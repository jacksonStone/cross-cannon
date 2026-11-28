//! HTMLMediaElement and Media Session are the browser's playback adapter.
use super::*;
#[derive(Clone, Serialize)]
pub(super) struct PlaybackChapter {
    pub id: String,
    pub title: String,
    pub audio: cross_canon_core::AudioLocation,
    pub fallback: Option<cross_canon_core::AudioLocation>,
}
#[derive(Clone, Serialize)]
pub(super) struct PlaybackPlan {
    pub chapters: Vec<PlaybackChapter>,
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_token: Option<String>,
}
pub(super) enum Command {
    Play(PlaybackPlan),
    Toggle,
    Stop,
    StopForNarrationChapter(String),
}
pub(super) enum Event {
    Loading,
    Chapter(String),
    Playing,
    Paused,
    Stopped,
    Error(String),
}
thread_local! { static EVENTS: std::cell::RefCell<Option<Sender<Event>>> = const { std::cell::RefCell::new(None) }; }
pub(super) fn start(_: PathBuf, _: egui::Context) -> (Arc<Sender<Command>>, Receiver<Event>) {
    let (tx, rx) = mpsc::channel();
    let (events, output) = mpsc::channel();
    EVENTS.with(|slot| *slot.borrow_mut() = Some(events));
    COMMANDS.with(|slot| *slot.borrow_mut() = Some(rx));
    (Arc::new(tx), output)
}
thread_local! { static COMMANDS: std::cell::RefCell<Option<Receiver<Command>>> = const { std::cell::RefCell::new(None) }; }
pub(super) fn flush() {
    COMMANDS.with(|slot| {
        if let Some(rx) = slot.borrow().as_ref() {
            while let Ok(command) = rx.try_recv() {
                let json = match command {
                    Command::Play(plan) => serde_json::json!({"action":"play", "plan":plan}),
                    Command::Toggle => serde_json::json!({"action":"toggle"}),
                    Command::Stop => serde_json::json!({"action":"stop"}),
                    Command::StopForNarrationChapter(chapter) => serde_json::json!({"action":"stopForNarrationChapter","chapter":chapter}),
                };
                browser::audio_command(&json.to_string());
            }
        }
    });
}
pub(super) fn receive(kind: &str, value: &str) {
    let event = match kind {
        "loading" => Event::Loading,
        "chapter" => Event::Chapter(value.into()),
        "playing" => Event::Playing,
        "paused" => Event::Paused,
        "stopped" => Event::Stopped,
        _ => Event::Error(value.into()),
    };
    EVENTS.with(|slot| {
        if let Some(tx) = slot.borrow().as_ref() {
            let _ = tx.send(event);
        }
    });
}
