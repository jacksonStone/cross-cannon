//! Decode the native/HTML wire protocol once, then apply reader intent without
//! requiring a text-rendering adapter. Adapters handle the returned layout effect.
use super::*;

#[derive(Debug, PartialEq)]
pub(super) enum Effect {
    None,
    Extend { forward: bool },
    Invalidate,
}

enum Command {
    Location { book: String, id: String },
    Select { book: String, id: String },
    Scripture { source: String, target: String },
    Clear,
    Extend { book: String, forward: bool },
    Jump,
    OpenPassage(String),
    OpenChapter { book: String, chapter: u32, verse: u32 },
    Favorite(String),
    Dialog(Dialog),
    Library,
    Audio,
    AudioSource(bool),
    AudioStop,
    Original,
    BrowserStatus(String),
    Resume,
    Connection(String),
    Preference(Preference),
    Study(StudyAction),
}

enum StudyAction {
    Highlight,
    Note,
    Commentary,
    Similar,
}

enum Preference {
    Font(f32),
    Spacing(f32),
    Width(f32),
    Canon(Canon),
    Translation(reading_translation::Translation),
    Theme(Theme),
}

impl Command {
    fn decode(event: Event) -> Option<Self> {
        Some(match event.action.as_str() {
            "location" => Self::Location {
                book: event.book,
                id: event.id,
            },
            "select" => Self::Select {
                book: event.book,
                id: event.id,
            },
            "clear" => Self::Clear,
            "scripture" => Self::Scripture {
                source: event.id,
                target: event.book,
            },
            "next" | "previous" => Self::Extend {
                book: event.book,
                forward: event.action == "next",
            },
            "jump" => Self::Jump,
            "open-passage" => Self::OpenPassage(event.id),
            "open-chapter" => Self::OpenChapter {
                book: event.book,
                chapter: event.id.parse().ok()?,
                verse: event.value.to_string().parse().ok()?,
            },
            "favorite-work" => Self::Favorite(event.book),
            "search" => Self::Dialog(Dialog::Search),
            "settings" => Self::Dialog(Dialog::Settings),
            "library" => Self::Library,
            "account" => Self::Dialog(Dialog::Account),
            "downloads" => Self::Dialog(Dialog::Downloads),
            "audio" => Self::Audio,
            "audio-source" => Self::AudioSource(match event.id.as_str() { "recorded" => true, "ai" => false, _ => return None }),
            "audio-stop" => Self::AudioStop,
            "original" => Self::Original,
            "browser-status" => Self::BrowserStatus(event.id),
            "resume" => Self::Resume,
            "connection" => {
                let url = reqwest::Url::parse(&event.id).ok()?;
                if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                    return None;
                }
                Self::Connection(event.id)
            }
            "preference" => {
                if !event.value.is_finite() {
                    return None;
                }
                Self::Preference(match event.id.as_str() {
                    "font" => Preference::Font(event.value.clamp(0.86, 1.35)),
                    "spacing" => Preference::Spacing(event.value.clamp(1.42, 2.08)),
                    "width" => Preference::Width(event.value.clamp(620.0, 880.0)),
                    "canon" => Preference::Canon(match event.value {
                        0.0 => Canon::Protestant,
                        1.0 => Canon::Catholic,
                        2.0 => Canon::Orthodox,
                        _ => return None,
                    }),
                    "translation" => Preference::Translation(match event.value {
                        0.0 => reading_translation::Translation::Web,
                        1.0 => reading_translation::Translation::Msb,
                        _ => return None,
                    }),
                    "theme" => Preference::Theme(match event.value {
                        0.0 => Theme::Paper,
                        1.0 => Theme::Sepia,
                        2.0 => Theme::Dark,
                        3.0 => Theme::Contrast,
                        _ => return None,
                    }),
                    _ => return None,
                })
            }
            "highlight" => Self::Study(StudyAction::Highlight),
            "note" => Self::Study(StudyAction::Note),
            "commentary" => Self::Study(StudyAction::Commentary),
            "similar" => Self::Study(StudyAction::Similar),
            _ => return None,
        })
    }
}

