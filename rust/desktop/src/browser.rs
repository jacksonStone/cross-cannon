//! Browser adapter for the existing Rust app. The DOM owns text layout and
//! selection; Rust owns navigation, text projection, dialogs, study and sync.
use super::*;
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;

pub(super) static EVENTS: Mutex<Vec<text_surface::Event>> = Mutex::new(Vec::new());
pub(super) static CONTEXT: OnceLock<egui::Context> = OnceLock::new();
pub(super) static INPUT: Mutex<Vec<egui::Event>> = Mutex::new(Vec::new());
static AFTER_TEXT: Mutex<Vec<egui::Event>> = Mutex::new(Vec::new());

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = isActive)]
    pub(super) fn is_active() -> bool;
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = activityGeneration)]
    pub(super) fn activity_generation() -> f64;
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = safeInsets)]
    pub(super) fn safe_insets() -> js_sys::Array;
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = updateSurface)]
    fn update_surface(json: &str, accessibility: bool);
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = signIn)]
    pub(super) fn sign_in();
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = signOut)]
    pub(super) fn sign_out();
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = openURL)]
    pub(super) fn open_url(url: &str);
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = audioCommand)]
    pub(super) fn audio_command(json: &str);
    #[wasm_bindgen(js_namespace = crossCanonPlatform, js_name = downloadCommand)]
    pub(super) fn download_command(json: &str);
}

pub(super) fn origin() -> String {
    web_sys::window().unwrap().location().origin().unwrap()
}
pub(super) fn send(value: &impl Serialize, accessibility: bool) {
    update_surface(&serde_json::to_string(value).unwrap(), accessibility);
}
fn js_error(error: JsValue) -> anyhow::Error {
    anyhow::anyhow!("Browser storage unavailable: {error:?}")
}
pub(super) fn storage_get(key: &str) -> Result<Option<String>> {
    web_sys::window()
        .unwrap()
        .local_storage()
        .map_err(js_error)?
        .context("Browser storage unavailable")?
        .get_item(key)
        .map_err(js_error)
}
pub(super) fn storage_set(key: &str, value: &str) -> Result<()> {
    web_sys::window()
        .unwrap()
        .local_storage()
        .map_err(js_error)?
        .context("Browser storage unavailable")?
        .set_item(key, value)
        .map_err(js_error)
}

#[derive(Deserialize)]
struct TextSelection {
    text: String,
    start: usize,
    end: usize,
}
thread_local! { static SELECTION: std::cell::RefCell<Option<(u64, TextSelection)>> = const { std::cell::RefCell::new(None) }; }
fn set_selection(ctx: &egui::Context, value: u64, selection: &TextSelection) {
    if let Ok(id) = serde_json::from_value::<Id>(serde_json::json!(value)) {
        let mut state = egui::TextEdit::load_state(ctx, id).unwrap_or_default();
        let scalar = |utf16| {
            let mut units = 0;
            selection
                .text
                .chars()
                .take_while(|c| {
                    units += c.len_utf16();
                    units <= utf16
                })
                .count()
        };
        state
            .cursor
            .set_char_range(Some(egui::text::CCursorRange::two(
                egui::text::CCursor::new(scalar(selection.start)),
                egui::text::CCursor::new(scalar(selection.end)),
            )));
        state.store(ctx, id);
    }
}
pub(super) fn finish_input(ctx: &egui::Context) {
    SELECTION.with(|slot| {
        if let Some((id, selection)) = slot.borrow_mut().take() {
            set_selection(ctx, id, &selection);
        }
    });
    // Toolbar actions must observe both the edited value and its latest native
    // selection. egui may render the toolbar before the editor in the same pass.
    let actions = std::mem::take(&mut *AFTER_TEXT.lock().unwrap());
    if !actions.is_empty() {
        INPUT.lock().unwrap().extend(actions);
        ctx.request_repaint();
    }
}

