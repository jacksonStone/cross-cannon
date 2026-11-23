//! Browser transport adapter for progressive immutable Chapter fragments.
//! Shared navigation/search receive the same canonical Library and text models.
use super::*;
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
};

#[derive(Clone, Deserialize)]
pub(super) struct Source {
    pub text: String,
    pub reading: Option<String>,
    pub catalog: Option<String>,
}
static SOURCES: OnceLock<HashMap<String, Source>> = OnceLock::new();
struct Loaded {
    key: String,
    bytes: Vec<u8>,
    reading: Option<String>,
    catalog: Option<String>,
}
static COMPLETED: Mutex<Vec<(String, Result<Loaded, String>)>> = Mutex::new(Vec::new());
thread_local! {
    static REQUESTED: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    static FAILED: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    static NAVIGATION: RefCell<Option<(String,bool)>> = const { RefCell::new(None) };
    static COMMENTARY: RefCell<Option<String>> = const { RefCell::new(None) };
}
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = libraryStatus)]
    fn status(text: &str);
}
fn sources() -> &'static HashMap<String, Source> {
    SOURCES.get().expect("Browser archive configured")
}
pub(super) fn configure(json: &str) -> Result<()> {
    SOURCES
        .set(serde_json::from_str(json)?)
        .map_err(|_| anyhow::anyhow!("Reader already started"))
}
pub(super) fn online() -> bool {
    web_sys::window().unwrap().navigator().on_line()
}
async fn fetch(source: Source) -> Result<Loaded> {
    let client = platform::http_client(Duration::from_secs(60))?;
    let response = client
        .get(format!("{}{}", browser::origin(), source.text))
        .send()
        .await?;
    anyhow::ensure!(
        response.status().is_success(),
        "This text is not available offline yet. Reconnect and try again."
    );
    let bytes = response.bytes().await?.to_vec();
    async fn optional_text(
        client: &platform::HttpClient,
        path: Option<String>,
    ) -> Result<Option<String>> {
        let Some(path) = path else { return Ok(None) };
        let response = client
            .get(format!("{}{}", browser::origin(), path))
            .send()
            .await?;
        anyhow::ensure!(
            response.status().is_success(),
            "The reading details are not available yet. Reconnect and try again."
        );
        Ok(Some(response.text().await?))
    }
    let reading = optional_text(&client, source.reading).await?;
    let catalog = optional_text(&client, source.catalog).await?;
    Ok(Loaded {
        key: source.text,
        bytes,
        reading,
        catalog,
    })
}
pub(super) fn request(library: &Library, chapters: impl IntoIterator<Item = String>) {
    for chapter in chapters {
        if library.chapter_ready(&chapter) {
            continue;
        }
        let Some(source) = sources().get(&chapter).cloned() else {
            continue;
        };
        if FAILED.with(|r| r.borrow().contains(&source.text)) {
            continue;
        }
        if !REQUESTED.with(|r| r.borrow_mut().insert(source.text.clone())) {
            continue;
        }
        let key = source.text.clone();
        platform::spawn(async move {
            let result = fetch(source).await.map_err(|e| e.to_string());
            COMPLETED.lock().unwrap().push((key, result));
            if let Some(ctx) = browser::CONTEXT.get() {
                ctx.request_repaint();
            }
        });
    }
}
pub(super) fn defer(library: &Library, id: &str, history: bool) -> bool {
    // A later action supersedes an outstanding navigation, including when its
    // destination is already loaded. A late fetch must never pull the user back.
    if NAVIGATION.with(|slot| slot.borrow_mut().take()).is_some() {
        status("");
    }
    let Some(p) = library.passage(id) else {
        return false;
    };
    if library.chapter_ready(&p.chapter_id) {
        return false;
    }
    if let Some(source) = sources().get(&p.chapter_id) {
        FAILED.with(|r| r.borrow_mut().remove(&source.text));
    }
    NAVIGATION.with(|slot| *slot.borrow_mut() = Some((id.into(), history)));
    status("Opening passage…");
    request(library, [p.chapter_id.clone()]);
    true
}
pub(super) fn defer_commentaries(
    library: &Library,
    catalog: &catalog::Catalog,
    p: &Passage,
) -> bool {
    let chapters = catalog.commentary_chapters(p);
    if chapters.iter().all(|id| library.chapter_ready(id)) {
        return false;
    }
    COMMENTARY.with(|slot| *slot.borrow_mut() = Some(p.id.clone()));
    for id in &chapters {
        if let Some(source) = sources().get(id) {
            FAILED.with(|r| r.borrow_mut().remove(&source.text));
        }
    }
    status("Opening commentaries…");
    request(library, chapters);
    true
}
pub(super) fn tick(app: &mut Desktop, ctx: &egui::Context) {
    let completed = std::mem::take(&mut *COMPLETED.lock().unwrap());
    for (key, result) in completed {
        REQUESTED.with(|r| r.borrow_mut().remove(&key));
        let result = result.and_then(|loaded| apply(app, loaded).map_err(|e| e.to_string()));
        if let Err(error) = result {
            FAILED.with(|r| r.borrow_mut().insert(key.clone()));
            let relevant = NAVIGATION.with(|s| {
                s.borrow()
                    .as_ref()
                    .and_then(|(id, _)| app.library.passage(id))
                    .and_then(|p| sources().get(&p.chapter_id))
                    .is_some_and(|source| source.text == key)
            }) || COMMENTARY.with(|s| {
                s.borrow()
                    .as_ref()
                    .and_then(|id| app.library.passage(id))
                    .is_some_and(|p| {
                        app.catalog
                            .commentary_chapters(p)
                            .iter()
                            .filter_map(|id| sources().get(id))
                            .any(|source| source.text == key)
                    })
            });
            if relevant {
                status(&error);
                app.message = error;
                NAVIGATION.with(|s| s.borrow_mut().take());
                COMMENTARY.with(|s| s.borrow_mut().take());
            }
        }
        app.text_surface.invalidate();
    }
    let navigation = NAVIGATION.with(|slot| {
        let ready = slot.borrow().as_ref().is_some_and(|(id, _)| {
            app.library
                .passage(id)
                .is_some_and(|p| app.library.chapter_ready(&p.chapter_id))
        });
        ready.then(|| slot.borrow_mut().take().unwrap())
    });
    if let Some((id, history)) = navigation {
        status("");
        if history {
            app.open(id)
        } else {
            app.restore_location(id)
        };
        ctx.request_repaint();
    }
    let commentary = COMMENTARY.with(|slot| {
        let ready = slot
            .borrow()
            .as_ref()
            .and_then(|id| app.library.passage(id))
            .is_some_and(|p| {
                app.catalog
                    .commentary_chapters(p)
                    .iter()
                    .all(|id| app.library.chapter_ready(id))
            });
        ready.then(|| slot.borrow_mut().take().unwrap())
    });
    if let Some(id) = commentary {
        status("");
        if let Some(p) = app.library.passage(&id).cloned() {
            app.show_commentaries(&p);
        }
    }
}
fn apply(app: &mut Desktop, loaded: Loaded) -> Result<()> {
    let fragment = Library::from_bytes(std::path::Path::new(""), &loaded.bytes)?;
    let details = app
        .catalog
        .decode_fragment(&fragment, loaded.catalog.as_deref().unwrap_or(""))?;
    Arc::make_mut(&mut app.library).install_fragment(fragment)?;
    Arc::make_mut(&mut app.catalog).install_fragment(details);
    if let Some(json) = loaded.reading {
        Arc::make_mut(&mut app.reading_text).add_json(&app.library, &json)?;
    }
    Ok(())
}