pub(super) fn apply(app: &mut Desktop, ctx: &egui::Context, event: Event) -> Effect {
    let Some(command) = Command::decode(event) else {
        return Effect::None;
    };
    match command {
        Command::Location { book, id } => {
            if app.scroll_target.is_none() && passage_in_reader(app, &book, &id) {
                app.remember_location(id);
            }
        }
        Command::Select { book, id } => {
            if passage_in_reader(app, &book, &id) {
                app.selected = Some(id);
            }
        }
        Command::Clear => app.selected = None,
        Command::Scripture { source, target } => {
            if passage_in_reader(app, &app.current_passage().book_id, &source)
                && app.library.passage(&source).is_some_and(|passage| {
                    app.catalog
                        .scripture_links(&app.library, passage)
                        .iter()
                        .any(|link| link.id == target)
                })
            {
                app.open(target);
            }
        }
        Command::Extend { book, forward } => {
            if book == app.current_passage().book_id {
                return Effect::Extend { forward };
            }
        }
        Command::Jump => app.show_library(),
        Command::OpenPassage(id) => {
            if app.library.passage(&id).is_some() {
                app.open(id);
            }
        }
        Command::OpenChapter { book, chapter, verse } => {
            let target = app.library.book(&book).and_then(|book| {
                let chapter = book.chapters.iter().find(|entry| entry.number == chapter)?;
                if verse == 0 {
                    return chapter.passage_ids.first();
                }
                if book.corpus != Corpus::Scripture {
                    return None;
                }
                chapter.passage_ids.iter().find(|id| app.library.passage(id).is_some_and(|p| (p.verse_start..=p.verse_end).contains(&verse)))
            });
            if let Some(id) = target.cloned() {
                app.open(id);
            }
        }
        Command::Favorite(book) => {
            app.toggle_favorite(&book);
            app.account.persist_now = true;
        }
        Command::Dialog(Dialog::Search) => app.show_text_search(),
        Command::Dialog(dialog) => app.dialog = Some(dialog),
        Command::Library => app.show_library(),
        Command::Audio => app.play_audio(&app.active_chapter_id.clone()),
        Command::AudioSource(recorded) => app.select_audio_source(recorded),
        Command::AudioStop => app.stop_audio(),
        Command::Original => app.set_original_view(!app.state.original),
        Command::BrowserStatus(status) => app.account.status = status,
        Command::Resume => app.account.force_sync(),
        Command::Connection(url) => {
            app.state.api_url = url;
            app.account.persist_now = true;
        }
        Command::Preference(preference) => {
            match preference {
                Preference::Font(value) => app.state.font_scale = value,
                Preference::Spacing(value) => app.state.line_height = value,
                Preference::Width(value) => app.state.width = value,
                Preference::Canon(canon) => app.update_canon(canon),
                Preference::Translation(translation) => app.set_translation(translation),
                Preference::Theme(theme) => {
                    app.state.theme = theme;
                    theme.apply(ctx);
                }
            }
            app.account.persist_now = true;
        }
        Command::Study(action) => {
            let id = app
                .selected
                .as_deref()
                .unwrap_or(&app.state.location_passage_id);
            let passage = app
                .reading_text
                .passage(
                    app.library.passage(id).unwrap(),
                    app.state.scripture_translation,
                )
                .clone();
            match action {
                StudyAction::Commentary => app.show_commentaries(&passage),
                StudyAction::Similar => {
                    app.dialog = Some(Dialog::Search);
                    app.query.clear();
                    if app.search_corpus != Some(passage.corpus) {
                        app.search_books.clear();
                        app.search_authors.clear();
                        app.author_filter.clear();
                    }
                    app.search_corpus = Some(passage.corpus);
                    app.search(ctx, Some(passage.id));
                }
                StudyAction::Highlight | StudyAction::Note => {
                    let kind = if matches!(action, StudyAction::Highlight) {
                        "highlight"
                    } else {
                        "note"
                    };
                    match app.study.direct_action(kind, &passage, app.state.original) {
                        Ok(edit) => {
                            if edit {
                                app.dialog = Some(Dialog::Study);
                            }
                            app.account.persist_now = true;
                            return Effect::Invalidate;
                        }
                        Err(error) => app.study.status = format!("Could not save study: {error}"),
                    }
                }
            }
        }
    }
    Effect::None
}

