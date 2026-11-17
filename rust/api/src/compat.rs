//! Public form and commentary contracts retained while the reader and server
//! share Rust. Searches call the same bounded engine path as the JSON API.
use crate::AppState;
use axum::{
    extract::{DefaultBodyLimit, FromRequest, Multipart, Request, State},
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Form, Json, Router,
};
use cross_canon_core::{Canon, Corpus, SearchMode, SearchRequest, CANONICAL_BOOKS};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Reader {
    Scripture,
    Fathers,
    Classics,
}
struct Catalog {
    books: HashSet<String>,
    fathers: HashSet<String>,
    classics: HashSet<String>,
}
struct CompatState {
    app: Arc<AppState>,
    catalog: Catalog,
    limits: Mutex<HashMap<String, Bucket>>,
    commentary_slots: Arc<tokio::sync::Semaphore>,
}
struct Bucket {
    count: u32,
    reset: Instant,
}

pub fn router(app: Arc<AppState>) -> Router {
    routes(Arc::new(CompatState::new(app)))
}

impl CompatState {
    fn new(app: Arc<AppState>) -> Self {
        let catalog = Catalog {
            books: app
                .engine
                .library
                .books
                .iter()
                .filter(|book| book.corpus == Corpus::Scripture)
                .map(|book| book.id.clone())
                .collect(),
            fathers: app
                .engine
                .library
                .books
                .iter()
                .filter(|book| book.corpus == Corpus::EarlyChristian)
                .filter_map(|book| book.author.clone())
                .collect(),
            classics: app
                .engine
                .library
                .books
                .iter()
                .filter(|book| book.corpus == Corpus::ChristianClassics)
                .filter_map(|book| book.author.clone())
                .collect(),
        };
        Self {
            app,
            catalog,
            limits: Mutex::new(HashMap::new()),
            commentary_slots: Arc::new(tokio::sync::Semaphore::new(2)),
        }
    }
}

fn routes(state: Arc<CompatState>) -> Router {
    Router::new()
        .route("/", post(scripture))
        .route("/church-fathers", post(fathers))
        .route("/church-fathers/", post(fathers))
        .route("/christian-classics/read", post(classics))
        .route("/christian-classics/read/", post(classics))
        .route("/api/classic-commentary", get(commentary))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(state)
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
fn bad(message: &str) -> Response {
    error(StatusCode::BAD_REQUEST, message)
}
fn trim(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}
fn value<'a>(form: &'a [(String, String)], key: &str) -> Option<&'a str> {
    form.iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}
fn values(form: &[(String, String)], key: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    form.iter()
        .filter(|(name, _)| name == key)
        .map(|(_, value)| trim(value))
        .filter(|value| !value.is_empty() && seen.insert((*value).to_owned()))
        .map(str::to_owned)
        .collect()
}
// Form/query numbers previously used JavaScript Number, including numeric radix
// prefixes. Retain that parsing, with finite integer/range checks at each use.
fn number(value: &str) -> f64 {
    let value = trim(value);
    if value.is_empty() {
        return 0.0;
    }
    for (prefixes, radix) in [(["0x", "0X"], 16), (["0o", "0O"], 8), (["0b", "0B"], 2)] {
        if let Some(digits) = prefixes
            .iter()
            .find_map(|prefix| value.strip_prefix(prefix))
        {
            return u64::from_str_radix(digits, radix)
                .map(|value| value as f64)
                .unwrap_or(f64::NAN);
        }
    }
    value.parse().unwrap_or(f64::NAN)
}
fn canon(value: Option<&str>) -> Canon {
    match value {
        Some("catholic") => Canon::Catholic,
        Some("orthodox") => Canon::Orthodox,
        _ => Canon::Protestant,
    }
}
fn canonical(canon: Canon, book: &str) -> bool {
    CANONICAL_BOOKS.contains(&book) && canon.includes(book)
}

