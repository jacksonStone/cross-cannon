//! UIKit and DOM adapters own text layout, selection, speech and scrolling. The shared reader
//! owns passage identity, navigation, study and persistence. No pixel offset is
//! persisted or used to infer a Chapter outside the native text layout.
use super::*;
use std::ops::Range;

mod events;

#[derive(Default)]
pub(super) struct Reader {
    pub(super) book: String,
    pub(super) window: Range<usize>,
    #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
    content_key: String,
    #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
    visible: bool,
}

impl Reader {
    #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
    pub(super) fn invalidate(&mut self) {
        self.content_key.clear();
    }
    fn locate(&mut self, book: &str, chapter: usize, count: usize, jump: bool) {
        if self.book != book || !self.window.contains(&chapter) || jump {
            self.book = book.into();
            self.window = chapter.saturating_sub(1)..(chapter + 2).min(count);
        }
    }

    fn extend(&mut self, forward: bool, chapter: usize, count: usize) {
        if forward && self.window.end < count {
            self.window.end += 1;
            if self.window.len() > 7 {
                if chapter > self.window.start {
                    self.window.start += 1;
                } else {
                    self.window.end -= 1;
                }
            }
        } else if !forward && self.window.start > 0 {
            self.window.start -= 1;
            if self.window.len() > 7 {
                if chapter + 1 < self.window.end {
                    self.window.end -= 1;
                } else {
                    self.window.start += 1;
                }
            }
        }
    }
}

#[cfg(any(target_os = "ios", target_arch = "wasm32"))]
#[derive(Serialize)]
struct Paragraph {
    id: String,
    reference: String,
    text: String,
    highlight: Option<String>,
    link: String,
    modernization: Vec<[usize; 2]>,
    quotations: Vec<[usize; 2]>,
}

#[cfg(any(target_os = "ios", target_arch = "wasm32"))]
#[derive(Serialize)]
struct Chapter {
    title: String,
    subtitle: String,
    edition: String,
    opening: Option<serde_json::Value>,
    paragraphs: Vec<Paragraph>,
}

#[derive(Deserialize, Default)]
pub(super) struct Event {
    pub(super) action: String,
    #[serde(default)]
    pub(super) id: String,
    #[serde(default)]
    pub(super) book: String,
    #[serde(default)]
    pub(super) value: f32,
}

#[cfg(any(target_os = "ios", target_arch = "wasm32"))]
#[cfg(target_os = "ios")]
mod platform {
    use super::*;
    use std::sync::{Mutex, OnceLock};
    pub(super) static EVENTS: Mutex<Vec<Event>> = Mutex::new(Vec::new());
    pub(super) static CONTEXT: OnceLock<egui::Context> = OnceLock::new();
    pub(super) static INPUT: Mutex<Vec<egui::Event>> = Mutex::new(Vec::new());

    unsafe extern "C" {
        pub(super) fn cross_canon_reader_update(json: *const std::ffi::c_char);
        pub(super) fn cross_canon_accessibility_update(json: *const std::ffi::c_char);
    }

    pub(super) fn send(value: &impl Serialize, accessibility: bool) {
        let json = std::ffi::CString::new(serde_json::to_string(value).unwrap()).unwrap();
        // SAFETY: UIKit copies this nul-terminated UTF-8 value synchronously on
        // the main thread. It never retains Rust's pointer.
        unsafe {
            if accessibility {
                cross_canon_accessibility_update(json.as_ptr());
            } else {
                cross_canon_reader_update(json.as_ptr());
            }
        }
    }

