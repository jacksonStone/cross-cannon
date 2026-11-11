//! Native playback. Existing manifest URLs and offsets are the playback contract.
#[cfg(not(target_vendor = "apple"))]
use anyhow::Context;
#[cfg(any(not(target_vendor = "apple"), test))]
use anyhow::Result;
use cross_canon_core::AudioLocation;
#[cfg(any(not(target_vendor = "apple"), test))]
use rodio::{Decoder, Source};
#[cfg(not(target_vendor = "apple"))]
use rodio::{OutputStreamBuilder, Sink};
#[cfg(any(not(target_vendor = "apple"), test))]
use std::io::Cursor;
#[cfg(not(target_vendor = "apple"))]
use std::io::Read;
#[cfg(any(not(target_vendor = "apple"), test))]
use std::time::Duration;
use std::{
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc,
    },
};
#[derive(Clone, serde::Serialize)]
pub struct PlaybackChapter {
    pub id: String,
    pub title: String,
    pub audio: AudioLocation,
    pub fallback: Option<AudioLocation>,
}
#[derive(Clone, serde::Serialize)]
pub struct PlaybackPlan {
    pub chapters: Vec<PlaybackChapter>,
    pub index: usize,
}
pub enum Command {
    Play(PlaybackPlan),
    Toggle,
    Stop,
    #[cfg(target_vendor = "apple")]
    Wake,
}
pub enum Event {
    Loading,
    Chapter(String),
    Position { chapter: String, seconds: f64 },
    Playing,
    Paused,
    Stopped,
    Error(String),
}
#[cfg(not(target_vendor = "apple"))]
pub fn start(root: PathBuf, ctx: eframe::egui::Context) -> (Arc<Sender<Command>>, Receiver<Event>) {
    let (tx, rx) = mpsc::channel();
    let (events, out) = mpsc::channel();
    std::thread::spawn(move || {
        let mut output = None;
        let mut sink: Option<Sink> = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Command::Play(plan)) => {
                    let audio = plan.chapters[plan.index].audio.clone();
                    if let Some(previous) = sink.take() {
                        previous.stop()
                    }
                    let result = (|| -> Result<()> {
                        if output.is_none() {
                            output = Some(
                                OutputStreamBuilder::open_default_stream()
                                    .context("Audio device unavailable")?,
                            )
                        }
                        let bytes = audio_bytes(&root, &audio.url)?;
                        let mut source = decode_audio(bytes)?;
                        source
                            .try_seek(Duration::from_secs_f64(audio.start_seconds.max(0.0)))
                            .map_err(|e| {
                                anyhow::anyhow!("Cannot seek to chapter timestamp: {e}")
                            })?;
                        let next = Sink::connect_new(output.as_ref().unwrap().mixer());
                        if let Some(end) = audio.end_seconds {
                            next.append(source.take_duration(Duration::from_secs_f64(
                                (end - audio.start_seconds).max(0.0),
                            )))
                        } else {
                            next.append(source)
                        }
                        sink = Some(next);
                        Ok(())
                    })();
                    let _ = events.send(match result {
                        Ok(()) => Event::Playing,
                        Err(e) => Event::Error(e.to_string()),
                    });
                    ctx.request_repaint();
                }
                Ok(Command::Toggle) => {
                    if let Some(sink) = &sink {
                        if sink.is_paused() {
                            sink.play();
                            let _ = events.send(Event::Playing);
                        } else {
                            sink.pause();
                            let _ = events.send(Event::Paused);
                        }
                        ctx.request_repaint();
                    }
                }
                Ok(Command::Stop) => {
                    if let Some(previous) = sink.take() {
                        previous.stop()
                    }
                    let _ = events.send(Event::Stopped);
                    ctx.request_repaint();
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if sink.as_ref().is_some_and(|s| s.empty()) {
                        sink = None;
                        let _ = events.send(Event::Stopped);
                        ctx.request_repaint();
                    }
                }
            }
        }
    });
    (Arc::new(tx), out)
}
#[cfg(not(target_vendor = "apple"))]
fn audio_bytes(root: &std::path::Path, url: &str) -> Result<Vec<u8>> {
    if std::path::Path::new(url).is_absolute() && std::path::Path::new(url).is_file() {
        return Ok(std::fs::read(url)?);
    }
    if url.starts_with("/audio/") && !url.contains("..") {
        let path = root.join("storage").join(url.trim_start_matches('/'));
        if path.is_file() {
            return Ok(std::fs::read(path)?);
        }
    }
    let url = if url.starts_with('/') {
        format!("https://www.crosscanon.com{url}")
    } else {
        url.to_owned()
    };
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()?
        .get(url)
        .send()?
        .error_for_status()?;
    let mut bytes = vec![];
    response
        .take(256 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(bytes.len() <= 256 * 1024 * 1024, "Recording is too large");
    Ok(bytes)
}

#[cfg(any(not(target_vendor = "apple"), test))]
fn decode_audio(bytes: Vec<u8>) -> Result<Decoder<Cursor<Vec<u8>>>> {
    // MP4 requires a known byte length. Decoder::new in Rodio 0.20 discarded
    // it even for an in-memory Cursor, causing a panic in existing M4A files.
    Ok(Decoder::builder()
        .with_byte_len(bytes.len() as u64)
        .with_seekable(true)
        .with_data(Cursor::new(bytes))
        .build()?)
}

#[cfg(target_vendor = "apple")]
static AUDIO_WAKE_TARGET: std::sync::Mutex<std::sync::Weak<Sender<Command>>> =
    std::sync::Mutex::new(std::sync::Weak::new());

#[cfg(target_vendor = "apple")]
#[no_mangle]
pub extern "C" fn cross_canon_audio_wake() {
    let target = AUDIO_WAKE_TARGET
        .lock()
        .ok()
        .and_then(|target| target.upgrade());
    if let Some(target) = target {
        let _ = target.send(Command::Wake);
    }
}

#[cfg(target_vendor = "apple")]
pub fn start(
    _root: PathBuf,
    ctx: eframe::egui::Context,
) -> (Arc<Sender<Command>>, Receiver<Event>) {
    use std::ffi::{CStr, CString};
    unsafe extern "C" {
        fn cross_canon_audio_play(json: *const std::ffi::c_char);
        fn cross_canon_audio_command(command: i32);
        fn cross_canon_audio_poll() -> *mut std::ffi::c_char;
        fn cross_canon_audio_free(event: *mut std::ffi::c_char);
    }
    let (tx, rx) = mpsc::channel();
    let tx = Arc::new(tx);
    *AUDIO_WAKE_TARGET.lock().unwrap() = Arc::downgrade(&tx);
    let (events, out) = mpsc::channel();
    std::thread::spawn(move || loop {
        match rx.recv() {
            Ok(Command::Play(plan)) => {
                if let Ok(json) = serde_json::to_string(&plan)
                    .and_then(|s| CString::new(s).map_err(serde::ser::Error::custom))
                {
                    // SAFETY: the adapter copies this nul-terminated string before returning.
                    unsafe { cross_canon_audio_play(json.as_ptr()) };
                }
            }
            Ok(Command::Toggle) => unsafe { cross_canon_audio_command(0) },
            Ok(Command::Stop) => unsafe { cross_canon_audio_command(1) },
            Ok(Command::Wake) => {}
            Err(_) => break,
        }
        loop {
            // SAFETY: poll returns either null or an owned nul-terminated allocation;
            // free uses the same allocator in the adapter. No Objective-C object crosses FFI.
            let raw = unsafe { cross_canon_audio_poll() };
            if raw.is_null() {
                break;
            }
            let event = unsafe { CStr::from_ptr(raw) }
                .to_string_lossy()
                .into_owned();
            unsafe { cross_canon_audio_free(raw) };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&event) else {
                continue;
            };
            let chapter = || value["chapter"].as_str().unwrap_or_default().to_string();
            let event = match value["type"].as_str() {
                Some("loading") => Event::Loading,
                Some("playing") => Event::Playing,
                Some("paused") => Event::Paused,
                Some("stopped") => Event::Stopped,
                Some("chapter") => Event::Chapter(chapter()),
                Some("position") => Event::Position {
                    chapter: chapter(),
                    seconds: value["seconds"].as_f64().unwrap_or(0.0),
                },
                Some("error") => Event::Error(
                    value["message"]
                        .as_str()
                        .unwrap_or("Recording is unavailable")
                        .into(),
                ),
                _ => continue,
            };
            if events.send(event).is_err() {
                return;
            }
            ctx.request_repaint();
        }
    });
    (tx, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_continuous_recording_decodes_and_seeks() {
        let bytes = include_bytes!("../tests/fixtures/2-john.m4a").to_vec();
        let mut source = decode_audio(bytes).expect("Existing M4A must decode without panicking");
        assert!(source.total_duration().unwrap() > Duration::from_secs(20));
        assert!(source.next().is_some());
        source
            .try_seek(Duration::from_secs(1))
            .expect("Existing timestamp offsets must be seekable");
        assert!(source.next().is_some());
    }
}