#[derive(Debug)]
struct Prepared {
    reader: Reader,
    target: Corpus,
    similar: bool,
    canon: Canon,
    books: Vec<String>,
    authors: Vec<String>,
    search: SearchRequest,
}
fn prepare(
    form: &[(String, String)],
    reader: Reader,
    catalog: &Catalog,
) -> Result<Prepared, &'static str> {
    let intent = value(form, "intent").unwrap_or("theme");
    let work = if value(form, "targetCorpus") == Some("christian-classics")
        || (reader == Reader::Scripture && intent.contains("classics"))
        || (reader == Reader::Classics && value(form, "targetCorpus") != Some("early-christian"))
    {
        Corpus::ChristianClassics
    } else {
        Corpus::EarlyChristian
    };
    let count = number(value(form, "matchCount").unwrap_or("10"));
    let requested_authors = values(
        form,
        if reader == Reader::Scripture {
            "earlyChristianAuthors"
        } else {
            "authors"
        },
    );
    let known_authors = if work == Corpus::ChristianClassics {
        &catalog.classics
    } else {
        &catalog.fathers
    };
    let parsed_authors = || {
        if requested_authors.len() > 3 {
            return Err("Choose up to 3 authors.");
        }
        let authors: Vec<_> = requested_authors
            .iter()
            .filter(|author| known_authors.contains(*author))
            .cloned()
            .collect();
        if !requested_authors.is_empty() && authors.is_empty() {
            return Err("Choose at least one indexed author in this collection.");
        }
        Ok(authors)
    };
    let parsed_count = || {
        if !count.is_finite() || count.fract() != 0.0 || !(5.0..=40.0).contains(&count) {
            Err("Choose between 5 and 40 matches.")
        } else {
            Ok(count as usize)
        }
    };
    // Preserve which validation error wins when more than one field is invalid.
    let (authors, limit) = if reader == Reader::Scripture {
        let authors = parsed_authors()?;
        (authors, parsed_count()?)
    } else {
        let limit = parsed_count()?;
        (parsed_authors()?, limit)
    };
    let (similar, target) = if reader == Reader::Scripture {
        match intent {
            "similar-passage" => (true, Corpus::Scripture),
            "similar-classics" => (true, Corpus::ChristianClassics),
            "theme-classics" => (false, Corpus::ChristianClassics),
            "similar-early-christian" => (true, Corpus::EarlyChristian),
            "theme-early-christian" => (false, Corpus::EarlyChristian),
            _ => (false, Corpus::Scripture),
        }
    } else {
        match intent {
            "similar-passage" => (true, work),
            "similar-scripture" => (true, Corpus::Scripture),
            "theme-scripture" => (false, Corpus::Scripture),
            _ => (false, work),
        }
    };
    let canon = canon(value(form, "canon"));
    let mut books = vec![];
    let mut search_books = vec![];
    if reader == Reader::Scripture || target == Corpus::Scripture {
        let selected = values(form, "books");
        books = selected
            .iter()
            .filter(|book| {
                canonical(canon, book)
                    && (reader != Reader::Scripture || catalog.books.contains(*book))
            })
            .cloned()
            .collect();
        if !selected.is_empty() && books.is_empty() {
            return Err(if reader == Reader::Scripture {
                "Choose at least one indexed book in the selected canon."
            } else {
                "Choose at least one book in the selected canon."
            });
        }
        search_books = if !books.is_empty() {
            books.clone()
        } else {
            CANONICAL_BOOKS
                .iter()
                .filter(|book| {
                    canon.includes(book)
                        && (reader != Reader::Scripture || catalog.books.contains(**book))
                })
                .map(|book| (*book).to_owned())
                .collect()
        };
    }
    let query = if similar {
        String::new()
    } else {
        let question = trim(value(form, "question").unwrap_or(""));
        let length = question.encode_utf16().count();
        if length < 3 {
            return Err("Enter a longer question.");
        }
        if length > 500 {
            return Err("Keep the question under 500 characters.");
        }
        question.to_owned()
    };
    let source_id = if similar {
        let source = trim(value(form, "sourcePassageId").unwrap_or(""));
        if reader == Reader::Scripture
            && !(source.len() == 24
                && source
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
        {
            return Err("Choose a passage to search from.");
        }
        Some(source.to_owned())
    } else {
        None
    };
    Ok(Prepared {
        reader,
        target,
        similar,
        canon,
        books,
        authors: authors.clone(),
        search: SearchRequest {
            query,
            source_id,
            corpus: Some(target),
            canon: Canon::Orthodox,
            books: if target == Corpus::Scripture {
                search_books
            } else {
                vec![]
            },
            authors: if target == Corpus::Scripture {
                vec![]
            } else {
                authors
            },
            web: true,
            limit,
            mode: SearchMode::Semantic,
        },
    })
}
fn calibrated(results: &mut Value) {
    if let Some(results) = results.as_array_mut() {
        for result in results {
            let score = result["score"].as_f64().filter(|score| score.is_finite());
            let strength = match score {
                Some(score) if score >= 0.8_f64 * 0.9 => 4,
                Some(score) if score >= 0.8_f64 * 0.8 => 3,
                Some(score) if score >= 0.8_f64 * 0.7 => 2,
                _ => 1,
            };
            result["matchStrength"] = json!(strength);
        }
    }
}
fn response_data(request: &Prepared, mut results: Value, source: Value) -> Value {
    calibrated(&mut results);
    let scripture_reader = request.reader == Reader::Scripture;
    let scripture_target = request.target == Corpus::Scripture;
    let mut data = json!({"matchCount":request.search.limit,"targetCorpus":request.target});
    if scripture_target || scripture_reader && request.similar {
        data["books"] = json!(request.books);
        data["canon"] = json!(request.canon);
    }
    let mode = if scripture_reader && !scripture_target {
        format!(
            "{}-{}",
            if request.similar { "similar" } else { "theme" },
            if request.target == Corpus::ChristianClassics {
                "classics"
            } else {
                "early-christian"
            }
        )
    } else if !scripture_reader && scripture_target {
        format!(
            "{}-scripture",
            if request.similar { "similar" } else { "theme" }
        )
    } else {
        if request.similar { "similar" } else { "theme" }.to_owned()
    };
    data["mode"] = json!(mode);
    if scripture_reader {
        data["earlyChristianAuthors"] = json!(request.authors);
    } else if !scripture_target {
        data["authors"] = json!(request.authors);
    }
    let field = if scripture_target && !scripture_reader {
        "scriptureResults"
    } else if !scripture_target && scripture_reader {
        "earlyChristianResults"
    } else {
        "results"
    };
    data[field] = results;
    if request.similar {
        data[if !scripture_reader && scripture_target {
            "similarScriptureSource"
        } else {
            "similarSource"
        }] = source;
    } else {
        data["question"] = json!(request.search.query);
    }
    data
}
fn missing_source(request: &Prepared) -> &'static str {
    if request.reader != Reader::Scripture {
        "Choose an indexed passage to search from."
    } else if request.target == Corpus::Scripture {
        "That passage is not available for similarity search."
    } else {
        "That passage is not available for similarity search in this collection."
    }
}

