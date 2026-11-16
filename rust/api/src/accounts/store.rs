//! Account persistence over the existing schema. Opening the store never creates
//! a database or runs migrations. Every native redemption and study CAS is atomic.
use super::protocol::{
    parse_location, valid_nonce, Location, Progress, SavedProgress, SavedStudy, StudyItem,
};
use anyhow::{Context, Result};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex, time::Duration};

const LOGIN_LIFETIME: i64 = 10 * 60_000;
const SESSION_LIFETIME: i64 = 30 * 24 * 60 * 60_000;

pub(crate) struct Store {
    connection: Mutex<Connection>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct User {
    pub id: String,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ProgressWrite {
    pub saved: bool,
    pub progress: Option<SavedProgress>,
}

#[derive(Debug, Serialize)]
pub(crate) struct StudyWrite {
    pub saved: bool,
    pub record: Option<SavedStudy>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeLogin {
    pub id: String,
    pub secret: String,
    pub label: String,
    pub expires_at: i64,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct PendingLogin {
    pub id: String,
    pub label: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum PollResult {
    Expired,
    Pending,
    SlowDown,
    Complete {
        token: String,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
    },
}

#[derive(Debug)]
pub(crate) struct LoginCapacity;
impl std::fmt::Display for LoginCapacity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Try again later")
    }
}
impl std::error::Error for LoginCapacity {}

pub(crate) fn valid_native_authorization(header: &str) -> Option<&str> {
    let token = header.strip_prefix("Bearer ")?;
    valid_native_token(token).then_some(token)
}

fn valid_native_token(token: &str) -> bool {
    token.strip_prefix("ccn_").is_some_and(valid_nonce)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(DIGITS[(byte >> 4) as usize] as char);
        value.push(DIGITS[(byte & 15) as usize] as char);
    }
    value
}

fn hash(value: &str) -> String {
    hex(digest::digest(&digest::SHA256, value.as_bytes()).as_ref())
}

fn nonce() -> Result<String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("Secure randomness unavailable"))?;
    Ok(hex(&bytes))
}

#[allow(deprecated)]
fn proof_matches(proof: &str, stored: &str) -> bool {
    ring::constant_time::verify_slices_are_equal(hash(proof).as_bytes(), stored.as_bytes()).is_ok()
}