async fn hydrate(
    library: &Library,
    catalog: &catalog::Catalog,
    chapters: Vec<String>,
) -> Result<(Library, catalog::Catalog)> {
    let wanted: HashSet<_> = chapters
        .iter()
        .filter_map(|id| sources().get(id))
        .map(|s| s.text.clone())
        .collect();
    let all: Vec<_> = sources()
        .iter()
        .filter(|(_, source)| wanted.contains(&source.text))
        .map(|(id, _)| id.clone())
        .collect();
    let mut snapshot = library.fragment(&all)?;
    let mut catalog = catalog.clone();
    let mut fetched = HashSet::new();
    for id in chapters {
        if snapshot.chapter_ready(&id) {
            continue;
        }
        let source = sources()
            .get(&id)
            .context("Chapter source unavailable")?
            .clone();
        if !fetched.insert(source.text.clone()) {
            continue;
        }
        let loaded = fetch(source).await?;
        let fragment = Library::from_bytes(std::path::Path::new(""), &loaded.bytes)?;
        let details =
            catalog.decode_fragment(&fragment, loaded.catalog.as_deref().unwrap_or(""))?;
        snapshot.install_fragment(fragment)?;
        catalog.install_fragment(details);
        let key = loaded.key.clone();
        COMPLETED.lock().unwrap().push((key, Ok(loaded)));
    }
    Ok((snapshot, catalog))
}