fn client_ip(headers: &HeaderMap) -> String {
    if let Some(value) = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
    {
        let first = trim(value.split(',').next().unwrap_or(""));
        return if first.is_empty() {
            "unknown".into()
        } else {
            first.into()
        };
    }
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown")
        .to_owned()
}
fn rate_limit(buckets: &mut HashMap<String, Bucket>, ip: String, now: Instant) -> Result<(), u64> {
    if buckets.len() >= 10_000 {
        buckets.retain(|_, bucket| bucket.reset > now);
    }
    let bucket = buckets.entry(ip).or_insert(Bucket {
        count: 0,
        reset: now + Duration::from_secs(60),
    });
    if bucket.reset <= now {
        *bucket = Bucket {
            count: 0,
            reset: now + Duration::from_secs(60),
        };
    }
    if bucket.count >= 5 {
        return Err((bucket.reset - now).as_secs_f64().ceil().max(1.0) as u64);
    }
    bucket.count += 1;
    Ok(())
}
async fn scripture(State(state): State<Arc<CompatState>>, request: Request) -> Response {
    handle(state, request, Reader::Scripture).await
}
async fn fathers(State(state): State<Arc<CompatState>>, request: Request) -> Response {
    handle(state, request, Reader::Fathers).await
}
async fn classics(State(state): State<Arc<CompatState>>, request: Request) -> Response {
    handle(state, request, Reader::Classics).await
}
async fn read_form(request: Request) -> Result<Vec<(String, String)>, Response> {
    if request
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .to_ascii_lowercase()
                .starts_with("multipart/form-data")
        })
    {
        let mut multipart = Multipart::from_request(request, &())
            .await
            .map_err(|_| bad("Provide a valid search form."))?;
        let mut fields = vec![];
        while let Some(field) = multipart
            .next_field()
            .await
            .map_err(|_| bad("Provide a valid search form."))?
        {
            let name = field.name().unwrap_or("").to_owned();
            let text = if field.file_name().is_some() {
                "[object File]".to_owned()
            } else {
                field
                    .text()
                    .await
                    .map_err(|_| bad("Provide a valid search form."))?
            };
            fields.push((name, text));
        }
        Ok(fields)
    } else {
        Form::<Vec<(String, String)>>::from_request(request, &())
            .await
            .map(|Form(form)| form)
            .map_err(|_| bad("Provide a valid search form."))
    }
}
async fn handle(state: Arc<CompatState>, request: Request, reader: Reader) -> Response {
    let limited = {
        match state.limits.lock() {
            Ok(mut buckets) => Ok(rate_limit(
                &mut buckets,
                client_ip(request.headers()),
                Instant::now(),
            )),
            Err(_) => Err(()),
        }
    };
    match limited {
        Ok(Ok(())) => (),
        Ok(Err(retry)) => {
            let mut response = (StatusCode::TOO_MANY_REQUESTS, Json(json!({"error":"Rate limit reached. Try again in a moment.","retryAfterSeconds":retry}))).into_response();
            response
                .headers_mut()
                .insert("retry-after", retry.to_string().parse().unwrap());
            return response;
        }
        Err(_) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Search could not be completed",
            )
        }
    }
    let form = match read_form(request).await {
        Ok(form) => form,
        Err(response) => return response,
    };
    let prepared = match prepare(&form, reader, &state.catalog) {
        Ok(prepared) => prepared,
        Err(message) => return bad(message),
    };
    match crate::search(State(state.app.clone()), Json(prepared.search.clone())).await {
        Ok(Json(payload)) => {
            let mut response = Json(response_data(
                &prepared,
                payload["results"].clone(),
                payload["source"].clone(),
            ))
            .into_response();
            response
                .headers_mut()
                .insert("x-cross-canon-search", "rust".parse().unwrap());
            response
        }
        Err(crate::ApiError(status, message)) => {
            let lower = message.to_ascii_lowercase();
            if prepared.similar
                && status == StatusCode::BAD_REQUEST
                && ["source passage", "stored embedding", "no rows"]
                    .iter()
                    .any(|pattern| lower.contains(pattern))
            {
                bad(missing_source(&prepared))
            } else if status == StatusCode::TOO_MANY_REQUESTS {
                (
                    status,
                    Json(json!({"error":message,"retryAfterSeconds":60})),
                )
                    .into_response()
            } else {
                error(status, &message)
            }
        }
    }
}