impl Store {
    pub(crate) fn open(path: &Path) -> Result<Self> {
        // Follow a legacy deployment symlink before opening SQLite so WAL and
        // journal sidecars live beside the writable shared database itself.
        let path = std::fs::canonicalize(path).context(
            "Locate existing accounts database; run the explicit accounts migration first",
        )?;
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .context("Open existing accounts database; run the explicit accounts migration first")?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self> {
        connection.pragma_update(None, "foreign_keys", true)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        for query in [
            "SELECT id, name, email FROM user LIMIT 0",
            "SELECT user_id, corpus, location, revision FROM reader_progress LIMIT 0",
            "SELECT user_id, id, item, revision FROM study_items LIMIT 0",
            "SELECT id, secret_hash, code, label, user_id, ticket_hash, expires_at, last_poll FROM native_login LIMIT 0",
            "SELECT token_hash, user_id, expires_at FROM native_session LIMIT 0",
        ] { connection.prepare(query).context("Accounts schema is incomplete; run the explicit accounts migration first")?; }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T>,
    ) -> Result<T> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| anyhow::anyhow!("Accounts database lock unavailable"))?;
        operation(&mut connection)
    }

    pub(crate) fn user_for_native_token(&self, token: &str, now_ms: i64) -> Result<Option<User>> {
        if !valid_native_token(token) {
            return Ok(None);
        }
        self.with_connection(|connection| Ok(connection.query_row(
            "SELECT user.id, user.name, user.email FROM native_session JOIN user ON user.id = native_session.user_id WHERE token_hash = ? AND expires_at > ?",
            params![hash(token), now_ms], |row| Ok(User { id: row.get(0)?, name: row.get(1)?, email: row.get(2)? }),
        ).optional()?))
    }

    pub(crate) fn progress(&self, user: &str) -> Result<Progress> {
        self.with_connection(|connection| read_progress(connection, user))
    }

    pub(crate) fn save_progress(
        &self,
        user: &str,
        location: &Location,
        revision: i64,
    ) -> Result<ProgressWrite> {
        self.with_connection(|connection| {
            let json = serde_json::to_string(location)?;
            let updated = if revision == 0 {
                connection.query_row("INSERT INTO reader_progress (user_id, corpus, location, revision) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, corpus) DO NOTHING RETURNING revision",
                    params![user, location.corpus, json], |row| row.get::<_, i64>(0)).optional()?
            } else {
                connection.query_row("UPDATE reader_progress SET location = ?, revision = revision + 1 WHERE user_id = ? AND corpus = ? AND revision = ? RETURNING revision",
                    params![json, user, location.corpus, revision], |row| row.get::<_, i64>(0)).optional()?
            };
            Ok(ProgressWrite { saved: updated.is_some(), progress: match updated {
                Some(revision) => Some(SavedProgress { location: location.clone(), revision }),
                None => read_progress(connection, user)?.remove(&location.corpus),
            } })
        })
    }

    pub(crate) fn study(&self, user: &str) -> Result<Vec<SavedStudy>> {
        self.with_connection(|connection| {
            let mut query = connection
                .prepare("SELECT item, revision FROM study_items WHERE user_id = ? ORDER BY id")?;
            let rows = query.query_map([user], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?;
            rows.map(|row| {
                let (json, revision) = row?;
                Ok(SavedStudy {
                    item: serde_json::from_str(&json)?,
                    revision,
                })
            })
            .collect()
        })
    }

    pub(crate) fn save_study(
        &self,
        user: &str,
        item: &StudyItem,
        revision: i64,
    ) -> Result<StudyWrite> {
        self.with_connection(|connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let mut item = item.clone();
            if let Some(previous) = read_study_item(&transaction, user, &item.id)? {
                if previous.item.created_at.is_some() { item.created_at = previous.item.created_at; }
            }
            let json = serde_json::to_string(&item)?;
            let updated = if revision == 0 {
                transaction.query_row("INSERT INTO study_items (user_id, id, item, revision) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, id) DO NOTHING RETURNING revision",
                    params![user, item.id, json], |row| row.get::<_, i64>(0)).optional()?
            } else {
                transaction.query_row("UPDATE study_items SET item = ?, revision = revision + 1 WHERE user_id = ? AND id = ? AND revision = ? RETURNING revision",
                    params![json, user, item.id, revision], |row| row.get::<_, i64>(0)).optional()?
            };
            let record = match updated {
                Some(revision) => Some(SavedStudy { item, revision }),
                None => read_study_item(&transaction, user, &item.id)?,
            };
            transaction.commit()?;
            Ok(StudyWrite { saved: updated.is_some(), record })
        })
    }

    pub(crate) fn start_native_login(
        &self,
        origin: &str,
        platform: Option<&str>,
        now_ms: i64,
    ) -> Result<NativeLogin> {
        let mut url = url::Url::parse(origin)?.join("/account/native")?;
        let id = nonce()?;
        let secret = nonce()?;
        let label = if platform == Some("ios") {
            "Cross Canon for iPhone / iPad"
        } else {
            "Cross Canon for desktop"
        }
        .to_owned();
        let expires_at = now_ms.saturating_add(LOGIN_LIFETIME);
        self.with_connection(|connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute("DELETE FROM native_login WHERE expires_at <= ?", [now_ms])?;
            transaction.execute("DELETE FROM native_session WHERE expires_at <= ?", [now_ms])?;
            let count: i64 = transaction.query_row("SELECT COUNT(*) FROM native_login", [], |row| row.get(0))?;
            if count >= 1000 { return Err(LoginCapacity.into()); }
            transaction.execute("INSERT INTO native_login (id, secret_hash, code, label, expires_at) VALUES (?, ?, '', ?, ?)",
                params![id, hash(&secret), label, expires_at])?;
            transaction.commit()?;
            Ok(())
        })?;
        url.query_pairs_mut().append_pair("id", &id);
        Ok(NativeLogin {
            id,
            secret,
            label,
            expires_at,
            url: url.into(),
        })
    }

    pub(crate) fn pending_native_login(
        &self,
        id: &str,
        now_ms: i64,
    ) -> Result<Option<PendingLogin>> {
        self.with_connection(|connection| {
            Ok(connection
                .query_row(
                    "SELECT id, label FROM native_login WHERE id = ? AND expires_at > ?",
                    params![id, now_ms],
                    |row| {
                        Ok(PendingLogin {
                            id: row.get(0)?,
                            label: row.get(1)?,
                        })
                    },
                )
                .optional()?)
        })
    }

    pub(crate) fn approve_native_login(
        &self,
        id: &str,
        user: &str,
        now_ms: i64,
    ) -> Result<Option<String>> {
        let ticket = nonce()?;
        self.with_connection(|connection| {
            let changes = connection.execute("UPDATE native_login SET user_id = ?, ticket_hash = ? WHERE id = ? AND user_id IS NULL AND expires_at > ?",
                params![user, hash(&ticket), id, now_ms])?;
            Ok((changes == 1).then_some(ticket))
        })
    }

    pub(crate) fn poll_native_login(
        &self,
        id: &str,
        secret: &str,
        ticket: Option<&str>,
        now_ms: i64,
    ) -> Result<PollResult> {
        self.with_connection(|connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let login = transaction.query_row(
                "SELECT secret_hash, user_id, ticket_hash, last_poll FROM native_login WHERE id = ? AND expires_at > ?", params![id, now_ms],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, i64>(3)?)),
            ).optional()?;
            let result = match login {
                None => PollResult::Expired,
                Some((proof, user, approved_ticket, last_poll)) => {
                    if !proof_matches(secret, &proof) { PollResult::Expired }
                    else if user.is_some() && ticket.is_none() { PollResult::Pending }
                    else if user.is_some() && !approved_ticket.as_deref().is_some_and(|expected| proof_matches(ticket.unwrap_or_default(), expected)) { PollResult::Expired }
                    else if last_poll > now_ms.saturating_sub(1500) { PollResult::SlowDown }
                    else {
                        transaction.execute("UPDATE native_login SET last_poll = ? WHERE id = ?", params![now_ms, id])?;
                        if let Some(user) = user {
                            let token = format!("ccn_{}", nonce()?);
                            let expires_at = now_ms.saturating_add(SESSION_LIFETIME);
                            transaction.execute("INSERT INTO native_session (token_hash, user_id, expires_at) VALUES (?, ?, ?)", params![hash(&token), user, expires_at])?;
                            transaction.execute("DELETE FROM native_login WHERE id = ?", [id])?;
                            PollResult::Complete { token, expires_at }
                        } else { PollResult::Pending }
                    }
                }
            };
            transaction.commit()?;
            Ok(result)
        })
    }

    pub(crate) fn revoke_native_login(&self, token: &str) -> Result<()> {
        if valid_native_token(token) {
            self.with_connection(|connection| {
                connection.execute(
                    "DELETE FROM native_session WHERE token_hash = ?",
                    [hash(token)],
                )?;
                Ok(())
            })?;
        }
        Ok(())
    }
}