    #[no_mangle]
    pub unsafe extern "C" fn cross_canon_reader_event(json: *const std::ffi::c_char) {
        if json.is_null() {
            return;
        }
        // SAFETY: our UIKit adapter provides a valid, live UTF-8 C string.
        let json = unsafe { std::ffi::CStr::from_ptr(json) }.to_bytes();
        if let Ok(event) = serde_json::from_slice::<Event>(json) {
            if event.action == "accessibility" {
                use egui::accesskit::{Action, ActionRequest, NodeId};
                if let Ok(id) = event.id.parse::<u64>() {
                    let action = match event.book.as_str() {
                        "increment" => Action::Increment,
                        "decrement" => Action::Decrement,
                        "focus" => Action::Focus,
                        _ => Action::Click,
                    };
                    INPUT
                        .lock()
                        .unwrap()
                        .push(egui::Event::AccessKitActionRequest(ActionRequest {
                            action,
                            target: NodeId(id),
                            data: None,
                        }));
                }
            } else if event.action == "scroll" {
                let mut input = INPUT.lock().unwrap();
                // Wheel routing follows the pointer. VoiceOver can request a
                // scroll without any preceding touch, so target its element's
                // visible interaction rectangle rather than stale hover state.
                if let (Some(ctx), Ok(id)) = (CONTEXT.get(), event.id.parse::<u64>()) {
                    if let Ok(id) = serde_json::from_value::<Id>(serde_json::json!(id)) {
                        if let Some(response) = ctx.read_response(id) {
                            input.push(egui::Event::PointerMoved(response.interact_rect.center()));
                        }
                    }
                }
                input.push(egui::Event::MouseWheel {
                    unit: egui::MouseWheelUnit::Point,
                    delta: egui::vec2(0.0, event.value),
                    modifiers: egui::Modifiers::NONE,
                });
            } else {
                EVENTS.lock().unwrap().push(event);
            }
        }
        if let Some(ctx) = CONTEXT.get() {
            ctx.request_repaint();
        }
    }
}

#[cfg(target_arch = "wasm32")]
use crate::browser as platform;

#[cfg(any(target_os = "ios", target_arch = "wasm32"))]
pub(super) fn input(ctx: &egui::Context, input: &mut egui::RawInput) {
    let _ = platform::CONTEXT.set(ctx.clone());
    ctx.enable_accesskit();
    input
        .events
        .extend(platform::INPUT.lock().unwrap().drain(..));
}

#[cfg(any(target_os = "ios", target_arch = "wasm32"))]
pub(super) fn accessibility(
    ctx: &egui::Context,
    output: &egui::PlatformOutput,
    scope: Option<String>,
) {
    let Some(tree) = &output.accesskit_update else {
        return;
    };
    platform::send(
        &serde_json::json!({ "nodes": modal_nodes(ctx, tree), "scale": ctx.zoom_factor(), "modal": scope.is_some(), "scope": scope }),
        true,
    );
}

