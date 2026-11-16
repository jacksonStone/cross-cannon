//! Cache Storage owns complete browser audio downloads; Rust keeps the same UI.
use super::*;
use platform::download_catalog::works;
pub(super) use platform::download_catalog::{Work, ALL_BIBLE};
pub(super) struct Active {
    pub id: String,
    pub done: usize,
    pub total: usize,
    pub bytes: u64,
}
pub(super) struct Downloads {
    pub works: Vec<Work>,
    pub active: Option<Active>,
    pub message: String,
}
thread_local! { static EVENTS: std::cell::RefCell<Vec<serde_json::Value>> = const { std::cell::RefCell::new(Vec::new()) }; }
pub(super) fn receive(json: &str) {
    if let Ok(value) = serde_json::from_str(json) {
        EVENTS.with(|e| e.borrow_mut().push(value));
    }
}
pub(super) struct PlaybackSources;
impl PlaybackSources {
    pub fn new(_: &std::path::Path) -> Self {
        Self
    }
    pub fn resolve(&mut self, url: &str) -> String {
        url.into()
    }
}
impl Downloads {
    pub fn new(library: &Library) -> Self {
        let works = works(library);
        browser::download_command(&serde_json::json!({"action":"inspect", "works": works.iter().map(|w| serde_json::json!({"id":w.id,"urls":w.urls})).collect::<Vec<_>>()}).to_string());
        Self {
            works,
            active: None,
            message: String::new(),
        }
    }
    pub fn poll(&mut self) {
        EVENTS.with(|events| {
            for event in events.borrow_mut().drain(..) {
                if let Some(work) = self
                    .works
                    .iter_mut()
                    .find(|w| Some(w.id.as_str()) == event["id"].as_str())
                {
                    work.downloaded = event["done"].as_u64().unwrap_or(0) as usize;
                    work.bytes = event["bytes"].as_u64().unwrap_or(0);
                    if event["active"].as_bool() == Some(true) {
                        self.active = Some(Active {
                            id: work.id.clone(),
                            done: work.downloaded,
                            total: work.urls.len(),
                            bytes: work.bytes,
                        });
                    } else if self.active.as_ref().is_some_and(|a| a.id == work.id) {
                        self.active = None;
                    }
                }
                if let Some(message) = event["message"].as_str() {
                    self.message = message.into();
                }
            }
        });
    }
    pub fn start(&mut self, id: &str, _: &egui::Context) {
        if let Some(work) = self.works.iter().find(|w| w.id == id) {
            if self.active.is_some() {
                return;
            }
            self.active = Some(Active {
                id: id.into(),
                done: work.downloaded,
                total: work.urls.len(),
                bytes: work.bytes,
            });
            browser::download_command(
                &serde_json::json!({"action":"start","id":id,"urls":work.urls}).to_string(),
            );
        }
    }
    pub fn pause(&mut self) {
        browser::download_command("{\"action\":\"pause\"}");
        self.active = None;
    }
    pub fn remove(&mut self, id: &str) {
        if let Some(work) = self.works.iter().find(|w| w.id == id) {
            browser::download_command(
                &serde_json::json!({"action":"remove","id":id,"urls":work.urls}).to_string(),
            );
        }
    }
}