fn read_progress(connection: &Connection, user: &str) -> Result<Progress> {
    let mut result = Progress::new();
    let mut query =
        connection.prepare("SELECT location, revision FROM reader_progress WHERE user_id = ?")?;
    let rows = query.query_map([user], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (json, revision) = row?;
        if let Some(location) = parse_location(&serde_json::from_str(&json)?) {
            result.insert(
                location.corpus.clone(),
                SavedProgress { location, revision },
            );
        }
    }
    Ok(result)
}

fn read_study_item(connection: &Connection, user: &str, id: &str) -> Result<Option<SavedStudy>> {
    let row = connection
        .query_row(
            "SELECT item, revision FROM study_items WHERE user_id = ? AND id = ?",
            params![user, id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    row.map(|(json, revision)| {
        Ok(SavedStudy {
            item: serde_json::from_str(&json)?,
            revision,
        })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::super::protocol::{parse_location, parse_study};
    use super::*;
    use serde_json::json;

    fn seed(connection: &Connection) {
        connection.execute_batch("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL); INSERT INTO user VALUES ('a', 'Reader A', 'a@example.test'), ('b', 'Reader B', 'b@example.test');").unwrap();
        connection
            .execute_batch(include_str!("../../accounts-schema.sql"))
            .unwrap();
    }

    fn memory() -> Store {
        let connection = Connection::open_in_memory().unwrap();
        seed(&connection);
        Store::from_connection(connection).unwrap()
    }

    fn location(corpus: &str, chapter: &str) -> Location {
        parse_location(&json!({ "version": 2, "corpus": corpus, "chapterKey": chapter })).unwrap()
    }

    fn note(id: &str) -> StudyItem {
        parse_study(&json!({ "id": id, "kind": "note", "location": { "version": 2, "corpus": "scripture", "chapterKey": "John\t3" }, "reference": "John 3", "quote": "A passage", "title": "", "body": "## Heading\n\n**Thought**", "color": "yellow", "notebookId": null, "deleted": false, "createdAt": 123456789 })).unwrap()
    }

    struct DatabaseFile(std::path::PathBuf);
    impl DatabaseFile {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "crosscanon-account-contract-{}-{}.db",
                std::process::id(),
                nonce().unwrap()
            )))
        }
        fn seeded() -> Self {
            let file = Self::new();
            let connection = Connection::open(&file.0).unwrap();
            seed(&connection);
            file
        }
    }
    impl Drop for DatabaseFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn opening_never_creates_or_migrates_and_progress_survives_reopening() {
        let missing = DatabaseFile::new();
        assert!(Store::open(&missing.0).is_err());
        assert!(!missing.0.exists());
        let uninitialized = DatabaseFile::new();
        Connection::open(&uninitialized.0).unwrap();
        assert!(Store::open(&uninitialized.0).is_err());
        let connection = Connection::open(&uninitialized.0).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let file = DatabaseFile::seeded();
        let store = Store::open(&file.0).unwrap();
        for corpus in ["scripture", "fathers", "classics"] {
            assert!(
                store
                    .save_progress("a", &location(corpus, "first"), 0)
                    .unwrap()
                    .saved
            );
        }
        assert!(store.progress("b").unwrap().is_empty());
        drop(store);
        let store = Store::open(&file.0).unwrap();
        assert_eq!(store.progress("a").unwrap().len(), 3);
        let newer = location("scripture", "John\t4");
        assert_eq!(
            store
                .save_progress("a", &newer, 1)
                .unwrap()
                .progress
                .unwrap()
                .revision,
            2
        );
        for stale in [0, 1, 99] {
            let conflict = store
                .save_progress("a", &location("scripture", "stale"), stale)
                .unwrap();
            assert!(!conflict.saved);
            assert_eq!(conflict.progress.unwrap().location, newer);
        }
        let missing = store.save_progress("b", &newer, 99).unwrap();
        assert!(!missing.saved);
        assert!(missing.progress.is_none());
    }

    #[test]
    #[cfg(unix)]
    fn legacy_database_symlinks_keep_sqlite_sidecars_at_the_real_writable_path() {
        let file = DatabaseFile::seeded();
        let legacy = DatabaseFile::new();
        std::os::unix::fs::symlink(&file.0, &legacy.0).unwrap();
        let store = Store::open(&legacy.0).unwrap();
        store
            .with_connection(|connection| {
                connection.pragma_update(None, "journal_mode", "WAL")?;
                Ok(())
            })
            .unwrap();
        assert!(
            store
                .save_progress("a", &location("scripture", "John\t3"), 0)
                .unwrap()
                .saved
        );
        assert!(std::path::PathBuf::from(format!("{}-wal", file.0.display())).exists());
        assert!(!std::path::PathBuf::from(format!("{}-wal", legacy.0.display())).exists());
    }

    #[test]
    fn study_cas_is_per_item_account_isolated_and_retains_dates_and_tombstones() {
        let store = memory();
        let first = note("first");
        let second = note("second");
        assert!(store.save_study("a", &first, 0).unwrap().saved);
        assert!(store.save_study("a", &second, 0).unwrap().saved);
        assert!(store.study("b").unwrap().is_empty());
        assert!(store.save_study("b", &first, 0).unwrap().saved);
        assert!(!store.save_study("a", &first, 0).unwrap().saved);
        let mut legacy = first.clone();
        legacy.body = "Edited by older app".into();
        legacy.created_at = None;
        let saved = store.save_study("a", &legacy, 1).unwrap();
        assert!(saved.saved);
        assert_eq!(saved.record.unwrap().item.created_at, first.created_at);
        legacy.created_at = Some(999);
        let conflict = store.save_study("a", &legacy, 1).unwrap();
        assert!(!conflict.saved);
        assert_eq!(conflict.record.unwrap().item.body, "Edited by older app");
        legacy.deleted = true;
        assert!(store.save_study("a", &legacy, 2).unwrap().saved);
        let stale = store.save_study("a", &first, 2).unwrap();
        assert!(!stale.saved);
        assert!(stale.record.unwrap().item.deleted);
        assert!(!store.study("b").unwrap()[0].item.deleted);
        let records = store.study("a").unwrap();
        assert_eq!(
            records
                .iter()
                .map(|record| record.item.id.as_str())
                .collect::<Vec<_>>(),
            ["first", "second"]
        );
        assert_eq!(records[0].item.created_at, first.created_at);
        assert_eq!(records[1].revision, 1);
    }

    #[test]
    fn native_handoff_requires_same_device_proof_and_ticket_and_redeems_once() {
        let store = memory();
        let now = 1_700_000_000_000;
        let login = store
            .start_native_login("https://www.crosscanon.com/base", Some("ios"), now)
            .unwrap();
        assert!(valid_nonce(&login.id));
        assert!(valid_nonce(&login.secret));
        assert_eq!(login.label, "Cross Canon for iPhone / iPad");
        assert_eq!(login.expires_at, now + LOGIN_LIFETIME);
        let url = url::Url::parse(&login.url).unwrap();
        assert_eq!(url.path(), "/account/native");
        assert_eq!(
            url.query_pairs().collect::<Vec<_>>(),
            [("id".into(), login.id.as_str().into())]
        );
        assert!(store
            .pending_native_login(&login.id, now)
            .unwrap()
            .is_some());
        assert_eq!(
            store
                .poll_native_login(&login.id, &login.secret, None, now)
                .unwrap(),
            PollResult::Pending
        );
        assert_eq!(
            store
                .poll_native_login(&login.id, &login.secret, None, now + 100)
                .unwrap(),
            PollResult::SlowDown
        );
        let ticket = store
            .approve_native_login(&login.id, "a", now + 200)
            .unwrap()
            .unwrap();
        assert!(valid_nonce(&ticket));
        assert!(store
            .approve_native_login(&login.id, "b", now + 300)
            .unwrap()
            .is_none());
        for (secret, ticket, expected) in [
            ("0".repeat(64), None, PollResult::Expired),
            (login.secret.clone(), None, PollResult::Pending),
            (
                login.secret.clone(),
                Some("0".repeat(64)),
                PollResult::Expired,
            ),
            ("0".repeat(64), Some(ticket.clone()), PollResult::Expired),
        ] {
            assert_eq!(
                store
                    .poll_native_login(&login.id, &secret, ticket.as_deref(), now + 2000)
                    .unwrap(),
                expected
            );
        }
        store
            .with_connection(|connection| {
                let (secret_hash, ticket_hash): (String, String) = connection.query_row(
                    "SELECT secret_hash, ticket_hash FROM native_login WHERE id = ?",
                    [&login.id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(secret_hash, hash(&login.secret));
                assert_ne!(secret_hash, login.secret);
                assert_eq!(ticket_hash, hash(&ticket));
                assert_ne!(ticket_hash, ticket);
                Ok(())
            })
            .unwrap();
        let result = store
            .poll_native_login(&login.id, &login.secret, Some(&ticket), now + 2000)
            .unwrap();
        let PollResult::Complete { token, expires_at } = result else {
            panic!("Expected redeemed native session")
        };
        assert_eq!(expires_at, now + 2000 + SESSION_LIFETIME);
        assert!(valid_native_token(&token));
        assert_eq!(
            store
                .user_for_native_token(&token, now + 3000)
                .unwrap()
                .unwrap()
                .id,
            "a"
        );
        assert_eq!(
            store
                .poll_native_login(&login.id, &login.secret, Some(&ticket), now + 4000)
                .unwrap(),
            PollResult::Expired
        );
        assert!(store
            .user_for_native_token(&token, expires_at)
            .unwrap()
            .is_none());
        store
            .with_connection(|connection| {
                assert_eq!(
                    connection.query_row("SELECT token_hash FROM native_session", [], |row| row
                        .get::<_, String>(0))?,
                    hash(&token)
                );
                Ok(())
            })
            .unwrap();
        for header in [
            "Bearer invalid".to_owned(),
            format!("bearer {token}"),
            format!("Bearer {token} "),
            format!("Bearer {}", token.to_uppercase()),
        ] {
            assert!(valid_native_authorization(&header).is_none());
        }
        let header = format!("Bearer {token}");
        assert_eq!(valid_native_authorization(&header), Some(token.as_str()));
        store.revoke_native_login(&token).unwrap();
        assert!(store
            .user_for_native_token(&token, now + 3000)
            .unwrap()
            .is_none());
    }

    #[test]
    fn native_expiration_and_capacity_are_bounded_and_old_requests_are_pruned() {
        let store = memory();
        let now = 1_700_000_000_000;
        let login = store
            .start_native_login("https://www.crosscanon.com", None, now)
            .unwrap();
        assert_eq!(login.label, "Cross Canon for desktop");
        assert!(store
            .approve_native_login(&login.id, "a", login.expires_at)
            .unwrap()
            .is_none());
        assert!(store
            .pending_native_login(&login.id, login.expires_at)
            .unwrap()
            .is_none());
        assert_eq!(
            store
                .poll_native_login(&login.id, &login.secret, None, login.expires_at)
                .unwrap(),
            PollResult::Expired
        );
        store.with_connection(|connection| {
            connection.execute("DELETE FROM native_login", [])?;
            connection.execute("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO native_login (id, secret_hash, code, label, expires_at) SELECT printf('%064x', x), 'proof-hash', '', 'desktop', ? FROM n", [now + 1000])?;
            connection.execute("INSERT INTO native_session VALUES ('old-token-hash', 'a', ?)", [now + 1000])?;
            Ok(())
        }).unwrap();
        assert!(store
            .start_native_login("https://www.crosscanon.com", None, now)
            .unwrap_err()
            .downcast_ref::<LoginCapacity>()
            .is_some());
        store
            .start_native_login("https://www.crosscanon.com", None, now + 1000)
            .unwrap();
        store
            .with_connection(|connection| {
                assert_eq!(
                    connection.query_row("SELECT COUNT(*) FROM native_login", [], |row| row
                        .get::<_, i64>(0))?,
                    1
                );
                assert_eq!(
                    connection
                        .query_row("SELECT COUNT(*) FROM native_session", [], |row| row
                            .get::<_, i64>(0))?,
                    0
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn independent_database_connections_cannot_overwrite_the_same_study_revision() {
        let file = DatabaseFile::seeded();
        let store = Store::open(&file.0).unwrap();
        let original = note("shared");
        assert!(store.save_study("a", &original, 0).unwrap().saved);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let results = std::thread::scope(|scope| {
            let mut workers = Vec::new();
            for body in ["left edit", "right edit"] {
                let store = Store::open(&file.0).unwrap();
                let barrier = barrier.clone();
                let mut item = original.clone();
                item.body = body.into();
                item.created_at = None;
                workers.push(scope.spawn(move || {
                    barrier.wait();
                    store.save_study("a", &item, 1).unwrap()
                }));
            }
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(results.iter().filter(|result| result.saved).count(), 1);
        let final_record = store.study("a").unwrap().remove(0);
        assert_eq!(final_record.revision, 2);
        assert_eq!(final_record.item.created_at, original.created_at);
        for result in results {
            assert_eq!(result.record.unwrap(), final_record);
        }
    }

    #[test]
    fn concurrent_native_redemption_mints_exactly_one_session() {
        let file = DatabaseFile::seeded();
        let store = Store::open(&file.0).unwrap();
        let now = 1_700_000_000_000;
        let login = store
            .start_native_login("https://www.crosscanon.com", None, now)
            .unwrap();
        let ticket = store
            .approve_native_login(&login.id, "b", now)
            .unwrap()
            .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let results = std::thread::scope(|scope| {
            let mut workers = Vec::new();
            for _ in 0..2 {
                let store = Store::open(&file.0).unwrap();
                let (barrier, id, secret, ticket) = (
                    barrier.clone(),
                    login.id.clone(),
                    login.secret.clone(),
                    ticket.clone(),
                );
                workers.push(scope.spawn(move || {
                    barrier.wait();
                    store
                        .poll_native_login(&id, &secret, Some(&ticket), now + 2000)
                        .unwrap()
                }));
            }
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, PollResult::Complete { .. }))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| **result == PollResult::Expired)
                .count(),
            1
        );
        store
            .with_connection(|connection| {
                assert_eq!(
                    connection.query_row(
                        "SELECT COUNT(*) FROM native_session WHERE user_id = 'b'",
                        [],
                        |row| row.get::<_, i64>(0)
                    )?,
                    1
                );
                Ok(())
            })
            .unwrap();
    }
}
