//! Offline work discovery is distinct from theme/paragraph search. Its small
//! catalog supplements the existing text bundle without changing its format.
use super::*;
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path, sync::OnceLock};

#[derive(Default, Deserialize)]
pub(super) struct Catalog {
    #[serde(default)]
    pub works: HashMap<String, WorkDetails>,
    #[serde(default)]
    chapters: HashMap<String, ChapterDetails>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct WorkDetails {
    pub genre: Option<String>,
    pub tradition: Option<String>,
    pub authorship_date_range: Option<String>,
    pub translator: Option<String>,
    pub edition: Option<String>,
    pub rights: Option<String>,
    pub source: Option<SourceDetails>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct SourceDetails {
    pub source_url: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ChapterDetails {
    scripture_reference: Option<ScriptureReference>,
    paragraphs: Vec<Paragraph>,
}

#[derive(Deserialize)]
struct ScriptureReference {
    book: String,
    chapter: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paragraph {
    start: u32,
    end: u32,
    scripture_start: Option<u32>,
    scripture_end: Option<u32>,
}

impl Catalog {
    pub fn load(root: &Path) -> Arc<Self> {
        static CATALOGS: OnceLock<std::sync::Mutex<HashMap<PathBuf, Arc<Catalog>>>> =
            OnceLock::new();
        let mut catalogs = CATALOGS.get_or_init(Default::default).lock().unwrap();
        catalogs
            .entry(root.to_owned())
            .or_insert_with(|| {
                let bundled = fs::read(root.join("catalog.json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok());
                Arc::new(bundled.unwrap_or_else(|| Self::from_artifacts(root)))
            })
            .clone()
    }

    fn from_artifacts(root: &Path) -> Self {
        let mut catalog = Self::default();
        for path in [
            "public/church-fathers-preview/books.json",
            "public/christian-classics-text/books.json",
        ] {
            let Some(index) = fs::read(root.join(path))
                .ok()
                .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
            else {
                continue;
            };
            for book in index["books"].as_array().into_iter().flatten() {
                if let Some(id) = book["id"].as_str() {
                    catalog.works.insert(
                        id.into(),
                        serde_json::from_value(book["metadata"].clone()).unwrap_or_default(),
                    );
                }
            }
        }
        catalog
    }

    pub fn decorate(&self, library: &Library, hit: &mut ResultPassage) {
        if hit.corpus != Corpus::ChristianClassics {
            return;
        }
        let Some(passage) = library.passage(&hit.id) else {
            return;
        };
        // Older text bundles can still show an honest chapter label.
        if hit.reference == passage.reference {
            if let Some((reference, _)) = hit.reference.rsplit_once(':') {
                hit.reference = reference.to_owned();
            }
        }
        let Some(details) = self.chapters.get(&passage.chapter_id) else {
            return;
        };
        let paragraphs: Vec<_> = details
            .paragraphs
            .iter()
            .filter(|p| p.start <= passage.verse_end && p.end >= passage.verse_start)
            .collect();
        let (Some(first), Some(last)) = (paragraphs.first(), paragraphs.last()) else {
            return;
        };
        if let Some((_, chapter)) = library.chapter(&passage.chapter_id) {
            hit.text = chapter
                .passage_ids
                .iter()
                .filter_map(|id| library.passage(id))
                .flat_map(|p| &p.verses)
                .filter(|v| v.number >= first.start && v.number <= last.end)
                .map(|v| v.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
        }
        if let (Some(reference), Some(start), Some(end)) = (
            &details.scripture_reference,
            paragraphs.iter().filter_map(|p| p.scripture_start).min(),
            paragraphs
                .iter()
                .filter_map(|p| p.scripture_end.or(p.scripture_start))
                .max(),
        ) {
            let range = if start == end {
                start.to_string()
            } else {
                format!("{start}–{end}")
            };
            hit.reference = format!(
                "{} · {} {}:{range}",
                passage.book, reference.book, reference.chapter
            );
        }
    }
}

pub(super) struct Browser {
    pub corpus: Corpus,
    pub query: String,
    pub category: String,
    pub favorites_only: bool,
    pub about: Option<String>,
}

impl Browser {
    pub fn new(corpus: Corpus) -> Self {
        Self {
            corpus,
            query: String::new(),
            category: String::new(),
            favorites_only: false,
            about: None,
        }
    }

    pub fn choose_collection(&mut self, corpus: Corpus) {
        if self.corpus != corpus {
            *self = Self::new(corpus);
        }
    }

    pub fn matches(
        &self,
        book: &Book,
        details: Option<&WorkDetails>,
        favorites: &[String],
        canon: Canon,
    ) -> bool {
        let haystack = format!(
            "{} {} {} {}",
            book.title,
            book.author.as_deref().unwrap_or(""),
            details.and_then(|d| d.genre.as_deref()).unwrap_or(""),
            details.and_then(|d| d.tradition.as_deref()).unwrap_or("")
        )
        .to_lowercase();
        book.corpus == self.corpus
            && (book.corpus != Corpus::Scripture || canon.includes(&book.title))
            && (!self.favorites_only || favorites.contains(&book.id))
            && (self.category.is_empty()
                || details.and_then(|d| d.genre.as_deref()) == Some(self.category.as_str()))
            && self
                .query
                .to_lowercase()
                .split_whitespace()
                .all(|term| haystack.contains(term))
    }
}

impl Desktop {
    pub(super) fn show_catalog(&mut self) {
        self.catalog_browser
            .choose_collection(self.current_passage().corpus);
        self.catalog_browser.about = None;
        self.dialog = Some(Dialog::Collections);
    }

    fn saved_catalog_location(&self, corpus: Corpus) -> Option<&Passage> {
        let saved = if self.current_passage().corpus == corpus {
            &self.state.location_passage_id
        } else {
            match corpus {
                Corpus::Scripture => &self.state.scripture_location,
                Corpus::EarlyChristian => &self.state.fathers_location,
                Corpus::ChristianClassics => &self.state.classics_location,
            }
        };
        self.library.passage(saved).filter(|p| p.corpus == corpus)
    }

    fn open_catalog_work(&mut self, book: &Book) {
        let id = self
            .saved_catalog_location(book.corpus)
            .filter(|p| p.book_id == book.id)
            .map(|p| p.id.clone())
            .or_else(|| book.chapters.first()?.passage_ids.first().cloned());
        if let Some(id) = id {
            self.remember_location(self.state.location_passage_id.clone());
            self.open(id);
        }
    }

    pub(super) fn collections_dialog(&mut self, ui: &mut egui::Ui, suppress_click: bool) {
        let library = self.library.clone();
        let catalog = self.catalog.clone();
        let p = self.state.theme.palette();
        ui.horizontal(|ui| {
            let width = (ui.available_width() - 16.0) / 3.0;
            for (corpus, _, label) in COLLECTIONS {
                if ui
                    .add_sized(
                        [width, 40.0],
                        egui::Button::new(label).selected(self.catalog_browser.corpus == corpus),
                    )
                    .clicked()
                    && !suppress_click
                {
                    self.catalog_browser.choose_collection(corpus);
                }
            }
        });
        ui.add_space(10.0);
        if let Some(book) = self
            .catalog_browser
            .about
            .as_deref()
            .and_then(|id| library.book(id))
        {
            if control(ui, "Back to library").clicked() && !suppress_click {
                self.catalog_browser.about = None;
            }
            ui.add_space(12.0);
            ui.label(RichText::new(&book.title).font(heading(23.0)).strong());
            if let Some(author) = &book.author {
                ui.label(author);
            }
            ui.add_space(10.0);
            ui.label(RichText::new("About this edition").strong().color(p.accent));
            if let Some(details) = catalog.works.get(&book.id) {
                for (name, value) in [
                    ("Type", details.genre.as_deref()),
                    ("Tradition", details.tradition.as_deref()),
                    ("Written", details.authorship_date_range.as_deref()),
                    ("Translator", details.translator.as_deref()),
                    ("Edition", details.edition.as_deref()),
                    ("Rights", details.rights.as_deref()),
                ] {
                    if let Some(value) = value.filter(|v| !v.is_empty()) {
                        ui.label(RichText::new(name).strong().color(p.muted));
                        ui.add(egui::Label::new(value).wrap());
                        ui.add_space(6.0);
                    }
                }
                if let Some(url) = details
                    .source
                    .as_ref()
                    .and_then(|s| s.source_url.as_deref())
                {
                    ui.hyperlink_to("View source edition", url);
                }
            }
            ui.add_space(12.0);
            if control(ui, "Read this work").clicked() && !suppress_click {
                self.open_catalog_work(book);
            }
            return;
        }
        let corpus = self.catalog_browser.corpus;
        ui.label(
            RichText::new(collection_name(corpus))
                .font(heading(21.0))
                .strong(),
        );
        ui.add_space(6.0);
        ui.label(
            RichText::new(if corpus == Corpus::Scripture {
                "Find a book"
            } else {
                "Find a work or author"
            })
            .strong()
            .color(p.muted),
        );
        ui.horizontal(|ui| {
            let width = (ui.available_width() - 52.0).max(100.0);
            ui.add(
                egui::TextEdit::singleline(&mut self.catalog_browser.query)
                    .id(Id::new("catalog-query"))
                    .hint_text(if corpus == Corpus::Scripture {
                        "Book name"
                    } else {
                        "Title or author"
                    })
                    .char_limit(200)
                    .margin(egui::vec2(10.0, 10.0))
                    .desired_width(width),
            );
            let clear = icons::button(ui, icons::Icon::Close, "", egui::vec2(44.0, 44.0), false)
                .on_hover_text("Clear catalog search");
            clear.widget_info(|| {
                egui::WidgetInfo::labeled(
                    egui::WidgetType::Button,
                    ui.is_enabled(),
                    "Clear catalog search",
                )
            });
            if clear.clicked() && !suppress_click {
                self.catalog_browser.query.clear();
            }
        });
        if corpus != Corpus::Scripture {
            ui.add_space(6.0);
            ui.horizontal_wrapped(|ui| {
                if ui
                    .add(egui::Button::new("All works").selected(
                        self.catalog_browser.category.is_empty()
                            && !self.catalog_browser.favorites_only,
                    ))
                    .clicked()
                    && !suppress_click
                {
                    self.catalog_browser.category.clear();
                    self.catalog_browser.favorites_only = false;
                }
                if ui
                    .add(
                        egui::Button::new("Favorites")
                            .selected(self.catalog_browser.favorites_only),
                    )
                    .clicked()
                    && !suppress_click
                {
                    self.catalog_browser.favorites_only = !self.catalog_browser.favorites_only;
                }
                if corpus == Corpus::ChristianClassics {
                    let genres: std::collections::BTreeSet<_> = library
                        .books
                        .iter()
                        .filter(|b| b.corpus == corpus)
                        .filter_map(|b| catalog.works.get(&b.id)?.genre.as_deref())
                        .collect();
                    for genre in genres {
                        if ui
                            .add(
                                egui::Button::new(genre)
                                    .selected(self.catalog_browser.category == genre),
                            )
                            .clicked()
                            && !suppress_click
                        {
                            self.catalog_browser.category = genre.into();
                            self.catalog_browser.favorites_only = false;
                        }
                    }
                }
            });
        }
        ui.add_space(12.0);
        if self.catalog_browser.query.trim().is_empty()
            && self.catalog_browser.category.is_empty()
            && !self.catalog_browser.favorites_only
        {
            let saved = self.saved_catalog_location(corpus).cloned();
            let featured = saved.clone().or_else(|| {
                let book = library.book(match corpus {
                    Corpus::Scripture => "Genesis",
                    Corpus::EarlyChristian => "anf09:xii.iv",
                    Corpus::ChristianClassics => "classics:imitation",
                })?;
                library
                    .passage(book.chapters.first()?.passage_ids.first()?)
                    .cloned()
            });
            if let Some(featured) = featured {
                ui.label(
                    RichText::new(if saved.is_some() {
                        "CONTINUE READING"
                    } else {
                        "A PLACE TO BEGIN"
                    })
                    .size(10.0)
                    .strong()
                    .color(p.accent),
                );
                let label = format!(
                    "{}\n{} →",
                    featured
                        .reference
                        .rsplit_once(':')
                        .map_or(featured.reference.as_str(), |(reference, _)| reference),
                    if saved.is_some() {
                        "Return to your place"
                    } else {
                        "Start reading"
                    }
                );
                if ui
                    .add_sized(
                        [ui.available_width(), 60.0],
                        egui::Button::new(label).wrap(),
                    )
                    .clicked()
                    && !suppress_click
                {
                    if saved.is_some() {
                        self.switch_corpus(corpus);
                    } else if let Some(book) = library.book(&featured.book_id) {
                        self.open_catalog_work(book);
                    }
                }
                ui.add_space(12.0);
            }
        }
        let mut books: Vec<_> = library
            .books
            .iter()
            .filter(|book| {
                self.catalog_browser.matches(
                    book,
                    catalog.works.get(&book.id),
                    &self.state.favorite_books,
                    self.state.canon,
                )
            })
            .collect();
        if corpus != Corpus::Scripture {
            books.sort_by_key(|book| {
                (
                    !self.state.favorite_books.contains(&book.id),
                    book.title.to_lowercase(),
                    book.author.as_deref(),
                )
            });
        }
        ui.horizontal(|ui| {
            ui.label(RichText::new("Explore the collection").strong());
            ui.label(
                RichText::new(format!(
                    "{} {}",
                    books.len(),
                    match (corpus == Corpus::Scripture, books.len() == 1) {
                        (true, true) => "book",
                        (true, false) => "books",
                        (false, true) => "work",
                        (false, false) => "works",
                    }
                ))
                .color(p.muted),
            );
        });
        if books.is_empty() {
            ui.add_space(12.0);
            ui.label(if self.catalog_browser.favorites_only {
                "No favorites match these filters. Star a work to save it here."
            } else {
                "No matching works. Try another author or title."
            });
            if control(ui, "Clear filters").clicked() && !suppress_click {
                self.catalog_browser = Browser::new(corpus);
            }
        }
        for book in books {
            ui.add_space(8.0);
            egui::Frame::NONE
                .fill(p.panel)
                .stroke(Stroke::new(1.0_f32, p.line))
                .corner_radius(6.0)
                .inner_margin(12.0)
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.add(egui::Label::new(RichText::new(&book.title).strong().size(15.0)).wrap());
                    if let Some(author) = &book.author {
                        ui.add(egui::Label::new(RichText::new(author).color(p.muted)).wrap());
                    }
                    let details = catalog.works.get(&book.id);
                    let mut meta = details
                        .into_iter()
                        .flat_map(|d| [d.genre.as_deref(), d.tradition.as_deref()])
                        .flatten()
                        .filter(|v| !v.is_empty())
                        .map(str::to_owned)
                        .collect::<Vec<_>>();
                    meta.push(format!("{} chapters", book.chapters.len()));
                    ui.add(
                        egui::Label::new(RichText::new(meta.join(" · ")).size(11.0).color(p.muted))
                            .wrap(),
                    );
                    ui.add_space(4.0);
                    ui.horizontal_wrapped(|ui| {
                        if control(
                            ui,
                            if corpus == Corpus::Scripture {
                                "Read book"
                            } else {
                                "Read work"
                            },
                        )
                        .clicked()
                            && !suppress_click
                        {
                            self.open_catalog_work(book);
                        }
                        if corpus != Corpus::Scripture {
                            if control(ui, "Edition").clicked() && !suppress_click {
                                self.catalog_browser.about = Some(book.id.clone());
                            }
                            let favorite = self.state.favorite_books.contains(&book.id);
                            if icons::button(
                                ui,
                                icons::Icon::Star,
                                "",
                                egui::vec2(44.0, 44.0),
                                favorite,
                            )
                            .on_hover_text(if favorite {
                                "Remove favorite"
                            } else {
                                "Favorite work"
                            })
                            .clicked()
                                && !suppress_click
                            {
                                self.toggle_favorite(&book.id);
                            }
                        }
                    });
                });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Arc<Library> {
        static LIBRARY: OnceLock<Arc<Library>> = OnceLock::new();
        LIBRARY
            .get_or_init(|| {
                Arc::new(
                    Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
                )
            })
            .clone()
    }

    #[test]
    fn discovery_matches_title_author_and_tradition_without_truncating_the_catalog() {
        let library = library();
        let catalog = Catalog::load(&library.root);
        let mut browser = Browser::new(Corpus::ChristianClassics);
        browser.query = "  REFORMED henry  ".into();
        let visible = |browser: &Browser, favorites: &[String]| {
            library
                .books
                .iter()
                .filter(|book| {
                    browser.matches(
                        book,
                        catalog.works.get(&book.id),
                        favorites,
                        Canon::Protestant,
                    )
                })
                .map(|book| book.id.as_str())
                .collect::<Vec<_>>()
        };
        assert_eq!(visible(&browser, &[]), ["classics:henry"]);
        browser.query = "wesley".into();
        assert_eq!(visible(&browser, &[]), ["classics:wesley"]);
        browser.query.clear();
        browser.category = "Spiritual Reading".into();
        assert_eq!(visible(&browser, &[]), ["classics:imitation"]);
        browser.choose_collection(Corpus::EarlyChristian);
        assert!(
            visible(&browser, &[]).len() > 24,
            "Every matching work is discoverable"
        );
        browser.favorites_only = true;
        assert_eq!(
            visible(&browser, &["anf09:xii.iv".into()]),
            ["anf09:xii.iv"]
        );
        browser.choose_collection(Corpus::ChristianClassics);
        assert!(browser.query.is_empty() && browser.category.is_empty() && !browser.favorites_only);
    }

    #[test]
    fn offline_paragraph_metadata_repairs_the_exact_screenshot_without_changing_its_source() {
        let library = library();
        let passage = library.passage("classics:henry:Prov.16:4-6").unwrap();
        let mut hit = ResultPassage::local(passage, 0.7);
        let catalog: Catalog = serde_json::from_value(serde_json::json!({"chapters": {
            "classics:henry:Prov.16": {"scriptureReference":{"book":"Proverbs","chapter":16},
                "paragraphs":[{"start":2,"end":12,"scriptureStart":1,"scriptureEnd":1}]}
        }}))
        .unwrap();
        catalog.decorate(&library, &mut hit);
        assert_eq!(
            hit.reference,
            "Commentary on the Whole Bible · Proverbs 16:1"
        );
        assert!(hit.text.starts_with("As we read this"));
        assert!(hit.text.ends_with("a blessing."));
        assert_eq!(hit.source_id, passage.id);
        assert_eq!(hit.score, 0.7);
        let mut corrected = ResultPassage::local(passage, 0.7);
        corrected.reference = hit.reference.clone();
        Catalog::default().decorate(&library, &mut corrected);
        assert_eq!(
            corrected.reference, hit.reference,
            "Never strip a server's real Scripture coverage"
        );
    }

    fn render(
        app: &mut Desktop,
        ctx: &egui::Context,
        width: f32,
        events: Vec<egui::Event>,
    ) -> egui::FullOutput {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(width, 852.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| app.render(ctx),
        )
    }

    fn label_position(output: &egui::FullOutput, label: &str) -> egui::Pos2 {
        output
            .shapes
            .iter()
            .find_map(|shape| match &shape.shape {
                egui::Shape::Text(text)
                    if text.galley.job.text == label && shape.clip_rect.contains(text.pos) =>
                {
                    Some(text.pos + text.galley.size() / 2.0)
                }
                _ => None,
            })
            .unwrap_or_else(|| panic!("Missing visible catalog label: {label}"))
    }

    fn tap(app: &mut Desktop, ctx: &egui::Context, width: f32, pos: egui::Pos2) {
        for pressed in [true, false] {
            render(
                app,
                ctx,
                width,
                vec![
                    egui::Event::PointerMoved(pos),
                    egui::Event::PointerButton {
                        pos,
                        button: egui::PointerButton::Primary,
                        pressed,
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
        }
    }

    #[test]
    fn reading_henry_from_catalog_bounds_first_frame_text_layout() {
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library());
        app.show_catalog();
        app.catalog_browser
            .choose_collection(Corpus::ChristianClassics);
        app.catalog_browser.query = "Henry".into();
        for _ in 0..3 {
            render(&mut app, &ctx, 393.0, vec![]);
        }
        let output = render(&mut app, &ctx, 393.0, vec![]);
        tap(&mut app, &ctx, 393.0, label_position(&output, "Read work"));
        assert_eq!(app.current_passage().book_id, "classics:henry");
        // Navigation is only half the action: the next frame actually opens
        // Henry's very large commentary on memory-constrained phones.
        let start = Instant::now();
        let output = render(&mut app, &ctx, 393.0, vec![]);
        let galleys = ctx.fonts(|fonts| fonts.num_galleys_in_cache());
        eprintln!(
            "HENRY_FIRST_FRAME elapsed={:?} galleys={galleys}",
            start.elapsed()
        );
        assert!(galleys < 1000, "Opening Henry must bound text layout to nearby chapters, got {galleys} cached text layouts");
        assert!(output.shapes.iter().any(|shape| matches!(&shape.shape,
            egui::Shape::Text(text) if text.galley.job.text.contains("Genesis"))));
        let last = app
            .library
            .book("classics:henry")
            .unwrap()
            .chapters
            .last()
            .unwrap()
            .passage_ids[0]
            .clone();
        for id in ["classics:henry:Prov.16:4-6".into(), last] {
            app.open(id.clone());
            for width in [393.0, 852.0, 320.0] {
                for _ in 0..3 {
                    render(&mut app, &ctx, width, vec![]);
                }
                assert_eq!(app.state.location_passage_id, id);
                assert!(ctx.fonts(|fonts| fonts.num_galleys_in_cache()) < 2000);
            }
        }
        let saved = app.state.location_passage_id.clone();
        let mut storage = crate::tests::MemoryStorage::default();
        eframe::App::save(&mut app, &mut storage);
        let restored_ctx = egui::Context::default();
        let mut restored = Desktop::initialize(&restored_ctx, Some(&storage), library());
        render(&mut restored, &restored_ctx, 393.0, vec![]);
        assert_eq!(restored.state.location_passage_id, saved);
        assert!(restored_ctx.fonts(|fonts| fonts.num_galleys_in_cache()) < 2000);
    }

    #[test]
    fn phone_library_filters_by_keyboard_and_only_navigates_when_read_is_selected() {
        let library = library();
        for width in [320.0, 393.0, 1000.0] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            let original = app.current_passage().id.clone();
            app.show_catalog();
            for _ in 0..3 {
                render(&mut app, &ctx, width, vec![]);
            }
            let output = render(&mut app, &ctx, width, vec![]);
            tap(&mut app, &ctx, width, label_position(&output, "Classics"));
            assert_eq!(
                app.current_passage().id,
                original,
                "Browsing must not replace Reader Location"
            );
            assert!(app.dialog == Some(Dialog::Collections));
            ctx.memory_mut(|memory| memory.request_focus(Id::new("catalog-query")));
            render(
                &mut app,
                &ctx,
                width,
                vec![egui::Event::Text("Henry".into())],
            );
            assert_eq!(app.catalog_browser.query, "Henry");
            let output = render(&mut app, &ctx, width, vec![]);
            label_position(&output, "Commentary on the Whole Bible");
            label_position(&output, "1 work");
            for shape in &output.shapes {
                if let egui::Shape::Text(text) = &shape.shape {
                    if shape.clip_rect.contains(text.pos) {
                        assert!(
                            text.pos.x + text.galley.size().x <= width - 6.0,
                            "Catalog text exceeds phone width {width}: {}",
                            text.galley.job.text
                        );
                    }
                }
            }
            tap(&mut app, &ctx, width, label_position(&output, "Read work"));
            assert_eq!(app.current_passage().book_id, "classics:henry");
            assert_eq!(app.state.scripture_location, original);
            assert!(app.dialog.is_none());
        }
    }
}
