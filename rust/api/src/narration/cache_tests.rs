//! Storage-only tests: no provider, HTTP, account credentials or live paths.
use super::*;
use axum::http::StatusCode;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("cc-chapter-storage-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
    fn cache(&self) -> Arc<Cache> {
        Cache::open(
            self.0.join("cache"),
            Limits {
                daily_attempts: 1,
                daily_characters: 20,
                max_disk_bytes: 64 * 1024 * 1024,
                concurrency: 1,
            },
        )
        .unwrap()
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn id(n: usize) -> String {
    format!("{n:064x}")
}
fn intent(n: usize) -> String {
    format!("{n:032x}")
}
fn wav() -> Vec<u8> {
    let mut value = vec![0; 46];
    value[..4].copy_from_slice(b"RIFF");
    value[8..12].copy_from_slice(b"WAVE");
    value[36..40].copy_from_slice(b"data");
    value[40..44].copy_from_slice(&2u32.to_le_bytes());
    value
}

#[test]
fn chapter_metadata_and_cancel_tombstones_survive_reopen_without_altering_clips_or_quota() {
    let temp = Temp::new();
    let old_unit = id(1);
    let chapter = id(2);
    // Start with the shipped pre-chapter schema and an already charged attempt.
    let legacy_root = temp.0.join("cache");
    fs::create_dir(&legacy_root).unwrap();
    drop(private_file(&legacy_root.join("cache.sqlite"), true).unwrap());
    let db = Connection::open(legacy_root.join("cache.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE descriptors(id TEXT PRIMARY KEY,descriptor TEXT NOT NULL); CREATE TABLE allowance(day INTEGER PRIMARY KEY,attempts INTEGER NOT NULL,characters INTEGER NOT NULL); CREATE TABLE usage(day INTEGER PRIMARY KEY,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,audio_output_tokens INTEGER NOT NULL);").unwrap();
    db.execute("INSERT INTO allowance VALUES (?,1,7)", [day()])
        .unwrap();
    drop(db);
    let bytes = wav();
    fs::write(legacy_root.join(format!("{old_unit}.wav")), &bytes).unwrap();
    let cache = temp.cache();
    cache
        .job_put(&chapter, r#"{"state":"running","completedUnits":1}"#)
        .unwrap();
    cache.cancel_intent(&chapter, &intent(1)).unwrap();
    cache
        .job_put(&chapter, r#"{"state":"interrupted","completedUnits":1}"#)
        .unwrap();
    let assembly = cache.reserve_assembly(1024).unwrap();
    drop(assembly);
    assert_eq!(
        cache
            .db
            .lock()
            .unwrap()
            .query_row("SELECT attempts,characters FROM allowance", [], |r| Ok((
                r.get::<_, u64>(0)?,
                r.get::<_, u64>(1)?
            )))
            .unwrap(),
        (1, 7)
    );
    assert_eq!(cache.cached(&old_unit).unwrap().unwrap().as_slice(), bytes);
    let root = cache.root.clone();
    drop(cache);
    let reopened = Cache::open(
        root,
        Limits {
            daily_attempts: 0,
            daily_characters: 0,
            max_disk_bytes: 64 * 1024 * 1024,
            concurrency: 1,
        },
    )
    .unwrap();
    assert_eq!(
        reopened.job_get(&chapter).unwrap().as_deref(),
        Some(r#"{"state":"interrupted","completedUnits":1}"#)
    );
    assert_eq!(reopened.job_all().unwrap().len(), 1);
    assert!(reopened.canceled_intent(&chapter, &intent(1)).unwrap());
    assert!(!reopened.canceled_intent(&chapter, &intent(2)).unwrap());
    assert!(!reopened.canceled_intent(&id(3), &intent(1)).unwrap());
    assert_eq!(
        reopened.cached(&old_unit).unwrap().unwrap().as_slice(),
        bytes
    );
    assert_eq!(
        reopened
            .db
            .lock()
            .unwrap()
            .query_row("SELECT attempts,characters FROM allowance", [], |r| Ok((
                r.get::<_, u64>(0)?,
                r.get::<_, u64>(1)?
            )))
            .unwrap(),
        (1, 7)
    );
}

#[test]
fn assembly_reservations_share_the_disk_bound_and_release_without_charging() {
    let temp = Temp::new();
    let cache = temp.cache();
    let available = cache.limits.max_disk_bytes - cache.disk_size().unwrap();
    let assembly = cache.reserve_assembly(available).unwrap();
    assert_eq!(
        cache.reserve_assembly(1).err().unwrap().status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    assert_eq!(
        cache.reserve(1).err().unwrap().status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    assert_eq!(
        cache.job_put(&id(1), "{}").unwrap_err().status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    assert_eq!(
        cache.cancel_intent(&id(1), &intent(1)).unwrap_err().status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    assert_eq!(
        cache
            .db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM allowance", [], |r| r.get::<_, u64>(0))
            .unwrap(),
        0
    );
    drop(assembly);
    assert_eq!(*cache.reserved_bytes.lock().unwrap(), 0);
    let guard = cache.reserve_assembly(1).unwrap();
    drop(guard);
    cache.job_put(&id(1), "{}").unwrap();
}

#[test]
fn next_paid_unit_headroom_includes_assembly_copy_reservations_and_metadata() {
    let temp = Temp::new();
    let cache = temp.cache();
    let boundary = cache.limits.max_disk_bytes
        - cache.disk_size().unwrap()
        - 2 * MAX_CLIP_BYTES
        - METADATA_HEADROOM;
    cache.ensure_assembly_headroom(boundary).unwrap();
    assert_eq!(
        cache
            .ensure_assembly_headroom(boundary + 1)
            .unwrap_err()
            .status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    assert_eq!(
        cache.ensure_assembly_headroom(u64::MAX).unwrap_err().status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    let guard = cache.reserve_assembly(1).unwrap();
    assert!(cache.ensure_assembly_headroom(boundary).is_err());
    drop(guard);
    cache.ensure_assembly_headroom(boundary).unwrap();
    assert_eq!(
        cache
            .db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM allowance", [], |r| r.get::<_, u64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn paths_and_metadata_fail_closed_for_invalid_ids_intents_or_oversize_records() {
    let temp = Temp::new();
    let cache = temp.cache();
    for bad in ["../escape", "", &"a".repeat(63), &"A".repeat(64)] {
        assert!(cache.unit_path(bad).is_err());
        assert!(cache.chapter_path(bad).is_err());
        assert!(cache.cached(bad).is_err());
        assert!(cache.job_put(bad, "{}").is_err());
        assert!(cache.job_get(bad).is_err());
        assert!(cache.canceled_intent(bad, &intent(1)).is_err());
    }
    for bad in ["", "../escape", &"a".repeat(31), &"A".repeat(32)] {
        assert!(cache.cancel_intent(&id(1), bad).is_err());
        assert!(cache.canceled_intent(&id(1), bad).is_err());
    }
    assert!(cache.job_put(&id(1), "raw text").is_err());
    assert!(cache.job_put(&id(1), "[]").is_err());
    assert!(cache
        .job_put(
            &id(1),
            &format!("{{\"padding\":\"{}\"}}", "x".repeat(MAX_JOB_BYTES))
        )
        .is_err());
    assert!(cache.job_get(&id(1)).unwrap().is_none());
    assert_ne!(
        cache.unit_path(&id(1)).unwrap(),
        cache.chapter_path(&id(1)).unwrap()
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            temp.0.join("unrelated"),
            cache.root.join(format!("{}.wav", id(1))),
        )
        .unwrap();
        assert!(cache.unit_path(&id(1)).is_err());
        assert!(cache.cached(&id(1)).is_err());
        std::os::unix::fs::symlink(
            temp.0.join("unrelated"),
            cache.root.join(format!("{}.chapter.wav", id(1))),
        )
        .unwrap();
        assert!(cache.chapter_path(&id(1)).is_err());
    }
}

#[test]
fn bounded_job_and_cancel_tables_keep_idempotent_retries_at_capacity() {
    let temp = Temp::new();
    let cache = temp.cache();
    {
        let mut db = cache.db.lock().unwrap();
        let tx = db.transaction().unwrap();
        {
            let mut jobs = tx
                .prepare("INSERT INTO chapter_jobs VALUES (?,'{}')")
                .unwrap();
            let mut intents = tx
                .prepare("INSERT INTO canceled_chapter_intents VALUES (?,?)")
                .unwrap();
            for n in 0..MAX_JOBS as usize {
                jobs.execute([id(n)]).unwrap();
                intents.execute(params![id(0), intent(n)]).unwrap();
            }
        }
        tx.commit().unwrap();
    }
    cache.job_put(&id(0), "{}").unwrap();
    cache.job_put(&id(0), r#"{"state":"complete"}"#).unwrap();
    cache.cancel_intent(&id(0), &intent(0)).unwrap();
    assert_eq!(
        cache
            .job_put(&id(MAX_JOBS as usize), "{}")
            .unwrap_err()
            .status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    assert_eq!(
        cache
            .cancel_intent(&id(0), &intent(MAX_JOBS as usize))
            .unwrap_err()
            .status,
        StatusCode::INSUFFICIENT_STORAGE
    );
    assert!(!cache
        .canceled_intent(&id(0), &intent(MAX_JOBS as usize))
        .unwrap());
    let remaining = cache.limits.max_disk_bytes - cache.disk_size().unwrap();
    let guard = cache.reserve_assembly(remaining).unwrap();
    cache.job_put(&id(0), r#"{"state":"complete"}"#).unwrap();
    cache.cancel_intent(&id(0), &intent(0)).unwrap();
    drop(guard);
    assert_eq!(cache.job_all().unwrap().len(), MAX_JOBS as usize);
}
