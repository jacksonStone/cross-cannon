//! Explicit, resumable single-chapter jobs. Planning and status reads never spend.
use super::{
    cache::{self, Cache},
    catalog::ResolvedChapter,
    chapter_audio, Failure, Routes,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::Notify;

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Record {
    pub id: String,
    pub account: String,
    pub chapter: String,
    pub version: String,
    pub title: String,
    pub units: Vec<String>,
    pub state: String,
    pub completed: usize,
    pub activated: bool,
}
struct Active {
    id: String,
    intents: HashSet<String>,
    cancelled: Arc<AtomicBool>,
}
pub(super) struct Jobs {
    cache: Arc<Cache>,
    active: Mutex<Option<Active>>,
    managed: Mutex<HashMap<String, String>>,
    changed: Notify,
    interrupted: Mutex<HashSet<String>>,
}
impl Jobs {
    pub fn open(cache: Arc<Cache>) -> Result<Arc<Self>, Failure> {
        let mut managed = HashMap::new();
        let mut interrupted = HashSet::new();
        for (id, value) in cache.job_all()? {
            let r: Record = serde_json::from_str(&value).map_err(|_| Failure::unavailable())?;
            if r.state == "running" {
                // Reconciliation is read-only: a full cache must not disable
                // existing playback merely to persist a restart marker.
                interrupted.insert(id.clone());
            }
            if r.activated {
                for unit in &r.units {
                    managed.insert(unit.clone(), id.clone());
                }
            }
        }
        Ok(Arc::new(Self {
            cache,
            active: Mutex::new(None),
            managed: Mutex::new(managed),
            changed: Notify::new(),
            interrupted: Mutex::new(interrupted),
        }))
    }
    pub fn identity(account: &str, chapter: &ResolvedChapter, units: &[String]) -> String {
        cache::hash(
            &serde_json::to_vec(&(
                "chapter-pcm-v1",
                account,
                &chapter.chapter_id,
                &chapter.version,
                units,
            ))
            .unwrap(),
        )
    }
    pub fn describe(
        &self,
        account: &str,
        chapter: &ResolvedChapter,
        units: Vec<String>,
    ) -> Result<Record, Failure> {
        let _active = self.active.lock().map_err(|_| Failure::unavailable())?;
        let id = Self::identity(account, chapter, &units);
        if let Some(r) = self.get(&id)? {
            return Ok(r);
        }
        let r = Record {
            id,
            account: account.into(),
            chapter: chapter.chapter_id.clone(),
            version: chapter.version.clone(),
            title: chapter.title.clone(),
            units,
            state: "ready".into(),
            completed: 0,
            activated: false,
        };
        self.put(&r)?;
        Ok(r)
    }
    pub fn get(&self, id: &str) -> Result<Option<Record>, Failure> {
        let record = self
            .cache
            .job_get(id)?
            .map(|v| serde_json::from_str::<Record>(&v).map_err(|_| Failure::unavailable()))
            .transpose()?;
        Ok(record.map(|mut r| {
            if r.state == "running" && self.interrupted.lock().map_or(true, |ids| ids.contains(id))
            {
                r.state = "interrupted".into();
            }
            r
        }))
    }
    fn put(&self, r: &Record) -> Result<(), Failure> {
        self.cache.job_put(
            &r.id,
            &serde_json::to_string(r).map_err(|_| Failure::unavailable())?,
        )?;
        self.changed.notify_waiters();
        Ok(())
    }
    pub fn completed(&self, r: &Record) -> Option<Value> {
        if r.state != "complete" {
            return None;
        }
        let path = self.cache.chapter_path(&r.id).ok()?;
        chapter_audio::inspect_part(&path).ok()?;
        Some(json!({"id":r.id,"url":format!("/api/narration/chapter/{}",r.id),"title":r.title}))
    }
    pub fn status(&self, r: &Record) -> Value {
        json!({"id":r.id,"state":r.state,"completedUnits":r.completed,"totalUnits":r.units.len(),"completedChapter":self.completed(r)})
    }
    pub fn start(
        self: &Arc<Self>,
        r: Record,
        intent: String,
        state: Arc<Routes>,
        user: String,
        headers: axum::http::HeaderMap,
    ) -> Result<(), Failure> {
        let mut active = self.active.lock().map_err(|_| Failure::unavailable())?;
        let r = self.get(&r.id)?.ok_or_else(Failure::missing)?;
        if self.cache.canceled_intent(&r.id, &intent)? {
            return Err(Failure {
                status: axum::http::StatusCode::CONFLICT,
                message: "This narration request was stopped. Tap Play to resume.",
            });
        }
        if self.completed(&r).is_some() {
            return Ok(());
        }
        if let Some(a) = active.as_mut() {
            if a.id == r.id && !a.cancelled.load(Ordering::SeqCst) {
                a.intents.insert(intent);
                return Ok(());
            }
            return Err(Failure::busy());
        }
        let mut r = r;
        r.state = "running".into();
        r.activated = true;
        self.put(&r)?;
        self.interrupted
            .lock()
            .map_err(|_| Failure::unavailable())?
            .remove(&r.id);
        {
            let mut managed = self.managed.lock().map_err(|_| Failure::unavailable())?;
            for u in &r.units {
                managed.insert(u.clone(), r.id.clone());
            }
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        *active = Some(Active {
            id: r.id.clone(),
            intents: HashSet::from([intent]),
            cancelled: cancelled.clone(),
        });
        let jobs = self.clone();
        tokio::spawn(async move {
            let result = jobs
                .build(&mut r, &state, &user, &headers, &cancelled)
                .await;
            r.state = match result {
                Ok(()) => "complete",
                Err(_) if cancelled.load(Ordering::SeqCst) => "cancelled",
                Err(e) if e.status == axum::http::StatusCode::INSUFFICIENT_STORAGE => {
                    "storage_full"
                }
                Err(e)
                    if e.status == axum::http::StatusCode::TOO_MANY_REQUESTS
                        && e.message == Failure::budget().message =>
                {
                    "budget"
                }
                Err(_) => "failed",
            }
            .into();
            // Clear the flight only after its terminal state is durable.
            if jobs.put(&r).is_err() {
                if let Ok(mut ids) = jobs.interrupted.lock() {
                    ids.insert(r.id.clone());
                }
            }
            if let Ok(mut a) = jobs.active.lock() {
                *a = None;
            }
            jobs.changed.notify_waiters();
        });
        Ok(())
    }
    pub fn cancel(&self, id: &str, intent: &str) -> Result<(), Failure> {
        let mut active = self.active.lock().map_err(|_| Failure::unavailable())?;
        self.cache.cancel_intent(id, intent)?;
        if let Some(a) = active.as_mut() {
            if a.id == id {
                a.intents.remove(intent);
                if a.intents.is_empty() {
                    a.cancelled.store(true, Ordering::SeqCst);
                }
            }
        }
        self.changed.notify_waiters();
        Ok(())
    }
    async fn build(
        &self,
        r: &mut Record,
        state: &Routes,
        user: &str,
        headers: &axum::http::HeaderMap,
        cancelled: &Arc<AtomicBool>,
    ) -> Result<(), Failure> {
        let service = state.service.as_ref().ok_or_else(Failure::unavailable)?;
        let mut pcm = 0u64;
        // Retained units after a gap also need a copy in the final file. Count
        // all of them before paying to fill that gap, not only the played prefix.
        let mut cached_pcm = 0u64;
        for id in &r.units {
            let path = self.cache.unit_path(id)?;
            match chapter_audio::inspect_part(&path) {
                Ok(meta) => {
                    cached_pcm = cached_pcm
                        .checked_add(meta.pcm_bytes)
                        .ok_or_else(Failure::capacity)?
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(Failure::provider()),
            }
        }
        let mut paths = Vec::new();
        for (index, id) in r.units.iter().enumerate() {
            if cancelled.load(Ordering::SeqCst) {
                return Err(Failure::unavailable());
            }
            // Recheck account linkage/allowlist and the exact canonical source before
            // every potentially charged unit. No caller-supplied text is persisted.
            super::job_owner_valid(state, user, headers).await?;
            let chapter = super::resolve_selection(state, &r.chapter, &r.version).await?;
            let text = chapter.units.get(index).ok_or_else(Failure::missing)?;
            if cache::clip_id(
                &r.account,
                &chapter.chapter_id,
                &chapter.version,
                index,
                &chapter.edition_identity,
                text,
                &service.settings,
            ) != *id
            {
                return Err(Failure::missing());
            }
            let missing = self.cache.cached(id)?.is_none();
            if missing {
                self.cache.ensure_assembly_headroom(cached_pcm)?;
            }
            if cancelled.load(Ordering::SeqCst) {
                return Err(Failure::unavailable());
            }
            self.cache
                .clip(
                    id.clone(),
                    text.clone(),
                    service.settings.clone(),
                    service.provider.clone(),
                )
                .await?;
            let path = self.cache.unit_path(id)?;
            let meta = chapter_audio::inspect_part(&path).map_err(|_| Failure::provider())?;
            if missing {
                cached_pcm = cached_pcm
                    .checked_add(meta.pcm_bytes)
                    .ok_or_else(Failure::capacity)?;
            }
            pcm = pcm
                .checked_add(meta.pcm_bytes)
                .ok_or_else(Failure::capacity)?;
            paths.push(path);
            r.completed = index + 1;
            self.put(r)?;
        }
        if cancelled.load(Ordering::SeqCst) {
            return Err(Failure::unavailable());
        }
        let bytes = pcm.checked_add(44).ok_or_else(Failure::capacity)?;
        let destination = self.cache.chapter_path(&r.id)?;
        // A crash can occur after atomic publication but before the job's final
        // SQLite commit. This namespace is keyed by all verified unit identities.
        if destination.exists() {
            let existing =
                chapter_audio::inspect_part(&destination).map_err(|_| Failure::unavailable())?;
            if existing.bytes == bytes && existing.pcm_bytes == pcm {
                return Ok(());
            }
            return Err(Failure::unavailable());
        }
        let reservation = self.cache.reserve_assembly(bytes)?;
        let cancelled = cancelled.clone();
        tokio::task::spawn_blocking(move || {
            let _reservation = reservation;
            chapter_audio::assemble(&paths, &destination, bytes, || {
                cancelled.load(Ordering::SeqCst)
            })
            .map_err(|_| Failure::unavailable())
        })
        .await
        .map_err(|_| Failure::unavailable())??;
        Ok(())
    }
    pub async fn managed_clip(&self, id: &str) -> Result<Option<Arc<Vec<u8>>>, Failure> {
        let job = self
            .managed
            .lock()
            .map_err(|_| Failure::unavailable())?
            .get(id)
            .cloned();
        let Some(job) = job else {
            return Ok(None);
        };
        tokio::time::timeout(std::time::Duration::from_secs(150), async {
            loop {
                let notified = self.changed.notified();
                if let Some(bytes) = self.cache.cached(id)? {
                    return Ok(Some(bytes));
                }
                let r = self.get(&job)?.ok_or_else(Failure::missing)?;
                if r.state != "running" {
                    return Err(match r.state.as_str() {
                        "budget" => Failure::budget(),
                        "storage_full" => Failure::capacity(),
                        _ => Failure::provider(),
                    });
                }
                notified.await;
            }
        })
        .await
        .map_err(|_| Failure::busy())?
    }
}
