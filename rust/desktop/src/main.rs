mod audio;
mod dialogs;
mod reader;
mod theme;
use anyhow::{Context, Result};
use cross_canon_core::{
    data_root, Book, Canon, Corpus, Library, Passage, SearchHit, SearchMode, SearchRequest,
};
use eframe::egui::{
    self, Align, Align2, FontId, Id, Key, Layout, Rect, RichText, Sense, Stroke, Vec2,
};
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
}
struct SearchOutput {
    generation: u64,
    result: std::result::Result<Vec<SearchHit>, String>,
}
struct Desktop {
    library: Arc<Library>,
    state: ReaderState,
    selected: Option<String>,
    active_chapter_id: String,
    dialog: Option<Dialog>,
    tools: bool,
    jump_filter: String,
    jump_book: String,
    query: String,
    search_corpus: Option<Corpus>,
    semantic: bool,
    results: Vec<SearchHit>,
    search_tx: Sender<SearchOutput>,
    search_rx: Receiver<SearchOutput>,
    search_generation: u64,
    busy: bool,
    message: String,
    scroll_target: Option<String>,
    last_scroll: f32,
    audio_tx: Sender<audio::Command>,
    audio_rx: Receiver<audio::Event>,
    audio_chapter: Option<String>,
    playing: bool,
    started: Instant,
    screenshot: Option<PathBuf>,
    screenshot_sent: bool,
}
impl Desktop {
    fn new(cc: &eframe::CreationContext<'_>, library: Arc<Library>) -> Self {
        Self::initialize(&cc.egui_ctx, cc.storage, library)
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
        state.theme.apply(ctx);
        let location = library.passage(&state.location_passage_id).unwrap();
        let active_chapter_id = location.chapter_id.clone();
        let jump_book = location.book_id.clone();
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
            jump_filter: String::new(),
            jump_book,
            query: String::new(),
            search_corpus,
            semantic: false,
            results: vec![],
            search_tx,
            search_rx,
            search_generation: 0,
            busy: false,
            message: String::new(),
            scroll_target: Some(state.location_passage_id),
            last_scroll: 0.0,
            audio_tx,
            audio_rx,
            audio_chapter: None,
            playing: false,
            started: Instant::now(),
            screenshot: std::env::var_os("CROSS_CANON_SCREENSHOT").map(Into::into),
            screenshot_sent: false,
        };
        if fresh {
            match std::env::var("CROSS_CANON_PREVIEW").as_deref() {
                Ok("settings") => desktop.dialog = Some(Dialog::Settings),
                Ok("jump") => desktop.dialog = Some(Dialog::Jump),
                Ok("search") => {
                    desktop.dialog = Some(Dialog::Search);
                    desktop.query = "beginning".into();
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
    fn open(&mut self, id: String) {
        if self.library.passage(&id).is_none() {
            return;
        }
        self.active_chapter_id = self.library.passage(&id).unwrap().chapter_id.clone();
        self.state.location_passage_id = id.clone();
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
        self.busy = true;
        self.message.clear();
        self.results.clear();
        self.search_generation += 1;
        let generation = self.search_generation;
        let library = self.library.clone();
        let tx = self.search_tx.clone();
        let ctx = ctx.clone();
        let api = self.state.api_url.trim_end_matches('/').to_owned();
        let request = SearchRequest {
            query: if source_id.is_some() {
                String::new()
            } else {
                self.query.clone()
            },
            source_id,
            corpus: self.search_corpus,
            canon: self.state.canon,
            books: vec![],
            limit: 20,
            mode: if self.semantic {
                SearchMode::Semantic
            } else {
                SearchMode::Keyword
            },
        };
        std::thread::spawn(move || {
            let result = if request.source_id.is_none()
                && matches!(request.mode, SearchMode::Keyword)
            {
                Ok(library.search(
                    &request.query,
                    request.corpus,
                    &[],
                    request.limit,
                    request.canon,
                ))
            } else {
                (||->Result<Vec<SearchHit>>{
                    let response=reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)).build()?.post(format!("{api}/search")).json(&request).send().context("R Cross Cannon is unreachable. Local reading and keyword search are available.")?;
                    let status=response.status();let payload:serde_json::Value=response.json()?;
                    if !status.is_success(){anyhow::bail!("{}",payload["error"].as_str().unwrap_or("Search is unavailable"))}
                    Ok(serde_json::from_value(payload["results"].clone())?)
                })().map_err(|e|e.to_string())
            };
            let _ = tx.send(SearchOutput { generation, result });
            ctx.request_repaint();
        });
    }
}
fn control(ui: &mut egui::Ui, label: &str) -> egui::Response {
    ui.add(
        egui::Button::new(label)
            .min_size(egui::vec2(34.0, 36.0))
            .corner_radius(6.0),
    )
}
impl Desktop {
    fn render(&mut self, ctx: &egui::Context) {
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
            self.dialog = Some(Dialog::Search)
        }
        if ctx.input(|i| i.modifiers.command && i.key_pressed(Key::J)) {
            self.jump_book = self.current_passage().book_id.clone();
            self.dialog = Some(Dialog::Jump)
        }
        let p = self.state.theme.palette();
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(p.paper).inner_margin(egui::Margin {
                left: 16,
                right: 16,
                top: 0,
                bottom: 0,
            }))
            .show(ctx, |ui| {
                let width = self.state.width.min(ui.available_width());
                let left = ui.min_rect().left() + (ui.available_width() - width) / 2.0;
                let area = Rect::from_min_size(
                    egui::pos2(left, ui.min_rect().top()),
                    egui::vec2(width, ui.available_height()),
                );
                ui.scope_builder(egui::UiBuilder::new().max_rect(area), |ui| {
                    self.toolbar(ui, ctx);
                    ui.add_space(0.0);
                    self.reader(ui);
                });
            });
        egui::Area::new(Id::new("corpus-switch"))
            .anchor(Align2::RIGHT_BOTTOM, [-16.0, -16.0])
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
                    let target = if self.current_passage().corpus == Corpus::Scripture {
                        Corpus::EarlyChristian
                    } else {
                        Corpus::Scripture
                    };
                    if let Some(book) = self.library.books.iter().find(|b| b.corpus == target) {
                        self.open(book.chapters[0].passage_ids[0].clone());
                    }
                }
            });
        if self.tools
            && self.dialog.is_none()
            && ctx.input(|i| {
                i.pointer.any_click() && i.pointer.interact_pos().is_some_and(|p| p.y > 59.0)
            })
        {
            self.tools = false;
        }
        if !self.message.is_empty() && self.dialog.is_none() {
            egui::Area::new(Id::new("status"))
                .anchor(Align2::RIGHT_BOTTOM, [-20.0, -20.0])
                .show(ctx, |ui| {
                    egui::Frame::popup(ui.style()).show(ui, |ui| {
                        ui.set_max_width(360.0);
                        ui.label(&self.message);
                    });
                });
        }
        self.dialogs(ctx);
        if self.screenshot.is_some()
            && !self.screenshot_sent
            && self.started.elapsed() > Duration::from_secs(2)
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
    }
    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        if std::env::var_os("CROSS_CANON_FRESH").is_none() {
            eframe::set_value(storage, "reader", &self.state)
        }
    }
    fn auto_save_interval(&self) -> Duration {
        Duration::from_secs(3)
    }
    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        let _ = self.audio_tx.send(audio::Command::Stop);
    }
}
fn main() -> Result<()> {
    let root = data_root()?;
    let library = Arc::new(Library::load(root)?);
    library.validate()?;
    if std::env::args().any(|s| s == "--check-library") {
        println!(
            "Cross Canon Desktop: {} books, {} passages; all local artifacts verified",
            library.books.len(),
            library.passages.len()
        );
        return Ok(());
    }
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1000.0, 900.0])
            .with_min_inner_size([600.0, 480.0])
            .with_app_id("com.crosscanon.desktop"),
        renderer: eframe::Renderer::Glow,
        ..Default::default()
    };
    eframe::run_native(
        "Cross Canon Desktop",
        options,
        Box::new(move |cc| Ok(Box::new(Desktop::new(cc, library)))),
    )
    .map_err(|e| anyhow::anyhow!("{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let chapter_before = app.active_chapter_id.clone();
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
            app.active_chapter_id, chapter_before,
            "Passive scrolling must not change explicit Chapter identity"
        );
    }
}