fn modal_nodes(ctx: &egui::Context, tree: &egui::accesskit::TreeUpdate) -> Vec<serde_json::Value> {
    use egui::accesskit::{Action, Role};
    let lookup: std::collections::HashMap<_, _> =
        tree.nodes.iter().map(|(id, node)| (*id, node)).collect();
    let filter = egui::accesskit::NodeId(Id::new("ios-filter-accessibility").value());
    let root = if lookup.contains_key(&filter) {
        filter
    } else {
        egui::accesskit::NodeId(Id::new("ios-dialog-accessibility").value())
    };
    let mut allowed = std::collections::HashSet::new();
    let mut pending = vec![root];
    while let Some(id) = pending.pop() {
        if !allowed.insert(id) {
            continue;
        }
        if let Some(node) = lookup.get(&id) {
            if !node.is_hidden() && !node.is_disabled() {
                pending.extend(node.children());
            }
        }
    }
    tree
        .nodes
        .iter()
        .filter_map(|(id, node)| {
            if !allowed.contains(id) { return None; }
            let rect = node.bounds()?;
            let mut bounds = Rect::from_min_max(egui::pos2(rect.x0 as f32, rect.y0 as f32), egui::pos2(rect.x1 as f32, rect.y1 as f32));
            // AccessKit's bounds include clipped scroll content. Use egui's
            // interaction rectangle so VoiceOver cannot focus controls hidden
            // behind a scroll viewport or keyboard. Id's public serde format
            // preserves its hash; re-hashing NodeId would identify another widget.
            if let Ok(widget_id) = serde_json::from_value::<Id>(serde_json::json!(id.0)) {
                if let Some(response) = ctx.read_response(widget_id) { bounds = bounds.intersect(response.interact_rect); }
            }
            if !bounds.is_positive() { return None; }
            if node.is_hidden() || node.is_disabled() {
                return None;
            }
            let role = match node.role() {
                Role::Button
                | Role::DefaultButton
                | Role::CheckBox
                | Role::RadioButton
                | Role::ComboBox
                | Role::Tab | Role::MenuItem | Role::Link => "button",
                Role::Slider | Role::SpinButton => "adjustable",
                Role::TextInput | Role::MultilineTextInput | Role::SearchInput => "input",
                Role::Label | Role::Heading | Role::Paragraph => "text",
                _ => return None,
            };
            let label = node
                .label()
                .filter(|s| !s.is_empty())
                .or_else(|| node.placeholder().filter(|s| !s.is_empty()))
                .or_else(|| node.value().filter(|s| !s.is_empty()))
                .unwrap_or(if role == "input" { "Text field" } else if node.role() == Role::ComboBox { "Choose option" } else { "" });
            if label.is_empty() {
                return None;
            }
            let selection = if role == "input" {
                serde_json::from_value::<Id>(serde_json::json!(id.0)).ok()
                    .and_then(|id| egui::TextEdit::load_state(ctx, id))
                    .and_then(|state| state.cursor.char_range())
                    .map(|range| {
                        let [start, end] = range.sorted();
                        let text = node.value().unwrap_or_default();
                        let utf16 = |index| text.chars().take(index).map(char::len_utf16).sum::<usize>();
                        [utf16(start.index), utf16(end.index)]
                    })
            } else { None };
            Some(serde_json::json!({
                "id": id.0.to_string(), "selection": selection, "label": label, "value": node.value(),
                "number": node.numeric_value(), "selected": node.is_selected().or(node.toggled().map(|t| t == egui::accesskit::Toggled::True)),
                "role": role, "multiline": node.role() == Role::MultilineTextInput, "click": node.supports_action(Action::Click),
                "rect": [bounds.left(), bounds.top(), bounds.width(), bounds.height()],
            }))
        })
        .collect()
}

#[cfg(any(target_os = "ios", target_arch = "wasm32"))]
impl Desktop {
    pub(super) fn text_surface_events(&mut self, ctx: &egui::Context) {
        let events = std::mem::take(&mut *platform::EVENTS.lock().unwrap());
        for event in events {
            match events::apply(self, ctx, event) {
                events::Effect::None => {}
                events::Effect::Invalidate => self.text_surface.invalidate(),
                events::Effect::Extend { forward } => {
                    let book = self.library.book(&self.current_passage().book_id).unwrap();
                    let chapter = book
                        .chapters
                        .iter()
                        .position(|chapter| chapter.id == self.active_chapter_id)
                        .unwrap_or(0);
                    self.text_surface
                        .extend(forward, chapter, book.chapters.len());
                }
            }
        }
    }