#[wasm_bindgen]
pub fn dispatch(json: &str) -> std::result::Result<(), JsValue> {
    let event: text_surface::Event =
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if event.action == "accessibility" {
        use egui::accesskit::{Action, ActionRequest, NodeId};
        if let Ok(id) = event.id.parse::<u64>() {
            let action = match event.book.as_str() {
                "increment" => Action::Increment,
                "decrement" => Action::Decrement,
                "focus" => Action::Focus,
                _ => Action::Click,
            };
            let input = egui::Event::AccessKitActionRequest(ActionRequest {
                action,
                target: NodeId(id),
                data: None,
            });
            if SELECTION.with(|slot| slot.borrow().is_some()) {
                AFTER_TEXT.lock().unwrap().push(input);
            } else {
                INPUT.lock().unwrap().push(input);
            }
        }
    } else if event.action == "key" {
        if let (Some(ctx), Ok(value)) = (CONTEXT.get(), event.book.parse::<u64>()) {
            let key = match event.id.as_str() {
                "ArrowUp" => Key::ArrowUp,
                "ArrowDown" => Key::ArrowDown,
                "Enter" => Key::Enter,
                "Escape" => Key::Escape,
                _ => return Ok(()),
            };
            if let Ok(id) = serde_json::from_value::<Id>(serde_json::json!(value)) {
                if ctx.memory(|memory| memory.has_focus(id)) {
                    // Text replacement/selection may still be queued from the DOM.
                    // Apply navigation after that edit, as with semantic clicks.
                    let events = [true, false].map(|pressed| egui::Event::Key {
                        key,
                        physical_key: None,
                        pressed,
                        repeat: false,
                        modifiers: egui::Modifiers::NONE,
                    });
                    if SELECTION.with(|slot| slot.borrow().is_some()) {
                        AFTER_TEXT.lock().unwrap().extend(events);
                    } else {
                        INPUT.lock().unwrap().extend(events);
                    }
                }
            }
        }
    } else if event.action == "text" || event.action == "selection" {
        if let (Some(ctx), Ok(id)) = (CONTEXT.get(), event.book.parse::<u64>()) {
            let selection: TextSelection =
                serde_json::from_str(&event.id).map_err(|e| JsValue::from_str(&e.to_string()))?;
            if event.action == "text" {
                let mut input = INPUT.lock().unwrap();
                for (key, modifiers) in [
                    (Key::A, egui::Modifiers::COMMAND),
                    (Key::Backspace, egui::Modifiers::NONE),
                ] {
                    for pressed in [true, false] {
                        input.push(egui::Event::Key {
                            key,
                            physical_key: None,
                            pressed,
                            repeat: false,
                            modifiers,
                        });
                    }
                }
                input.push(egui::Event::Text(selection.text.clone()));
                SELECTION.with(|slot| *slot.borrow_mut() = Some((id, selection)));
            } else {
                let pending = SELECTION.with(|slot| {
                    slot.borrow()
                        .as_ref()
                        .is_some_and(|(pending, _)| *pending == id)
                });
                if pending {
                    SELECTION.with(|slot| *slot.borrow_mut() = Some((id, selection)));
                } else {
                    set_selection(ctx, id, &selection);
                }
            }
        }
    } else if event.action == "scroll" {
        if let (Some(ctx), Ok(id)) = (CONTEXT.get(), event.id.parse::<u64>()) {
            if let Ok(id) = serde_json::from_value::<Id>(serde_json::json!(id)) {
                if let Some(response) = ctx.read_response(id) {
                    let mut input = INPUT.lock().unwrap();
                    input.push(egui::Event::PointerMoved(response.interact_rect.center()));
                    input.push(egui::Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: egui::vec2(0.0, event.value),
                        modifiers: egui::Modifiers::NONE,
                    });
                }
            }
        }
    } else if event.action == "audio-event" {
        audio::receive(&event.id, &event.book);
    } else if event.action == "download-event" {
        downloads::receive(&event.id);
    } else if event.action == "link" {
        if let Some(ctx) = CONTEXT.get() {
            navigation::queue_link(&event.id, ctx);
        }
    } else {
        EVENTS.lock().unwrap().push(event);
    }
    if let Some(ctx) = CONTEXT.get() {
        ctx.request_repaint();
    }
    Ok(())
}

struct Prepared {
    library: Library,
    catalog: catalog::Catalog,
    storage: persistence::ReaderStorage,
    reading: reading_translation::ReadingText,
}
thread_local! { static PREPARED: std::cell::RefCell<Option<Prepared>> = const { std::cell::RefCell::new(None) }; }

/// Project the offline identity index before it moves into the reader. No text
/// fragment is needed to browse a work or to validate a Scripture reference.
#[wasm_bindgen]
pub fn library_navigation_json() -> std::result::Result<String, JsValue> {
    PREPARED.with(|slot| {
        let prepared = slot.borrow();
        let prepared = prepared.as_ref().ok_or_else(|| JsValue::from_str("Reader not prepared"))?;
        let library = &prepared.library;
        let books = library.books.iter().filter(|book| !book.chapters.is_empty()).map(|book| {
            let chapters = book.chapters.iter().map(|chapter| {
                if book.corpus == Corpus::Scripture {
                    let verses: Vec<_> = chapter.passage_ids.iter().filter_map(|id| library.passage(id))
                        .map(|passage| [passage.verse_start, passage.verse_end]).collect();
                    serde_json::json!([chapter.number, verses])
                } else {
                    serde_json::json!([chapter.number, chapter.title])
                }
            }).collect::<Vec<_>>();
            let metadata = prepared.catalog.works.get(&book.id);
            serde_json::json!({"id":book.id,"title":book.title,"author":book.author,"corpus":book.corpus,
                "translator":metadata.and_then(|value| value.translator.as_deref()),
                "edition":metadata.and_then(|value| value.edition.as_deref()),
                "chapters":chapters,"catholic":Canon::Catholic.includes(&book.title),
                "protestant":Canon::Protestant.includes(&book.title)})
        }).collect::<Vec<_>>();
        serde_json::to_string(&books).map_err(|error| JsValue::from_str(&error.to_string()))
    })
}