struct CommentaryQuery {
    book: String,
    chapter: u32,
    start: u32,
    end: u32,
}
fn commentary_query(uri: &Uri) -> Option<CommentaryQuery> {
    let query: Vec<_> = url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .into_owned()
        .collect();
    let book = value(&query, "book").unwrap_or("");
    let chapter = number(value(&query, "chapter").unwrap_or("0"));
    let start = number(value(&query, "verseStart").unwrap_or("1"));
    let end = number(value(&query, "verseEnd").unwrap_or("1000"));
    if book.is_empty()
        || book.encode_utf16().count() > 40
        || !chapter.is_finite()
        || chapter.fract() != 0.0
        || !(1.0..=151.0).contains(&chapter)
        || !start.is_finite()
        || start.fract() != 0.0
        || start < 1.0
        || !end.is_finite()
        || end.fract() != 0.0
        || end < start
        || end > 1000.0
    {
        return None;
    }
    Some(CommentaryQuery {
        book: book.to_owned(),
        chapter: chapter as u32,
        start: start as u32,
        end: end as u32,
    })
}
async fn commentary(State(state): State<Arc<CompatState>>, uri: Uri) -> Response {
    let Some(query) = commentary_query(&uri) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                json!({"error":"Choose a Bible chapter and verse range.","version":"","works":[]}),
            ),
        )
            .into_response();
    };
    let Ok(permit) = state.commentary_slots.clone().try_acquire_owned() else {
        let mut response = (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"Commentary is busy; try again shortly.","version":"","works":[]})),
        )
            .into_response();
        response
            .headers_mut()
            .insert("retry-after", "1".parse().unwrap());
        return response;
    };
    let engine = state.app.engine.clone();
    match tokio::task::spawn_blocking(move || {
        // Own the permit inside the blocking task: disconnecting a request must
        // not release capacity while its uncancellable work is still running.
        let _permit = permit;
        engine.classics()?.commentary(
            &engine.library.root,
            &query.book,
            query.chapter,
            query.start,
            query.end,
        )
    })
    .await
    {
        Ok(Ok(data)) => {
            let mut response = Json(data).into_response();
            response
                .headers_mut()
                .insert("cache-control", "public, max-age=60".parse().unwrap());
            response
        }
        error => {
            tracing::error!("Commentary lookup failed: {error:?}");
            error_response()
        }
    }
}
fn error_response() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Commentary could not be loaded",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use cross_canon_core::Library;
    use http_body_util::BodyExt;
    use std::path::Path;
    use tower::ServiceExt;

    fn fixture_catalog() -> Catalog {
        Catalog {
            books: ["Genesis", "John", "Tobit"]
                .map(str::to_owned)
                .into_iter()
                .collect(),
            fathers: ["Clement of Rome", "Augustine"]
                .map(str::to_owned)
                .into_iter()
                .collect(),
            classics: ["Thomas à Kempis", "Matthew Henry and continuators"]
                .map(str::to_owned)
                .into_iter()
                .collect(),
        }
    }
    fn fields(values: &[(&str, &str)]) -> Vec<(String, String)> {
        values
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect()
    }
    #[test]
    fn form_validation_preserves_canon_author_source_and_error_precedence() {
        let catalog = fixture_catalog();
        for (reader, pairs, expected) in [
            (
                Reader::Scripture,
                vec![("question", "no")],
                "Enter a longer question.",
            ),
            (
                Reader::Scripture,
                vec![("matchCount", "41"), ("question", "hope")],
                "Choose between 5 and 40 matches.",
            ),
            (
                Reader::Scripture,
                vec![("matchCount", ""), ("question", "hope")],
                "Choose between 5 and 40 matches.",
            ),
            (
                Reader::Scripture,
                vec![
                    ("intent", "similar-passage"),
                    ("sourcePassageId", "ecw:123"),
                ],
                "Choose a passage to search from.",
            ),
            (
                Reader::Scripture,
                vec![
                    ("question", "hope"),
                    ("canon", "protestant"),
                    ("books", "Tobit"),
                ],
                "Choose at least one indexed book in the selected canon.",
            ),
            (
                Reader::Scripture,
                vec![("question", "hope"), ("books", "Mark")],
                "Choose at least one indexed book in the selected canon.",
            ),
            (
                Reader::Fathers,
                vec![
                    ("question", "hope"),
                    ("intent", "theme-scripture"),
                    ("canon", "catholic"),
                    ("books", "3 Maccabees"),
                ],
                "Choose at least one book in the selected canon.",
            ),
            (
                Reader::Scripture,
                vec![("matchCount", "41"), ("earlyChristianAuthors", "unknown")],
                "Choose at least one indexed author in this collection.",
            ),
            (
                Reader::Fathers,
                vec![("matchCount", "41"), ("authors", "unknown")],
                "Choose between 5 and 40 matches.",
            ),
            (
                Reader::Classics,
                vec![("question", "hope"), ("authors", "Augustine")],
                "Choose at least one indexed author in this collection.",
            ),
            (
                Reader::Scripture,
                vec![
                    ("intent", "theme-classics"),
                    ("question", "hope"),
                    ("earlyChristianAuthors", "Augustine"),
                ],
                "Choose at least one indexed author in this collection.",
            ),
            (
                Reader::Fathers,
                vec![
                    ("authors", "a"),
                    ("authors", "b"),
                    ("authors", "c"),
                    ("authors", "d"),
                ],
                "Choose up to 3 authors.",
            ),
        ] {
            assert_eq!(
                prepare(&fields(&pairs), reader, &catalog).unwrap_err(),
                expected
            );
        }
        let long = "😀".repeat(251);
        assert_eq!(
            prepare(&fields(&[("question", &long)]), Reader::Scripture, &catalog).unwrap_err(),
            "Keep the question under 500 characters."
        );
        let prepared = prepare(
            &fields(&[
                ("question", "  hope  "),
                ("matchCount", "0xA"),
                ("canon", "catholic"),
                ("books", "Tobit"),
                ("books", "3 Maccabees"),
                ("books", "Tobit"),
                ("books", "Mark"),
            ]),
            Reader::Scripture,
            &catalog,
        )
        .unwrap();
        assert_eq!(prepared.search.query, "hope");
        assert_eq!(prepared.search.limit, 10);
        assert_eq!(prepared.books, vec!["Tobit"]);
        assert_eq!(prepared.search.books, vec!["Tobit"]);
        assert_eq!(
            prepared.search.canon,
            Canon::Orthodox,
            "Explicit book scope carries the canon to the same engine contract as before"
        );
        let prepared = prepare(
            &fields(&[
                ("question", "hope"),
                ("intent", "theme-classics"),
                ("earlyChristianAuthors", "  Thomas à Kempis  "),
                ("earlyChristianAuthors", "Thomas à Kempis"),
                ("earlyChristianAuthors", "unknown"),
            ]),
            Reader::Scripture,
            &catalog,
        )
        .unwrap();
        assert_eq!(prepared.authors, vec!["Thomas à Kempis"]);
        assert_eq!(prepared.search.authors, vec!["Thomas à Kempis"]);
        assert_eq!(prepared.target, Corpus::ChristianClassics);
    }

    #[test]
    fn all_reader_target_and_search_modes_keep_the_public_json_shape() {
        let catalog = fixture_catalog();
        for reader in [Reader::Scripture, Reader::Fathers, Reader::Classics] {
            for target in [
                Corpus::Scripture,
                Corpus::EarlyChristian,
                Corpus::ChristianClassics,
            ] {
                for similar in [false, true] {
                    let target_name = match target {
                        Corpus::Scripture => "scripture",
                        Corpus::EarlyChristian => "early-christian",
                        Corpus::ChristianClassics => "christian-classics",
                    };
                    let mode = if similar { "similar" } else { "theme" };
                    let intent = if reader == Reader::Scripture {
                        if target == Corpus::Scripture {
                            if similar {
                                "similar-passage".into()
                            } else {
                                "theme".into()
                            }
                        } else {
                            format!(
                                "{mode}-{}",
                                if target == Corpus::ChristianClassics {
                                    "classics"
                                } else {
                                    "early-christian"
                                }
                            )
                        }
                    } else if target == Corpus::Scripture {
                        format!("{mode}-scripture")
                    } else {
                        if similar {
                            "similar-passage".into()
                        } else {
                            "theme".into()
                        }
                    };
                    let source = if reader == Reader::Scripture {
                        "aaaaaaaaaaaaaaaaaaaaaaaa"
                    } else {
                        "anf09:xii.iv.ii:1-3"
                    };
                    let author = if target == Corpus::ChristianClassics {
                        "Thomas à Kempis"
                    } else {
                        "Clement of Rome"
                    };
                    let mut form = fields(&[
                        ("intent", &intent),
                        ("targetCorpus", target_name),
                        ("canon", "catholic"),
                        ("books", "John"),
                        ("matchCount", "10"),
                    ]);
                    form.push(if similar {
                        ("sourcePassageId".into(), source.into())
                    } else {
                        ("question".into(), "  hope and comfort  ".into())
                    });
                    if target != Corpus::Scripture {
                        form.push((
                            if reader == Reader::Scripture {
                                "earlyChristianAuthors"
                            } else {
                                "authors"
                            }
                            .into(),
                            author.into(),
                        ));
                    }
                    let prepared = prepare(&form, reader, &catalog).unwrap();
                    assert_eq!(prepared.target, target);
                    assert_eq!(prepared.similar, similar);
                    assert_eq!(
                        prepared.search.source_id,
                        similar.then(|| source.to_owned())
                    );
                    let results = json!([{"id":"result","score":0.72,"highlightVerse":3}]);
                    let source = json!({"id":source,"reference":"Selected passage","text":"Selected original text"});
                    let data = response_data(&prepared, results, source.clone());
                    assert_eq!(data["targetCorpus"], target_name);
                    let result_field = if target == Corpus::Scripture && reader != Reader::Scripture
                    {
                        "scriptureResults"
                    } else if target != Corpus::Scripture && reader == Reader::Scripture {
                        "earlyChristianResults"
                    } else {
                        "results"
                    };
                    assert_eq!(data[result_field][0]["highlightVerse"], 3);
                    assert_eq!(
                        data[result_field][0]["matchStrength"], 3,
                        "JS's 0.8*0.9 threshold is slightly above 0.72"
                    );
                    assert_eq!(data.get("question").is_some(), !similar);
                    assert_eq!(
                        data.get("books").is_some(),
                        target == Corpus::Scripture || reader == Reader::Scripture && similar
                    );
                    if similar {
                        assert_eq!(
                            data[if target == Corpus::Scripture && reader != Reader::Scripture {
                                "similarScriptureSource"
                            } else {
                                "similarSource"
                            }],
                            source
                        );
                    }
                }
            }
        }
        let mut results =
            json!([{"score":0.8},{"score":0.72},{"score":0.64},{"score":0.56},{"score":0.55},{}]);
        calibrated(&mut results);
        assert_eq!(
            results
                .as_array()
                .unwrap()
                .iter()
                .map(|result| result["matchStrength"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![4, 3, 2, 2, 1, 1]
        );
    }

    #[test]
    fn compatibility_rate_budget_is_shared_by_ip_and_expires_after_one_minute() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", " 203.0.113.1, 10.0.0.1".parse().unwrap());
        headers.insert("cf-connecting-ip", "203.0.113.2".parse().unwrap());
        assert_eq!(client_ip(&headers), "203.0.113.1");
        headers.remove("x-forwarded-for");
        assert_eq!(client_ip(&headers), "203.0.113.2");
        let now = Instant::now();
        let mut buckets = HashMap::new();
        for _ in 0..5 {
            assert_eq!(rate_limit(&mut buckets, "one".into(), now), Ok(()));
        }
        assert_eq!(rate_limit(&mut buckets, "one".into(), now), Err(60));
        assert_eq!(
            rate_limit(
                &mut buckets,
                "one".into(),
                now + Duration::from_millis(59_500)
            ),
            Err(1)
        );
        assert_eq!(rate_limit(&mut buckets, "two".into(), now), Ok(()));
        assert_eq!(
            rate_limit(&mut buckets, "one".into(), now + Duration::from_secs(60)),
            Ok(())
        );
    }

    #[tokio::test]
    async fn encoded_and_multipart_forms_preserve_repeated_fields_and_first_scalar() {
        let encoded = Request::builder()
            .method("POST")
            .header("content-type", "application/x-www-form-urlencoded")
            .body(axum::body::Body::from(
                "question=first&question=second&authors=Clement+of+Rome&authors=Augustine",
            ))
            .unwrap();
        let form = read_form(encoded).await.unwrap();
        assert_eq!(value(&form, "question"), Some("first"));
        assert_eq!(
            values(&form, "authors"),
            vec!["Clement of Rome", "Augustine"]
        );
        let multipart = Request::builder().method("POST").header("content-type","multipart/form-data; boundary=search-test")
            .body(axum::body::Body::from("--search-test\r\nContent-Disposition: form-data; name=\"question\"\r\n\r\nhope\r\n--search-test\r\nContent-Disposition: form-data; name=\"authors\"\r\n\r\nClement of Rome\r\n--search-test--\r\n")).unwrap();
        let form = read_form(multipart).await.unwrap();
        assert_eq!(value(&form, "question"), Some("hope"));
        assert_eq!(values(&form, "authors"), vec!["Clement of Rome"]);
    }

    #[test]
    fn commentary_validation_and_exact_coverage_exclude_scripture_quotations() {
        for query in [
            "book=John",
            "book=John&chapter=152",
            "book=John&chapter=3&verseStart=0",
            "book=John&chapter=3&verseStart=4&verseEnd=3",
            "book=John&chapter=3&verseEnd=1001",
        ] {
            assert!(
                commentary_query(&format!("/api/classic-commentary?{query}").parse().unwrap())
                    .is_none()
            );
        }
        let root = std::env::temp_dir().join(format!(
            "cross-canon-compat-commentary-{}",
            std::process::id()
        ));
        let folder = root.join("public/christian-classics-text");
        std::fs::create_dir_all(folder.join("chapters")).unwrap();
        std::fs::write(
            folder.join("manifest.json"),
            json!({"version":"fixture","bookIndexPath":"/christian-classics-text/books.json"})
                .to_string(),
        )
        .unwrap();
        let chapter = json!({"id":"commentary","scriptureReference":{"book":"John","chapter":3},"assetPath":"/christian-classics-text/chapters/commentary.json","quotationSentenceRanges":[[1,1]]});
        std::fs::write(folder.join("books.json"),json!({"books":[{"id":"classic","name":"Classic commentary","author":"Commentator","metadata":{"tradition":"Test"},"chapters":[chapter]}]}).to_string()).unwrap();
        std::fs::write(
            folder.join("chapters/commentary.json"),
            json!({"verses":[
                {"scriptureVerseStart":16,"scriptureVerseEnd":18,"scriptureQuotation":true},
                {"scriptureVerseStart":17,"scriptureVerseEnd":19,"text":"Original explanation"}
            ]})
            .to_string(),
        )
        .unwrap();
        let cache = crate::classics::CatalogCache::default();
        let manifest = std::fs::read(folder.join("manifest.json")).unwrap();
        std::fs::remove_file(folder.join("manifest.json")).unwrap();
        assert!(cache.get(&root).is_err());
        std::fs::write(folder.join("manifest.json"), manifest).unwrap();
        let catalog = cache.get(&root).unwrap();
        let chapter_bytes = std::fs::read(folder.join("chapters/commentary.json")).unwrap();
        std::fs::remove_file(folder.join("chapters/commentary.json")).unwrap();
        assert!(catalog.commentary(&root, "John", 3, 16, 16).is_err());
        std::fs::write(folder.join("chapters/commentary.json"), chapter_bytes).unwrap();
        std::fs::remove_file(folder.join("books.json")).unwrap();
        assert_eq!(catalog.quotations.get("commentary"), Some(&vec![[1, 1]]));
        let query = |start, end| CommentaryQuery {
            book: "John".into(),
            chapter: 3,
            start,
            end,
        };
        assert_eq!(
            catalog
                .commentary(&root, &query(16, 16).book, 3, 16, 16)
                .unwrap()["works"],
            json!([])
        );
        std::fs::remove_file(folder.join("chapters/commentary.json")).unwrap();
        let response = catalog.commentary(&root, "John", 3, 19, 19).unwrap();
        assert_eq!(response["version"], "fixture");
        assert_eq!(
            response["works"][0],
            json!({"id":"classic","title":"Classic commentary","author":"Commentator","tradition":"Test","chapter":chapter})
        );
        assert_eq!(
            catalog.commentary(&root, "John", 3, 20, 20).unwrap()["works"],
            json!([])
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn actual_readonly_indexes_form_searches_preserve_sources_scopes_and_errors() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let engine = crate::engine::Engine::load(
            Arc::new(Library::load_server(&root).unwrap()),
            &root.join("storage/crosscannon.db"),
            &root.join("storage/early-christian-works.db"),
        )
        .unwrap();
        let scripture = engine.library.book("Genesis").unwrap().chapters[0].passage_ids[0].clone();
        let fathers = engine
            .library
            .books
            .iter()
            .find(|book| book.author.as_deref() == Some("Clement of Rome"))
            .unwrap()
            .chapters[0]
            .passage_ids[0]
            .clone();
        let classics =
            engine.library.book("classics:imitation").unwrap().chapters[0].passage_ids[0].clone();
        let state = Arc::new(CompatState::new(Arc::new(
            AppState::new(engine, None).unwrap(),
        )));
        let router = routes(state.clone());
        let permits = state
            .commentary_slots
            .clone()
            .acquire_many_owned(2)
            .await
            .unwrap();
        let busy = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/classic-commentary?book=John&chapter=3&verseStart=16")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(busy.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(busy.headers()["retry-after"], "1");
        assert_eq!(
            state.app.slots.available_permits(),
            4,
            "Commentary has its own budget"
        );
        drop(permits);
        for (index, (route, pairs, field, corpus)) in [
            (
                "/",
                vec![
                    ("intent", "similar-passage"),
                    ("sourcePassageId", scripture.as_str()),
                    ("matchCount", "5"),
                    ("books", "John"),
                ],
                "results",
                Corpus::Scripture,
            ),
            (
                "/church-fathers",
                vec![
                    ("intent", "similar-scripture"),
                    ("sourcePassageId", fathers.as_str()),
                    ("matchCount", "5"),
                    ("books", "John"),
                ],
                "scriptureResults",
                Corpus::Scripture,
            ),
            (
                "/",
                vec![
                    ("intent", "similar-classics"),
                    ("sourcePassageId", scripture.as_str()),
                    ("matchCount", "5"),
                    ("earlyChristianAuthors", "Thomas à Kempis"),
                ],
                "earlyChristianResults",
                Corpus::ChristianClassics,
            ),
            (
                "/christian-classics/read",
                vec![
                    ("intent", "similar-scripture"),
                    ("sourcePassageId", classics.as_str()),
                    ("matchCount", "5"),
                    ("books", "John"),
                ],
                "scriptureResults",
                Corpus::Scripture,
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let body = url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(pairs)
                .finish();
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("{route}?_data=legacy"))
                        .header("content-type", "application/x-www-form-urlencoded")
                        .header("x-forwarded-for", format!("203.0.113.{}", index + 1))
                        .body(axum::body::Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), 200, "{route}");
            assert_eq!(response.headers()["x-cross-canon-search"], "rust");
            let data: Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(data["targetCorpus"], json!(corpus));
            assert_eq!(data[field].as_array().unwrap().len(), 5);
            for result in data[field].as_array().unwrap() {
                assert!((1..=4).contains(&result["matchStrength"].as_u64().unwrap()));
                if corpus == Corpus::Scripture {
                    assert!(result["reference"].as_str().unwrap().starts_with("John "));
                } else {
                    assert!(result["chapterId"]
                        .as_str()
                        .unwrap()
                        .starts_with("classics:imitation:"));
                }
            }
            let source = data
                .get("similarScriptureSource")
                .or_else(|| data.get("similarSource"))
                .unwrap();
            assert!(source["id"].is_string());
            assert!(source["reference"].is_string());
            if route != "/" {
                assert!(source["text"].is_string());
            }
        }
        for (index, (route, body, status, message)) in [
            (
                "/",
                "intent=similar-passage&sourcePassageId=ffffffffffffffffffffffff",
                400,
                "That passage is not available for similarity search.",
            ),
            (
                "/church-fathers",
                "intent=similar-passage&sourcePassageId=ecw%3Amissing",
                400,
                "Choose an indexed passage to search from.",
            ),
            (
                "/",
                "question=hope",
                503,
                "Theme search is unavailable; keyword and similar-passage search remain available",
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(route)
                        .header("content-type", "application/x-www-form-urlencoded")
                        .header("x-forwarded-for", format!("203.0.113.{}", index + 10))
                        .body(axum::body::Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            let data: Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(data["error"], message);
        }
        for count in 0..6 {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(if count % 2 == 0 {
                            "/"
                        } else {
                            "/church-fathers"
                        })
                        .header("x-forwarded-for", "203.0.113.99")
                        .header("content-type", "application/x-www-form-urlencoded")
                        .body(axum::body::Body::from("question=no"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), if count == 5 { 429 } else { 400 });
            if count == 5 {
                assert_eq!(response.headers()["retry-after"], "60");
            }
        }
        for (path, status) in [
            (
                "/api/classic-commentary?book=John&chapter=3&verseStart=16&verseEnd=16",
                200,
            ),
            ("/api/classic-commentary?book=John&chapter=0", 400),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            if status == 200 {
                assert_eq!(response.headers()["cache-control"], "public, max-age=60");
            }
            let data: Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(data["error"].is_null(), status == 200);
            if status == 200 {
                assert!(!data["works"].as_array().unwrap().is_empty());
            }
        }
    }
}
