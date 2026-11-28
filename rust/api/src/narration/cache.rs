//! Private bounded persistent clip storage. A cache root has exactly one writer
//! process; a crash releases its advisory lock. Failed/cancelled paid attempts
//! remain charged to the persistent daily allowance.
use super::{
    provider::{self, ProviderConfig, SpeechSettings},
    Failure,
};
use fs2::FileExt;
use ring::digest::{digest, SHA256};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{watch, Semaphore};

pub(super) const MAX_CLIP_BYTES: u64 = 8 * 1024 * 1024 + 44;
const MAX_DESCRIPTORS: i64 = 50_000;

pub(super) fn hash(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub(super) fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Descriptor {
    pub account: String,
    pub chapter: String,
    pub version: String,
    pub unit: usize,
}
pub(super) fn clip_id(
    owner: &str,
    chapter: &str,
    version: &str,
    unit: usize,
    edition: &str,
    text: &str,
    settings: &SpeechSettings,
) -> String {
    hash(
        &serde_json::to_vec(&(
            provider::SPEECH_REVISION,
            owner,
            chapter,
            version,
            unit,
            edition,
            text,
            settings,
        ))
        .expect("serializable speech identity"),
    )
}
#[derive(Clone)]
pub(super) struct Limits {
    pub daily_attempts: u64,
    pub daily_characters: u64,
    pub max_disk_bytes: u64,
    pub concurrency: usize,
}
type ClipResult = Result<Arc<Vec<u8>>, Failure>;
type Flight = watch::Receiver<Option<ClipResult>>;
pub(super) struct Cache {
    root: PathBuf,
    db: Mutex<Connection>,
    // Held before db for every disk mutation; bytes cover in-flight clips.
    reserved_bytes: Mutex<u64>,
    _lock: File,
    limits: Limits,
    slots: Arc<Semaphore>,
    flights: Mutex<HashMap<String, Flight>>,
}
impl Cache {
    pub fn open(root: PathBuf, limits: Limits) -> anyhow::Result<Arc<Self>> {
        anyhow::ensure!(
            root.is_absolute()
                && limits.max_disk_bytes >= MAX_CLIP_BYTES
                && (1..=2).contains(&limits.concurrency),
            "Invalid narration cache limits"
        );
        fs::create_dir_all(&root)?;
        anyhow::ensure!(
            !fs::symlink_metadata(&root)?.file_type().is_symlink(),
            "Cache root cannot be a symlink"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
        }
        let lock = private_file(&root.join("writer.lock"), false)?;
        lock.try_lock_exclusive()?;
        // Only incomplete scratch output is removed; completed clips are never
        // evicted automatically and replay never silently becomes a paid miss.
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            if entry.file_name().to_string_lossy().ends_with(".partial") {
                fs::remove_file(entry.path())?;
            }
        }
        let db_path = root.join("cache.sqlite");
        if !db_path.exists() {
            drop(private_file(&db_path, true)?);
        }
        let db = Connection::open(db_path)?;
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS descriptors (id TEXT PRIMARY KEY, descriptor TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS allowance (day INTEGER PRIMARY KEY, attempts INTEGER NOT NULL, characters INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS usage (day INTEGER PRIMARY KEY, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, audio_output_tokens INTEGER NOT NULL);")?;
        Ok(Arc::new(Self {
            root,
            db: Mutex::new(db),
            reserved_bytes: Mutex::new(0),
            _lock: lock,
            slots: Arc::new(Semaphore::new(limits.concurrency)),
            limits,
            flights: Mutex::new(HashMap::new()),
        }))
    }
    pub fn describe(&self, entries: &[(String, Descriptor)]) -> Result<(), Failure> {
        let reserved = self
            .reserved_bytes
            .lock()
            .map_err(|_| Failure::unavailable())?;
        let mut db = self.db.lock().map_err(|_| Failure::unavailable())?;
        let tx = db.transaction().map_err(|_| Failure::unavailable())?;
        let count: i64 = tx
            .query_row("SELECT count(*) FROM descriptors", [], |r| r.get(0))
            .map_err(|_| Failure::unavailable())?;
        let mut additions = Vec::new();
        for (id, d) in entries {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM descriptors WHERE id=?)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|_| Failure::unavailable())?;
            if !exists {
                additions.push((
                    id,
                    serde_json::to_string(d).map_err(|_| Failure::unavailable())?,
                ));
            }
            if count + additions.len() as i64 > MAX_DESCRIPTORS {
                return Err(Failure::capacity());
            }
        }
        // An idempotent Play plan allocates nothing and stays usable at capacity.
        // Reserve SQLite page/journal overhead before writing new descriptors;
        // rejection rolls back instead of accumulating unusable plan metadata.
        if additions.is_empty() {
            return Ok(());
        }
        let reservation = additions
            .iter()
            .map(|(id, json)| (id.len() + json.len()) as u64 + 16 * 1024)
            .sum::<u64>();
        if self
            .disk_size()?
            .saturating_add(*reserved)
            .saturating_add(reservation)
            > self.limits.max_disk_bytes
        {
            return Err(Failure::capacity());
        }
        for (id, json) in additions {
            tx.execute("INSERT INTO descriptors VALUES (?,?)", params![id, json])
                .map_err(|_| Failure::unavailable())?;
        }
        if self.disk_size()?.saturating_add(*reserved) > self.limits.max_disk_bytes {
            return Err(Failure::capacity());
        }
        tx.commit().map_err(|_| Failure::unavailable())?;
        Ok(())
    }
    pub fn descriptor(&self, id: &str) -> Result<Descriptor, Failure> {
        if !valid_id(id) {
            return Err(Failure::missing());
        }
        let db = self.db.lock().map_err(|_| Failure::unavailable())?;
        let value: Option<String> = db
            .query_row("SELECT descriptor FROM descriptors WHERE id=?", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| Failure::unavailable())?;
        serde_json::from_str(&value.ok_or_else(Failure::missing)?)
            .map_err(|_| Failure::unavailable())
    }
    fn disk_size(&self) -> Result<u64, Failure> {
        let mut bytes = 0_u64;
        for entry in fs::read_dir(&self.root).map_err(|_| Failure::unavailable())? {
            let metadata = entry
                .map_err(|_| Failure::unavailable())?
                .metadata()
                .map_err(|_| Failure::unavailable())?;
            bytes = bytes.saturating_add(metadata.len());
        }
        Ok(bytes)
    }
    fn read(&self, id: &str) -> Result<Option<Arc<Vec<u8>>>, Failure> {
        if !valid_id(id) {
            return Err(Failure::missing());
        }
        let path = self.root.join(format!("{id}.wav"));
        match fs::metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(Failure::unavailable()),
            Ok(meta) => {
                if meta.len() > MAX_CLIP_BYTES || meta.len() < 46 {
                    return Err(Failure::unavailable());
                }
                let bytes = fs::read(path).map_err(|_| Failure::unavailable())?;
                if !valid_wav(&bytes) {
                    return Err(Failure::unavailable());
                }
                Ok(Some(Arc::new(bytes)))
            }
        }
    }
    fn reserve(self: &Arc<Self>, characters: usize) -> Result<Reservation, Failure> {
        let mut reserved = self
            .reserved_bytes
            .lock()
            .map_err(|_| Failure::unavailable())?;
        let bytes = MAX_CLIP_BYTES + 32 * 1024; // complete clip plus SQLite allowance/usage pages
        if self
            .disk_size()?
            .saturating_add(*reserved)
            .saturating_add(bytes)
            > self.limits.max_disk_bytes
        {
            return Err(Failure::capacity());
        }
        let mut db = self.db.lock().map_err(|_| Failure::unavailable())?;
        let tx = db.transaction().map_err(|_| Failure::unavailable())?;
        let day = day();
        tx.execute("INSERT OR IGNORE INTO allowance VALUES (?,0,0)", [day])
            .map_err(|_| Failure::unavailable())?;
        let (attempts, chars): (u64, u64) = tx
            .query_row(
                "SELECT attempts,characters FROM allowance WHERE day=?",
                [day],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| Failure::unavailable())?;
        if attempts >= self.limits.daily_attempts
            || chars.saturating_add(characters as u64) > self.limits.daily_characters
        {
            return Err(Failure::budget());
        }
        tx.execute(
            "UPDATE allowance SET attempts=attempts+1,characters=characters+? WHERE day=?",
            params![characters as u64, day],
        )
        .map_err(|_| Failure::unavailable())?;
        tx.commit().map_err(|_| Failure::unavailable())?;
        *reserved += bytes;
        Ok(Reservation {
            cache: self.clone(),
            bytes,
        })
    }
    fn save(&self, id: &str, bytes: &[u8], usage: &provider::SpeechUsage) -> Result<(), Failure> {
        if bytes.len() as u64 > MAX_CLIP_BYTES || !valid_wav(bytes) {
            return Err(Failure::provider());
        }
        let reserved = self
            .reserved_bytes
            .lock()
            .map_err(|_| Failure::unavailable())?;
        // Metadata cannot consume promised clip space while synthesis awaits.
        // Recheck too, so external/manual file growth cannot bypass the ceiling.
        if self.disk_size()?.saturating_add(*reserved) > self.limits.max_disk_bytes {
            return Err(Failure::capacity());
        }
        let scratch = self.root.join(format!("{id}.partial"));
        let final_path = self.root.join(format!("{id}.wav"));
        let result = (|| -> std::io::Result<()> {
            let mut file = private_file(&scratch, true)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&scratch, &final_path)?;
            File::open(&self.root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(scratch);
            return Err(Failure::unavailable());
        }
        let db = self.db.lock().map_err(|_| Failure::unavailable())?;
        db.execute("INSERT INTO usage VALUES (?,?,?,?) ON CONFLICT(day) DO UPDATE SET input_tokens=input_tokens+excluded.input_tokens,output_tokens=output_tokens+excluded.output_tokens,audio_output_tokens=audio_output_tokens+excluded.audio_output_tokens",params![day(),usage.input_tokens,usage.output_tokens,usage.audio_output_tokens]).map_err(|_|Failure::unavailable())?;
        Ok(())
    }
    pub async fn clip(
        self: &Arc<Self>,
        id: String,
        text: String,
        settings: SpeechSettings,
        provider: Arc<ProviderConfig>,
    ) -> ClipResult {
        if let Some(bytes) = self.read(&id)? {
            return Ok(bytes);
        }
        let mut receiver = {
            let mut flights = self.flights.lock().map_err(|_| Failure::unavailable())?;
            if let Some(existing) = flights.get(&id) {
                existing.clone()
            } else {
                // A previous flight may have committed after the first read.
                if let Some(bytes) = self.read(&id)? {
                    return Ok(bytes);
                }
                // Try, never queue another paid task. Matching misses join the
                // same bounded task, including after their HTTP caller leaves.
                let slot = self
                    .slots
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| Failure::busy())?;
                let reservation = self.reserve(text.chars().count())?;
                let (sender, receiver) = watch::channel(None);
                flights.insert(id.clone(), receiver.clone());
                let cache = self.clone();
                tokio::spawn(async move {
                    let _slot = slot;
                    let result = async {
                        let audio = provider::synthesize(&provider, &settings, &text)
                            .await
                            .map_err(|_| Failure::provider())?;
                        if !provider::transcript_matches(&text, &audio.transcript) {
                            return Err(Failure::provider());
                        }
                        cache.save(&id, &audio.wav, &audio.usage)?;
                        Ok(Arc::new(audio.wav))
                    }
                    .await;
                    drop(reservation);
                    if let Ok(mut flights) = cache.flights.lock() {
                        flights.remove(&id);
                    }
                    drop(cache);
                    let _ = sender.send(Some(result));
                });
                receiver
            }
        };
        loop {
            if let Some(result) = receiver.borrow_and_update().clone() {
                return result;
            }
            receiver
                .changed()
                .await
                .map_err(|_| Failure::unavailable())?;
        }
    }
}
struct Reservation {
    cache: Arc<Cache>,
    bytes: u64,
}
impl Drop for Reservation {
    fn drop(&mut self) {
        if let Ok(mut reserved) = self.cache.reserved_bytes.lock() {
            *reserved = reserved.saturating_sub(self.bytes);
        }
    }
}

fn day() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400
}
fn private_file(path: &Path, exclusive: bool) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).read(true);
    if exclusive {
        options.create_new(true);
    } else {
        options.create(true).truncate(false);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}
fn valid_wav(bytes: &[u8]) -> bool {
    bytes.len() >= 46
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WAVE"
        && &bytes[36..40] == b"data"
        && (u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize) == bytes.len() - 44
}