// Resolve the exact saved/deep-linked Passage before requesting any reading text.
#[wasm_bindgen]
pub fn prepare(
    library_bytes: Vec<u8>,
    catalog_json: &str,
    legacy_json: &str,
    archive_json: &str,
) -> std::result::Result<String, JsValue> {
    prepare_inner(library_bytes, catalog_json, legacy_json, archive_json)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
fn prepare_inner(
    library_bytes: Vec<u8>,
    catalog_json: &str,
    legacy_json: &str,
    archive_json: &str,
) -> Result<String> {
    let library = Library::from_bytes(std::path::Path::new(""), &library_bytes)?;
    let catalog: catalog::Catalog = serde_json::from_str(catalog_json)?;
    browser_library::configure(archive_json)?;
    let mut storage = persistence::ReaderStorage::open("cross-canon/browser-reader-v1".into())?;
    if eframe::Storage::get_string(&storage, "reader").is_none() {
        #[derive(Deserialize)]
        struct Legacy {
            reader: ReaderState,
            locations: std::collections::HashMap<String, account::Location>,
            study: study::Saved,
            accounts: account::Saved,
        }
        let mut legacy: Legacy =
            serde_json::from_str(legacy_json).context("Could not import existing browser data")?;
        for (corpus, location) in legacy.locations {
            if let Some(id) = location.passage(&library) {
                match corpus.as_str() {
                    "scripture" => {
                        legacy.reader.scripture_location = id.clone();
                        legacy.reader.location_passage_id = id;
                    }
                    "fathers" => legacy.reader.fathers_location = id,
                    "classics" => legacy.reader.classics_location = id,
                    _ => {}
                }
            }
        }
        eframe::set_value(&mut storage, "reader", &legacy.reader);
        eframe::set_value(&mut storage, "study", &legacy.study);
        eframe::set_value(&mut storage, "accounts", &legacy.accounts);
        eframe::Storage::flush(&mut storage);
    }
    let mut state: ReaderState = eframe::get_value(&storage, "reader").unwrap_or_default();
    if let Ok(url) = web_sys::window().unwrap().location().href() {
        if let Some(id) = navigation::passage_from_link(
            &library,
            &url.replace(&origin(), "https://www.crosscanon.com"),
        ) {
            state.location_passage_id = id;
        }
    }
    if library.passage(&state.location_passage_id).is_none() {
        state.location_passage_id =
            library.book("Genesis").unwrap().chapters[0].passage_ids[0].clone();
    }
    let passage = library.passage(&state.location_passage_id).unwrap();
    let book = library.book(&passage.book_id).unwrap();
    let position = book
        .chapters
        .iter()
        .position(|c| c.id == passage.chapter_id)
        .unwrap();
    let chapters: Vec<_> = book.chapters
        [position.saturating_sub(1)..(position + 2).min(book.chapters.len())]
        .iter()
        .map(|c| c.id.clone())
        .collect();
    eframe::set_value(&mut storage, "reader", &state);
    // This prepared storage is not flushed until text is available and the app
    // opens successfully, so a failed request cannot move the saved location.
    PREPARED.with(|slot| {
        *slot.borrow_mut() = Some(Prepared {
            library,
            catalog,
            storage,
            reading: Default::default(),
        })
    });
    Ok(serde_json::to_string(&chapters)?)
}
#[wasm_bindgen]
pub fn stage_fragment(bytes: Vec<u8>, reading_json: &str) -> std::result::Result<(), JsValue> {
    PREPARED
        .with(|slot| -> Result<()> {
            let mut slot = slot.borrow_mut();
            let prepared = slot.as_mut().context("Reader not prepared")?;
            prepared
                .library
                .install_fragment(Library::from_bytes(std::path::Path::new(""), &bytes)?)?;
            if !reading_json.is_empty() {
                prepared.reading.add_json(&prepared.library, reading_json)?;
            }
            Ok(())
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
#[wasm_bindgen]
pub async fn start(canvas: web_sys::HtmlCanvasElement) -> std::result::Result<(), JsValue> {
    let Prepared {
        library,
        catalog,
        storage,
        reading,
    } = PREPARED
        .with(|slot| slot.borrow_mut().take())
        .ok_or_else(|| JsValue::from_str("Reader not prepared"))?;
    let library = Arc::new(library);
    let runner = eframe::WebRunner::new();
    runner
        .start(
            canvas,
            eframe::WebOptions::default(),
            Box::new(move |cc| {
                let mut app = Desktop::initialize(&cc.egui_ctx, Some(&storage), library);
                app.state.api_url = format!("{}/r/api", origin());
                app.catalog = Arc::new(catalog);
                app.reader_storage = Some(storage);
                app.study
                    .attach_storage("cross-canon/browser-study-v1".into())?;
                app.reading_text = Arc::new(reading);
                Ok(Box::new(app))
            }),
        )
        .await?;
    // Keep the runner alive: its Drop tears down the event listeners and painter.
    std::mem::forget(runner);
    Ok(())
}

#[wasm_bindgen]
pub fn icons_json() -> String {
    icons::browser_icons().to_string()
}