fn passage_in_reader(app: &Desktop, book: &str, id: &str) -> bool {
    book == app.current_passage().book_id
        && app.library.passage(id).is_some_and(|passage| {
            if passage.book_id == book {
                return true;
            }
            let current = app.library.book(book).unwrap();
            app.text_surface.sequence == reader::sequence_key(current, app.state.canon)
                && reader::chapter_sequence(&app.library, current, app.state.canon)
                    .iter()
                    .enumerate()
                    .any(|(index, (_, chapter))| {
                        app.text_surface.window.contains(&index) && chapter.id == passage.chapter_id
                    })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn send(app: &mut Desktop, ctx: &egui::Context, json: serde_json::Value) -> Effect {
        apply(app, ctx, serde_json::from_value(json).unwrap())
    }

    #[test]
    fn scripture_event_opens_only_a_linked_target_from_the_current_work() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let source = library.passage("classics:henry:Prov.16:4-6").unwrap();
        let links = app.catalog.scripture_links(&library, source);
        let target = &links[0].id;
        app.open(source.id.clone());
        send(
            &mut app,
            &ctx,
            serde_json::json!({"action":"scripture", "id":source.id, "book":"unknown"}),
        );
        assert_eq!(app.state.location_passage_id, source.id);
        send(
            &mut app,
            &ctx,
            serde_json::json!({"action":"scripture", "id":source.id, "book":target}),
        );
        assert_eq!(&app.state.location_passage_id, target);
        assert_eq!(app.back.last(), Some(&source.id));
        // A stale commentary event must not navigate after the reader changed books.
        app.open(library.chapter("John:3").unwrap().1.passage_ids[0].clone());
        let before = app.state.location_passage_id.clone();
        send(
            &mut app,
            &ctx,
            serde_json::json!({"action":"scripture", "id":source.id, "book":target}),
        );
        assert_eq!(app.state.location_passage_id, before);
    }

    #[test]
    fn wire_events_share_reader_navigation_selection_settings_and_study() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let chapter = library.chapter("John:3").unwrap().1;
        let first = &chapter.passage_ids[0];
        let next = &chapter.passage_ids[1];
        app.open(first.clone());
        send(
            &mut app,
            &ctx,
            serde_json::json!({ "action": "location", "book": "John", "id": next }),
        );
        assert_eq!(
            &app.state.location_passage_id, first,
            "Programmatic jumps outrank queued passive reading events"
        );
        app.scroll_target = None;
        send(
            &mut app,
            &ctx,
            serde_json::json!({ "action": "location", "book": "John", "id": next }),
        );
        assert_eq!(&app.state.location_passage_id, next);
        assert_eq!(app.active_chapter_id, "John:3");
        send(
            &mut app,
            &ctx,
            serde_json::json!({ "action": "select", "book": "John", "id": first }),
        );
        assert_eq!(app.selected.as_ref(), Some(first));
        assert_eq!(
            &app.state.location_passage_id, next,
            "Selecting text preserves the restorable reading location"
        );
        assert_eq!(
            send(&mut app, &ctx, serde_json::json!({ "action": "highlight" })),
            Effect::Invalidate
        );
        assert_eq!(
            app.study.marks(library.passage(first).unwrap()).as_deref(),
            Some("yellow")
        );
        assert!(app.account.persist_now);
        assert_eq!(
            send(&mut app, &ctx, serde_json::json!({ "action": "note" })),
            Effect::Invalidate
        );
        assert_eq!(app.dialog, Some(Dialog::Study));
        send(&mut app, &ctx, serde_json::json!({ "action": "clear" }));
        assert_eq!(app.selected, None);
        for (id, value, expected) in [
            ("font", 99.0, 1.35),
            ("spacing", 0.1, 1.42),
            ("width", 9999.0, 880.0),
        ] {
            send(
                &mut app,
                &ctx,
                serde_json::json!({ "action": "preference", "id": id, "value": value }),
            );
            let actual = match id {
                "font" => app.state.font_scale,
                "spacing" => app.state.line_height,
                _ => app.state.width,
            };
            assert_eq!(actual, expected);
        }
        send(
            &mut app,
            &ctx,
            serde_json::json!({ "action": "preference", "id": "translation", "value": 1 }),
        );
        assert_eq!(
            app.state.scripture_translation,
            reading_translation::Translation::Msb
        );
        send(
            &mut app,
            &ctx,
            serde_json::json!({ "action": "preference", "id": "canon", "value": 2 }),
        );
        assert_eq!(app.state.canon, Canon::Orthodox);
        send(
            &mut app,
            &ctx,
            serde_json::json!({ "action": "preference", "id": "theme", "value": 2 }),
        );
        assert_eq!(app.state.theme, Theme::Dark);
        for (action, dialog) in [
            ("search", Dialog::Search),
            ("settings", Dialog::Settings),
            ("account", Dialog::Account),
            ("downloads", Dialog::Downloads),
            ("jump", Dialog::Library),
            ("library", Dialog::Library),
        ] {
            send(&mut app, &ctx, serde_json::json!({ "action": action }));
            assert_eq!(app.dialog, Some(dialog));
        }
        for (action, forward) in [("next", true), ("previous", false)] {
            assert_eq!(
                send(
                    &mut app,
                    &ctx,
                    serde_json::json!({ "action": action, "book": "John" })
                ),
                Effect::Extend { forward }
            );
        }
        send(
            &mut app,
            &ctx,
            serde_json::json!({ "action": "connection", "id": "http://127.0.0.1:3006/r/api" }),
        );
        assert_eq!(app.state.api_url, "http://127.0.0.1:3006/r/api");
    }

    #[test]
    fn cross_book_window_accepts_visible_passages_and_preserves_reading_history() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let genesis = library.book("Genesis").unwrap();
        let chapters = reader::chapter_sequence(&library, genesis, Canon::Protestant);
        let index = chapters
            .iter()
            .position(|(_, c)| c.id == "Genesis:50")
            .unwrap();
        let last = library.chapter("Genesis:50").unwrap().1.passage_ids[0].clone();
        let next = library.chapter("Exodus:1").unwrap().1.passage_ids[0].clone();
        app.open(last.clone());
        app.scroll_target = None;
        app.text_surface.locate(
            &reader::sequence_key(genesis, Canon::Protestant),
            index,
            chapters.len(),
            true,
        );
        let window = app.text_surface.window.clone();
        let history = app.back.clone();
        send(
            &mut app,
            &ctx,
            serde_json::json!({"action":"select", "book":"Genesis", "id":next}),
        );
        assert_eq!(app.selected.as_ref(), Some(&next));
        send(
            &mut app,
            &ctx,
            serde_json::json!({"action":"location", "book":"Genesis", "id":next}),
        );
        assert_eq!(app.active_chapter_id, "Exodus:1");
        assert_eq!(app.state.scripture_location, next);
        assert_eq!(app.back, history);
        assert!(app.scroll_target.is_none());
        app.text_surface.locate(
            &reader::sequence_key(library.book("Exodus").unwrap(), Canon::Protestant),
            index + 1,
            chapters.len(),
            false,
        );
        assert_eq!(
            app.text_surface.window, window,
            "Crossing books must retain the window"
        );
        send(
            &mut app,
            &ctx,
            serde_json::json!({"action":"location", "book":"Exodus", "id":last}),
        );
        assert_eq!(app.active_chapter_id, "Genesis:50");
        assert_eq!(app.back, history);
        let titles = chapters
            .iter()
            .map(|(b, _)| b.title.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(titles.len(), 66);
        assert_eq!(chapters.first().unwrap().1.id, "Genesis:1");
        assert_eq!(chapters.last().unwrap().1.id, "Revelation:22");
        for canon in [Canon::Catholic, Canon::Orthodox] {
            let sequence = reader::chapter_sequence(&library, genesis, canon);
            assert!(sequence.iter().all(|(b, _)| canon.includes(&b.title)));
            assert!(sequence.iter().any(|(b, _)| b.title == "Tobit"));
        }
    }

    #[test]
    fn stale_or_malformed_adapter_events_cannot_change_or_persist_reader_state() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let current = library.chapter("John:3").unwrap().1.passage_ids[0].clone();
        let other = library.chapter("Genesis:1").unwrap().1.passage_ids[0].clone();
        app.open(current.clone());
        app.scroll_target = None;
        app.selected = Some(current.clone());
        app.account.persist_now = false;
        let before = app.state.clone();
        let saved = app.account.saved.clone();
        for json in [
            serde_json::json!({ "action": "location", "book": "John", "id": "unknown-passage" }),
            serde_json::json!({ "action": "location", "book": "John", "id": other }),
            serde_json::json!({ "action": "location", "book": "Genesis", "id": other }),
            serde_json::json!({ "action": "select", "book": "John", "id": other }),
            serde_json::json!({ "action": "select", "book": "Genesis", "id": other }),
            serde_json::json!({ "action": "select", "book": "John", "id": "unknown-passage" }),
            serde_json::json!({ "action": "next", "book": "unknown-book" }),
            serde_json::json!({ "action": "previous", "book": "Genesis" }),
            serde_json::json!({ "action": "preference", "id": "unknown", "value": 1 }),
            serde_json::json!({ "action": "preference", "id": "canon", "value": 1.5 }),
            serde_json::json!({ "action": "preference", "id": "theme", "value": -1 }),
            serde_json::json!({ "action": "preference", "id": "translation", "value": 5 }),
            serde_json::json!({ "action": "connection", "id": "javascript:alert(1)" }),
            serde_json::json!({ "action": "connection", "id": "file:///tmp/reader" }),
            serde_json::json!({ "action": "connection", "id": "" }),
            serde_json::json!({ "action": "future-action" }),
        ] {
            assert_eq!(send(&mut app, &ctx, json.clone()), Effect::None, "{json}");
            assert!(app.state == before, "{json}");
            assert!(app.account.saved == saved, "{json}");
            assert_eq!(app.selected.as_ref(), Some(&current), "{json}");
            assert!(!app.account.persist_now, "{json}");
        }
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            apply(
                &mut app,
                &ctx,
                Event {
                    action: "preference".into(),
                    id: "font".into(),
                    value,
                    ..Default::default()
                },
            );
            assert!(app.state == before);
            assert!(!app.account.persist_now);
        }
        for json in [
            serde_json::json!({}),
            serde_json::json!({ "action": 7 }),
            serde_json::json!({ "action": "select", "id": 8 }),
            serde_json::json!({ "action": "preference", "value": "large" }),
        ] {
            assert!(serde_json::from_value::<Event>(json).is_err());
        }
    }
}
