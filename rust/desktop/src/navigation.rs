use super::*;
use std::sync::{Mutex, OnceLock};

static INCOMING_LINK: Mutex<Option<String>> = Mutex::new(None);
static READER_CONTEXT: OnceLock<egui::Context> = OnceLock::new();

pub(super) fn install_reader_links(ctx: &egui::Context) {
    if READER_CONTEXT.set(ctx.clone()).is_err() {
        return;
    }
    #[cfg(target_vendor = "apple")]
    {
        unsafe extern "C" {
            fn cross_canon_install_reader_links();
        }
        // SAFETY: initialization runs on the application's main thread.
        unsafe { cross_canon_install_reader_links() };
    }
}

#[no_mangle]
pub unsafe extern "C" fn cross_canon_open_reader_link(url: *const std::ffi::c_char) {
    if url.is_null() {
        return;
    }
    // SAFETY: our OS adapter supplies a live nul-terminated UTF-8 string; copied here.
    let value = unsafe { std::ffi::CStr::from_ptr(url) }.to_string_lossy();
    if value.len() > 2048 {
        return;
    }
    if let Ok(mut link) = INCOMING_LINK.lock() {
        *link = Some(value.into_owned());
    }
    if let Some(ctx) = READER_CONTEXT.get() {
        ctx.request_repaint();
    }
}

pub(super) fn take_reader_link() -> Option<String> {
    INCOMING_LINK.lock().ok()?.take()
}

impl Desktop {
    pub(super) fn play_audio(&mut self, chapter_id: &str) {
        if self.audio_chapter.as_deref() == Some(chapter_id) {
            let _ = self.audio_tx.send(audio::Command::Toggle);
        } else if let Some(audio) = self.library.audio(chapter_id) {
            let (book, _) = self.library.chapter(chapter_id).unwrap();
            let mut sources = downloads::PlaybackSources::new(&self.library.root);
            let chapters = book
                .chapters
                .iter()
                .filter_map(|chapter| {
                    let mut audio = self.library.audio(&chapter.id)?;
                    let fallback = self
                        .library
                        .original_audio(&chapter.id)
                        .filter(|original| original.url != audio.url);
                    let mut normalize = |location: &mut cross_canon_core::AudioLocation| {
                        location.url = sources.resolve(&location.url);
                    };
                    normalize(&mut audio);
                    let fallback = fallback.map(|mut a| {
                        normalize(&mut a);
                        a
                    });
                    Some(audio::PlaybackChapter {
                        id: chapter.id.clone(),
                        title: format!("{} {}", book.title, chapter.number),
                        audio,
                        fallback,
                    })
                })
                .collect::<Vec<_>>();
            let index = chapters.iter().position(|c| c.id == chapter_id).unwrap();
            let _ = audio;
            let _ = self
                .audio_tx
                .send(audio::Command::Play(audio::PlaybackPlan {
                    chapters,
                    index,
                }));
            self.audio_chapter = Some(chapter_id.to_owned());
            self.message = "Loading audio…".into();
        }
    }
    pub(super) fn remember_location(&mut self, id: String) {
        let Some(passage) = self.library.passage(&id) else {
            return;
        };
        // Reader chrome follows the Passage's Chapter for both explicit
        // navigation and passive reading. Pixel offsets are never Chapter IDs.
        self.active_chapter_id = passage.chapter_id.clone();
        if self.state.location_passage_id != id {
            self.account.remember(passage);
        }
        match passage.corpus {
            Corpus::Scripture => self.state.scripture_location = id.clone(),
            Corpus::EarlyChristian => self.state.fathers_location = id.clone(),
            Corpus::ChristianClassics => self.state.classics_location = id.clone(),
        }
        self.state.location_passage_id = id;
    }

    pub(super) fn switch_corpus(&mut self, target: Corpus) {
        // Migrate old installations' single saved location before leaving it.
        self.remember_location(self.state.location_passage_id.clone());
        let saved = match target {
            Corpus::Scripture => &self.state.scripture_location,
            Corpus::EarlyChristian => &self.state.fathers_location,
            Corpus::ChristianClassics => &self.state.classics_location,
        };
        let id = self
            .library
            .passage(saved)
            .filter(|p| p.corpus == target)
            .map(|p| p.id.clone())
            .or_else(|| {
                let default = match target {
                    Corpus::Scripture => "Genesis",
                    Corpus::EarlyChristian => "anf09:xii.iv",
                    Corpus::ChristianClassics => "classics:imitation",
                };
                self.library
                    .book(default)
                    .or_else(|| self.library.books.iter().find(|b| b.corpus == target))
                    .and_then(|b| b.chapters.first())
                    .and_then(|c| c.passage_ids.first())
                    .cloned()
            });
        if let Some(id) = id {
            self.open(id);
        }
    }

    pub(super) fn show_jump(&mut self) {
        let passage = self.current_passage().clone();
        self.jump_book = passage.book_id.clone();
        self.jump_chapter = passage.chapter;
        self.jump_corpus = passage.corpus;
        self.jump_filter.clear();
        self.jump_author.clear();
        self.dialog = Some(Dialog::Jump);
    }

    pub(super) fn go_back(&mut self) {
        if let Some(id) = self.back.pop() {
            self.forward.push(self.state.location_passage_id.clone());
            self.restore_location(id);
        }
    }
    pub(super) fn go_forward(&mut self) {
        if let Some(id) = self.forward.pop() {
            self.back.push(self.state.location_passage_id.clone());
            self.restore_location(id);
        }
    }
    pub(super) fn toggle_favorite(&mut self, book: &str) {
        if self.state.favorite_books.iter().any(|id| id == book) {
            self.state.favorite_books.retain(|id| id != book);
        } else if self
            .library
            .book(book)
            .is_some_and(|b| b.corpus != Corpus::Scripture)
        {
            self.state.favorite_books.push(book.into());
        }
    }
}

