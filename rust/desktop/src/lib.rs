mod account;
#[cfg(not(target_arch = "wasm32"))]
mod audio;
#[cfg(target_arch = "wasm32")]
#[path = "platform/browser_audio.rs"]
mod audio;
#[cfg(target_arch = "wasm32")]
mod browser;
#[cfg(target_arch = "wasm32")]
mod browser_library;
mod catalog;
mod commentary;
mod dialogs;
#[cfg(not(target_arch = "wasm32"))]
mod downloads;
#[cfg(target_arch = "wasm32")]
#[path = "platform/browser_downloads.rs"]
mod downloads;
mod icons;
mod mobile;
mod navigation;
mod note_markdown;
#[cfg(test)]
mod performance;
mod persistence;
mod platform;
mod reader;
mod reading_translation;
mod search;
#[cfg(test)]
mod search_regressions;
mod study;
#[cfg(any(target_os = "ios", target_arch = "wasm32", test))]
mod text_surface;
mod theme;
mod touch_scroll;
use anyhow::{Context, Result};
#[cfg(not(target_arch = "wasm32"))]
use cross_canon_core::data_root;
use cross_canon_core::{Book, Canon, Corpus, Library, Passage, SearchMode, SearchRequest};
use eframe::egui::{self, Align, Align2, FontId, Id, Key, Layout, Rect, RichText, Sense, Stroke};
use platform::Instant;
use search::ResultPassage;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    time::Duration,
};
use theme::{heading, serif, Theme};

const COLLECTIONS: [(Corpus, &str, &str); 3] = [
    (Corpus::Scripture, "Scripture", "Bible"),
    (Corpus::EarlyChristian, "Early Christian Works", "Fathers"),
    (Corpus::ChristianClassics, "Christian Classics", "Classics"),
];

const READER_FOOTER_HEIGHT: f32 = 76.0;

fn collection_name(corpus: Corpus) -> &'static str {
    COLLECTIONS
        .iter()
        .find(|entry| entry.0 == corpus)
        .unwrap()
        .1
}

