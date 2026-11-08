//! Optional offline recordings. Only complete, validated files become playable.
use anyhow::{ensure, Context, Result};
use cross_canon_core::{Corpus, Library};
use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

#[derive(Clone)]
pub(super) struct Work {
    pub id: String,
    pub corpus: Corpus,
    pub title: String,
    pub chapters: usize,
    pub total_chapters: usize,
    pub urls: Vec<String>,
    pub downloaded: usize,
    pub bytes: u64,
}

pub(super) struct Active {
    pub id: String,
    pub done: usize,
    pub total: usize,
    pub bytes: u64,
    cancel: Arc<AtomicBool>,
}

enum Event {
    Progress { done: usize, bytes: u64 },
    Finished(Result<()>),
}

pub(super) struct Downloads {
    pub works: Vec<Work>,
    pub active: Option<Active>,
    pub message: String,
    directory: Option<PathBuf>,
    library_root: PathBuf,
    rx: mpsc::Receiver<Event>,
    tx: mpsc::Sender<Event>,
}

pub(super) fn directory() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CROSS_CANON_AUDIO_DIR") {
        return Some(path.into());
    }
    let home = PathBuf::from(std::env::var_os("HOME")?);
    #[cfg(target_vendor = "apple")]
    let base = home.join("Library/Application Support/CrossCanon");
    #[cfg(not(target_vendor = "apple"))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"))
        .join("cross-canon");
    Some(base.join("audio"))
}

// Encode the full URL, split into legal filename lengths. Identity never depends
// on a lossy filename or a hash collision, and remote paths cannot escape storage.
fn cached_path(directory: &Path, url: &str) -> PathBuf {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(url.len() * 2);
    for &byte in url.as_bytes() {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 15) as usize] as char);
    }
    let mut path = directory.to_path_buf();
    for chunk in encoded.as_bytes().chunks(120) {
        path.push(std::str::from_utf8(chunk).unwrap());
    }
    // AVPlayer needs the container's extension for downloaded local assets.
    let extension = if url.split('?').next().unwrap_or(url).ends_with(".m4a") {
        "m4a"
    } else {
        "mp3"
    };
    path.join(format!("recording.{extension}"))
}

fn nonempty(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() > 0)
}

fn local_path(root: &Path, directory: Option<&Path>, url: &str) -> Option<PathBuf> {
    if url.starts_with("/audio/") && !url.split('/').any(|s| s == "..") {
        let bundled = root
            .join("storage")
            .join(url.split('?').next().unwrap_or(url).trim_start_matches('/'));
        if nonempty(&bundled) {
            return Some(bundled);
        }
    }
    directory
        .map(|dir| cached_path(dir, url))
        .filter(|p| nonempty(p))
}

/// Resolve shared recordings once per playback plan. A later plan rechecks files.
pub(super) struct PlaybackSources {
    root: Option<PathBuf>,
    directory: Option<PathBuf>,
    resolved: HashMap<String, String>,
}

impl PlaybackSources {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.join("storage").is_dir().then(|| root.to_path_buf()),
            directory: directory().filter(|p| p.is_dir()),
            resolved: HashMap::new(),
        }
    }

    pub fn resolve(&mut self, url: &str) -> String {
        if let Some(value) = self.resolved.get(url) {
            return value.clone();
        }
        let bundled = self
            .root
            .as_ref()
            .and_then(|root| local_path(root, None, url));
        let downloaded = || {
            self.directory
                .as_ref()
                .map(|dir| cached_path(dir, url))
                .filter(|p| nonempty(p))
        };
        let value = if let Some(path) = bundled.or_else(downloaded) {
            path.to_string_lossy().into_owned()
        } else if url.starts_with('/') {
            format!("https://www.crosscanon.com{url}")
        } else {
            url.to_owned()
        };
        self.resolved.insert(url.into(), value.clone());
        value
    }
}

pub(super) const ALL_BIBLE: &str = "__all_bible_audio__";