pub(super) fn reader_link(passage: &Passage) -> String {
    let mut url = reqwest::Url::parse("https://www.crosscanon.com").unwrap();
    if passage.corpus == Corpus::Scripture {
        url.set_path(&format!("/reader/{}", passage.id));
    } else {
        url.set_path(if passage.corpus == Corpus::ChristianClassics {
            "/christian-classics/read"
        } else {
            "/church-fathers"
        });
        url.query_pairs_mut()
            .append_pair("chapter", &passage.chapter_id)
            .append_pair(
                "passage",
                &format!("{}-{}", passage.verse_start, passage.verse_end),
            );
    }
    url.into()
}

pub(super) fn passage_from_link(library: &Library, text: &str) -> Option<String> {
    let url = reqwest::Url::parse(text.trim())
        .or_else(|_| {
            reqwest::Url::parse("https://www.crosscanon.com")
                .unwrap()
                .join(text.trim())
        })
        .ok()?;
    if url.scheme() != "crosscanon"
        && !matches!(
            url.host_str(),
            Some("www.crosscanon.com" | "crosscanon.com")
        )
    {
        return None;
    }
    let path = if url.scheme() == "crosscanon" {
        format!("/{}{}", url.host_str().unwrap_or_default(), url.path())
    } else {
        url.path().to_string()
    };
    if let Some(id) = path.strip_prefix("/reader/") {
        return library.passage(id).map(|p| p.id.clone());
    }
    let corpus = match path.trim_end_matches('/') {
        "/church-fathers" => Corpus::EarlyChristian,
        "/christian-classics/read" => Corpus::ChristianClassics,
        _ => return None,
    };
    let query = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    let chapter = query.get("chapter")?;
    let (book, entry) = library.chapter(chapter)?;
    if book.corpus != corpus {
        return None;
    }
    let range = query.get("passage").map(|s| s.as_ref()).unwrap_or("");
    entry
        .passage_ids
        .iter()
        .find(|id| {
            library.passage(id).is_some_and(|p| {
                range.is_empty() || format!("{}-{}", p.verse_start, p.verse_end) == range
            })
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corpus_locations_history_favorites_and_reader_links_survive_navigation() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let john = library.book("John").unwrap().chapters[2]
            .passage_ids
            .last()
            .unwrap()
            .clone();
        app.open(john.clone());
        app.switch_corpus(Corpus::EarlyChristian);
        assert_eq!(app.current_passage().book_id, "anf09:xii.iv");
        let clement = library.book("anf09:xii.iv").unwrap().chapters[3].passage_ids[0].clone();
        app.open(clement.clone());
        app.switch_corpus(Corpus::Scripture);
        assert_eq!(app.state.location_passage_id, john);
        app.switch_corpus(Corpus::EarlyChristian);
        assert_eq!(app.state.location_passage_id, clement);
        app.go_back();
        assert_eq!(app.state.location_passage_id, john);
        app.go_forward();
        assert_eq!(app.state.location_passage_id, clement);
        app.toggle_favorite("anf09:xii.iv");
        app.switch_corpus(Corpus::ChristianClassics);
        assert_eq!(app.current_passage().book_id, "classics:imitation");
        let classic =
            library.book("classics:imitation").unwrap().chapters[1].passage_ids[0].clone();
        app.open(classic.clone());
        app.toggle_favorite("classics:imitation");
        app.switch_corpus(Corpus::Scripture);
        assert_eq!(app.state.location_passage_id, john);
        app.switch_corpus(Corpus::ChristianClassics);
        assert_eq!(app.state.location_passage_id, classic);
        let mut storage = crate::tests::MemoryStorage::default();
        eframe::App::save(&mut app, &mut storage);
        let mut restored = Desktop::initialize(&ctx, Some(&storage), library.clone());
        assert_eq!(
            restored.state.favorite_books,
            ["anf09:xii.iv", "classics:imitation"]
        );
        restored.switch_corpus(Corpus::Scripture);
        assert_eq!(restored.state.location_passage_id, john);
        restored.switch_corpus(Corpus::ChristianClassics);
        assert_eq!(restored.state.location_passage_id, classic);
        for id in [john, clement, classic] {
            let link = reader_link(library.passage(&id).unwrap());
            assert_eq!(passage_from_link(&library, &link), Some(id));
        }
    }
    #[test]
    fn opening_reader_link_positions_the_requested_passage_in_the_viewport() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for target in ["0c558fd2c95099cf1909774d", "61a9b43eaccc335fe2739693"] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.open("anf09:xii.iv.i:1-3".into());

            let mut seen = false;
            for frame in 0..80 {
                if frame == 5 {
                    app.open(target.into());
                }
                let output = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(Rect::from_min_size(
                            egui::Pos2::ZERO,
                            egui::vec2(1000.0, 900.0),
                        )),
                        time: Some(frame as f64 / 60.0),
                        ..Default::default()
                    },
                    |ctx| app.render(ctx),
                );
                if frame == 79 {
                    for shape in output.shapes {
                        if let egui::epaint::Shape::Text(text) = shape.shape {
                            if text.galley.job.text == library.passage(target).unwrap().text {
                                let rect = Rect::from_min_size(text.pos, text.galley.size());
                                seen = shape.clip_rect.intersects(rect)
                                    && rect.top() >= app.toolbar_rect.bottom();
                            }
                        }
                    }
                }
            }
            assert!(
                seen,
                "Opening John 3:12–17 must actually display it, not a later chapter"
            );
            assert_eq!(
                app.state.location_passage_id, target,
                "Programmatic scrolling must retain the requested focus"
            );
        }
    }
}