fn collection_short_name(corpus: Corpus) -> &'static str {
    COLLECTIONS
        .iter()
        .find(|entry| entry.0 == corpus)
        .unwrap()
        .2
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
struct ReaderState {
    location_passage_id: String,
    scripture_location: String,
    fathers_location: String,
    #[serde(default)]
    classics_location: String,
    favorite_books: Vec<String>,
    canon: Canon,
    theme: Theme,
    font_scale: f32,
    line_height: f32,
    width: f32,
    original: bool,
    scripture_translation: reading_translation::Translation,
    api_url: String,
}
impl Default for ReaderState {
    fn default() -> Self {
        Self {
            location_passage_id: String::new(),
            scripture_location: String::new(),
            fathers_location: String::new(),
            classics_location: String::new(),
            favorite_books: vec![],
            canon: Canon::Protestant,
            theme: Theme::Paper,
            font_scale: 1.0,
            line_height: 1.72,
            width: 820.0,
            original: false,
            scripture_translation: reading_translation::Translation::Web,
            api_url: "https://www.crosscanon.com/r/api".into(),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Dialog {
    Library,
    Search,
    Settings,
    Downloads,
    Account,
    Commentary,
    Study,
}
struct SearchOutput {
    generation: u64,
    result: std::result::Result<Vec<ResultPassage>, String>,
}
struct Desktop {
    #[cfg(any(target_os = "ios", target_arch = "wasm32", test))]
    text_surface: text_surface::Reader,
    reader_storage: Option<persistence::ReaderStorage>,
    account: account::Account,
    study: study::Study,
    library: Arc<Library>,
    reading_text: Arc<reading_translation::ReadingText>,
    catalog: Arc<catalog::Catalog>,
    library_about: bool,
    commentary: Option<commentary::Selection>,
    state: ReaderState,
    selected: Option<String>,
    active_chapter_id: String,
    dialog: Option<Dialog>,
    tools: bool,
    toolbar_rect: Rect,
    tools_rect: Rect,
    jump_button_rect: Rect,
    jump_filter: String,
    jump_book: String,
    jump_chapter: u32,
    jump_corpus: Corpus,
    jump_author: String,
    back: Vec<String>,
    forward: Vec<String>,
    query: String,
    search_corpus: Option<Corpus>,
    semantic: bool,
    search_source: Option<ResultPassage>,
    search_books: Vec<String>,
    search_authors: Vec<String>,
    match_count: usize,
    filters_open: bool,
    author_filter: String,
    selected_result: Option<String>,
    results_semantic: bool,
    results: Vec<ResultPassage>,
    search_tx: Sender<SearchOutput>,
    search_rx: Receiver<SearchOutput>,
    search_generation: u64,
    busy: bool,
    message: String,
    scroll_target: Option<String>,
    last_scroll: f32,
    reader_layout: reader::ReaderLayout,
    reader_touch: touch_scroll::TouchScroll,
    reader_max_scroll: f32,
    search_touch: touch_scroll::TouchScroll,
    search_scroll: f32,
    search_max_scroll: f32,
    audio_tx: Arc<Sender<audio::Command>>,
    audio_rx: Receiver<audio::Event>,
    audio_chapter: Option<String>,
    playing: bool,
    downloads: Option<downloads::Downloads>,
    started: Instant,
    screenshot: Option<PathBuf>,
    screenshot_sent: bool,
    startup_reported: bool,
}
impl Desktop {
    #[cfg(not(target_arch = "wasm32"))]
    fn new(
        cc: &eframe::CreationContext<'_>,
        library: Arc<Library>,
        startup: Instant,
        persistence_path: Option<PathBuf>,
    ) -> Result<Self> {
        navigation::install_reader_links(&cc.egui_ctx);
        let reader_storage = persistence_path
            .map(persistence::ReaderStorage::open)
            .transpose()?;
        let storage = reader_storage
            .as_ref()
            .map(|s| s as &dyn eframe::Storage)
            .or(cc.storage);
        let mut app = Self::initialize(&cc.egui_ctx, storage, library);
        app.reader_storage = reader_storage;
        if std::env::var_os("CROSS_CANON_FRESH").is_none() {
            let directory =
                PathBuf::from(std::env::var_os("HOME").context("Missing app home directory")?)
                    .join("Library/Application Support/CrossCanon");
            app.study
                .attach_storage(directory.join("personal-study.ron"))?;
        }
        app.started = startup;
        Ok(app)
    }
    fn initialize(
        ctx: &egui::Context,
        storage: Option<&dyn eframe::Storage>,
        library: Arc<Library>,
    ) -> Self {
        theme::fonts(ctx);
        let fresh = std::env::var_os("CROSS_CANON_FRESH").is_some();
        let mut state: ReaderState = if fresh {
            ReaderState::default()
        } else {
            storage
                .and_then(|s| eframe::get_value(s, "reader"))
                .unwrap_or_default()
        };
        state.font_scale = state.font_scale.clamp(0.86, 1.35);
        state.line_height = state.line_height.clamp(1.42, 2.08);
        state.width = state.width.clamp(620.0, 880.0);
        if let Ok(url) = std::env::var("R_CROSS_CANNON_URL") {
            state.api_url = url;
        }
        if let Ok(id) = std::env::var("CROSS_CANON_PASSAGE") {
            state.location_passage_id = id;
        }
        if library.passage(&state.location_passage_id).is_none() {
            state.location_passage_id =
                library.book("Genesis").unwrap().chapters[0].passage_ids[0].clone()
        }
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(id) =
            std::env::args().find_map(|arg| navigation::passage_from_link(&library, &arg))
        {
            state.location_passage_id = id;
        }
        state.theme.apply(ctx);
        let location = library.passage(&state.location_passage_id).unwrap();
        let active_chapter_id = location.chapter_id.clone();
        let jump_book = location.book_id.clone();
        let jump_chapter = location.chapter;
        let jump_corpus = location.corpus;
        let search_corpus = Some(location.corpus);
        let (search_tx, search_rx) = mpsc::channel();
        let (audio_tx, audio_rx) = audio::start(library.root.clone(), ctx.clone());
        let catalog = catalog::Catalog::load(&library.root);
        let reading_text = Arc::new(reading_translation::ReadingText::new(&library));
        let mut desktop = Self {
            #[cfg(any(target_os = "ios", target_arch = "wasm32", test))]
            text_surface: Default::default(),
            reader_storage: None,
            study: study::Study::new(if fresh {
                Default::default()
            } else {
                storage
                    .and_then(|s| eframe::get_value(s, "study"))
                    .unwrap_or_default()
            }),
            account: account::Account::new(if fresh {
                Default::default()
            } else {
                storage
                    .and_then(|s| eframe::get_value(s, "accounts"))
                    .unwrap_or_default()
            }),
            library,
            reading_text,
            catalog,
            library_about: false,
            commentary: None,
            state: state.clone(),
            selected: None,
            active_chapter_id,
            dialog: None,
            tools: false,
            toolbar_rect: Rect::NOTHING,
            tools_rect: Rect::NOTHING,
            jump_button_rect: Rect::NOTHING,
            jump_filter: String::new(),
            jump_book,
            jump_chapter,
            jump_corpus,
            jump_author: String::new(),
            back: vec![],
            forward: vec![],
            query: String::new(),
            search_corpus,
            semantic: true,
            search_source: None,
            search_books: vec![],
            search_authors: vec![],
            match_count: 10,
            filters_open: false,
            author_filter: String::new(),
            selected_result: None,
            results_semantic: true,
            results: vec![],
            search_tx,
            search_rx,
            search_generation: 0,
            busy: false,
            message: String::new(),
            scroll_target: Some(state.location_passage_id),
            last_scroll: 0.0,
            reader_layout: Default::default(),
            reader_touch: Default::default(),
            reader_max_scroll: 0.0,
            search_touch: Default::default(),
            search_scroll: 0.0,
            search_max_scroll: 0.0,
            audio_tx,
            audio_rx,
            audio_chapter: None,
            playing: false,
            downloads: None,
            started: Instant::now(),
            screenshot: std::env::var_os("CROSS_CANON_SCREENSHOT").map(Into::into),
            screenshot_sent: false,
            startup_reported: false,
        };
        if fresh {
            match std::env::var("CROSS_CANON_PREVIEW").as_deref() {
                Ok("collections") => {
                    desktop.show_library();
                    desktop.jump_filter =
                        std::env::var("CROSS_CANON_CATALOG_QUERY").unwrap_or_default();
                }
                Ok("settings") => desktop.dialog = Some(Dialog::Settings),
                Ok("account") => desktop.dialog = Some(Dialog::Account),
                Ok("study") => desktop.dialog = Some(Dialog::Study),
                Ok(mode @ ("study-passage" | "study-editor")) => {
                    let passage = desktop.current_passage().clone();
                    desktop.study.anchor = Some(account::Location::from_passage(&passage));
                    let _ = desktop.study.create("highlight", Some(&passage), false);
                    let _ = desktop.study.create("note", Some(&passage), false);
                    if let Some(mut item) = desktop.study.editing.take() {
                        item.body = "Love begins with **God’s gift**.\n\n- A gift to receive, before anything to achieve.\n- Read this alongside First Clement.".into();
                        desktop.study.put(item);
                    }
                    let _ = desktop.study.create("note", Some(&passage), false);
                    if let Some(mut item) = desktop.study.editing.take() {
                        item.body =
                            "What would change if I started with **God’s gift** each morning?"
                                .into();
                        desktop.study.put(item.clone());
                        if mode == "study-editor" {
                            desktop.study.editing = Some(item);
                        }
                    }
                    desktop.dialog = Some(Dialog::Study);
                }
                Ok(mode @ ("passage-actions" | "passage-copy-menu")) => {
                    desktop.selected = Some(desktop.current_passage().id.clone());
                    if mode == "passage-copy-menu" {
                        desktop.state.theme = Theme::Dark;
                        desktop.state.theme.apply(ctx);
                    }
                }
                Ok("commentaries") => {
                    let passage = desktop.current_passage().clone();
                    desktop.show_commentaries(&passage);
                }
                Ok("offline-audio") => desktop.dialog = Some(Dialog::Downloads),
                Ok("jump") => desktop.dialog = Some(Dialog::Library),
                Ok("tools") => desktop.tools = true,
                Ok("search" | "search-results") => {
                    desktop.dialog = Some(Dialog::Search);
                    desktop.query = std::env::var("CROSS_CANON_QUERY")
                        .unwrap_or_else(|_| "More money More Problems".into());
                    desktop.search(ctx, None);
                }
                Ok("dark") => {
                    desktop.state.theme = Theme::Dark;
                    desktop.state.theme.apply(ctx);
                }
                _ => {}
            }
        }
        desktop
    }
    fn update_canon(&mut self, canon: Canon) {
        self.state.canon = canon;
        self.search_books.retain(|book| canon.includes(book));
    }
    fn open(&mut self, id: String) {
        #[cfg(target_arch = "wasm32")]
        if browser_library::defer(&self.library, &id, true) {
            return;
        }
        if self.library.passage(&id).is_none() {
            return;
        }
        if id != self.state.location_passage_id {
            self.back.push(self.state.location_passage_id.clone());
            self.forward.clear();
        }
        self.restore_location(id);
    }
    fn restore_location(&mut self, id: String) {
        #[cfg(target_arch = "wasm32")]
        if browser_library::defer(&self.library, &id, false) {
            return;
        }
        let Some(passage) = self.library.passage(&id) else {
            return;
        };
        if self.current_passage().corpus != passage.corpus {
            self.search_corpus = Some(passage.corpus);
            self.search_source = None;
            self.results.clear();
        }
        self.active_chapter_id = passage.chapter_id.clone();
        self.remember_location(id.clone());
        self.scroll_target = Some(id);
        self.selected = None;
        self.dialog = None;
        self.message.clear();
    }
    fn current_passage(&self) -> &Passage {
        self.library
            .passage(&self.state.location_passage_id)
            .unwrap()
    }
    fn has_text_version_control(&self) -> bool {
        match self.current_passage().corpus {
            Corpus::EarlyChristian => true,
            Corpus::ChristianClassics => {
                self.library
                    .chapter(&self.active_chapter_id)
                    .is_some_and(|(_, chapter)| {
                        chapter.passage_ids.iter().any(|id| {
                            self.library
                                .passage(id)
                                .is_some_and(|passage| passage.text != passage.original_text)
                        })
                    })
            }
            Corpus::Scripture => false,
        }
    }
    fn search(&mut self, ctx: &egui::Context, source_id: Option<String>) {
        if self.busy {
            return;
        }
        if let Some(id) = source_id {
            self.search_source = self
                .results
                .iter()
                .find(|p| p.source_id == id)
                .cloned()
                .or_else(|| {
                    self.library
                        .passage(&id)
                        .map(|p| ResultPassage::local(p, 0.0))
                });
        }
        if self.search_source.is_none() && !(3..=500).contains(&self.query.trim().chars().count()) {
            self.message = "Enter a question between 3 and 500 characters.".into();
            return;
        }
        self.busy = true;
        self.message.clear();
        let request = self.search_request();
        self.results_semantic = request.web;
        self.results.clear();
        self.selected_result = None;
        self.search_generation += 1;
        let generation = self.search_generation;
        let library = self.library.clone();
        let catalog = self.catalog.clone();
        let tx = self.search_tx.clone();
        let ctx = ctx.clone();
        let api = self.state.api_url.trim_end_matches('/').to_owned();
        platform::spawn(async move {
            #[cfg(target_arch = "wasm32")]
            let result = browser_library::search(library.clone(), catalog.clone(), &api, &request)
                .await
                .map_err(|e| e.to_string());
            #[cfg(not(target_arch = "wasm32"))]
            let result = if request.source_id.is_none()
                && matches!(request.mode, SearchMode::Keyword)
            {
                let books =
                    if request.corpus != Some(Corpus::Scripture) && !request.authors.is_empty() {
                        library
                            .books
                            .iter()
                            .filter(|b| {
                                request.corpus.is_none_or(|corpus| b.corpus == corpus)
                                    && b.author
                                        .as_ref()
                                        .is_some_and(|a| request.authors.contains(a))
                            })
                            .map(|b| b.id.clone())
                            .collect()
                    } else {
                        request.books.clone()
                    };
                Ok(library
                    .search(
                        &request.query,
                        request.corpus,
                        &books,
                        request.limit,
                        request.canon,
                    )
                    .into_iter()
                    .filter_map(|h| {
                        library
                            .passage(&h.id)
                            .map(|p| ResultPassage::local(p, h.score))
                    })
                    .collect())
            } else {
                search::remote_search_async(&library, &api, &request)
                    .await
                    .map_err(|e| e.to_string())
            };
            #[cfg(not(target_arch = "wasm32"))]
            let result = result.map(|mut hits: Vec<ResultPassage>| {
                for hit in &mut hits {
                    catalog.decorate(&library, hit);
                }
                hits.retain(|hit| !hit.text.trim().is_empty());
                hits
            });
            let _ = tx.send(SearchOutput { generation, result });
            ctx.request_repaint();
        });
    }
}
fn control(ui: &mut egui::Ui, label: &str) -> egui::Response {
    let response = ui.add(
        egui::Button::new(label)
            .min_size(if Desktop::compact(ui.ctx()) {
                egui::vec2(44.0, 44.0)
            } else {
                egui::vec2(34.0, 36.0)
            })
            .corner_radius(6.0),
    );
    if label == "×" {
        response.widget_info(|| {
            egui::WidgetInfo::labeled(egui::WidgetType::Button, ui.is_enabled(), "Close")
        });
    }
    response
}
impl Desktop {
    fn render(&mut self, ctx: &egui::Context) {
        #[cfg(target_arch = "wasm32")]
        browser_library::tick(self, ctx);
        #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
        self.text_surface_events(ctx);
        self.account_tick(ctx);
        let owner = self
            .account
            .saved
            .user
            .as_ref()
            .map(|u| format!("user:{}", u.id))
            .unwrap_or_else(|| "guest".into());
        if self
            .study
            .tick(ctx, owner, self.account.study_credentials())
        {
            self.account.persist_now = true;
            #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
            self.text_surface.invalidate();
        }
        if let Some(downloads) = &mut self.downloads {
            downloads.poll();
        }
        if let Some(link) = navigation::take_reader_link() {
            if self.account.receive_callback(&link) {
                ctx.request_repaint();
            } else if let Some(id) = navigation::passage_from_link(&self.library, &link) {
                self.open(id);
            }
        }
        while let Ok(output) = self.search_rx.try_recv() {
            if output.generation == self.search_generation {
                self.busy = false;
                match output.result {
                    Ok(hits) => {
                        self.message = if hits.is_empty() {
                            "No passages found".into()
                        } else {
                            format!("{} passages", hits.len())
                        };
                        self.results = hits
                    }
                    Err(error) => self.message = error,
                }
            }
        }
        while let Ok(event) = self.audio_rx.try_recv() {
            match event {
                audio::Event::Loading => self.message = "Loading audio…".into(),
                audio::Event::Chapter(chapter) => {
                    let changed = self.audio_chapter.as_deref() != Some(&chapter);
                    let follow = self
                        .audio_chapter
                        .as_deref()
                        .and_then(|id| self.library.chapter(id))
                        .is_some_and(|(book, _)| book.id == self.current_passage().book_id);
                    self.audio_chapter = Some(chapter.clone());
                    if changed && follow {
                        if let Some((_, entry)) = self.library.chapter(&chapter) {
                            if let Some(id) = entry.passage_ids.first().cloned() {
                                self.restore_location(id);
                            }
                        }
                    }
                }
                audio::Event::Playing => {
                    self.playing = true;
                    self.message.clear()
                }
                audio::Event::Paused => self.playing = false,
                audio::Event::Stopped => {
                    self.playing = false;
                    self.audio_chapter = None
                }
                audio::Event::Error(error) => {
                    self.playing = false;
                    self.audio_chapter = None;
                    self.message = error
                }
            }
        }
        if ctx.input(|i| i.modifiers.command && i.key_pressed(Key::F)) {
            self.dialog = Some(Dialog::Search);
            ctx.memory_mut(|m| m.request_focus(Id::new("search-query")));
        }
        if ctx.input(|i| i.modifiers.command && i.key_pressed(Key::J)) {
            self.show_library();
        }
        if ctx.input(|i| i.modifiers.alt && i.key_pressed(Key::ArrowLeft)) {
            self.go_back();
        }
        if ctx.input(|i| i.modifiers.alt && i.key_pressed(Key::ArrowRight)) {
            self.go_forward();
        }
        let p = self.state.theme.palette();
        let insets = mobile::insets();
        #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
        if self.show_text_surface(ctx) {
            self.account.schedule_tick(ctx);
            return;
        }
        let fathers = self.current_passage().corpus != Corpus::Scripture;
        let side = if Self::compact(ctx) {
            if fathers {
                12.0
            } else {
                22.0
            }
        } else {
            16.0
        };
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(p.paper).inner_margin(egui::Margin {
                left: (side + insets.left).ceil() as i8,
                right: (side + insets.right).ceil() as i8,
                top: (insets.top + if Self::compact(ctx) { 12.0 } else { 0.0 }).ceil() as i8,
                // Keep the reading viewport above the persistent bottom controls.
                // Painting controls over the scroll area hides lines of the passage.
                bottom: (insets.bottom + READER_FOOTER_HEIGHT).ceil() as i8,
            }))
            .show(ctx, |ui| {
                let width =
                    (self.state.width - if fathers { 0.0 } else { 20.0 }).min(ui.available_width());
                let left = ui.min_rect().left() + (ui.available_width() - width) / 2.0;
                let area = Rect::from_min_size(
                    egui::pos2(left, ui.min_rect().top()),
                    egui::vec2(width, ui.available_height()),
                );
                ui.scope_builder(egui::UiBuilder::new().max_rect(area), |ui| {
                    self.toolbar(ui, ctx);
                    ui.add_space(18.0);
                    self.reader(ui);
                });
            });
        if self.has_text_version_control() {
            egui::Area::new(Id::new("text-version"))
                .anchor(
                    Align2::LEFT_BOTTOM,
                    [16.0 + insets.left, -16.0 - insets.bottom],
                )
                .show(ctx, |ui| {
                    egui::Frame::popup(ui.style())
                        .corner_radius(20.0)
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.selectable_value(&mut self.state.original, false, "Mod")
                                    .on_hover_text("Modernized text");
                                ui.selectable_value(&mut self.state.original, true, "Orig")
                                    .on_hover_text("Original text");
                            });
                        });
                });
        }
        if self.tools
            && self.dialog.is_none()
            && ctx.input(|i| {
                i.pointer.any_click()
                    && i.pointer.interact_pos().is_some_and(|p| {
                        !self.toolbar_rect.contains(p) && !self.tools_rect.contains(p)
                    })
            })
        {
            self.tools = false;
        }
        if !self.message.is_empty() && self.dialog.is_none() {
            egui::Area::new(Id::new("status"))
                .anchor(
                    Align2::RIGHT_BOTTOM,
                    [-20.0 - insets.right, -70.0 - insets.bottom],
                )
                .show(ctx, |ui| {
                    egui::Frame::popup(ui.style()).show(ui, |ui| {
                        ui.set_max_width(360.0_f32.min(ctx.screen_rect().width() - 40.0));
                        ui.label(&self.message);
                    });
                });
        }
        #[cfg(any(target_os = "ios", target_arch = "wasm32", test))]
        {
            let root = Id::new("ios-dialog-accessibility");
            ctx.accesskit_node_builder(root, |node| node.set_role(egui::accesskit::Role::Dialog));
            ctx.with_accessibility_parent(root, || self.dialogs(ctx));
        }
        #[cfg(not(any(target_os = "ios", target_arch = "wasm32", test)))]
        self.dialogs(ctx);
        if self.screenshot.is_some()
            && !self.screenshot_sent
            && self.started.elapsed() > Duration::from_secs(2)
            && !self.busy
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(egui::UserData::default()));
            self.screenshot_sent = true;
        }
        #[cfg(not(target_arch = "wasm32"))]
        let events = ctx.input(|i| i.events.clone());
        #[cfg(not(target_arch = "wasm32"))]
        for event in events {
            if let egui::Event::Screenshot { image, .. } = event {
                if let Some(path) = self.screenshot.take() {
                    let pixels = image
                        .pixels
                        .iter()
                        .flat_map(|p| p.to_array())
                        .collect::<Vec<_>>();
                    let result = image::save_buffer(
                        &path,
                        &pixels,
                        image.width() as u32,
                        image.height() as u32,
                        image::ColorType::Rgba8,
                    );
                    if let Err(e) = result {
                        eprintln!("Screenshot: {e}")
                    }
                    if std::env::var_os("CROSS_CANON_EXIT_AFTER_SCREENSHOT").is_some() {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
            }
        }
        if self.screenshot.is_some() || self.busy {
            ctx.request_repaint_after(Duration::from_millis(100));
        }
        // Navigation during rendering can shorten the clean sync deadline.
        self.account.schedule_tick(ctx);
    }
}
impl eframe::App for Desktop {
    #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
    fn raw_input_hook(&mut self, ctx: &egui::Context, input: &mut egui::RawInput) {
        text_surface::input(ctx, input);
    }
    #[cfg(any(target_os = "ios", target_arch = "wasm32"))]
    fn platform_output_hook(&mut self, ctx: &egui::Context, output: &egui::PlatformOutput) {
        #[cfg(target_arch = "wasm32")]
        browser::finish_input(ctx);
        text_surface::accessibility(
            ctx,
            output,
            self.dialog.map(|d| format!("{d:?}:{}", self.filters_open)),
        );
    }
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.render(ctx);
        #[cfg(target_arch = "wasm32")]
        audio::flush();
        self.study.checkpoint();
        if self.study.storage_error().is_some() {
            ctx.request_repaint_after(Duration::from_secs(1));
        }
        let mut reader_storage = self.reader_storage.take();
        if let Some(storage) = reader_storage.as_mut() {
            // iOS may never render another frame or run on_exit. Saving here
            // captures jumps, passive reading, settings and account progress.
            storage.checkpoint(&self.state, &self.account.saved, &self.study);
            eframe::Storage::flush(storage);
            if storage.needs_retry() {
                self.study.status =
                    "Could not save on this device. Keep the app open and free some storage."
                        .into();
                ctx.request_repaint_after(Duration::from_secs(1));
            }
            self.account.persist_now = false;
        } else if self.account.persist_now {
            self.account.persist_now = false;
            if let Some(storage) = frame.storage_mut() {
                self.save(storage);
                storage.flush();
            }
        }
        self.reader_storage = reader_storage;
        if !self.startup_reported && std::env::var_os("CROSS_CANON_STARTUP_TIMING").is_some() {
            eprintln!(
                "Cross Canon startup: first reader frame prepared in {:.3}s",
                self.started.elapsed().as_secs_f64()
            );
            self.startup_reported = true;
        }
    }
    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        if std::env::var_os("CROSS_CANON_FRESH").is_none() {
            eframe::set_value(storage, "reader", &self.state);
            eframe::set_value(storage, "accounts", &self.account.saved);
            self.study.save(storage);
        }
    }
    fn auto_save_interval(&self) -> Duration {
        Duration::from_secs(3)
    }
    #[cfg(not(target_os = "ios"))]
    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        let _ = self.audio_tx.send(audio::Command::Stop);
    }
    #[cfg(target_os = "ios")]
    fn on_exit(&mut self) {
        let _ = self.audio_tx.send(audio::Command::Stop);
    }
}
#[cfg(not(target_arch = "wasm32"))]
pub fn run() -> Result<()> {
    let startup = Instant::now();
    let root = data_root()?;
    let library = Arc::new(Library::load(root)?);
    if std::env::var_os("CROSS_CANON_STARTUP_TIMING").is_some() {
        eprintln!(
            "Cross Canon startup: library ready in {:.3}s",
            startup.elapsed().as_secs_f64()
        );
    }
    if std::env::args().any(|s| s == "--check-library") {
        library.validate()?;
        println!(
            "Cross Canon Desktop: {} books, {} passages; all local artifacts verified",
            library.books.len(),
            library.passages.len()
        );
        return Ok(());
    }
    let mut options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1000.0, 900.0])
            .with_min_inner_size([600.0, 480.0])
            .with_app_id("com.crosscanon.desktop"),
        ..Default::default()
    };
    if std::env::var_os("CROSS_CANON_FRESH").is_some() {
        options.persist_window = false;
    }
    #[cfg(not(target_os = "ios"))]
    {
        options.renderer = eframe::Renderer::Glow;
        if std::env::var_os("CROSS_CANON_PHONE_PREVIEW").is_some() {
            options.persist_window = false;
            options.viewport = options
                .viewport
                .with_app_id("com.crosscanon.phone-preview")
                .with_inner_size([393.0, 852.0])
                .with_min_inner_size([320.0, 480.0]);
        }
    }
    #[cfg(target_os = "ios")]
    {
        options.renderer = eframe::Renderer::Wgpu;
        options.run_and_return = false;
        options.persist_window = false;
        options.viewport = egui::ViewportBuilder::default().with_app_id("com.crosscanon.mobile");
        let directory = PathBuf::from(std::env::var_os("HOME").context("Missing iOS sandbox")?)
            .join("Library/Application Support/CrossCanon");
        std::fs::create_dir_all(&directory)?;
        options.persistence_path = Some(directory.join("reader.ron"));
    }
    // eframe's normal storage flush is asynchronous. iOS owns the same file
    // directly so each changed checkpoint is on disk before rendering stops.
    let persistence_path = options.persistence_path.take();
    eframe::run_native(
        if cfg!(target_os = "ios") {
            "Cross Canon"
        } else {
            "Cross Canon Desktop"
        },
        options,
        Box::new(move |cc| {
            Ok(Box::new(Desktop::new(
                cc,
                library,
                startup,
                persistence_path,
            )?))
        }),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn theme_search_defaults_to_web_semantics() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let app = Desktop::initialize(&egui::Context::default(), None, library);
        assert!(app.semantic, "A theme such as More money More Problems must use the web semantic search, not offline all-word matching");
    }
    #[test]
    fn classics_version_control_tracks_chapter_availability() {
        let library = Arc::new(
            Library::load_artifacts(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
                .unwrap(),
        );
        let mut app = Desktop::initialize(&egui::Context::default(), None, library.clone());
        let book = library.book("classics:imitation").unwrap();
        app.open(book.chapters[0].passage_ids[0].clone());
        assert!(app.has_text_version_control());
        let unmodernized = library.book("classics:henry").unwrap();
        app.open(unmodernized.chapters[0].passage_ids[0].clone());
        assert!(!app.has_text_version_control());
    }
    #[derive(Default)]
    pub(super) struct MemoryStorage(std::collections::HashMap<String, String>);
    impl eframe::Storage for MemoryStorage {
        fn get_string(&self, key: &str) -> Option<String> {
            self.0.get(key).cloned()
        }
        fn set_string(&mut self, key: &str, value: String) {
            self.0.insert(key.into(), value);
        }
        fn flush(&mut self) {}
    }
    fn phone_frame(app: &mut Desktop, ctx: &egui::Context, width: f32, events: Vec<egui::Event>) {
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(width, 700.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| app.render(ctx),
        );
    }
    fn phone_tap(app: &mut Desktop, ctx: &egui::Context, width: f32, pos: egui::Pos2) {
        for pressed in [true, false] {
            phone_frame(
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
    fn chapter_heading_follows_visible_passages_when_scrolling_both_directions() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for width in [393.0, 1000.0] {
            for book_id in ["Genesis", "anf09:xii.iv"] {
                let ctx = egui::Context::default();
                let mut app = Desktop::initialize(&ctx, None, library.clone());
                let book = library.book(book_id).unwrap();
                app.open(book.chapters[0].passage_ids[0].clone());
                phone_frame(&mut app, &ctx, width, vec![]);
                phone_frame(&mut app, &ctx, width, vec![]);
                let history = app.back.clone();
                for direction in [-1.0, 1.0] {
                    let wanted = if direction < 0.0 { 2 } else { 1 };
                    for _ in 0..120 {
                        phone_frame(
                            &mut app,
                            &ctx,
                            width,
                            vec![
                                egui::Event::PointerMoved(egui::pos2(width / 2.0, 500.0)),
                                egui::Event::MouseWheel {
                                    unit: egui::MouseWheelUnit::Point,
                                    delta: egui::vec2(0.0, direction * 180.0),
                                    modifiers: egui::Modifiers::NONE,
                                },
                            ],
                        );
                        if app.current_passage().chapter == wanted {
                            break;
                        }
                    }
                    assert_eq!(
                        app.current_passage().chapter,
                        wanted,
                        "The replay must cross a real chapter boundary in {book_id}"
                    );
                    let expected = format!("{} {wanted}", book.title);
                    let output = ctx.run(
                        egui::RawInput {
                            screen_rect: Some(Rect::from_min_size(
                                egui::Pos2::ZERO,
                                egui::vec2(width, 700.0),
                            )),
                            ..Default::default()
                        },
                        |ctx| app.render(ctx),
                    );
                    let heading = output.shapes.iter().any(|shape| {
                        if let egui::epaint::Shape::Text(text) = &shape.shape {
                            let rect = Rect::from_min_size(text.pos, text.galley.size());
                            text.galley.job.text == expected
                                && app.toolbar_rect.contains_rect(rect)
                                && shape.clip_rect.contains_rect(rect)
                        } else {
                            false
                        }
                    });
                    assert!(heading, "The toolbar must follow the visible passage: expected {expected} at width {width}, active chapter {}", app.active_chapter_id);
                    assert_eq!(
                        app.back, history,
                        "Passive reading must not add navigation history"
                    );
                    assert!(
                        app.scroll_target.is_none(),
                        "Changing the heading must not trigger navigation"
                    );
                }
            }
        }
    }
    #[test]
    fn phone_scroll_work_stays_bounded_on_long_books() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        app.open(library.book("Psalms").unwrap().chapters[0].passage_ids[0].clone());
        for _ in 0..3 {
            phone_frame(&mut app, &ctx, 393.0, vec![]);
        }
        let started = Instant::now();
        for _ in 0..30 {
            phone_frame(
                &mut app,
                &ctx,
                393.0,
                vec![egui::Event::MouseWheel {
                    unit: egui::MouseWheelUnit::Point,
                    delta: egui::vec2(0.0, -20.0),
                    modifiers: egui::Modifiers::NONE,
                }],
            );
        }
        let galleys = ctx.fonts(|f| f.num_galleys_in_cache());
        eprintln!(
            "phone scroll: {:.2} ms/frame, {galleys} text layouts retained",
            started.elapsed().as_secs_f64() * 1000.0 / 30.0
        );
        assert!(galleys < 150, "Scrolling must lay out nearby reading content, not an entire long book: {galleys} layouts");
    }
    #[test]
    fn phone_cached_layout_preserves_distant_jumps_after_settings_changes() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let target = library.book("Psalms").unwrap().chapters[148].passage_ids[0].clone();
        for (width, scale, original) in [
            (393.0, 1.0, false),
            (320.0, 1.25, false),
            (700.0, 1.0, true),
        ] {
            app.state.font_scale = scale;
            app.state.original = original;
            app.open(target.clone());
            for _ in 0..3 {
                phone_frame(&mut app, &ctx, width, vec![]);
            }
            app.open(target.clone());
            phone_frame(&mut app, &ctx, width, vec![]);
            let cached = app.last_scroll;
            let content_height = app.reader_max_scroll;
            app.reader_layout = Default::default();
            app.open(target.clone());
            phone_frame(&mut app, &ctx, width, vec![]);
            assert!(
                (app.last_scroll - cached).abs() < 2.0,
                "Skipped content must preserve distant jump geometry: {} vs {cached}",
                app.last_scroll
            );
            assert!(
                (app.reader_max_scroll - content_height).abs() < 2.0,
                "Content height must remain stable while skipping off-screen chapters"
            );
            assert_eq!(app.state.location_passage_id, target);
        }
    }
    #[test]
    fn phone_flick_coasts_and_touch_stops_it() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library);
        let mut tick = 0;
        let mut frame = |app: &mut Desktop, phase: Option<egui::TouchPhase>, y: f32| {
            let pos = egui::pos2(180.0, y);
            let mut events = vec![];
            if let Some(phase) = phase {
                events.push(egui::Event::Touch {
                    device_id: egui::TouchDeviceId(0),
                    id: egui::TouchId(0),
                    phase,
                    pos,
                    force: None,
                });
                match phase {
                    egui::TouchPhase::Start => {
                        events.push(egui::Event::PointerMoved(pos));
                        events.push(egui::Event::PointerButton {
                            pos,
                            button: egui::PointerButton::Primary,
                            pressed: true,
                            modifiers: egui::Modifiers::NONE,
                        });
                    }
                    egui::TouchPhase::Move => events.push(egui::Event::PointerMoved(pos)),
                    _ => {
                        events.push(egui::Event::PointerButton {
                            pos,
                            button: egui::PointerButton::Primary,
                            pressed: false,
                            modifiers: egui::Modifiers::NONE,
                        });
                        events.push(egui::Event::PointerGone);
                    }
                }
            }
            tick += 1;
            let _ = ctx.run(
                egui::RawInput {
                    screen_rect: Some(Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(393.0, 700.0),
                    )),
                    time: Some(tick as f64 / 60.0),
                    events,
                    ..Default::default()
                },
                |ctx| app.render(ctx),
            );
        };
        for _ in 0..3 {
            frame(&mut app, None, 0.0);
        }
        let start = app.last_scroll;
        frame(&mut app, Some(egui::TouchPhase::Start), 550.0);
        for step in 1..=12 {
            frame(
                &mut app,
                Some(egui::TouchPhase::Move),
                550.0 - step as f32 * 20.0,
            );
        }
        frame(&mut app, Some(egui::TouchPhase::End), 310.0);
        let released = app.last_scroll;
        assert!(
            released > start + 180.0,
            "The reader must follow a finger drag"
        );
        for _ in 0..12 {
            frame(&mut app, None, 0.0);
        }
        assert!(
            app.last_scroll > released + 80.0,
            "A flick must continue after release"
        );
        frame(&mut app, Some(egui::TouchPhase::Start), 400.0);
        let stopped = app.last_scroll;
        for _ in 0..6 {
            frame(&mut app, None, 0.0);
        }
        assert!(
            (app.last_scroll - stopped).abs() < 1.0,
            "Touching a moving page must stop it immediately: moved {} points",
            app.last_scroll - stopped
        );
        frame(&mut app, Some(egui::TouchPhase::End), 400.0);
        assert!(
            app.selected.is_none(),
            "A scroll gesture must not select a Passage"
        );
        frame(&mut app, Some(egui::TouchPhase::Start), 400.0);
        frame(&mut app, Some(egui::TouchPhase::End), 400.0);
        assert!(
            app.selected.is_some(),
            "An ordinary tap must still select a Passage"
        );
    }
    #[test]
    fn phone_touch_navigation_offline_search_and_saved_focus() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for width in [320.0, 393.0] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.state.api_url = "http://127.0.0.1:9".into();
            phone_frame(&mut app, &ctx, width, vec![]);
            assert!(Desktop::compact(&ctx));
            let tools = egui::pos2(
                app.toolbar_rect.right() - 28.0,
                app.toolbar_rect.top() + 24.0,
            );
            phone_tap(&mut app, &ctx, width, tools);
            assert!(app.tools, "Tools must open by touch at width {width}");
            phone_frame(&mut app, &ctx, width, vec![]);
            let jump = app.jump_button_rect.center();
            phone_tap(&mut app, &ctx, width, jump);
            assert!(
                app.dialog == Some(Dialog::Library),
                "Jump must open at width {width}; toolbar {:?}, tap {:?}",
                app.toolbar_rect,
                jump
            );
            // A book/chapter jump persists a Passage rather than a scroll offset.
            let target = library.book("John").unwrap().chapters[2].passage_ids[0].clone();
            app.open(target.clone());
            app.state.theme = Theme::Dark;
            app.state.font_scale = 1.14;
            let mut storage = MemoryStorage::default();
            eframe::App::save(&mut app, &mut storage);
            let mut restored = Desktop::initialize(&ctx, Some(&storage), library.clone());
            assert_eq!(restored.state.location_passage_id, target);
            assert_eq!(restored.state.theme, Theme::Dark);
            assert_eq!(restored.state.font_scale, 1.14);
            for dialog in [
                Dialog::Library,
                Dialog::Settings,
                Dialog::Search,
                Dialog::Downloads,
            ] {
                restored.dialog = Some(dialog);
                phone_frame(&mut restored, &ctx, width, vec![]);
                // Touching the backdrop dismisses the modal.
                phone_tap(&mut restored, &ctx, width, egui::pos2(2.0, 2.0));
                assert!(restored.dialog.is_none());
            }
            restored.semantic = false;
            restored.query = "beginning".into();
            restored.search(&ctx, None);
            let deadline = Instant::now() + Duration::from_secs(10);
            while restored.busy && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
                phone_frame(&mut restored, &ctx, width, vec![]);
            }
            assert!(
                !restored.busy && !restored.results.is_empty(),
                "{}",
                restored.message
            );
            assert!(restored
                .results
                .iter()
                .all(|hit| library.passage(&hit.id).is_some()));
        }
    }
    #[test]
    fn toolbar_title_stays_readable_after_repeated_tools_toggles() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let book = library
            .books
            .iter()
            .find(|b| {
                b.author.as_deref() == Some("Clement of Rome") && b.title.contains("Corinthians")
            })
            .unwrap();
        for width in [320.0, 393.0, 600.0, 1000.0, 1400.0] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.open(book.chapters[0].passage_ids[0].clone());
            let label = format!("{} 1", book.title);
            let header_label = format!("Library · {label} ⌄");
            let mut initial_title = None;
            let mut initial_header_bottom = None;
            let mut options_button = None;
            for tools in [false, true, false, true, false] {
                assert_eq!(app.tools, tools);
                let output = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(Rect::from_min_size(
                            egui::Pos2::ZERO,
                            egui::vec2(width, 900.0),
                        )),
                        ..Default::default()
                    },
                    |ctx| app.render(ctx),
                );
                let title = output
                    .shapes
                    .iter()
                    .find_map(|s| {
                        if let egui::epaint::Shape::Text(t) = &s.shape {
                            if t.galley.job.text == header_label
                                && t.pos.y < app.toolbar_rect.bottom()
                            {
                                return Some((s.clip_rect, t));
                            }
                        }
                        None
                    })
                    .expect("Header title must be painted");
                let text_rect = Rect::from_min_size(title.1.pos, title.1.galley.size());
                let chapter_label = output
                    .shapes
                    .iter()
                    .find_map(|s| {
                        if let egui::epaint::Shape::Text(t) = &s.shape {
                            if t.galley.job.text == label && t.pos.y > title.1.pos.y {
                                return Some(t.pos.y);
                            }
                        }
                        None
                    })
                    .expect("Reader chapter label must be visible");
                let header_bottom = *initial_header_bottom.get_or_insert(app.toolbar_rect.bottom());
                assert!(chapter_label >= header_bottom, "Reader overlaps header at width {width}: chapter {chapter_label}, header bottom {header_bottom}");
                assert!(title.0.contains_rect(text_rect), "Title clipped after tools={tools} at width {width}: text {text_rect:?}, clip {:?}", title.0);
                assert!(!title.1.galley.elided, "Full title must remain readable");
                if let Some(initial) = initial_title {
                    assert_eq!(
                        text_rect, initial,
                        "Toggling tools must not move or resize the title"
                    );
                } else {
                    initial_title = Some(text_rect);
                    options_button = Some(egui::pos2(
                        app.toolbar_rect.right() - 22.0,
                        app.toolbar_rect.top() + 28.0,
                    ));
                }
                phone_tap(&mut app, &ctx, width, options_button.unwrap());
            }
            assert!(app.tools);
            let outside = if width >= 600.0 {
                egui::pos2(
                    app.toolbar_rect.left() + 1.0,
                    app.toolbar_rect.bottom() + 10.0,
                )
            } else {
                egui::pos2(2.0, 400.0)
            };
            phone_tap(&mut app, &ctx, width, outside);
            assert!(
                !app.tools,
                "Clicking outside the actual popover must dismiss it"
            );
        }
    }

    fn draw(
        app: &mut Desktop,
        ctx: &egui::Context,
        events: Vec<egui::Event>,
        modifiers: egui::Modifiers,
    ) {
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1000.0, 900.0),
                )),
                events,
                modifiers,
                ..Default::default()
            },
            |ctx| app.render(ctx),
        );
    }
    fn key(key: Key, modifiers: egui::Modifiers) -> egui::Event {
        egui::Event::Key {
            key,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers,
        }
    }
    #[test]
    fn native_keyboard_dismissal_and_local_search_work_without_api() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library);
        app.state.api_url = "http://127.0.0.1:9".into();
        draw(&mut app, &ctx, vec![], egui::Modifiers::NONE);
        draw(
            &mut app,
            &ctx,
            vec![key(Key::F, egui::Modifiers::COMMAND)],
            egui::Modifiers::COMMAND,
        );
        assert!(app.dialog == Some(Dialog::Search));
        draw(
            &mut app,
            &ctx,
            vec![key(Key::Escape, egui::Modifiers::NONE)],
            egui::Modifiers::NONE,
        );
        assert!(app.dialog.is_none());
        draw(
            &mut app,
            &ctx,
            vec![key(Key::J, egui::Modifiers::COMMAND)],
            egui::Modifiers::COMMAND,
        );
        assert!(app.dialog == Some(Dialog::Library));
        draw(
            &mut app,
            &ctx,
            vec![key(Key::Escape, egui::Modifiers::NONE)],
            egui::Modifiers::NONE,
        );
        assert!(app.dialog.is_none());
        app.semantic = false;
        app.query = "beginning".into();
        app.search(&ctx, None);
        let deadline = Instant::now() + Duration::from_secs(10);
        while app.busy && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
            draw(&mut app, &ctx, vec![], egui::Modifiers::NONE);
        }
        assert!(!app.busy && !app.results.is_empty(), "{}", app.message);
        assert!(app
            .results
            .iter()
            .all(|h| app.library.passage(&h.id).is_some()));
        let history_before = app.back.clone();
        draw(
            &mut app,
            &ctx,
            vec![
                egui::Event::PointerMoved(egui::pos2(500.0, 500.0)),
                egui::Event::MouseWheel {
                    unit: egui::MouseWheelUnit::Point,
                    delta: egui::vec2(0.0, -3000.0),
                    modifiers: egui::Modifiers::NONE,
                },
            ],
            egui::Modifiers::NONE,
        );
        assert_eq!(
            app.active_chapter_id,
            app.current_passage().chapter_id,
            "The heading must follow the Chapter of the visible Passage"
        );
        assert_eq!(
            app.back, history_before,
            "Passive scrolling must not add history entries"
        );
    }
}