fn works(library: &Library) -> Vec<Work> {
    let mut works: Vec<Work> = library
        .books
        .iter()
        .filter_map(|book| {
            let audio = book
                .chapters
                .iter()
                .filter_map(|c| library.audio(&c.id))
                .collect::<Vec<_>>();
            if audio.is_empty() {
                return None;
            }
            let chapters = audio.len();
            let urls = audio
                .into_iter()
                .map(|a| a.url)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            Some(Work {
                id: book.id.clone(),
                corpus: book.corpus,
                title: book.title.clone(),
                chapters,
                total_chapters: book.chapters.len(),
                urls,
                downloaded: 0,
                bytes: 0,
            })
        })
        .collect();
    let bible: Vec<_> = works
        .iter()
        .filter(|w| w.corpus == Corpus::Scripture)
        .collect();
    let urls: Vec<_> = bible
        .iter()
        .flat_map(|w| w.urls.iter().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if !urls.is_empty() {
        let chapters = bible.iter().map(|w| w.chapters).sum();
        works.insert(
            0,
            Work {
                id: ALL_BIBLE.into(),
                corpus: Corpus::Scripture,
                title: "Entire Bible".into(),
                chapters,
                total_chapters: chapters,
                urls,
                downloaded: 0,
                bytes: 0,
            },
        );
    }
    works
}

impl Downloads {
    pub fn new(library: &Library) -> Self {
        let (tx, rx) = mpsc::channel();
        let mut downloads = Self {
            works: works(library),
            active: None,
            message: String::new(),
            directory: directory(),
            library_root: library.root.clone(),
            rx,
            tx,
        };
        downloads.refresh();
        downloads
    }

    fn refresh(&mut self) {
        let empty = !self.library_root.join("storage").is_dir()
            && self.directory.as_ref().is_none_or(|p| !p.is_dir());
        for work in &mut self.works {
            work.downloaded = 0;
            work.bytes = 0;
            if empty {
                continue;
            }
            for url in &work.urls {
                if let Some(path) = local_path(&self.library_root, self.directory.as_deref(), url) {
                    work.downloaded += 1;
                    work.bytes += fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                }
            }
        }
    }

    pub fn poll(&mut self) {
        while let Ok(event) = self.rx.try_recv() {
            match event {
                Event::Progress { done, bytes } => {
                    if let Some(active) = &mut self.active {
                        active.done = done;
                        active.bytes = bytes;
                    }
                }
                Event::Finished(result) => {
                    let cancelled = self
                        .active
                        .take()
                        .is_some_and(|a| a.cancel.load(Ordering::Relaxed));
                    self.message = match result {
                        Ok(()) if cancelled => "Download paused. Completed tracks are kept.".into(),
                        Ok(()) => "Audio is ready offline.".into(),
                        Err(error) => {
                            format!("Download stopped: {error}. You can retry the download.")
                        }
                    };
                    self.refresh();
                }
            }
        }
    }

    pub fn start(&mut self, id: &str, ctx: &eframe::egui::Context) {
        if self.active.is_some() {
            return;
        }
        let Some(work) = self.works.iter().find(|w| w.id == id).cloned() else {
            return;
        };
        let Some(directory) = self.directory.clone() else {
            self.message = "Audio storage is unavailable.".into();
            return;
        };
        let cancel = Arc::new(AtomicBool::new(false));
        self.active = Some(Active {
            id: id.into(),
            done: work.downloaded,
            total: work.urls.len(),
            bytes: work.bytes,
            cancel: cancel.clone(),
        });
        self.message.clear();
        let root = self.library_root.clone();
        let tx = self.tx.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let result = (|| -> Result<()> {
                let client = http_client()?;
                let mut bytes = 0;
                for (done, url) in work.urls.iter().enumerate() {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Some(path) = local_path(&root, Some(&directory), url) {
                        bytes += fs::metadata(path)?.len();
                    } else {
                        let base = bytes;
                        let mut last_update = Instant::now();
                        let path = cached_path(&directory, url);
                        let complete = download(&client, url, &path, &cancel, |received| {
                            if last_update.elapsed() >= Duration::from_millis(150) {
                                let _ = tx.send(Event::Progress {
                                    done,
                                    bytes: base + received,
                                });
                                ctx.request_repaint();
                                last_update = Instant::now();
                            }
                        })?;
                        if !complete {
                            break;
                        }
                        bytes += fs::metadata(path)?.len();
                    }
                    let _ = tx.send(Event::Progress {
                        done: done + 1,
                        bytes,
                    });
                    ctx.request_repaint();
                }
                Ok(())
            })();
            let _ = tx.send(Event::Finished(result));
            ctx.request_repaint();
        });
    }

    pub fn pause(&mut self) {
        if let Some(active) = &self.active {
            active.cancel.store(true, Ordering::Relaxed);
        }
    }

    pub fn remove(&mut self, id: &str) {
        if self.active.is_some() {
            return;
        }
        let result = (|| -> Result<()> {
            let work = self
                .works
                .iter()
                .find(|w| w.id == id)
                .context("Unknown work")?;
            if let Some(directory) = &self.directory {
                for url in &work.urls {
                    let path = cached_path(directory, url);
                    if path.exists() {
                        fs::remove_file(path)?;
                    }
                }
            }
            Ok(())
        })();
        self.message = match result {
            Ok(()) => "Downloaded audio removed.".into(),
            Err(error) => format!("Could not remove audio: {error}"),
        };
        self.refresh();
    }
}