pub(super) async fn search(
    library: Arc<Library>,
    catalog: Arc<catalog::Catalog>,
    api: &str,
    request: &SearchRequest,
) -> Result<Vec<ResultPassage>> {
    let keyword = request.source_id.is_none() && matches!(request.mode, SearchMode::Keyword);
    let mut request = request.clone();
    if keyword && request.corpus != Some(Corpus::Scripture) && !request.authors.is_empty() {
        request.books = library
            .books
            .iter()
            .filter(|b| {
                request.corpus.is_none_or(|c| b.corpus == c)
                    && b.author
                        .as_ref()
                        .is_some_and(|a| request.authors.contains(a))
            })
            .map(|b| b.id.clone())
            .collect();
    }
    let (snapshot, catalog, mut hits) = if keyword && !online() {
        let chapters = library
            .books
            .iter()
            .filter(|b| {
                request.corpus.is_none_or(|c| b.corpus == c)
                    && (b.corpus != Corpus::Scripture || request.canon.includes(&b.title))
                    && (request.books.is_empty() || request.books.contains(&b.id))
            })
            .flat_map(|b| b.chapters.iter().map(|c| c.id.clone()))
            .collect();
        let (snapshot, catalog) = hydrate(&library, &catalog, chapters).await?;
        let hits = snapshot
            .search(
                &request.query,
                request.corpus,
                &request.books,
                request.limit,
                request.canon,
            )
            .iter()
            .filter_map(|h| {
                snapshot
                    .passage(&h.id)
                    .map(|p| ResultPassage::local(p, h.score))
            })
            .collect();
        (snapshot, catalog, hits)
    } else {
        let payload = search::fetch_payload(api, &request).await?;
        let chapters = payload["results"]
            .as_array()
            .context("Missing search results")?
            .iter()
            .filter_map(|hit| {
                hit["chapterId"].as_str().map(str::to_owned).or_else(|| {
                    hit["id"]
                        .as_str()
                        .and_then(|id| library.passage(id))
                        .map(|p| p.chapter_id.clone())
                })
            })
            .collect::<Vec<_>>();
        if chapters.is_empty() {
            return Ok(vec![]);
        }
        let (snapshot, catalog) = hydrate(&library, &catalog, chapters).await?;
        let hits = if keyword {
            payload["results"]
                .as_array()
                .unwrap()
                .iter()
                .map(|hit| {
                    let p = snapshot
                        .passage(hit["id"].as_str().context("Missing search Passage")?)
                        .context("Missing search text")?;
                    Ok(ResultPassage::local(
                        p,
                        hit["score"].as_f64().context("Missing search score")? as f32,
                    ))
                })
                .collect::<Result<Vec<_>>>()?
        } else {
            search::decode_results(
                &snapshot,
                request.corpus.context("Choose a collection")?,
                &payload,
            )?
        };
        (snapshot, catalog, hits)
    };
    for hit in &mut hits {
        catalog.decorate(&snapshot, hit);
    }
    hits.retain(|hit| !hit.text.trim().is_empty());
    Ok(hits)
}
