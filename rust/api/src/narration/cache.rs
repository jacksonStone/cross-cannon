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

#[cfg(test)]
#[path = "cache_tests.rs"]
mod storage_tests;

pub(super) const MAX_CLIP_BYTES: u64 = 8 * 1024 * 1024 + 44;
const MAX_DESCRIPTORS: i64 = 50_000;
const MAX_JOBS: i64 = 50_000;
const MAX_JOB_BYTES: usize = 1024 * 1024;
const METADATA_HEADROOM: u64 = 64 * 1024;

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
            CREATE TABLE IF NOT EXISTS usage (day INTEGER PRIMARY KEY, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, audio_output_tokens INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS chapter_jobs (id TEXT PRIMARY KEY, record TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS canceled_chapter_intents (id TEXT NOT NULL, intent TEXT NOT NULL, PRIMARY KEY(id,intent));")?;
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
        let path = self.unit_path(id)?;
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
    /// Read a verified completed unit without generating or charging allowance.
    pub(super) fn cached(&self, id: &str) -> Result<Option<Arc<Vec<u8>>>, Failure> {
        self.read(id)
    }
    pub(super) fn unit_path(&self, id: &str) -> Result<PathBuf, Failure> {
        self.audio_path(id, "wav")
    }
    /// Assembled files have a separate namespace; old unit identities stay valid.
    pub(super) fn chapter_path(&self, id: &str) -> Result<PathBuf, Failure> {
        self.audio_path(id, "chapter.wav")
    }
    fn audio_path(&self, id: &str, suffix: &str) -> Result<PathBuf, Failure> {
        if !valid_id(id) {
            return Err(Failure::missing());
        }
        let path = self.root.join(format!("{id}.{suffix}"));
        match fs::symlink_metadata(&path) {
            Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
                Err(Failure::unavailable())
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(Failure::unavailable()),
            _ => Ok(path),
        }
    }
    /// Hold this guard until the assembly has been synced and atomically renamed
    /// (or its scratch file removed). It shares the clip/metadata disk ceiling but
    /// never reserves an attempt or character allowance. No output is evicted.
    pub(super) fn reserve_assembly(self: &Arc<Self>, bytes: u64) -> Result<Reservation, Failure> {
        let mut reserved = self
            .reserved_bytes
            .lock()
            .map_err(|_| Failure::unavailable())?;
        if self
            .disk_size()?
            .saturating_add(*reserved)
            .saturating_add(bytes)
            > self.limits.max_disk_bytes
        {
            return Err(Failure::capacity());
        }
        *reserved = reserved.checked_add(bytes).ok_or_else(Failure::capacity)?;
        Ok(Reservation {
            cache: self.clone(),
            bytes,
        })
    }
    /// Before paying for the next missing unit, keep space for the assembled PCM
    /// accumulated so far, a worst-case new unit plus its assembly copy, and
    /// header/SQLite overhead. This is a conservative check, not an allocation;
    /// callers still reserve assembly bytes before creating the final file.
    pub(super) fn ensure_assembly_headroom(&self, existing_pcm_bytes: u64) -> Result<(), Failure> {
        let reserved = self
            .reserved_bytes
            .lock()
            .map_err(|_| Failure::unavailable())?;
        if self
            .disk_size()?
            .saturating_add(*reserved)
            .saturating_add(existing_pcm_bytes)
            .saturating_add(2 * MAX_CLIP_BYTES)
            .saturating_add(METADATA_HEADROOM)
            > self.limits.max_disk_bytes
        {
            return Err(Failure::capacity());
        }
        Ok(())
    }
    /// Opaque, text-free JSON metadata owned by the typed chapter-job manager.
    /// Never store source text, transcripts, credentials or account email here.
    /// Each write is atomic; unchanged retries allocate nothing at capacity.
    pub(super) fn job_put(&self, id: &str, record: &str) -> Result<(), Failure> {
        if !valid_id(id) {
            return Err(Failure::missing());
        }
        if !valid_job_record(record) {
            return Err(Failure::capacity());
        }
        let reserved = self
            .reserved_bytes
            .lock()
            .map_err(|_| Failure::unavailable())?;
        let mut db = self.db.lock().map_err(|_| Failure::unavailable())?;
        let tx = db.transaction().map_err(|_| Failure::unavailable())?;
        let old: Option<String> = tx
            .query_row("SELECT record FROM chapter_jobs WHERE id=?", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| Failure::unavailable())?;
        if old.as_deref() == Some(record) {
            return Ok(());
        }
        if old.is_none()
            && tx
                .query_row("SELECT COUNT(*) FROM chapter_jobs", [], |r| {
                    r.get::<_, i64>(0)
                })
                .map_err(|_| Failure::unavailable())?
                >= MAX_JOBS
        {
            return Err(Failure::capacity());
        }
        let metadata = (record.len().max(old.as_ref().map_or(0, String::len)) as u64)
            .saturating_mul(3)
            .saturating_add(METADATA_HEADROOM);
        if self
            .disk_size()?
            .saturating_add(*reserved)
            .saturating_add(metadata)
            > self.limits.max_disk_bytes
        {
            return Err(Failure::capacity());
        }
        tx.execute("INSERT INTO chapter_jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record", params![id,record])
            .map_err(|_| Failure::unavailable())?;
        if self.disk_size()?.saturating_add(*reserved) > self.limits.max_disk_bytes {
            return Err(Failure::capacity());
        }
        tx.commit().map_err(|_| Failure::unavailable())
    }
    pub(super) fn job_get(&self, id: &str) -> Result<Option<String>, Failure> {
        if !valid_id(id) {
            return Err(Failure::missing());
        }
        let db = self.db.lock().map_err(|_| Failure::unavailable())?;
        let value: Option<String> = db
            .query_row("SELECT record FROM chapter_jobs WHERE id=?", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| Failure::unavailable())?;
        if value.as_ref().is_some_and(|v| !valid_job_record(v)) {
            return Err(Failure::unavailable());
        }
        Ok(value)
    }
    /// Startup reconciliation only; the manager interprets persisted running
    /// records as interrupted. Cap and validate rows before exposing them.
    pub(super) fn job_all(&self) -> Result<Vec<(String, String)>, Failure> {
        let db = self.db.lock().map_err(|_| Failure::unavailable())?;
        let mut query = db
            .prepare("SELECT id,record FROM chapter_jobs ORDER BY id LIMIT ?")
            .map_err(|_| Failure::unavailable())?;
        let rows = query
            .query_map([MAX_JOBS + 1], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|_| Failure::unavailable())?;
        let mut records = Vec::new();
        for row in rows {
            let (id, record) = row.map_err(|_| Failure::unavailable())?;
            if records.len() >= MAX_JOBS as usize || !valid_id(&id) || !valid_job_record(&record) {
                return Err(Failure::unavailable());
            }
            records.push((id, record));
        }
        Ok(records)
    }
    pub(super) fn canceled_intent(&self, id: &str, intent: &str) -> Result<bool, Failure> {
        if !valid_id(id) || !valid_intent(intent) {
            return Err(Failure::missing());
        }
        let db = self.db.lock().map_err(|_| Failure::unavailable())?;
        db.query_row(
            "SELECT EXISTS(SELECT 1 FROM canceled_chapter_intents WHERE id=? AND intent=?)",
            params![id, intent],
            |r| r.get(0),
        )
        .map_err(|_| Failure::unavailable())
    }
    /// Durable append-only tombstone. Commit before acknowledging cancellation;
    /// the manager serializes this with its job-state transition. Job updates
    /// never clear tombstones, including after a crash or duplicate late start.
    pub(super) fn cancel_intent(&self, id: &str, intent: &str) -> Result<(), Failure> {
        if !valid_id(id) || !valid_intent(intent) {
            return Err(Failure::missing());
        }
        let reserved = self
            .reserved_bytes
            .lock()
            .map_err(|_| Failure::unavailable())?;
        let mut db = self.db.lock().map_err(|_| Failure::unavailable())?;
        let tx = db.transaction().map_err(|_| Failure::unavailable())?;
        if tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM canceled_chapter_intents WHERE id=? AND intent=?)",
                params![id, intent],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|_| Failure::unavailable())?
        {
            return Ok(());
        }
        if tx
            .query_row("SELECT COUNT(*) FROM canceled_chapter_intents", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(|_| Failure::unavailable())?
            >= MAX_JOBS
            || self
                .disk_size()?
                .saturating_add(*reserved)
                .saturating_add(METADATA_HEADROOM)
                > self.limits.max_disk_bytes
        {
            return Err(Failure::capacity());
        }
        tx.execute(
            "INSERT INTO canceled_chapter_intents VALUES (?,?)",
            params![id, intent],
        )
        .map_err(|_| Failure::unavailable())?;
        if self.disk_size()?.saturating_add(*reserved) > self.limits.max_disk_bytes {
            return Err(Failure::capacity());
        }
        tx.commit().map_err(|_| Failure::unavailable())
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
        let chars: u64 = tx
            .query_row("SELECT characters FROM allowance WHERE day=?", [day], |r| {
                r.get(0)
            })
            .map_err(|_| Failure::unavailable())?;
        if chars.saturating_add(characters as u64) > self.limits.daily_characters {
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
pub(super) struct Reservation {
    cache: Arc<Cache>,
    bytes: u64,
}

fn valid_job_record(record: &str) -> bool {
    record.len() <= MAX_JOB_BYTES
        && serde_json::from_str::<serde_json::Value>(record).is_ok_and(|value| value.is_object())
}
fn valid_intent(intent: &str) -> bool {
    intent.len() == 32
        && intent
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
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