    pub(super) fn show_text_surface(&mut self, ctx: &egui::Context) -> bool {
        let visible = self.dialog.is_none() && !self.tools;
        if !visible {
            if self.text_surface.visible {
                platform::send(&serde_json::json!({"visible": false}), false);
                self.text_surface.visible = false;
            }
            return false;
        }
        let passage = self.current_passage().clone();
        let book = self.library.book(&passage.book_id).unwrap();
        let index = book
            .chapters
            .iter()
            .position(|c| c.id == passage.chapter_id)
            .unwrap_or(0);
        let jump = self.scroll_target.take();
        self.text_surface
            .locate(&book.id, index, book.chapters.len(), jump.is_some());
        #[cfg(target_arch = "wasm32")]
        browser_library::request(
            &self.library,
            book.chapters[self.text_surface.window.clone()]
                .iter()
                .map(|c| c.id.clone()),
        );
        let key = format!(
            "{}:{:?}:{}:{:?}",
            book.id,
            self.text_surface.window,
            self.state.original,
            self.state.scripture_translation
        );
        let chapters = if key != self.text_surface.content_key || !self.text_surface.visible {
            self.text_surface.content_key = key;
            Some(
                book.chapters[self.text_surface.window.clone()]
                    .iter()
                    .filter(|chapter| !cfg!(target_arch = "wasm32") || self.library.chapter_ready(&chapter.id))
                    .map(|chapter| Chapter {
                        title: format!("{} {}", book.title, chapter.number),
                        subtitle: if book.corpus == Corpus::Scripture {
                            self.reading_text
                                .label(&book.title, self.state.scripture_translation)
                                .into()
                        } else {
                            chapter.title.clone()
                        },
                        edition: if book.corpus == Corpus::Scripture { String::new() } else { book.author.clone().unwrap_or_default() },
                        opening: (chapter.number == 1).then(|| serde_json::json!({
                            "title": book.title, "author": if book.corpus == Corpus::Scripture { self.reading_text.label(&book.title, self.state.scripture_translation) } else { book.author.as_deref().unwrap_or("") },
                            "collection": collection_name(book.corpus), "chapters": book.chapters.len(),
                        })),
                        paragraphs: chapter
                            .passage_ids
                            .iter()
                            .map(|id| {
                                let p = self.reading_text.passage(
                                    self.library.passage(id).unwrap(),
                                    self.state.scripture_translation,
                                );
                                let displayed = p.reader_text(self.state.original);
                                let modernization = if !self.state.original
                                    && p.corpus != Corpus::Scripture
                                    && p.original_text != displayed
                                {
                                    reader::modernized_ranges(&p.original_text, displayed)
                                        .iter()
                                        .map(|r| {
                                            [
                                                displayed[..r.start].encode_utf16().count(),
                                                displayed[r.clone()].encode_utf16().count(),
                                            ]
                                        })
                                        .collect()
                                } else {
                                    vec![]
                                };
                                Paragraph {
                                    id: id.clone(),
                                    reference: p.reference.clone(),
                                    text: displayed.into(),
                                    highlight: self.study.marks(p),
                                    link: navigation::reader_link(p),
                                    modernization,
                                    quotations: self.catalog.quotation_ranges(&self.library, p, displayed)
                                        .iter().map(|r| [displayed[..r.start].encode_utf16().count(), displayed[r.clone()].encode_utf16().count()]).collect(),
                                }
                            })
                            .collect(),
                    })
                    .collect::<Vec<_>>(),
            )
        } else {
            None
        };
        let p = self.state.theme.palette();
        let color = |c: egui::Color32| {
            let [r, g, b, _] = c.to_array();
            format!("#{r:02x}{g:02x}{b:02x}")
        };
        let reference = self
            .selected
            .as_ref()
            .and_then(|id| self.library.passage(id))
            .map(|p| &p.reference);
        platform::send(
            &serde_json::json!({
                "visible": true, "book": book.id, "title": format!("{} {}", book.title, passage.chapter),
                "collection": collection_name(book.corpus), "scripture": book.corpus == Corpus::Scripture,
                "chapters": chapters, "jump": jump, "location": self.state.location_passage_id,
                "link": navigation::reader_link(&passage),
                "selected": self.selected, "reference": reference,
                "fontScale": self.state.font_scale, "lineHeight": self.state.line_height,
            "width": self.state.width,
                "theme": match self.state.theme { Theme::Paper => 0, Theme::Sepia => 1, Theme::Dark => 2, Theme::Contrast => 3 },
                "translation": u32::from(self.state.scripture_translation == reading_translation::Translation::Msb),
                "canon": match self.state.canon { Canon::Protestant => 0, Canon::Catholic => 1, Canon::Orthodox => 2 },
                "apiURL": self.state.api_url,
                "info": format!("{} books · {} passages · all texts stored locally", self.library.books.len(), self.library.passages.len()),
                "paper": color(p.paper), "ink": color(p.ink), "muted": color(p.muted), "accent": color(p.accent),
                "playing": self.playing, "audio": self.library.audio(&self.active_chapter_id).is_some(),
                "versionControl": self.has_text_version_control(), "original": self.state.original,
                "previous": self.text_surface.window.start > 0,
                "next": self.text_surface.window.end < book.chapters.len(),
                "status": if self.study.storage_error().is_some() { self.study.storage_error().unwrap_or_default() } else { &self.message },
            }),
            false,
        );
        self.text_surface.visible = true;
        // Keep the underlying Metal surface in the same theme without laying
        // out the same Scripture a second time behind UIKit.
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(p.paper))
            .show(ctx, |_| {});
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_chapter_window_resumes_jumps_and_stays_bounded_in_both_directions() {
        let mut r = Reader::default();
        r.locate("Genesis", 15, 50, true);
        assert_eq!(r.window, 14..17);
        for chapter in 15..49 {
            r.locate("Genesis", chapter, 50, false);
            r.extend(true, chapter, 50);
            assert!(r.window.contains(&chapter));
            assert!(r.window.len() <= 7);
        }
        for chapter in (1..49).rev() {
            r.locate("Genesis", chapter, 50, false);
            r.extend(false, chapter, 50);
            assert!(r.window.contains(&chapter));
            assert!(r.window.len() <= 7);
        }
        r.locate("Psalms", 118, 150, false);
        assert_eq!(r.window, 117..120);
        r.locate("Psalms", 0, 150, true);
        assert_eq!(r.window, 0..2);
    }

