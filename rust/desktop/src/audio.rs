//! Native playback. Existing manifest URLs and offsets are the playback contract.
use anyhow::{Context, Result};
use cross_canon_core::AudioLocation;
use rodio::{Decoder, OutputStreamBuilder, Sink, Source};
use std::{
    io::{Cursor, Read},
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender},
    time::Duration,
};
pub enum Command {
    Play(AudioLocation),
    Toggle,
    Stop,
}
pub enum Event {
    Playing,
    Paused,
    Stopped,
    Error(String),
}
pub fn start(root: PathBuf, ctx: eframe::egui::Context) -> (Sender<Command>, Receiver<Event>) {
    let (tx, rx) = mpsc::channel();
    let (events, out) = mpsc::channel();
    std::thread::spawn(move || {
        let mut output = None;
        let mut sink: Option<Sink> = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Command::Play(audio)) => {
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
    (tx, out)
}
fn audio_bytes(root: &std::path::Path, url: &str) -> Result<Vec<u8>> {
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

fn decode_audio(bytes: Vec<u8>) -> Result<Decoder<Cursor<Vec<u8>>>> {
    // MP4 requires a known byte length. Decoder::new in Rodio 0.20 discarded
    // it even for an in-memory Cursor, causing a panic in existing M4A files.
    Ok(Decoder::builder()
        .with_byte_len(bytes.len() as u64)
        .with_seekable(true)
        .with_data(Cursor::new(bytes))
        .build()?)
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