impl Drop for Downloads {
    fn drop(&mut self) {
        self.pause();
    }
}

fn http_client() -> Result<reqwest::blocking::Client> {
    // BiblicalAudio rejects requests without an explicit application user agent.
    Ok(reqwest::blocking::Client::builder()
        .user_agent("CrossCanon/0.1")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()?)
}

fn download(
    client: &reqwest::blocking::Client,
    url: &str,
    destination: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> Result<bool> {
    let url = if url.starts_with('/') {
        format!("https://www.crosscanon.com{url}")
    } else {
        url.into()
    };
    let mut response = client.get(url).send()?.error_for_status()?;
    if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
        let kind = content_type
            .to_str()?
            .split(';')
            .next()
            .unwrap_or("")
            .trim();
        ensure!(
            kind.starts_with("audio/") || kind == "application/octet-stream" || kind == "video/mp4",
            "Server returned a non-audio response"
        );
    }
    let expected = response.content_length();
    fs::create_dir_all(destination.parent().context("Missing audio directory")?)?;
    let partial = destination.with_extension("part");
    let result = (|| -> Result<bool> {
        let mut output = File::create(&partial)?;
        let mut buffer = [0u8; 64 * 1024];
        let mut received = 0u64;
        let mut signature = Vec::new();
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Ok(false);
            }
            let count = response.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            if signature.len() < 12 {
                signature.extend_from_slice(&buffer[..count.min(12 - signature.len())]);
            }
            received += count as u64;
            ensure!(received <= 1024 * 1024 * 1024, "Recording exceeds 1 GB");
            output.write_all(&buffer[..count])?;
            progress(received);
        }
        ensure!(
            received > 0 && expected.is_none_or(|length| received == length),
            "Recording download is incomplete"
        );
        ensure!(
            signature.starts_with(b"ID3")
                || (signature.len() >= 2 && signature[0] == 0xff && signature[1] & 0xe0 == 0xe0)
                || (signature.len() >= 8 && &signature[4..8] == b"ftyp"),
            "Invalid audio recording"
        );
        if cancel.load(Ordering::Relaxed) {
            return Ok(false);
        }
        output.sync_all()?;
        drop(output);
        fs::rename(&partial, destination)?;
        Ok(true)
    })();
    if partial.exists() {
        let _ = fs::remove_file(partial);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn temp(label: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("crosscanon-audio-{label}-{}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn server(responses: Vec<Vec<u8>>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            for response in responses {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0u8];
                while !request.ends_with(b"\r\n\r\n") {
                    socket.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                let _ = socket.write_all(&response);
            }
        });
        (url, handle)
    }

    fn response(kind: &str, body: &[u8], length: usize) -> Vec<u8> {
        let mut response = format!("HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n").into_bytes();
        response.extend_from_slice(body);
        response
    }

    #[test]
    fn downloads_publish_only_complete_audio_and_pause_discards_partial() {
        let directory = temp("atomic");
        let body = b"ID3existing recording fixture";
        let (url, handle) = server(vec![
            response("audio/mpeg", body, body.len()),
            response("audio/mpeg", body, body.len() + 100),
            response("text/html", b"not audio", 9),
            response("audio/mpeg", b"<html>error</html>", 18),
            response("audio/mpeg", body, body.len()),
        ]);
        let client = reqwest::blocking::Client::new();
        let cancel = AtomicBool::new(false);
        let destination = cached_path(&directory, &url);
        assert!(download(&client, &url, &destination, &cancel, |_| {}).unwrap());
        assert_eq!(fs::read(&destination).unwrap(), body);
        assert_eq!(
            local_path(Path::new("/missing"), Some(&directory), &url),
            Some(destination.clone())
        );
        fs::remove_file(&destination).unwrap();
        for _ in 0..3 {
            assert!(download(&client, &url, &destination, &cancel, |_| {}).is_err());
            assert!(!destination.exists());
            assert!(!destination.with_extension("part").exists());
        }
        assert!(!download(&client, &url, &destination, &cancel, |_| cancel
            .store(true, Ordering::Relaxed))
        .unwrap());
        assert!(!destination.exists());
        assert!(!destination.with_extension("part").exists());
        handle.join().unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn available_works_deduplicate_tracks_and_preserve_chapter_offsets() {
        let library = Library::load(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
        let works = works(&library);
        assert_eq!(
            works
                .iter()
                .filter(|w| w.corpus == Corpus::EarlyChristian)
                .count(),
            3
        );
        assert_eq!(
            works
                .iter()
                .filter(|w| w.corpus == Corpus::Scripture && w.id != ALL_BIBLE)
                .count(),
            66
        );
        let all = works.iter().find(|w| w.id == ALL_BIBLE).unwrap();
        assert_eq!(all.chapters, 1189);
        assert_eq!(
            all.urls.len(),
            66,
            "the developer library uses continuous recordings"
        );
        let clement = works.iter().find(|w| w.id == "anf09:xii.iv").unwrap();
        assert_eq!(clement.chapters, 1);
        assert_eq!(clement.total_chapters, 65);
        assert_eq!(
            clement.urls.len(),
            1,
            "multi-chapter audio must download only once"
        );
        let directory = temp("playback");
        let chapter = library.book(&clement.id).unwrap().chapters.first().unwrap();
        let location = library.audio(&chapter.id).unwrap();
        let offset = location.start_seconds;
        assert!(offset > 0.0);
        let path = cached_path(&directory, &location.url);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"ID3local fixture").unwrap();
        assert_eq!(
            local_path(&library.root, Some(&directory), &location.url),
            Some(path)
        );
        assert_eq!(library.audio(&chapter.id).unwrap().start_seconds, offset);
        assert_ne!(
            cached_path(&directory, "https://a/b.mp3"),
            cached_path(&directory, "https://b/b.mp3")
        );
        assert_eq!(
            cached_path(&directory, &location.url).extension().unwrap(),
            "mp3"
        );
        assert_eq!(
            cached_path(&directory, "/audio/book.m4a")
                .extension()
                .unwrap(),
            "m4a"
        );
        assert!(cached_path(&directory, "https://host/../../evil").starts_with(&directory));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn bundled_bible_wins_over_network_and_partial_downloads() {
        let root = temp("bundled");
        let url = "/audio/continuous/book.m4a";
        let bundled = root.join("storage/audio/continuous/book.m4a");
        fs::create_dir_all(bundled.parent().unwrap()).unwrap();
        fs::write(&bundled, b"existing m4a").unwrap();
        let mut sources = PlaybackSources::new(&root);
        assert_eq!(sources.resolve(url), bundled.to_string_lossy());
        fs::remove_file(&bundled).unwrap();
        assert_eq!(
            sources.resolve(url),
            bundled.to_string_lossy(),
            "Shared track resolution is stable within a plan"
        );
        assert_eq!(
            PlaybackSources::new(&root).resolve(url),
            format!("https://www.crosscanon.com{url}"),
            "New plans must recheck removed recordings"
        );
        fs::write(&bundled, b"existing m4a").unwrap();
        assert_eq!(local_path(&root, None, url), Some(bundled));
        let partial = cached_path(&root, "https://host/book.mp3").with_extension("part");
        fs::create_dir_all(partial.parent().unwrap()).unwrap();
        fs::write(partial, b"incomplete").unwrap();
        assert!(local_path(&root, Some(&root), "https://host/book.mp3").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_work_resumes_completed_tracks_and_can_be_removed() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let body = b"ID3download test";
            for (index, expected) in ["/one", "/two", "/two"].iter().enumerate() {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0u8];
                while !request.ends_with(b"\r\n\r\n") {
                    socket.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                assert!(String::from_utf8_lossy(&request).starts_with(&format!("GET {expected} ")));
                let reply = if index == 1 {
                    b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        .to_vec()
                } else {
                    response("audio/mpeg", body, body.len())
                };
                socket.write_all(&reply).unwrap();
            }
        });
        let directory = temp("resume");
        let (tx, rx) = mpsc::channel();
        let urls = vec![format!("{origin}/one"), format!("{origin}/two")];
        let mut downloads = Downloads {
            works: vec![Work {
                id: "work".into(),
                corpus: Corpus::EarlyChristian,
                title: "Test work".into(),
                chapters: 3,
                total_chapters: 3,
                urls: urls.clone(),
                downloaded: 0,
                bytes: 0,
            }],
            directory: Some(directory.clone()),
            library_root: directory.join("bundle"),
            tx,
            rx,
            active: None,
            message: String::new(),
        };
        let ctx = eframe::egui::Context::default();
        for expected in [1, 2] {
            downloads.start("work", &ctx);
            let deadline = Instant::now() + Duration::from_secs(10);
            while downloads.active.is_some() && Instant::now() < deadline {
                downloads.poll();
                std::thread::sleep(Duration::from_millis(2));
            }
            assert!(downloads.active.is_none(), "worker must finish");
            assert_eq!(downloads.works[0].downloaded, expected);
        }
        handle.join().unwrap();
        assert!(downloads.message.contains("ready offline"));
        downloads.remove("work");
        assert_eq!(downloads.works[0].downloaded, 0);
        assert!(urls
            .iter()
            .all(|url| !cached_path(&directory, url).exists()));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "Downloads an existing 9 MB recording from the live Fathers audio provider"]
    fn existing_fathers_recording_downloads_for_offline_playback() {
        let directory = temp("live");
        let url = "https://www.biblicalaudio.com/audio/music/CLEMENS/Clemens-01%7E03.mp3";
        let destination = cached_path(&directory, url);
        assert!(download(
            &http_client().unwrap(),
            url,
            &destination,
            &AtomicBool::new(false),
            |_| {}
        )
        .unwrap());
        assert!(destination.metadata().unwrap().len() > 1_000_000);
        assert_eq!(
            local_path(Path::new("/missing"), Some(&directory), url),
            Some(destination)
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "Downloads an existing Bible MP3 from production to check opt-in source integrity"]
    fn original_bible_recording_downloads_without_quality_changes() {
        let directory = temp("live-bible");
        let url = "/audio/WEBD_AT/01_Genesis_01.mp3";
        let destination = cached_path(&directory, url);
        assert!(download(
            &http_client().unwrap(),
            url,
            &destination,
            &AtomicBool::new(false),
            |_| {}
        )
        .unwrap());
        let original = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../storage/audio/WEBD_AT/01_Genesis_01.mp3");
        assert_eq!(
            fs::read(&destination).unwrap(),
            fs::read(original).unwrap(),
            "Optional download must retain the original audio bytes"
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
