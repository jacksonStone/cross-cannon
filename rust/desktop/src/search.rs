//! Native adapter for the same refined result contract used by both web readers.
use super::*;
use serde_json::Value;

#[derive(Clone, Debug)]
pub(super) struct ResultPassage {
    pub id: String,
    pub source_id: String,
    pub reference: String,
    pub text: String,
    pub corpus: Corpus,
    pub score: f32,
    pub highlight_verse: Option<u32>,
}
impl ResultPassage {
    pub fn local(p: &Passage, score: f32) -> Self {
        Self {
            id: p.id.clone(),
            source_id: p.id.clone(),
            reference: p.reference.clone(),
            text: p.text.clone(),
            corpus: p.corpus,
            score,
            highlight_verse: None,
        }
    }
    pub fn strength(&self) -> usize {
        if self.score >= 0.72 {
            4
        } else if self.score >= 0.64 {
            3
        } else if self.score >= 0.56 {
            2
        } else {
            1
        }
    }
}

pub(super) fn decode_results(
    library: &Library,
    corpus: Corpus,
    payload: &Value,
) -> Result<Vec<ResultPassage>> {
    payload["results"]
        .as_array()
        .context("Invalid search response: missing results")?
        .iter()
        .map(|hit| {
            if corpus == Corpus::Scripture {
                let id = hit["id"].as_str().context("Missing Scripture passage ID")?;
                let p = library
                    .passage(id)
                    .context("Search result is missing from the local library")?;
                let mut result = ResultPassage::local(
                    p,
                    hit["score"].as_f64().context("Missing result score")? as f32,
                );
                result.highlight_verse = hit["highlightVerse"].as_u64().map(|v| v as u32);
                Ok(result)
            } else {
                let chapter = hit["chapterId"].as_str().context("Missing chapter ID")?;
                let highlight = &hit["highlightPassage"];
                let start = highlight["verseStart"]
                    .as_u64()
                    .context("Missing passage start")? as u32;
                let end = highlight["verseEnd"]
                    .as_u64()
                    .context("Missing passage end")? as u32;
                let (_, chapter) = library
                    .chapter(chapter)
                    .context("Search chapter is missing from the local library")?;
                let passages: Vec<_> = chapter
                    .passage_ids
                    .iter()
                    .filter_map(|id| library.passage(id))
                    .collect();
                let p = passages
                    .iter()
                    .find(|p| p.verse_start <= start && p.verse_end >= start)
                    .context("Search passage is missing from the local library")?;
                Ok(ResultPassage {
                    id: p.id.clone(),
                    source_id: highlight["id"]
                        .as_str()
                        .context("Missing source ID")?
                        .into(),
                    reference: highlight["reference"]
                        .as_str()
                        .context("Missing reference")?
                        .into(),
                    text: if corpus == Corpus::ChristianClassics {
                        highlight["text"]
                            .as_str()
                            .context("Missing Classics source paragraph")?
                            .to_owned()
                    } else {
                        passages
                            .iter()
                            .flat_map(|p| &p.verses)
                            .filter(|v| (start..=end).contains(&v.number))
                            .map(|v| v.text.as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    },
                    corpus,
                    score: hit["score"].as_f64().context("Missing score")? as f32,
                    highlight_verse: None,
                })
            }
        })
        .collect()
}

pub(super) fn remote_search(
    library: &Library,
    api: &str,
    request: &SearchRequest,
) -> Result<Vec<ResultPassage>> {
    // Retain the connection pool and TLS session across searches.
    static CLIENT: std::sync::OnceLock<std::result::Result<reqwest::blocking::Client, String>> =
        std::sync::OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(60))
                .connect_timeout(Duration::from_secs(15))
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    let response = client
        .post(format!("{api}/search"))
        .json(request)
        .send()
        .context("Search service is unreachable. Try again online or select Search Keywords.")?;
    let status = response.status();
    let payload: Value = response
        .json()
        .context("Search service returned an invalid response")?;
    if !status.is_success() {
        anyhow::bail!(
            "{}",
            payload["error"]
                .as_str()
                .unwrap_or("Search is unavailable; please try again")
        );
    }
    decode_results(
        library,
        request.corpus.context("Choose a search target")?,
        &payload,
    )
}