    #[test]
    fn modal_accessibility_excludes_the_reader_and_traps_only_the_top_dialog() {
        let ctx = egui::Context::default();
        ctx.enable_accesskit();
        let render = |filters: bool| {
            ctx.run(egui::RawInput::default(), |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    let _ = ui.button("Reader tools");
                });
                let dialog = Id::new("ios-dialog-accessibility");
                ctx.accesskit_node_builder(dialog, |node| {
                    node.set_role(egui::accesskit::Role::Dialog)
                });
                ctx.with_accessibility_parent(dialog, || {
                    egui::Area::new(Id::new("test-dialog")).show(ctx, |ui| {
                        let _ = ui.button("Search");
                        ui.add(egui::TextEdit::singleline(&mut String::new()));
                    });
                    if filters {
                        let root = Id::new("ios-filter-accessibility");
                        ctx.accesskit_node_builder(root, |node| {
                            node.set_role(egui::accesskit::Role::Dialog)
                        });
                        ctx.with_accessibility_parent(root, || {
                            egui::Area::new(Id::new("test-filters")).show(ctx, |ui| {
                                let _ = ui.button("Apply filters");
                            });
                        });
                    }
                });
            })
        };
        render(false);
        let output = render(false);
        let nodes = modal_nodes(
            &ctx,
            output.platform_output.accesskit_update.as_ref().unwrap(),
        );
        assert!(!nodes.iter().any(|n| n["label"] == "Reader tools"));
        assert!(nodes.iter().any(|n| n["label"] == "Search"));
        assert!(nodes
            .iter()
            .any(|n| n["role"] == "input" && n["label"] == "Text field"));
        render(true);
        let output = render(true);
        let nodes = modal_nodes(
            &ctx,
            output.platform_output.accesskit_update.as_ref().unwrap(),
        );
        assert!(nodes.iter().any(|n| n["label"] == "Apply filters"));
        assert!(!nodes.iter().any(|n| n["label"] == "Search"));
    }

    #[test]
    fn real_commentary_dialog_shows_compact_quotes_and_source_actions() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        ctx.enable_accesskit();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let id = library.book("John").unwrap().chapters[2].passage_ids[0].clone();
        app.open(id.clone());
        app.show_commentaries(library.passage(&id).unwrap());
        let mut output = None;
        for _ in 0..3 {
            output = Some(ctx.run(
                egui::RawInput {
                    screen_rect: Some(Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(390.0, 844.0),
                    )),
                    ..Default::default()
                },
                |ctx| app.render(ctx),
            ));
            assert!(
                output.as_ref().unwrap().platform_output.ime.is_none(),
                "The real read-only commentary dialog must not request a keyboard"
            );
        }
        let nodes = modal_nodes(
            &ctx,
            output
                .unwrap()
                .platform_output
                .accesskit_update
                .as_ref()
                .unwrap(),
        );
        assert!(
            nodes.iter().any(|n| n["label"]
                .as_str()
                .is_some_and(|s| s.contains("Thomas Aquinas"))),
            "Projected controls: {:?}",
            nodes
                .iter()
                .map(|n| (&n["role"], &n["label"], &n["rect"]))
                .filter(|(_, _, r)| r[1].as_f64().unwrap_or(0.0) < 844.0)
                .collect::<Vec<_>>()
        );
        assert!(nodes.iter().any(|n| n["label"] == "Source"));
        assert!(nodes.iter().any(|n| n["label"] == "Close"));
        assert!(!nodes.iter().any(|n| n["label"] == "Reader tools"));
    }

    #[test]
    fn every_dialog_keeps_visible_controls_inside_phone_landscape_and_keyboard_viewports() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for (width, height, keyboard) in [
            (320.0, 700.0, 0.0_f32),
            (390.0, 844.0, 310.0),
            (844.0, 390.0, 0.0),
        ] {
            let ctx = egui::Context::default();
            ctx.enable_accesskit();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            let id = library.book("John").unwrap().chapters[2].passage_ids[0].clone();
            app.open(id.clone());
            app.show_commentaries(library.passage(&id).unwrap());
            let _ = app
                .study
                .direct_action("note", library.passage(&id).unwrap(), false);
            for (name, dialog) in [
                ("library", Dialog::Collections),
                ("jump", Dialog::Jump),
                ("search", Dialog::Search),
                ("audio", Dialog::Downloads),
                ("account", Dialog::Account),
                ("commentary", Dialog::Commentary),
                ("note editor", Dialog::Study),
            ] {
                app.dialog = Some(dialog);
                let mut output = None;
                for _ in 0..3 {
                    output = Some(ctx.run(
                        egui::RawInput {
                            screen_rect: Some(Rect::from_min_size(
                                egui::Pos2::ZERO,
                                egui::vec2(width, height),
                            )),
                            ..Default::default()
                        },
                        |ctx| {
                            let root = Id::new("ios-dialog-accessibility");
                            ctx.accesskit_node_builder(root, |node| {
                                node.set_role(egui::accesskit::Role::Dialog)
                            });
                            ctx.with_accessibility_parent(root, || {
                                app.dialogs_with_insets(
                                    ctx,
                                    mobile::Insets {
                                        top: 44.0,
                                        bottom: keyboard.max(20.0),
                                        ..Default::default()
                                    },
                                )
                            });
                        },
                    ));
                }
                let nodes = modal_nodes(
                    &ctx,
                    output
                        .unwrap()
                        .platform_output
                        .accesskit_update
                        .as_ref()
                        .unwrap(),
                );
                assert!(
                    nodes.iter().any(|n| n["label"] == "Close"),
                    "{name} has no accessible Close at {width}×{height}"
                );
                for node in nodes.iter().filter(|n| n["role"] != "text") {
                    let rect = &node["rect"];
                    let left = rect[0].as_f64().unwrap() as f32;
                    let top = rect[1].as_f64().unwrap() as f32;
                    let right = left + rect[2].as_f64().unwrap() as f32;
                    let bottom = top + rect[3].as_f64().unwrap() as f32;
                    assert!(left >= 0.0 && right <= width + 1.0 && top >= 0.0 && bottom <= height - keyboard + 1.0,
                        "{name}: {} escapes {width}×{height} with keyboard {keyboard}: ({left},{top})–({right},{bottom})", node["label"]);
                }
            }
        }
    }

    #[test]
    fn long_similar_source_keeps_search_controls_visible_on_a_phone() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let book = library
            .books
            .iter()
            .find(|b| b.title.starts_with("The First Epistle of Clement"))
            .unwrap();
        let source = library.passage(&book.chapters[0].passage_ids[0]).unwrap();
        assert!(source.text.len() > 500);
        for (width, height) in [(320.0, 700.0), (390.0, 844.0)] {
            let ctx = egui::Context::default();
            ctx.enable_accesskit();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.dialog = Some(Dialog::Search);
            app.search_corpus = Some(source.corpus);
            app.search_source = Some(ResultPassage::local(source, 1.0));
            let mut output = None;
            for _ in 0..3 {
                output = Some(ctx.run(
                    egui::RawInput {
                        screen_rect: Some(Rect::from_min_size(
                            egui::Pos2::ZERO,
                            egui::vec2(width, height),
                        )),
                        ..Default::default()
                    },
                    |ctx| app.render(ctx),
                ));
            }
            let nodes = modal_nodes(
                &ctx,
                output
                    .unwrap()
                    .platform_output
                    .accesskit_update
                    .as_ref()
                    .unwrap(),
            );
            for label in ["Filters", "Find Fathers"] {
                let button = nodes
                    .iter()
                    .find(|n| n["label"] == label)
                    .unwrap_or_else(|| {
                        panic!("{label} hidden by a long source at {width}×{height}")
                    });
                let rect = &button["rect"];
                assert!(
                    rect[1].as_f64().unwrap() + rect[3].as_f64().unwrap() < height as f64 - 20.0
                );
            }
        }
    }

    #[test]
    fn accessible_result_activation_reveals_aligned_phone_actions() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        ctx.enable_accesskit();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let book = library.book("classics:wesley").unwrap();
        let passage = library.passage(&book.chapters[70].passage_ids[0]).unwrap();
        let hit = ResultPassage::local(passage, 0.7);
        let source = hit.source_id.clone();
        app.results = vec![hit];
        app.dialog = Some(Dialog::Search);
        app.semantic = false;
        let frame = |app: &mut Desktop, events| {
            ctx.run(
                egui::RawInput {
                    screen_rect: Some(Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(390.0, 844.0),
                    )),
                    events,
                    ..Default::default()
                },
                |ctx| app.render(ctx),
            )
        };
        frame(&mut app, vec![]);
        frame(&mut app, vec![]);
        let output = frame(&mut app, vec![]);
        let tree = output.platform_output.accesskit_update.unwrap();
        let id = tree
            .nodes
            .iter()
            .find(|(_, n)| {
                n.label()
                    .is_some_and(|s| s.starts_with("Passage actions for"))
            })
            .unwrap()
            .0;
        frame(
            &mut app,
            vec![egui::Event::AccessKitActionRequest(
                egui::accesskit::ActionRequest {
                    action: egui::accesskit::Action::Click,
                    target: id,
                    data: None,
                },
            )],
        );
        assert_eq!(app.selected_result.as_deref(), Some(source.as_str()));
        let output = frame(&mut app, vec![]);
        let tree = output.platform_output.accesskit_update.as_ref().unwrap();
        let position = |label| {
            tree.nodes
                .iter()
                .find(|(_, n)| n.label() == Some(label))
                .unwrap_or_else(|| panic!("Missing {label}"))
                .1
                .bounds()
                .unwrap()
        };
        let context = position("View in context");
        let similar = position("Similar passages");
        let bible = position("Find Bible");
        let fathers = position("Find Fathers");
        let copy = position("Copy");
        assert_eq!(context.x0, bible.x0);
        assert_eq!(context.x0, copy.x0);
        assert_eq!(similar.x0, fathers.x0);
        assert_eq!(context.y0, similar.y0);
        assert_eq!(bible.y0, fathers.y0);
        assert!([context, similar, bible, fathers, copy]
            .iter()
            .all(|r| r.x1 <= 390.0));
    }
}
