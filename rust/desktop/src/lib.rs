mod audio;
mod dialogs;
mod downloads;
mod icons;
mod mobile;
mod navigation;
#[cfg(test)]
mod performance;
mod reader;
mod search;
#[cfg(test)]
mod search_regressions;
mod theme;
mod touch_scroll;
use anyhow::{Context, Result};
use cross_canon_core::{
    data_root, Book, Canon, Corpus, Library, Passage, SearchMode, SearchRequest,
};
use eframe::egui::{self, Align, Align2, FontId, Id, Key, Layout, Rect, RichText, Sense, Stroke};
use search::ResultPassage;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    time::{Duration, Instant},
};
use theme::{heading, serif, Theme};

#[derive(Clone, Serialize, Deserialize)]
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
            api_url: "https://www.crosscanon.com/r/api".into(),
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Dialog {
    Jump,
    Search,
    Settings,
    Downloads,
}
struct SearchOutput {
    generation: u64,
    result: std::result::Result<Vec<ResultPassage>, String>,
}
struct Desktop {
    library: Arc<Library>,
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
    audio_seconds: f64,
    started: Instant,
    screenshot: Option<PathBuf>,
    screenshot_sent: bool,
    startup_reported: bool,
}
impl Desktop {
    fn new(cc: &eframe::CreationContext<'_>, library: Arc<Library>, startup: Instant) -> Self {
        navigation::install_reader_links(&cc.egui_ctx);
        let mut app = Self::initialize(&cc.egui_ctx, cc.storage, library);
        app.started = startup;
        app
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
        let mut desktop = Self {
            library,
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
            audio_seconds: 0.0,
            started: Instant::now(),
            screenshot: std::env::var_os("CROSS_CANON_SCREENSHOT").map(Into::into),
            screenshot_sent: false,
            startup_reported: false,
        };
        if fresh {
            match std::env::var("CROSS_CANON_PREVIEW").as_deref() {
                Ok("settings") => desktop.dialog = Some(Dialog::Settings),
                Ok("offline-audio") => desktop.dialog = Some(Dialog::Downloads),
                Ok("jump") => desktop.dialog = Some(Dialog::Jump),
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
        let tx = self.search_tx.clone();
        let ctx = ctx.clone();
        let api = self.state.api_url.trim_end_matches('/').to_owned();
        std::thread::spawn(move || {
            let result =
                if request.source_id.is_none() && matches!(request.mode, SearchMode::Keyword) {
                    let books = if request.corpus == Some(Corpus::EarlyChristian)
                        && !request.authors.is_empty()
                    {
                        library
                            .books
                            .iter()
                            .filter(|b| {
                                b.author
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
                    search::remote_search(&library, &api, &request).map_err(|e| e.to_string())
                };
            let _ = tx.send(SearchOutput { generation, result });
            ctx.request_repaint();
        });
    }
}
fn control(ui: &mut egui::Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(label)
            .min_size(if Desktop::compact(ui.ctx()) {
                egui::vec2(44.0, 44.0)
            } else {
                egui::vec2(34.0, 36.0)
            })
            .corner_radius(6.0),
    )
}
impl Desktop {
    fn render(&mut self, ctx: &egui::Context) {
        if let Some(downloads) = &mut self.downloads {
            downloads.poll();
        }
        if let Some(link) = navigation::take_reader_link() {
            if let Some(id) = navigation::passage_from_link(&self.library, &link) {
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
                audio::Event::Position { chapter, seconds } => {
                    if self.audio_chapter.as_deref() == Some(&chapter) {
                        self.audio_seconds = seconds;
                    }
                }
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
            self.show_jump();
        }
        if ctx.input(|i| i.modifiers.alt && i.key_pressed(Key::ArrowLeft)) {
            self.go_back();
        }
        if ctx.input(|i| i.modifiers.alt && i.key_pressed(Key::ArrowRight)) {
            self.go_forward();
        }
        let p = self.state.theme.palette();
        let insets = mobile::insets();
        let fathers = self.current_passage().corpus == Corpus::EarlyChristian;
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
                bottom: insets.bottom.ceil() as i8,
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
        egui::Area::new(Id::new("corpus-switch"))
            .anchor(
                Align2::RIGHT_BOTTOM,
                [-16.0 - insets.right, -16.0 - insets.bottom],
            )
            .show(ctx, |ui| {
                let response =
                    ui.add_sized([44.0, 44.0], egui::Button::new("").corner_radius(13.0));
                let center = response.rect.center();
                for delta in [
                    egui::vec2(-4.0, 0.0),
                    egui::vec2(4.0, 0.0),
                    egui::vec2(0.0, -4.0),
                    egui::vec2(0.0, 4.0),
                ] {
                    ui.painter()
                        .line_segment([center, center + delta], Stroke::new(1.2_f32, p.accent));
                    ui.painter().circle_filled(center + delta, 1.7, p.accent);
                }
                if response
                    .on_hover_text(if self.current_passage().corpus == Corpus::Scripture {
                        "Early Christian works"
                    } else {
                        "Scripture"
                    })
                    .clicked()
                {
                    self.switch_corpus();
                }
            });
        if self.current_passage().corpus == Corpus::EarlyChristian {
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
        self.dialogs(ctx);
        if self.screenshot.is_some()
            && !self.screenshot_sent
            && self.started.elapsed() > Duration::from_secs(2)
            && !self.busy
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(egui::UserData::default()));
            self.screenshot_sent = true;
        }
        let events = ctx.input(|i| i.events.clone());
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
    }
}
impl eframe::App for Desktop {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.render(ctx);
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
            eframe::set_value(storage, "reader", &self.state)
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
    eframe::run_native(
        if cfg!(target_os = "ios") {
            "Cross Canon"
        } else {
            "Cross Canon Desktop"
        },
        options,
        Box::new(move |cc| Ok(Box::new(Desktop::new(cc, library, startup)))),
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
                app.dialog == Some(Dialog::Jump),
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
                Dialog::Jump,
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
                            if t.galley.job.text == label && t.pos.y < app.toolbar_rect.bottom() {
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
        assert!(app.dialog == Some(Dialog::Jump));
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