impl Desktop {
    pub(super) fn search_request(&self) -> SearchRequest {
        let scripture = self.search_corpus == Some(Corpus::Scripture);
        SearchRequest {
            query: if self.search_source.is_some() {
                String::new()
            } else {
                self.query.trim().into()
            },
            source_id: self.search_source.as_ref().map(|p| p.source_id.clone()),
            corpus: self.search_corpus,
            canon: self.state.canon,
            books: if scripture {
                self.search_books
                    .iter()
                    .filter(|b| self.state.canon.includes(b))
                    .cloned()
                    .collect()
            } else {
                vec![]
            },
            authors: if scripture {
                vec![]
            } else {
                self.search_authors.clone()
            },
            web: self.semantic || self.search_source.is_some(),
            limit: self.match_count,
            mode: if self.semantic || self.search_source.is_some() {
                SearchMode::Semantic
            } else {
                SearchMode::Keyword
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_remote_searches_reuse_the_same_connection() {
        use std::io::{BufRead, Read, Write};
        let library =
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            drop(listener); // A second TCP connection cannot succeed.
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
            for _ in 0..2 {
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    assert!(
                        reader.read_line(&mut line).unwrap() > 0,
                        "Both searches must reuse the open connection"
                    );
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse::<usize>().unwrap();
                    }
                }
                reader.read_exact(&mut vec![0; length]).unwrap();
                let body = r#"{"results":[]}"#;
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).unwrap();
                stream.flush().unwrap();
            }
        });
        let request = SearchRequest {
            query: "comfort".into(),
            corpus: Some(Corpus::Scripture),
            ..Default::default()
        };
        for _ in 0..2 {
            assert!(remote_search(&library, &api, &request).unwrap().is_empty());
        }
        server.join().unwrap();
    }
    use std::io::{Read, Write};
    fn library() -> Arc<Library> {
        Arc::new(Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap())
    }
    #[test]
    fn native_search_sends_web_contract_and_preserves_highlights() {
        let library = library();
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        app.query = "More money More Problems".into();
        app.search_books = vec!["Luke".into()];
        app.match_count = 5;
        let request = app.search_request();
        assert!(request.web);
        assert_eq!(request.query, app.query);
        assert_eq!(request.limit, 5);
        assert_eq!(request.books, ["Luke"]);
        assert!(matches!(request.mode, SearchMode::Semantic));
        let passage = library
            .passages
            .iter()
            .find(|p| p.book == "Luke")
            .unwrap()
            .clone();
        let response = serde_json::json!({"results":[{"id":passage.id,"reference":passage.reference,"type":"paragraph","score":0.7,"highlightVerse":passage.verse_start}]});
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = format!("http://{}/r/api", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .map(|s| s.trim().parse().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        let sent: Value =
                            serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap();
                        assert_eq!(sent["web"], true);
                        assert_eq!(sent["query"], "More money More Problems");
                        assert_eq!(sent["books"], serde_json::json!(["Luke"]));
                        break;
                    }
                }
            }
            let body = response.to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let hits = remote_search(&library, &api, &request).unwrap();
        server.join().unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, passage.id);
        assert_eq!(hits[0].highlight_verse, Some(passage.verse_start));
        assert_eq!(hits[0].text, passage.text);
        assert_eq!(hits[0].strength(), 3);
        app.search_source = Some(hits[0].clone());
        app.search_corpus = Some(Corpus::EarlyChristian);
        app.search_authors = vec!["Clement of Rome".into()];
        app.semantic = false; // Similarity must still use the index.
        let similar = app.search_request();
        assert!(similar.query.is_empty() && similar.web);
        assert_eq!(similar.source_id.as_deref(), Some(passage.id.as_str()));
        assert!(similar.books.is_empty());
        assert_eq!(similar.authors, ["Clement of Rome"]);
        app.search_corpus = Some(Corpus::ChristianClassics);
        app.search_authors = vec!["Thomas à Kempis".into()];
        let classics = app.search_request();
        assert_eq!(classics.corpus, Some(Corpus::ChristianClassics));
        assert_eq!(classics.authors, ["Thomas à Kempis"]);
        assert_eq!(classics.source_id, similar.source_id);
        assert_eq!(
            serde_json::to_value(&classics).unwrap()["corpus"],
            "christian-classics"
        );
    }

    #[test]
    fn refined_work_results_open_matching_local_range_and_keep_exact_source() {
        let library = library();
        for corpus in [Corpus::EarlyChristian, Corpus::ChristianClassics] {
            let p = library
                .passages
                .iter()
                .find(|p| p.corpus == corpus && p.verses.len() >= 3)
                .unwrap();
            // The server's indexed paragraph can be smaller than a merged reader paragraph.
            let start = p.verses[1].number;
            let end = p.verses[2].number;
            let payload = serde_json::json!({"results":[{"chapterId":p.chapter_id,"score":0.65,
            "highlightPassage":{"id":"ecw:exact-indexed-paragraph","reference":"Selected paragraph","text":"A complete authoritative source paragraph.","verseStart":start,"verseEnd":end}}]});
            let hits = decode_results(&library, corpus, &payload).unwrap();
            assert_eq!(hits[0].corpus, corpus);
            assert_eq!(hits[0].id, p.id);
            assert_eq!(hits[0].source_id, "ecw:exact-indexed-paragraph");
            assert_eq!(
                hits[0].text,
                if corpus == Corpus::ChristianClassics {
                    payload["results"][0]["highlightPassage"]["text"]
                        .as_str()
                        .unwrap()
                        .to_owned()
                } else {
                    format!("{} {}", p.verses[1].text, p.verses[2].text)
                }
            );
            assert_eq!(hits[0].reference, "Selected paragraph");
            assert_eq!(hits[0].strength(), 3);
        }
        assert!(decode_results(
            &library,
            Corpus::Scripture,
            &serde_json::json!({"results":[{"id":"missing"}]})
        )
        .is_err());
    }

    #[test]
    fn search_matches_mobile_web_scrolling_and_full_passages() {
        fn render(
            app: &mut Desktop,
            ctx: &egui::Context,
            width: f32,
            height: f32,
            events: Vec<egui::Event>,
        ) -> egui::FullOutput {
            ctx.run(
                egui::RawInput {
                    screen_rect: Some(Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(width, height),
                    )),
                    events,
                    ..Default::default()
                },
                |ctx| app.render(ctx),
            )
        }
        fn text<'a>(
            output: &'a egui::FullOutput,
            label: &str,
        ) -> Option<(&'a egui::epaint::ClippedShape, &'a egui::epaint::TextShape)> {
            output.shapes.iter().find_map(|shape| {
                if let egui::epaint::Shape::Text(text) = &shape.shape {
                    (text.galley.job.text == label).then_some((shape, text))
                } else {
                    None
                }
            })
        }
        let library = library();
        let first = &library.passages[0];
        let full_text = first
            .verses
            .iter()
            .map(|v| v.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        for (width, height) in [
            (320.0, 700.0),
            (393.0, 700.0),
            (393.0, 850.0),
            (700.0, 393.0),
            (1000.0, 850.0),
        ] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.dialog = Some(Dialog::Search);
            app.query = "More money More Problems".into();
            app.results = library
                .passages
                .iter()
                .take(20)
                .map(|p| ResultPassage::local(p, 0.6))
                .collect();
            for _ in 0..3 {
                render(&mut app, &ctx, width, height, vec![]);
            }
            let before = render(&mut app, &ctx, width, height, vec![]);
            let (_, title) =
                text(&before, "Find passages").expect("The search header must be visible");
            let header_pos = title.pos;
            let (mode, _) =
                text(&before, "Search Index (Online)").expect("The form begins visible");
            let body_clip = mode.clip_rect;
            assert!(
                body_clip.height()
                    >= height
                        - if width >= 600.0 && height >= 600.0 {
                            200.0
                        } else {
                            150.0
                        },
                "The scrolling body must use the screen below the header: {body_clip:?}"
            );
            render(
                &mut app,
                &ctx,
                width,
                height,
                vec![
                    egui::Event::PointerMoved(body_clip.center()),
                    egui::Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: egui::vec2(0.0, -600.0),
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
            let mut after = before;
            for _ in 0..40 {
                after = render(&mut app, &ctx, width, height, vec![]);
            }
            assert_eq!(
                text(&after, "Find passages").unwrap().1.pos,
                header_pos,
                "Only the header stays fixed"
            );
            assert!(
                text(&after, "Search Index (Online)").is_none_or(|(shape, t)| !shape
                    .clip_rect
                    .contains_rect(Rect::from_min_size(t.pos, t.galley.size()))),
                "The form must scroll away like mobile web"
            );
            let (passage_shape, passage_text) =
                text(&after, &full_text).expect("The complete first passage remains rendered");
            assert!(
                !passage_text.galley.elided && passage_text.galley.rows.len() > 4,
                "Search passages must not be abbreviated"
            );
            assert_eq!(
                passage_shape.clip_rect, body_clip,
                "The form and passages share one scroll viewport"
            );
            assert!(text(&after, "Read full passage").is_none());
            let passage_pos = passage_text.pos;
            let tap = Rect::from_min_size(passage_pos, passage_text.galley.size())
                .intersect(body_clip)
                .center();
            for pressed in [true, false] {
                render(
                    &mut app,
                    &ctx,
                    width,
                    height,
                    vec![
                        egui::Event::PointerMoved(tap),
                        egui::Event::PointerButton {
                            pos: tap,
                            button: egui::PointerButton::Primary,
                            pressed,
                            modifiers: egui::Modifiers::NONE,
                        },
                    ],
                );
            }
            let selected = render(&mut app, &ctx, width, height, vec![]);
            assert_eq!(
                app.selected_result.as_deref(),
                Some(first.id.as_str()),
                "Tapping a passage selects its actions"
            );
            assert_eq!(
                text(&selected, &full_text).unwrap().1.pos,
                passage_pos,
                "Selecting a passage must not expand or move its text"
            );
            let offset = app.search_scroll;
            app.filters_open = true;
            for _ in 0..3 {
                render(&mut app, &ctx, width, height, vec![]);
            }
            let filters = render(&mut app, &ctx, width, height, vec![]);
            assert!(
                text(&filters, "Clear all").is_some() && text(&filters, "Done").is_some(),
                "Filters have a separate dialog with footer actions"
            );
            app.filters_open = false;
            render(&mut app, &ctx, width, height, vec![]);
            assert_eq!(
                app.search_scroll, offset,
                "Closing filters restores the search position"
            );
        }
    }

    #[test]
    #[ignore = "Live comparison against production web forms and the online API"]
    fn live_web_search_parity() {
        let library = library();
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let bible = library.book("Genesis").unwrap().chapters[0].passage_ids[0].clone();
        let early = library
            .books
            .iter()
            .find(|b| b.author.as_deref() == Some("Clement of Rome"))
            .unwrap()
            .chapters[0]
            .passage_ids[0]
            .clone();
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap();
        let api = "https://www.crosscanon.com/r/api";
        // Corpus, source, canon, selected book, author, count, web reader route, intent.
        let cases = [
            (
                Corpus::Scripture,
                None,
                Canon::Protestant,
                None,
                None,
                10,
                false,
                "theme",
            ),
            (
                Corpus::Scripture,
                Some(bible.as_str()),
                Canon::Catholic,
                Some("Sirach"),
                None,
                5,
                false,
                "similar-passage",
            ),
            (
                Corpus::EarlyChristian,
                None,
                Canon::Protestant,
                None,
                Some("Clement of Rome"),
                5,
                false,
                "theme-early-christian",
            ),
            (
                Corpus::Scripture,
                Some(bible.as_str()),
                Canon::Protestant,
                Some("John"),
                None,
                5,
                false,
                "similar-passage",
            ),
            (
                Corpus::EarlyChristian,
                Some(bible.as_str()),
                Canon::Protestant,
                None,
                Some("Clement of Rome"),
                5,
                false,
                "similar-early-christian",
            ),
            (
                Corpus::Scripture,
                Some(early.as_str()),
                Canon::Orthodox,
                Some("1 Esdras"),
                None,
                5,
                true,
                "similar-scripture",
            ),
            (
                Corpus::EarlyChristian,
                Some(early.as_str()),
                Canon::Protestant,
                None,
                Some("Augustine of Hippo"),
                10,
                true,
                "similar-passage",
            ),
            (
                Corpus::EarlyChristian,
                None,
                Canon::Protestant,
                None,
                None,
                10,
                true,
                "theme",
            ),
        ];
        for (target, source, canon, book, author, count, fathers, intent) in cases {
            app.query = "More money More Problems".into();
            app.search_corpus = Some(target);
            app.search_source =
                source.map(|id| ResultPassage::local(library.passage(id).unwrap(), 0.0));
            app.state.canon = canon;
            app.search_books = book.map(String::from).into_iter().collect();
            app.search_authors = author.map(String::from).into_iter().collect();
            app.match_count = count;
            let native = remote_search(&library, api, &app.search_request()).unwrap();
            let mut form = vec![
                ("intent", intent.to_owned()),
                ("question", app.query.clone()),
                ("matchCount", count.to_string()),
                (
                    "canon",
                    serde_json::to_value(canon)
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .into(),
                ),
            ];
            if let Some(id) = source {
                form.push(("sourcePassageId", id.into()));
            }
            if let Some(book) = book {
                form.push(("books", book.into()));
            }
            if let Some(author) = author {
                form.push((
                    if fathers {
                        "authors"
                    } else {
                        "earlyChristianAuthors"
                    },
                    author.into(),
                ));
            }
            let url = if fathers {
                "https://www.crosscanon.com/church-fathers?_data=routes%2Fchurch-fathers"
            } else {
                "https://www.crosscanon.com/?_data=routes%2F_index"
            };
            let mut web = Value::Null;
            for attempt in 0..3 {
                let response = client.post(url).form(&form).send().unwrap();
                let status = response.status();
                let payload: Value = response.json().unwrap();
                if status.as_u16() == 429 && attempt < 2 {
                    let seconds = payload["retryAfterSeconds"].as_u64().unwrap_or(60) + 1;
                    eprintln!("Web rate limit: respecting {seconds}s cooldown before {intent}");
                    for _ in 0..seconds {
                        std::thread::sleep(Duration::from_secs(1));
                    }
                    continue;
                }
                assert!(status.is_success(), "{intent}: {payload}");
                web = payload;
                break;
            }
            let results = if target == Corpus::Scripture {
                web.get("scriptureResults").unwrap_or(&web["results"])
            } else {
                web.get("earlyChristianResults").unwrap_or(&web["results"])
            };
            let results = results.as_array().unwrap_or_else(|| panic!("{web}"));
            assert_eq!(native.len(), count, "{intent}");
            assert_eq!(native.len(), results.len(), "{intent}");
            for (actual, expected) in native.iter().zip(results) {
                let expected_id = if target == Corpus::Scripture {
                    &expected["id"]
                } else {
                    &expected["highlightPassage"]["id"]
                };
                assert_eq!(
                    actual.source_id,
                    expected_id.as_str().unwrap(),
                    "{intent}: ranked passage differs"
                );
                assert_eq!(
                    actual.highlight_verse,
                    expected["highlightVerse"].as_u64().map(|n| n as u32)
                );
                assert_eq!(
                    actual.strength() as u64,
                    expected["matchStrength"].as_u64().unwrap()
                );
                assert!((actual.score as f64 - expected["score"].as_f64().unwrap()).abs() < 0.0001);
            }
            eprintln!("PASS {intent}, {target:?}, {canon:?}, book={book:?}, author={author:?}: {count} identical ranked passages and highlights");
        }
    }
}
