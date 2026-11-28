//! Browser-mediated login. The Google secret stays on the server; only the
//! device's revocable Cross Canon session is held in the Apple Keychain.
use super::*;
use anyhow::{bail, ensure};
use std::collections::BTreeMap;

const ORIGIN: &str = "https://www.crosscanon.com";
fn origin() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        browser::origin()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        ORIGIN.into()
    }
}

pub(super) const CORPORA: [&str; 3] = ["scripture", "fathers", "classics"];

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Location {
    version: u8,
    pub corpus: String,
    chapter_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    passage_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    passage_range: Option<String>,
}
impl Location {
    pub fn from_passage(p: &Passage) -> Self {
        Self {
            version: 2,
            corpus: corpus_key(p.corpus).into(),
            chapter_key: if p.corpus == Corpus::Scripture {
                format!("{}\t{}", p.book, p.chapter)
            } else {
                p.chapter_id.clone()
            },
            passage_key: (p.corpus == Corpus::Scripture).then(|| p.id.clone()),
            passage_range: (p.corpus != Corpus::Scripture)
                .then(|| format!("{}-{}", p.verse_start, p.verse_end)),
        }
    }
    pub fn passage(&self, library: &Library) -> Option<String> {
        if self.version != 2 {
            return None;
        }
        if self.corpus == "scripture" {
            if let Some(p) = self.passage_key.as_ref().and_then(|id| library.passage(id)) {
                if p.corpus == Corpus::Scripture {
                    return Some(p.id.clone());
                }
            }
            let (book, chapter) = self.chapter_key.split_once('\t')?;
            return library
                .book(book)?
                .chapters
                .iter()
                .find(|c| c.number.to_string() == chapter)?
                .passage_ids
                .first()
                .cloned();
        }
        let (book, chapter) = library.chapter(&self.chapter_key)?;
        if corpus_key(book.corpus) != self.corpus {
            return None;
        }
        // Web Work locations may store only a Chapter. Resolve ranges against
        // verse/paragraph coverage, never internal sentence positions.
        let start = self
            .passage_range
            .as_deref()
            .and_then(|r| r.split('-').next()?.parse::<u32>().ok());
        chapter
            .passage_ids
            .iter()
            .find(|id| {
                library
                    .passage(id)
                    .is_some_and(|p| start.is_none_or(|v| p.verse_start <= v && p.verse_end >= v))
            })
            .or_else(|| chapter.passage_ids.first())
            .cloned()
    }
}
pub(super) fn corpus_key(corpus: Corpus) -> &'static str {
    match corpus {
        Corpus::Scripture => "scripture",
        Corpus::EarlyChristian => "fathers",
        Corpus::ChristianClassics => "classics",
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct User {
    pub id: String,
    pub name: String,
    pub email: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct Progress {
    pub location: Location,
    pub revision: u64,
}
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct LocalProgress {
    pub saved: Option<Progress>,
    pub dirty: bool,
    pub conflict: Option<Progress>,
}
#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Saved {
    pub user: Option<User>,
    pub profiles: BTreeMap<String, BTreeMap<String, LocalProgress>>,
    pub guest: Vec<String>,
    pub revoke_pending: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Login {
    id: String,
    secret: String,
    pub url: String,
    expires_at: u64,
    #[serde(skip)]
    ticket: Option<String>,
}
#[derive(Deserialize)]
struct AccountResponse {
    user: Option<User>,
    progress: BTreeMap<String, Progress>,
}
struct SyncOutput {
    account: AccountResponse,
    uploaded: BTreeMap<String, Progress>,
}
enum Event {
    Restored(Result<Option<String>>),
    Started(Result<Login>),
    Polled(Result<Option<String>>),
    Synced(u64, Result<SyncOutput>),
    Revoked(Result<()>),
}

pub(super) struct Account {
    pub saved: Saved,
    token: Option<String>,
    pub login: Option<Login>,
    pub status: String,
    busy: bool,
    last_request: Instant,
    generation: u64,
    tx: Sender<(u64, Event)>,
    rx: Receiver<(u64, Event)>,
    pub open_browser: Option<String>,
    pub close_browser: bool,
    pub identity_changed: bool,
    pub persist_now: bool,
    persistent: bool,
    restore_started: bool,
    reader_active: bool,
    foreground_generation: u64,
    refresh_generation: u64,
    received_refresh: Option<u64>,
    resume: Option<(u64, String)>,
    sync_origin: Option<String>,
}
impl Account {
    pub fn new(saved: Saved) -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            saved,
            token: None,
            login: None,
            status: String::new(),
            busy: false,
            last_request: Instant::now(),
            generation: 0,
            tx,
            rx,
            open_browser: None,
            close_browser: false,
            identity_changed: false,
            persist_now: false,
            restore_started: false,
            persistent: false,
            reader_active: false,
            foreground_generation: 0,
            refresh_generation: 0,
            received_refresh: None,
            resume: None,
            // Background sync tests opt into a loopback server explicitly.
            sync_origin: (!cfg!(test)).then(origin),
        }
    }
    fn run(&mut self, ctx: &egui::Context, job: impl platform::Task<Output = Event>) {
        self.busy = true;
        self.last_request = Instant::now();
        let tx = self.tx.clone();
        let generation = self.generation;
        let ctx = ctx.clone();
        platform::spawn(async move {
            let _ = tx.send((generation, job.await));
            ctx.request_repaint();
        });
    }
    pub fn sign_in(&mut self, ctx: &egui::Context) {
        if self.busy || self.saved.revoke_pending {
            return;
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = ctx;
            browser::sign_in();
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.generation += 1;
            self.status = "Preparing secure Google sign-in…".into();
            self.run(ctx, async {
                Event::Started(
                    (async {
                        let platform = if cfg!(target_os = "ios") {
                            "ios"
                        } else {
                            "desktop"
                        };
                        let login: Login = client()?
                            .post(format!("{ORIGIN}/api/native-login"))
                            .json(&serde_json::json!({"operation":"start", "platform":platform}))
                            .send()
                            .await?
                            .error_for_status()?
                            .json()
                            .await?;
                        ensure!(
                            login
                                .url
                                .starts_with(&format!("{ORIGIN}/account/native?id=")),
                            "Invalid sign-in address"
                        );
                        Ok(login)
                    })
                    .await,
                )
            });
        }
    }
    pub fn cancel_login(&mut self) {
        self.generation += 1;
        self.busy = false;
        self.login = None;
        self.close_browser = true;
        self.status = "Sign-in canceled. You can keep reading.".into();
    }
    pub fn sign_out(&mut self, ctx: &egui::Context) {
        #[cfg(target_arch = "wasm32")]
        {
            let _ = ctx;
            browser::sign_out();
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.persist_now = true;
            self.generation += 1;
            self.busy = false;
            self.login = None;
            self.saved.user = None;
            self.identity_changed = true;
            self.saved.revoke_pending = self.token.is_some();
            self.close_browser = true;
            self.status = "Signed out on this device. Revoking its session…".into();
            self.force_sync();
            self.tick(ctx);
        }
    }
    pub fn force_sync(&mut self) {
        self.last_request = Instant::now() - Duration::from_secs(60);
    }
    fn observe_activity(&mut self, activity: mobile::Activity, passage: &str) {
        let active = activity.active != 0;
        if active && (!self.reader_active || activity.generation != self.foreground_generation) {
            self.refresh_generation += 1;
            self.resume = Some((self.refresh_generation, passage.to_owned()));
            self.force_sync();
        } else if !active {
            self.resume = None;
        }
        self.reader_active = active;
        self.foreground_generation = activity.generation;
    }
    pub fn profile(&self) -> Option<&BTreeMap<String, LocalProgress>> {
        self.saved.profiles.get(&self.saved.user.as_ref()?.id)
    }
    fn profile_mut(&mut self) -> Option<&mut BTreeMap<String, LocalProgress>> {
        Some(
            self.saved
                .profiles
                .entry(self.saved.user.as_ref()?.id.clone())
                .or_default(),
        )
    }
    pub fn remember(&mut self, passage: &Passage, library: &Library) {
        let Some(profile) = self.profile_mut() else {
            return;
        };
        let location = Location::from_passage(passage);
        let entry = profile.entry(location.corpus.clone()).or_default();
        if entry
            .saved
            .as_ref()
            .is_some_and(|p| p.location.passage(library).as_deref() == Some(passage.id.as_str()))
        {
            return;
        }
        let revision = entry.saved.as_ref().map_or(0, |p| p.revision);
        entry.saved = Some(Progress { location, revision });
        entry.dirty = true;
        // An unresolved conflict remains visible as reading continues offline.
    }
    pub fn resolve(&mut self, corpus: &str, keep_local: bool) {
        self.persist_now = true;
        let Some(entry) = self.profile_mut().and_then(|p| p.get_mut(corpus)) else {
            return;
        };
        if let Some(cloud) = entry.conflict.take() {
            if keep_local {
                if let Some(saved) = &mut entry.saved {
                    saved.revision = cloud.revision;
                }
                entry.dirty = true;
            } else {
                entry.saved = Some(cloud);
                entry.dirty = false;
            }
        }
        self.force_sync();
    }
    pub fn tick(&mut self, ctx: &egui::Context) {
        self.received_refresh = None;
        while let Ok((generation, event)) = self.rx.try_recv() {
            if generation != self.generation {
                continue;
            }
            self.busy = false;
            match event {
                Event::Restored(result) => {
                    match result {
                        Ok(token) => {
                            self.token = token;
                            self.persistent = self.token.is_some();
                            if self.token.is_none() && self.saved.user.take().is_some() {
                                self.identity_changed = true;
                            }
                            self.force_sync();
                        }
                        Err(_) => {
                            self.status = "Unlock your device to access its saved sign-in, then reopen Account.".into();
                        }
                    }
                }
                Event::Started(result) => match result {
                    Ok(login) => {
                        self.open_browser = Some(login.url.clone());
                        self.login = Some(login);
                        self.status = "Finish signing in in your browser.".into();
                    }
                    Err(_) => {
                        self.status =
                            "Could not start sign-in. Check your connection and try again.".into();
                    }
                },
                Event::Polled(result) => match result {
                    Ok(Some(token)) => {
                        self.persistent = store_token(Some(&token)).is_ok();
                        self.token = Some(token);
                        self.login = None;
                        self.close_browser = true;
                        self.force_sync();
                    }
                    Ok(None) => {}
                    Err(error) => {
                        self.status = error.to_string();
                    }
                },
                Event::Synced(refresh, result) => match result {
                    Ok(output) => {
                        if let Some(user) = output.account.user {
                            if self.saved.user.as_ref().map(|u| &u.id) != Some(&user.id) {
                                self.identity_changed = true;
                            }
                            self.saved.user = Some(user);
                            reconcile(
                                self.profile_mut().unwrap(),
                                output.account.progress,
                                output.uploaded,
                            );
                            self.persist_now = true;
                            self.received_refresh = Some(refresh);
                            self.status = if self
                                .profile()
                                .unwrap()
                                .values()
                                .any(|p| p.conflict.is_some())
                            {
                                "Choose which reading place to keep below."
                            } else if self.profile().unwrap().values().any(|p| p.dirty) {
                                "Saving your place…"
                            } else {
                                "Your reading progress is up to date."
                            }
                            .into();
                        } else {
                            #[cfg(target_arch = "wasm32")]
                            {
                                if self.saved.user.take().is_some() {
                                    self.identity_changed = true;
                                }
                                self.token = None;
                                self.persist_now = true;
                                self.status = "Sign in to sync your reading across devices.".into();
                            }
                        }
                    }
                    Err(error) => {
                        if error
                            .downcast_ref::<reqwest::Error>()
                            .is_some_and(|e| e.status() == Some(reqwest::StatusCode::UNAUTHORIZED))
                        {
                            // Keep this account's offline queue, but stop authenticated requests.
                            self.token = None;
                            let _ = store_token(None);
                            self.status = "Your session expired. Sign in again to sync this account’s saved places.".into();
                        } else {
                            self.status = "Offline — your place is saved here and will sync when you reconnect.".into();
                        }
                    }
                },
                Event::Revoked(result) => match result {
                    Ok(()) => {
                        self.persist_now = true;
                        self.token = None;
                        self.saved.revoke_pending = false;
                        self.status =
                            "Signed out. Your account’s offline progress stays separate.".into();
                    }
                    Err(_) => {
                        self.status =
                            "Signed out here. The session will be revoked when you reconnect."
                                .into();
                    }
                },
            }
        }
        if self.busy {
            // run() wakes the UI when its worker delivers a response.
            return;
        }
        if !self.restore_started {
            self.restore_started = true;
            // Tests and throwaway previews never access a real credential store.
            if !cfg!(test) && std::env::var_os("CROSS_CANON_FRESH").is_none() {
                self.run(ctx, async { Event::Restored(load_token()) });
                return;
            }
        }
        if self.saved.revoke_pending && self.last_request.elapsed() >= Duration::from_secs(3) {
            if let Some(token) = self.token.clone() {
                self.run(ctx, async move {
                    Event::Revoked(
                        (async {
                            let response = client()?
                                .post(format!("{ORIGIN}/api/native-login"))
                                .bearer_auth(token)
                                .json(&serde_json::json!({"operation":"revoke"}))
                                .send()
                                .await?;
                            if response.status() != reqwest::StatusCode::UNAUTHORIZED {
                                response.error_for_status()?;
                            }
                            store_token(None)?;
                            Ok(())
                        })
                        .await,
                    )
                });
            } else {
                self.saved.revoke_pending = false;
            }
        } else if let Some(login) = self.login.clone() {
            if epoch_millis() >= login.expires_at {
                self.cancel_login();
                self.status = "Sign-in expired. Please try again.".into();
            } else if login.ticket.is_some()
                && self.last_request.elapsed() >= Duration::from_secs(2)
            {
                self.run(ctx, async move { Event::Polled((async {
                    let response = client()?.post(format!("{ORIGIN}/api/native-login"))
                        .json(&serde_json::json!({"operation":"poll", "id":login.id, "secret":login.secret, "ticket":login.ticket})).send().await?;
                    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS { return Ok(None); }
                    let body: serde_json::Value = response.error_for_status()?.json().await?;
                    match body["status"].as_str() {
                        Some("complete") => {
                            let token = body["token"].as_str().context("Missing session")?.to_owned();
                            ensure!(valid_token(&token), "Invalid session");
                            Ok(Some(token))
                        }
                        Some("expired") => bail!("This sign-in expired. Cancel and try again."),
                        _ => Ok(None),
                    }
                }).await) });
            }
        } else if let (Some(token), Some(origin)) = (self.token.clone(), self.sync_origin.clone()) {
            if self.last_request.elapsed() >= self.sync_interval() {
                let profile = self.profile().cloned().unwrap_or_default();
                let user_id = self.saved.user.as_ref().map(|u| u.id.clone());
                let refresh = self.refresh_generation;
                self.run(ctx, async move {
                    Event::Synced(
                        refresh,
                        sync_async(&origin, &token, user_id.as_deref(), profile).await,
                    )
                });
            }
        }
        self.schedule_tick(ctx);
    }
    pub(super) fn schedule_tick(&self, ctx: &egui::Context) {
        // Sleep until work is due rather than checking it every half second.
        // Local input and worker responses still request immediate repaints.
        if !self.busy {
            let delay = if self.saved.revoke_pending {
                Some(Duration::from_secs(3).saturating_sub(self.last_request.elapsed()))
            } else if let Some(login) = &self.login {
                let expiry = Duration::from_millis(login.expires_at.saturating_sub(epoch_millis()));
                Some(if login.ticket.is_some() {
                    Duration::from_secs(2)
                        .saturating_sub(self.last_request.elapsed())
                        .min(expiry)
                } else {
                    expiry
                })
            } else if self.token.is_some() && self.sync_origin.is_some() {
                Some(
                    self.sync_interval()
                        .saturating_sub(self.last_request.elapsed()),
                )
            } else {
                None
            };
            if let Some(delay) = delay {
                ctx.request_repaint_after(delay);
            }
        }
    }
    fn sync_interval(&self) -> Duration {
        let dirty = self
            .profile()
            .is_some_and(|p| p.values().any(|e| e.dirty && e.conflict.is_none()));
        Duration::from_secs(if dirty { 2 } else { 30 })
    }
    pub fn study_credentials(&self) -> Option<(String, String, String)> {
        if !self.signed_in() || self.received_refresh.is_none() {
            return None;
        }
        Some((
            self.saved.user.as_ref()?.id.clone(),
            self.token.clone()?,
            self.sync_origin.clone()?,
        ))
    }
    pub fn narration_credentials(&self) -> Option<(String, String, String)> {
        if !self.signed_in() { return None; }
        Some((self.saved.user.as_ref()?.id.clone(), self.token.clone()?, self.sync_origin.clone()?))
    }
    pub fn signed_in(&self) -> bool {
        self.token.is_some() && !self.saved.revoke_pending && self.saved.user.is_some()
    }
    pub fn receive_callback(&mut self, value: &str) -> bool {
        let Ok(url) = reqwest::Url::parse(value) else {
            return false;
        };
        if url.scheme() != "crosscanon" || url.host_str() != Some("login-complete") {
            return false;
        }
        let request = url
            .query_pairs()
            .find(|(key, _)| key == "request")
            .map(|(_, value)| value.into_owned());
        let ticket = url
            .query_pairs()
            .find(|(key, _)| key == "ticket")
            .map(|(_, value)| value.into_owned());
        if let (Some(login), Some(request), Some(ticket)) = (&mut self.login, request, ticket) {
            if login.id == request
                && ticket.len() == 64
                && ticket.bytes().all(|b| b.is_ascii_hexdigit())
            {
                login.ticket = Some(ticket);
                self.status = "Finishing sign-in…".into();
                self.force_sync();
                return true;
            }
        }
        self.status = "Start sign-in from this app to connect your account.".into();
        true
    }
}

fn epoch_millis() -> u64 {
    platform::epoch_millis()
}
fn client() -> Result<platform::HttpClient> {
    platform::http_client(Duration::from_secs(15))
}
async fn sync_async(
    origin: &str,
    token: &str,
    expected_user: Option<&str>,
    local: BTreeMap<String, LocalProgress>,
) -> Result<SyncOutput> {
    let client = client()?;
    let mut account: AccountResponse =
        platform::authenticated(client.get(format!("{origin}/api/account")), token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
    let mut uploaded = BTreeMap::new();
    // A credential restored from Keychain must be identified before any queued
    // account's data is sent. A different Google account starts a separate queue.
    if account.user.as_ref().map(|u| u.id.as_str()) != expected_user {
        return Ok(SyncOutput { account, uploaded });
    }
    for (corpus, entry) in local {
        let Some(saved) = entry.saved else {
            continue;
        };
        let cloud = account.progress.get(&corpus);
        if cloud.is_some_and(|p| p.location == saved.location) {
            continue;
        }
        if !entry.dirty
            || entry.conflict.is_some()
            || cloud.map_or(0, |p| p.revision) != saved.revision
        {
            continue;
        }
        let response = platform::authenticated(client.post(format!("{origin}/api/account")), token)
            .json(&serde_json::json!({"location":saved.location, "revision":saved.revision}))
            .send()
            .await?;
        let conflict = response.status() == reqwest::StatusCode::CONFLICT;
        let response = if conflict {
            response
        } else {
            response.error_for_status()?
        };
        let body: serde_json::Value = response.json().await?;
        let progress: Progress = serde_json::from_value(body["progress"].clone())?;
        if !conflict {
            uploaded.insert(corpus.clone(), progress.clone());
        }
        account.progress.insert(corpus, progress);
    }
    Ok(SyncOutput { account, uploaded })
}
#[cfg(all(test, not(target_arch = "wasm32")))]
fn sync(
    origin: &str,
    token: &str,
    user: Option<&str>,
    local: BTreeMap<String, LocalProgress>,
) -> Result<SyncOutput> {
    platform::block_on(sync_async(origin, token, user, local))
}

fn reconcile(
    local: &mut BTreeMap<String, LocalProgress>,
    cloud: BTreeMap<String, Progress>,
    uploaded: BTreeMap<String, Progress>,
) {
    for (corpus, remote) in cloud {
        let entry = local.entry(corpus.clone()).or_default();
        if let Some(saved) = &mut entry.saved {
            if saved.location == remote.location {
                *saved = remote;
                entry.dirty = false;
                entry.conflict = None;
            } else if entry.dirty {
                if uploaded
                    .get(&corpus)
                    .is_some_and(|p| p.location == remote.location && p.revision == remote.revision)
                {
                    // User kept reading during an upload. Acknowledge only that
                    // upload; the newly focused Passage remains queued.
                    saved.revision = remote.revision;
                } else if saved.revision != remote.revision {
                    entry.conflict = Some(remote);
                }
            } else {
                entry.saved = Some(remote);
                entry.conflict = None;
            }
        } else {
            entry.saved = Some(remote);
            entry.dirty = false;
        }
    }
}

fn valid_token(token: &str) -> bool {
    token.len() == 68
        && token.starts_with("ccn_")
        && token[4..].bytes().all(|b| b.is_ascii_hexdigit())
}
fn load_token() -> Result<Option<String>> {
    #[cfg(target_vendor = "apple")]
    {
        unsafe extern "C" {
            fn cross_canon_account_read(buffer: *mut std::ffi::c_char, capacity: usize) -> i32;
        }
        let mut buffer = [0u8; 256];
        // SAFETY: buffer is writable for the exact capacity passed to the bridge.
        let status = unsafe { cross_canon_account_read(buffer.as_mut_ptr().cast(), buffer.len()) };
        ensure!(status >= 0, "Keychain unavailable");
        if status == 0 {
            return Ok(None);
        }
        let token = std::ffi::CStr::from_bytes_until_nul(&buffer)?
            .to_str()?
            .to_owned();
        ensure!(valid_token(&token), "Invalid stored session");
        Ok(Some(token))
    }
    #[cfg(all(not(target_vendor = "apple"), not(target_arch = "wasm32")))]
    {
        Ok(None)
    }
    #[cfg(target_arch = "wasm32")]
    {
        Ok(Some("browser-session".into()))
    }
}
fn store_token(token: Option<&str>) -> Result<()> {
    #[cfg(target_vendor = "apple")]
    {
        unsafe extern "C" {
            fn cross_canon_account_write(token: *const std::ffi::c_char) -> i32;
        }
        let value = token.map(std::ffi::CString::new).transpose()?;
        // SAFETY: CString lives through this synchronous call; null means delete.
        ensure!(
            unsafe {
                cross_canon_account_write(value.as_ref().map_or(std::ptr::null(), |s| s.as_ptr()))
            } == 1,
            "Could not update Keychain"
        );
        Ok(())
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = token;
        Ok(())
    }
    #[cfg(all(not(target_vendor = "apple"), not(target_arch = "wasm32")))]
    {
        if token.is_some() {
            bail!("Persistent sign-in requires a system credential store");
        }
        Ok(())
    }
}
pub(super) fn browser(url: &str) -> Result<()> {
    #[cfg(target_vendor = "apple")]
    {
        unsafe extern "C" {
            fn cross_canon_account_browser(url: *const std::ffi::c_char) -> i32;
        }
        let url = std::ffi::CString::new(url)?;
        // SAFETY: invoked on the render/main thread; bridge copies the string.
        ensure!(
            unsafe { cross_canon_account_browser(url.as_ptr()) } == 1,
            "Could not open the sign-in browser"
        );
        Ok(())
    }
    #[cfg(target_arch = "wasm32")]
    {
        browser::open_url(url);
        Ok(())
    }
    #[cfg(all(not(target_vendor = "apple"), not(target_arch = "wasm32")))]
    {
        webbrowser::open(url)?;
        Ok(())
    }
}
pub(super) fn close_browser() {
    #[cfg(target_vendor = "apple")]
    {
        unsafe extern "C" {
            fn cross_canon_account_close_browser();
        }
        // SAFETY: invoked on the render/main thread.
        unsafe {
            cross_canon_account_close_browser();
        }
    }
}

impl Desktop {
    pub(super) fn account_tick(&mut self, ctx: &egui::Context) {
        self.account_tick_with_activity(ctx, mobile::activity(ctx));
    }
    fn account_tick_with_activity(&mut self, ctx: &egui::Context, activity: mobile::Activity) {
        self.account
            .observe_activity(activity, &self.state.location_passage_id);
        if self.account.saved.user.is_none() && !self.account.identity_changed {
            self.account.saved.guest = vec![
                self.state.location_passage_id.clone(),
                self.state.scripture_location.clone(),
                self.state.fathers_location.clone(),
                self.state.classics_location.clone(),
            ];
        }
        self.account.tick(ctx);
        if let Some(url) = self.account.open_browser.take() {
            if browser(&url).is_err() {
                self.account.status =
                    "Could not open the browser. Use Open sign-in browser below to retry.".into();
            }
        }
        if self.account.close_browser {
            close_browser();
            self.account.close_browser = false;
        }
        let mut resume = None;
        if let Some(profile) = self.account.profile() {
            for (key, state) in [
                ("scripture", &mut self.state.scripture_location),
                ("fathers", &mut self.state.fathers_location),
                ("classics", &mut self.state.classics_location),
            ] {
                let location = profile
                    .get(key)
                    .and_then(|p| p.saved.as_ref())
                    .and_then(|p| p.location.passage(&self.library));
                if let Some(id) = location {
                    *state = id.clone();
                    if key
                        == corpus_key(
                            self.library
                                .passage(&self.state.location_passage_id)
                                .unwrap()
                                .corpus,
                        )
                    {
                        resume = Some(id);
                    }
                } else if self.account.identity_changed {
                    state.clear();
                }
            }
        }
        let returned = self
            .account
            .resume
            .as_ref()
            .is_some_and(|(refresh, anchor)| {
                self.account.reader_active
                    && !self.playing
                    && self.account.received_refresh == Some(*refresh)
                    && anchor == &self.state.location_passage_id
                    && self
                        .account
                        .profile()
                        .and_then(|p| p.get(corpus_key(self.current_passage().corpus)))
                        .is_some_and(|p| !p.dirty && p.conflict.is_none())
            });
        if self.account.received_refresh
            == self.account.resume.as_ref().map(|(refresh, _)| *refresh)
        {
            self.account.resume = None;
        }
        if self.account.identity_changed || returned {
            self.account.persist_now = true;
            if self.account.saved.user.is_none() {
                let guest = &self.account.saved.guest;
                resume = guest.first().cloned();
                self.state.scripture_location = guest.get(1).cloned().unwrap_or_default();
                self.state.fathers_location = guest.get(2).cloned().unwrap_or_default();
                self.state.classics_location = guest.get(3).cloned().unwrap_or_default();
            }
            self.account.identity_changed = false;
            // Restore after sign-in or a fresh return-to-app sync, provided the
            // reader has not moved locally while the request was in flight.
            // Routine polling during active reading updates resume targets only.
            if let Some(id) = resume.filter(|id| self.library.passage(id).is_some()) {
                self.restore_location(id);
            }
        }
    }
    pub(super) fn account_sheet(&mut self, ctx: &egui::Context, insets: mobile::Insets) {
        let p = self.state.theme.palette();
        let compact = Self::compact(ctx);
        let width = (ctx.screen_rect().width() - insets.left - insets.right - 24.0).min(440.0);
        let desired_height = if self.account.saved.user.is_some() {
            270.0
        } else if self.account.login.is_some() {
            200.0
        } else {
            152.0
        };
        let height = (ctx.screen_rect().height() - insets.top - insets.bottom - 116.0)
            .clamp(80.0, desired_height);
        let response = egui::Modal::new(Id::new("account-sheet"))
            .area(egui::Modal::default_area(Id::new("account-sheet")).anchor(
                if compact {
                    Align2::CENTER_BOTTOM
                } else {
                    Align2::CENTER_CENTER
                },
                [
                    (insets.left - insets.right) / 2.0,
                    if compact { -insets.bottom - 12.0 } else { 0.0 },
                ],
            ))
            .frame(
                egui::Frame::window(&ctx.style())
                    .fill(p.panel)
                    .inner_margin(16.0)
                    .corner_radius(14.0)
                    .stroke(Stroke::new(1.0_f32, p.line)),
            )
            .show(ctx, |ui| {
                ui.set_width((width - 32.0).max(160.0));
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Your account").font(heading(20.0)).strong());
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if control(ui, "Close").clicked() {
                            self.dialog = None;
                        }
                    });
                });
                ui.add_space(8.0);
                touch_scroll::vertical(ui, "account-sheet-body", height, true, |ui, _| {
                    self.account_dialog(ui)
                });
            });
        if response.should_close() {
            self.dialog = None;
        }
    }
    pub(super) fn account_dialog(&mut self, ui: &mut egui::Ui) {
        ui.set_max_width(ui.available_width());
        if let Some(user) = self.account.saved.user.clone() {
            ui.label(RichText::new(&user.name).size(18.0).strong());
            ui.label(RichText::new(&user.email).small());
        } else {
            ui.label("Sign in to keep your place across devices.");
        }
        ui.add_space(8.0);
        if !self.account.status.is_empty() {
            ui.label(&self.account.status);
            ui.add_space(8.0);
        }
        if let Some(login) = self.account.login.clone() {
            if control(ui, "Reopen browser").clicked() {
                self.account.open_browser = Some(login.url);
            }
            if control(ui, "Cancel sign-in").clicked() {
                self.account.cancel_login();
            }
        } else if !self.account.signed_in() {
            if ui
                .add_enabled(
                    !self.account.busy && !self.account.saved.revoke_pending,
                    egui::Button::new("Continue with Google")
                        .min_size(egui::vec2(ui.available_width(), 44.0)),
                )
                .clicked()
            {
                self.account.sign_in(ui.ctx());
            }
            ui.add_space(6.0);
            ui.label(RichText::new("You can always read without an account.").small());
        }
        if self.account.saved.user.is_some() {
            if self.account.signed_in() && !self.account.persistent {
                ui.label("Sign-in could not be saved securely. Reopening the app will require sign-in again.");
            }
            ui.add_space(8.0);
            if control(ui, "Back to reading").clicked() {
                self.dialog = None;
            }
            if control(ui, "Sign out").clicked() {
                self.stop_audio();
                self.account.sign_out(ui.ctx());
            }
            let conflict = self
                .account
                .profile()
                .is_some_and(|p| p.values().any(|e| e.conflict.is_some()));
            egui::CollapsingHeader::new(if conflict {
                "Resolve reading progress"
            } else {
                "Reading progress"
            })
            .default_open(conflict)
            .show(ui, |ui| self.account_progress(ui));
        }
    }
    fn account_progress(&mut self, ui: &mut egui::Ui) {
        let profile = self.account.profile().cloned().unwrap_or_default();
        for (corpus, title) in
            CORPORA
                .into_iter()
                .zip(["Scripture", "Early Christian Works", "Christian Classics"])
        {
            ui.separator();
            ui.strong(title);
            let entry = profile.get(corpus);
            if let Some(progress) = entry.and_then(|e| e.saved.as_ref()) {
                if let Some(passage) = progress
                    .location
                    .passage(&self.library)
                    .and_then(|id| self.library.passage(&id))
                {
                    let id = passage.id.clone();
                    ui.label(format!("{} {}", passage.book, passage.chapter));
                    if control(ui, "Continue reading").clicked() {
                        self.open(id);
                    }
                } else {
                    ui.label("This saved place is not available in this app’s text library yet.");
                }
                if let Some(conflict) = entry.and_then(|e| e.conflict.as_ref()) {
                    ui.label("This device and another device have different saved places.");
                    if let Some(passage) = conflict
                        .location
                        .passage(&self.library)
                        .and_then(|id| self.library.passage(&id))
                    {
                        ui.label(format!(
                            "Other device: {} {}",
                            passage.book, passage.chapter
                        ));
                    }
                    if control(ui, "Use other device").clicked() {
                        self.account.resolve(corpus, false);
                    }
                    if control(ui, "Keep this device").clicked() {
                        self.account.resolve(corpus, true);
                    }
                }
            } else {
                ui.label("No saved place yet.");
            }
        }
        ui.add_space(12.0);
        ui.collapsing("Bring in progress from before sign-in", |ui| {
            ui.label("Copy this device’s guest reading places to your account. If another device has a place, you’ll choose which to keep.");
            if control(ui, "Bring in my progress").clicked() {
                let places = self.account.saved.guest.clone();
                for id in places.iter().skip(1).chain(places.first()) {
                    if let Some(p) = self.library.passage(id) { self.account.remember(p, &self.library); }
                }
                // Import is an explicit choice, but an existing cloud place
                // still requires choosing which location wins.
                if let Some(profile) = self.account.profile_mut() {
                    for entry in profile.values_mut().filter(|p| p.dirty) {
                        if let Some(saved) = &mut entry.saved { saved.revision = 0; }
                    }
                }
                self.account.force_sync();
            }
        });
        if control(ui, "Sync now").clicked() {
            if self.account.token.is_none() {
                self.account.restore_started = false;
            }
            self.account.force_sync();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn idle_sync_sleeps_until_its_deadline_and_workers_wake_on_completion() {
        let ctx = egui::Context::default();
        let mut account = Account::new(Saved::default());
        account.restore_started = true;
        account.token = Some("test-session".into());
        account.sync_origin = Some("http://127.0.0.1:9".into());
        let delay = |account: &mut Account| {
            // Settle egui's initial repaint requests before measuring tick's timer.
            let mut output = egui::FullOutput::default();
            for _ in 0..4 {
                output = ctx.run(egui::RawInput::default(), |ctx| account.tick(ctx));
            }
            output.viewport_output[&egui::ViewportId::ROOT].repaint_delay
        };
        let clean = delay(&mut account);
        assert!(
            clean > Duration::from_secs(29) && clean <= Duration::from_secs(30),
            "idle delay: {clean:?}"
        );
        account.saved.user = Some(User {
            id: "user".into(),
            name: "Reader".into(),
            email: "reader@example.com".into(),
        });
        account
            .saved
            .profiles
            .insert("user".into(), local("3", 1, true));
        let dirty = delay(&mut account);
        assert!(
            dirty > Duration::from_secs(1) && dirty <= Duration::from_secs(2),
            "dirty delay: {dirty:?}"
        );
        account.busy = true;
        assert_eq!(
            delay(&mut account),
            Duration::MAX,
            "worker completion already requests its own repaint"
        );
        account.busy = false;
        account
            .saved
            .profiles
            .insert("user".into(), local("3", 1, false));
        let mut output = egui::FullOutput::default();
        for _ in 0..4 {
            output = ctx.run(egui::RawInput::default(), |ctx| {
                account
                    .saved
                    .profiles
                    .insert("user".into(), local("3", 1, false));
                account.tick(ctx);
                // Reading can change after tick(), during rendering.
                account
                    .saved
                    .profiles
                    .insert("user".into(), local("4", 1, true));
                account.schedule_tick(ctx);
            });
        }
        assert!(
            output.viewport_output[&egui::ViewportId::ROOT].repaint_delay <= Duration::from_secs(2)
        );
        account.token = None;
        account.login = Some(pending_login());
        let expiry = delay(&mut account);
        assert!(expiry > Duration::from_secs(59) && expiry <= Duration::from_secs(60));
        account.login.as_mut().unwrap().ticket = Some("ticket".into());
        let login_poll = delay(&mut account);
        assert!(login_poll > Duration::from_secs(1) && login_poll <= Duration::from_secs(2));
    }
    fn pending_login() -> Login {
        Login {
            id: "1".repeat(64),
            secret: "2".repeat(64),
            url: format!("{ORIGIN}/account/native?id={}", "1".repeat(64)),
            expires_at: epoch_millis() + 60_000,
            ticket: None,
        }
    }
    #[test]
    fn sign_in_return_must_match_this_apps_pending_request() {
        let mut account = Account::new(Saved::default());
        account.login = Some(pending_login());
        let ticket = "3".repeat(64);
        assert!(account.receive_callback(&format!(
            "crosscanon://login-complete?request={}&ticket={ticket}",
            "4".repeat(64)
        )));
        assert!(account.login.as_ref().unwrap().ticket.is_none());
        assert!(account.receive_callback(&format!(
            "crosscanon://login-complete?request={}&ticket=invalid",
            "1".repeat(64)
        )));
        assert!(account.login.as_ref().unwrap().ticket.is_none());
        assert!(account.receive_callback(&format!(
            "crosscanon://login-complete?request={}&ticket={ticket}",
            "1".repeat(64)
        )));
        assert_eq!(
            account.login.as_ref().unwrap().ticket.as_deref(),
            Some(ticket.as_str())
        );
        assert!(!account.receive_callback("crosscanon://reader/a-passage"));
        let state = serde_json::to_string(&account.saved).unwrap();
        assert!(
            !state.contains(&ticket) && !state.contains(&"2".repeat(64)),
            "Return tickets and proofs must never enter saved reader state"
        );
    }
    #[test]
    fn account_primary_controls_fit_small_phones_without_scrolling() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library);
        for mode in ["guest", "pending", "signed-in"] {
            app.account = Account::new(Saved::default());
            let expected = match mode {
                "pending" => {
                    app.account.login = Some(pending_login());
                    app.account.status = "Finish signing in in your browser.".into();
                    vec!["Close", "Reopen browser", "Cancel sign-in"]
                }
                "signed-in" => {
                    app.account.saved.user = Some(User {
                        id: "alice".into(),
                        name: "Alex Reader".into(),
                        email: "alex@example.com".into(),
                    });
                    app.account.token = Some(format!("ccn_{}", "a".repeat(64)));
                    app.account.persistent = true;
                    app.account.status = "Your reading progress is up to date.".into();
                    vec!["Close", "Back to reading", "Sign out"]
                }
                _ => vec!["Close", "Continue with Google"],
            };
            for (width, height, top, bottom) in [
                (320.0, 568.0, 20.0, 0.0),
                (393.0, 852.0, 59.0, 34.0),
                (844.0, 390.0, 0.0, 21.0),
            ] {
                for frame in 0..4 {
                    let output = ctx.run(
                        egui::RawInput {
                            screen_rect: Some(Rect::from_min_size(
                                egui::Pos2::ZERO,
                                egui::vec2(width, height),
                            )),
                            ..Default::default()
                        },
                        |ctx| {
                            app.account_sheet(
                                ctx,
                                mobile::Insets {
                                    top,
                                    bottom,
                                    ..Default::default()
                                },
                            )
                        },
                    );
                    if frame != 3 {
                        continue;
                    }
                    let mut seen = Vec::new();
                    for shape in &output.shapes {
                        if let egui::epaint::Shape::Text(text) = &shape.shape {
                            if expected.contains(&text.galley.job.text.as_str()) {
                                let bounds = Rect::from_min_size(text.pos, text.galley.size());
                                assert!(bounds.left() >= 8.0 && bounds.right() <= width - 8.0 && bounds.top() >= top + 8.0 && bounds.bottom() <= height - bottom - 8.0,
                                    "{mode}: {} must be visible without scrolling at {width}x{height}: {bounds:?}", text.galley.job.text);
                                assert!(
                                    shape.clip_rect.contains_rect(bounds),
                                    "{mode} {} must not be clipped at {width}x{height}: bounds {bounds:?}, clip {:?}", text.galley.job.text, shape.clip_rect
                                );
                                seen.push(text.galley.job.text.clone());
                            }
                            assert!(
                                !text.galley.job.text.contains("same code"),
                                "Sign-in must not show manual pairing codes"
                            );
                        }
                    }
                    for label in &expected {
                        assert!(
                            seen.iter().any(|text| text == label),
                            "{mode}: {label} missing from account sheet at {width}x{height}"
                        );
                    }
                }
            }
        }
    }
    fn location(chapter: &str) -> Location {
        Location {
            version: 2,
            corpus: "scripture".into(),
            chapter_key: format!("John\t{chapter}"),
            passage_key: None,
            passage_range: None,
        }
    }
    fn progress(chapter: &str, revision: u64) -> Progress {
        Progress {
            location: location(chapter),
            revision,
        }
    }
    fn local(chapter: &str, revision: u64, dirty: bool) -> BTreeMap<String, LocalProgress> {
        BTreeMap::from([(
            "scripture".into(),
            LocalProgress {
                saved: Some(progress(chapter, revision)),
                dirty,
                conflict: None,
            },
        )])
    }
    #[test]
    fn offline_queue_keeps_conflicts_and_new_reading_during_upload() {
        let mut state = local("4", 2, true);
        reconcile(
            &mut state,
            BTreeMap::from([("scripture".into(), progress("5", 3))]),
            BTreeMap::new(),
        );
        let entry = &state["scripture"];
        assert_eq!(entry.saved.as_ref().unwrap().location, location("4"));
        assert_eq!(entry.conflict.as_ref().unwrap().location, location("5"));
        let mut account = Account::new(Saved {
            user: Some(User {
                id: "alice".into(),
                name: "Alice".into(),
                email: "alice@example.com".into(),
            }),
            ..Default::default()
        });
        account.saved.profiles.insert("alice".into(), state);
        account.resolve("scripture", true);
        let mut state = account.profile().unwrap().clone();
        assert!(state["scripture"].dirty);
        assert_eq!(state["scripture"].saved.as_ref().unwrap().revision, 3);
        // While John's fourth Chapter uploads, reading advances to Chapter six.
        state
            .get_mut("scripture")
            .unwrap()
            .saved
            .as_mut()
            .unwrap()
            .location = location("6");
        let uploaded = BTreeMap::from([("scripture".into(), progress("4", 4))]);
        reconcile(&mut state, uploaded.clone(), uploaded);
        assert_eq!(
            state["scripture"].saved.as_ref().unwrap().location,
            location("6")
        );
        assert_eq!(state["scripture"].saved.as_ref().unwrap().revision, 4);
        assert!(state["scripture"].dirty);
        assert!(state["scripture"].conflict.is_none());
    }
    #[test]
    fn accounts_keep_separate_queues_and_never_serialize_credentials() {
        let mut account = Account::new(Saved::default());
        account.token = Some(format!("ccn_{}", "a".repeat(64)));
        account.saved.user = Some(User {
            id: "alice".into(),
            name: "Alice".into(),
            email: "alice@example.com".into(),
        });
        account
            .saved
            .profiles
            .insert("alice".into(), local("4", 2, true));
        account
            .saved
            .profiles
            .insert("bob".into(), local("8", 9, false));
        let serialized = serde_json::to_string(&account.saved).unwrap();
        assert!(!serialized.contains("ccn_"));
        let restored: Saved = serde_json::from_str(&serialized).unwrap();
        let mut account = Account::new(restored);
        assert!(account.token.is_none());
        account.saved.user.as_mut().unwrap().id = "bob".into();
        assert_eq!(
            account.profile().unwrap()["scripture"]
                .saved
                .as_ref()
                .unwrap()
                .location,
            location("8")
        );
        account.saved.user.as_mut().unwrap().id = "alice".into();
        assert!(account.profile().unwrap()["scripture"].dirty);
    }
    #[test]
    fn web_and_native_locations_round_trip_all_collections() {
        let library =
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
        for (book, chapter) in [("John", 2), ("anf09:xii.iv", 3), ("classics:imitation", 1)] {
            let chapter = &library.book(book).unwrap().chapters[chapter];
            let id = chapter.passage_ids.last().unwrap();
            let passage = library.passage(id).unwrap();
            let native = Location::from_passage(passage);
            assert_eq!(native.passage(&library), Some(id.clone()));
            let mut web_chapter = native.clone();
            web_chapter.passage_key = None;
            web_chapter.passage_range = None;
            assert_eq!(
                web_chapter.passage(&library),
                chapter.passage_ids.first().cloned()
            );
            let value = serde_json::to_value(&native).unwrap();
            assert_eq!(value["version"], 2);
            assert_eq!(value["corpus"], corpus_key(passage.corpus));
        }
        let mut forged = location("3");
        forged.passage_key =
            Some(library.book("classics:imitation").unwrap().chapters[0].passage_ids[0].clone());
        assert_eq!(
            library
                .passage(&forged.passage(&library).unwrap())
                .unwrap()
                .corpus,
            Corpus::Scripture
        );
    }
    #[test]
    fn native_transport_sends_bearer_only_and_respects_server_revision_conflicts() {
        use std::{
            io::{BufRead, Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let token = format!("ccn_{}", "a".repeat(64));
        let expected_token = token.clone();
        let server = std::thread::spawn(move || {
            for index in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = std::io::BufReader::new(&socket);
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line);
                }
                let lower = headers.to_ascii_lowercase();
                assert!(lower.contains(&format!("authorization: bearer {expected_token}")));
                assert!(!lower.contains("cookie:"));
                let (status, body) = if index == 0 {
                    assert!(headers.starts_with("GET /api/account "));
                    (
                        "200 OK",
                        serde_json::json!({"user":{"id":"alice","name":"Alice","email":"alice@example.com"},"progress":{"scripture":progress("3", 2)}}),
                    )
                } else {
                    assert!(headers.starts_with("POST /api/account "));
                    let length: usize = lower
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    let mut bytes = vec![0; length];
                    reader.read_exact(&mut bytes).unwrap();
                    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                    assert_eq!(body["revision"], 2);
                    assert_eq!(
                        body["location"],
                        serde_json::to_value(location("4")).unwrap()
                    );
                    (
                        "409 Conflict",
                        serde_json::json!({"saved":false,"progress":progress("5", 3)}),
                    )
                };
                let body = body.to_string();
                write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let output = sync(&origin, &token, Some("alice"), local("4", 2, true)).unwrap();
        assert!(output.uploaded.is_empty());
        assert_eq!(output.account.progress["scripture"].location, location("5"));
        server.join().unwrap();
    }
    #[test]
    fn returning_to_native_reader_restores_newer_web_chapter() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let chapter_two = location("2").passage(&library).unwrap();
        app.open(chapter_two);
        app.account.saved.user = Some(User {
            id: "alice".into(),
            name: "Alice".into(),
            email: "alice@example.com".into(),
        });
        app.account
            .saved
            .profiles
            .insert("alice".into(), local("2", 2, false));
        // The phone's chapter two has already reached the web. Leave the app,
        // advance the web reader to chapter three, then return to the phone.
        for focused in [true, false, true] {
            let _ = ctx.run(
                egui::RawInput {
                    focused,
                    ..Default::default()
                },
                |ctx| app.account_tick(ctx),
            );
        }
        app.account
            .tx
            .send((
                app.account.generation,
                Event::Synced(
                    app.account.refresh_generation,
                    Ok(SyncOutput {
                        account: AccountResponse {
                            user: app.account.saved.user.clone(),
                            progress: BTreeMap::from([("scripture".into(), progress("3", 3))]),
                        },
                        uploaded: BTreeMap::new(),
                    }),
                ),
            ))
            .unwrap();
        let _ = ctx.run(egui::RawInput::default(), |ctx| app.account_tick(ctx));
        assert_eq!(
            app.current_passage().chapter,
            3,
            "Returning to the phone must show the newer web chapter, not chapter two"
        );
        assert!(!app.account.profile().unwrap()["scripture"].dirty);
    }
    #[test]
    fn ios_return_fetches_and_displays_web_progress_through_real_transport() {
        use std::{
            io::{BufRead, Write},
            net::TcpListener,
        };
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < deadline,
                            "Returning to iOS never fetched web progress"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = std::io::BufReader::new(&socket);
            let mut request = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                request.push_str(&line);
            }
            assert!(request.starts_with("GET /api/account "));
            assert!(request
                .to_lowercase()
                .contains("authorization: bearer ccn_"));
            let body = serde_json::json!({
                "user": {"id":"alice", "name":"Alice", "email":"alice@example.com"},
                "progress": {"scripture":progress("3", 3)},
            })
            .to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        app.open(location("2").passage(&library).unwrap());
        app.account.saved.user = Some(User {
            id: "alice".into(),
            name: "Alice".into(),
            email: "alice@example.com".into(),
        });
        app.account
            .saved
            .profiles
            .insert("alice".into(), local("2", 2, false));
        app.account.token = Some(format!("ccn_{}", "a".repeat(64)));
        app.account.sync_origin = Some(origin);
        app.account.reader_active = true;
        app.account.foreground_generation = 1;
        // The last successful sync was recent. A new UIKit activation must
        // bypass the normal twenty-second interval and fetch chapter three.
        app.account.last_request = Instant::now();
        let deadline = Instant::now() + Duration::from_secs(5);
        while app.current_passage().chapter != 3 && Instant::now() < deadline {
            let _ = ctx.run(egui::RawInput::default(), |ctx| {
                app.account_tick_with_activity(
                    ctx,
                    mobile::Activity {
                        generation: 2,
                        active: 1,
                    },
                );
            });
            std::thread::sleep(Duration::from_millis(5));
        }
        server.join().unwrap();
        assert_eq!(app.current_passage().chapter, 3);
        assert!(!app.account.profile().unwrap()["scripture"].dirty);
    }
    #[test]
    fn ios_activation_refreshes_each_collection_without_an_inactive_frame() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for book in ["John", "anf09:xii.iv", "classics:imitation"] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            let chapters = &library.book(book).unwrap().chapters;
            let old = library.passage(&chapters[1].passage_ids[0]).unwrap();
            let new = library.passage(&chapters[2].passage_ids[0]).unwrap();
            let corpus = corpus_key(old.corpus);
            app.open(old.id.clone());
            app.account.saved.user = Some(User {
                id: "alice".into(),
                name: "Alice".into(),
                email: "alice@example.com".into(),
            });
            app.account.saved.profiles.insert(
                "alice".into(),
                BTreeMap::from([(
                    corpus.into(),
                    LocalProgress {
                        saved: Some(Progress {
                            location: Location::from_passage(old),
                            revision: 2,
                        }),
                        ..Default::default()
                    },
                )]),
            );
            let tick = |app: &mut Desktop, generation| {
                let _ = ctx.run(egui::RawInput::default(), |ctx| {
                    app.account_tick_with_activity(
                        ctx,
                        mobile::Activity {
                            generation,
                            active: 1,
                        },
                    );
                });
            };
            tick(&mut app, 1);
            let old_refresh = app.account.refresh_generation;
            app.account.last_request = Instant::now();
            // UIKit activates again; winit never delivered an unfocused frame.
            tick(&mut app, 2);
            assert!(
                app.account.last_request.elapsed() >= Duration::from_secs(20),
                "Returning must refresh immediately rather than wait for the polling interval"
            );
            let fresh = app.account.refresh_generation;
            assert!(fresh > old_refresh);
            let deliver = |app: &mut Desktop, refresh, passage: &Passage, revision| {
                app.account
                    .tx
                    .send((
                        app.account.generation,
                        Event::Synced(
                            refresh,
                            Ok(SyncOutput {
                                account: AccountResponse {
                                    user: app.account.saved.user.clone(),
                                    progress: BTreeMap::from([(
                                        corpus.into(),
                                        Progress {
                                            location: Location::from_passage(passage),
                                            revision,
                                        },
                                    )]),
                                },
                                uploaded: BTreeMap::new(),
                            }),
                        ),
                    ))
                    .unwrap();
            };
            // A request begun before the return cannot decide the resume target.
            deliver(&mut app, old_refresh, new, 3);
            tick(&mut app, 2);
            assert_eq!(app.state.location_passage_id, old.id);
            assert!(app.account.resume.is_some());
            deliver(&mut app, fresh, new, 3);
            tick(&mut app, 2);
            assert_eq!(app.state.location_passage_id, new.id);
            assert_eq!(app.scroll_target.as_deref(), Some(new.id.as_str()));
            assert!(!app.account.profile().unwrap()[corpus].dirty);
            // Once resumed, ordinary polling must not interrupt active reading.
            deliver(&mut app, fresh, old, 4);
            tick(&mut app, 2);
            assert_eq!(app.state.location_passage_id, new.id);
        }
    }
    #[test]
    fn resume_sync_preserves_unsynced_reading_and_audio() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for mode in ["offline", "moved-during-request", "audio"] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.open(location("2").passage(&library).unwrap());
            app.account.saved.user = Some(User {
                id: "alice".into(),
                name: "Alice".into(),
                email: "alice@example.com".into(),
            });
            app.account
                .saved
                .profiles
                .insert("alice".into(), local("2", 2, false));
            let _ = ctx.run(egui::RawInput::default(), |ctx| app.account_tick(ctx));
            let fresh = app.account.refresh_generation;
            if mode == "audio" {
                app.playing = true;
            } else {
                app.open(location("4").passage(&library).unwrap());
                if mode == "offline" {
                    // Local progress existed before the return as well.
                    app.account.resume = None;
                    app.account.reader_active = false;
                    let _ = ctx.run(egui::RawInput::default(), |ctx| app.account_tick(ctx));
                }
            }
            let refresh = if mode == "offline" {
                app.account.refresh_generation
            } else {
                fresh
            };
            app.account
                .tx
                .send((
                    app.account.generation,
                    Event::Synced(
                        refresh,
                        Ok(SyncOutput {
                            account: AccountResponse {
                                user: app.account.saved.user.clone(),
                                progress: BTreeMap::from([("scripture".into(), progress("3", 3))]),
                            },
                            uploaded: BTreeMap::new(),
                        }),
                    ),
                ))
                .unwrap();
            let _ = ctx.run(egui::RawInput::default(), |ctx| app.account_tick(ctx));
            assert_eq!(
                app.current_passage().chapter,
                if mode == "audio" { 2 } else { 4 }
            );
            let entry = &app.account.profile().unwrap()["scripture"];
            if mode != "audio" {
                assert!(entry.dirty);
                assert_eq!(entry.conflict.as_ref().unwrap().location, location("3"));
            }
        }
    }
    #[test]
    fn account_dialog_fits_phone_and_desktop_and_sign_out_restores_guest() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let guest = library.book("John").unwrap().chapters[2].passage_ids[0].clone();
        app.open(guest.clone());
        app.account_tick(&ctx);
        app.account.saved.user = Some(User {
            id: "alice".into(),
            name: "Alice".into(),
            email: "alice@example.com".into(),
        });
        app.account
            .saved
            .profiles
            .insert("alice".into(), local("5", 3, false));
        app.account.identity_changed = true;
        app.account_tick(&ctx);
        assert_eq!(app.current_passage().chapter, 5);
        app.dialog = Some(Dialog::Account);
        for width in [320.0, 393.0, 1100.0] {
            for frame in 0..3 {
                let output = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(Rect::from_min_size(
                            egui::Pos2::ZERO,
                            egui::vec2(width, 852.0),
                        )),
                        ..Default::default()
                    },
                    |ctx| app.render(ctx),
                );
                let text = output
                    .shapes
                    .iter()
                    .filter_map(|shape| match &shape.shape {
                        egui::epaint::Shape::Text(t) => Some(t.galley.job.text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                if frame == 2 {
                    assert!(
                        text.contains("Your account") || text.contains("Your reading, together"),
                        "Account dialog content missing at width {width}: {text}"
                    );
                    for shape in &output.shapes {
                        if let egui::epaint::Shape::Text(text) = &shape.shape {
                            if text.galley.job.text.starts_with("Keep your place") {
                                assert!(text.pos.x + text.galley.size().x <= width - 8.0,
                                    "Account instructions must wrap inside a {width}-point viewport");
                            }
                        }
                    }
                }
            }
        }
        // A routine remote update changes the resume target, not an open view.
        app.account
            .saved
            .profiles
            .insert("alice".into(), local("8", 4, false));
        app.account_tick(&ctx);
        assert_eq!(app.current_passage().chapter, 5);
        app.account.sign_out(&ctx);
        app.account_tick(&ctx);
        assert_eq!(app.state.location_passage_id, guest);
        assert!(app.account.saved.profiles.contains_key("alice"));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod narration_entry_tests {
    use super::*;
    use std::io::{Read, Write};
    fn wait_until(mut check: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !check() {
            assert!(std::time::Instant::now() < deadline,"Narration worker did not complete");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn read_request(stream: &mut std::net::TcpStream) -> String {
        stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut data = vec![];
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap(); assert!(count > 0);
            data.extend_from_slice(&buffer[..count]);
            if let Some(header_end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&data[..header_end]).to_lowercase();
                let length = headers.lines().find_map(|line| line.strip_prefix("content-length:").and_then(|s| s.trim().parse::<usize>().ok())).unwrap_or(0);
                if data.len() >= header_end + 4 + length { break; }
            }
        }
        String::from_utf8(data).unwrap()
    }
    fn reply(stream: &mut std::net::TcpStream, value: serde_json::Value) {
        let body = value.to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    }
    #[test]
    fn real_play_entry_preserves_recordings_and_owner_units_stop_on_account_change() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}",listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream,_) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert!(request.starts_with("GET /api/narration/capabilities "));
            assert!(request.to_lowercase().contains("authorization: bearer private-test-session"));
            reply(&mut stream,serde_json::json!({"enabled":true}));
            let (mut stream,_) = listener.accept().unwrap();
            let request = read_request(&mut stream);
            assert!(request.starts_with("POST /api/narration/plan "));
            let body:serde_json::Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
            assert_eq!(body,serde_json::json!({"chapterId":"anf03:vi.iv.i","version":"modernized"}));
            let units = ["a","b"].map(|letter| {let id=letter.repeat(64);serde_json::json!({"id":id,"url":format!("/api/narration/audio/{id}"),"title":"On Prayer 1"})});
            reply(&mut stream,serde_json::json!({"chapterId":"anf03:vi.iv.i","version":"modernized","units":units}));
        });
        let library=Arc::new(Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap());
        let ctx=egui::Context::default();
        let mut app=Desktop::initialize(&ctx,None,library.clone());
        let (tx,rx)=mpsc::channel();app.audio_tx=Arc::new(tx);
        // Non-owner/default paths retain their existing recording and offsets.
        app.play_audio("John:3");
        let audio::Command::Play(recorded)=rx.try_recv().unwrap() else {panic!("Missing original recording")};
        assert!(recorded.private_token.is_none());
        let expected = downloads::PlaybackSources::new(&library.root).resolve(&reading_translation::Translation::Web.audio(&library,"John:3").unwrap().url);
        assert_eq!(recorded.chapters[recorded.index].audio.url,expected);
        app.stop_audio();let _=rx.try_recv();
        app.account.saved.user=Some(User {id:"private-owner".into(),name:"Test Reader".into(),email:"reader@example.test".into()});
        app.account.token=Some("private-test-session".into());app.account.sync_origin=Some(origin.clone());
        wait_until(|| {app.narration_tick(&ctx);app.narration.enabled});
        assert!(app.narration.selected());
        assert_eq!(app.audio_label(),"Play AI narration");
        app.set_original_view(true);
        let chapter = &library.chapter("anf03:vi.iv.i").unwrap().1;
        let on_prayer = library.passage(&chapter.passage_ids[0]).unwrap();
        assert!(on_prayer.reader_text(app.state.original).contains("a new breadth be sewn"));
        assert_eq!(app.narration_version("anf03:vi.iv.i"),"modernized");
        let location = app.state.location_passage_id.clone();
        let search_position = app.search_scroll;
        app.play_audio("anf03:vi.iv.i");
        assert!(app.narration.waiting());
        app.set_original_view(false);
        assert!(on_prayer.reader_text(app.state.original).contains("a new piece of cloth be sewn"));
        app.set_original_view(true);
        assert!(app.narration.waiting());
        assert_eq!(app.audio_chapter.as_deref(),Some("anf03:vi.iv.i"));
        assert!(rx.try_recv().is_err(),"Visual toggle must not stop or restart a pending narration");
        assert_eq!(app.state.location_passage_id,location);
        assert_eq!(app.search_scroll,search_position);
        wait_until(|| {app.narration_tick(&ctx);!app.narration.waiting()});
        let audio::Command::Play(plan)=rx.try_recv().unwrap() else {panic!("Missing AI units")};
        assert_eq!(plan.chapters.len(),2);assert_eq!(plan.index,0);
        assert_eq!(plan.private_token.as_deref(),Some("private-test-session"));
        assert!(plan.chapters.iter().all(|c| c.id=="anf03:vi.iv.i" && c.fallback.is_none() && c.audio.url.starts_with(&origin) && c.title.ends_with("AI narration")));
        // AI Play describes the selected chapter, not a different chapter still
        // playing in the background. Merely navigating never requests speech.
        app.playing=true;
        app.set_original_view(false);
        assert!(app.playing);
        app.set_original_view(true);
        assert!(app.playing);
        assert_eq!(app.audio_chapter.as_deref(),Some("anf03:vi.iv.i"));
        assert!(rx.try_recv().is_err(),"Visual toggle must not stop or restart playing narration");
        app.playing=false;
        app.set_original_view(false);
        app.set_original_view(true);
        assert!(!app.playing);
        assert_eq!(app.audio_chapter.as_deref(),Some("anf03:vi.iv.i"));
        assert!(rx.try_recv().is_err(),"Visual toggle must preserve paused narration");
        app.state.scripture_translation=reading_translation::Translation::Msb;
        assert_eq!(app.narration_version("John:3"),"msb");
        app.state.scripture_translation=reading_translation::Translation::Web;
        assert_eq!(app.narration_version("John:3"),"web");
        app.playing=true;
        app.active_chapter_id="anf03:vi.iv.i".into();
        assert_eq!(app.audio_label(),"Pause AI narration");
        app.active_chapter_id="anf03:vi.iv.ii".into();
        assert_eq!(app.audio_label(),"Play AI narration");
        assert!(!app.audio_control_playing("anf03:vi.iv.ii"));
        app.active_chapter_id="anf03:vi.iv.i".into();
        app.audio_failed("AI narration unavailable. Tap Play to retry.".into());
        assert_eq!(app.audio_chapter.as_deref(),Some("anf03:vi.iv.i"));
        // Retry remains an adapter command at its retained unit; no fresh plan.
        app.play_audio("anf03:vi.iv.i");assert!(matches!(rx.try_recv(),Ok(audio::Command::Toggle)));
        app.play_audio("anf03:vi.iv.ii");
        assert!(matches!(rx.try_recv(),Ok(audio::Command::StopForNarrationChapter(chapter)) if chapter == "anf03:vi.iv.ii"));
        assert!(app.narration.waiting());
        app.select_audio_source(true);assert!(matches!(rx.try_recv(),Ok(audio::Command::Stop)));
        app.play_audio("John:3");
        let audio::Command::Play(recorded)=rx.try_recv().unwrap() else {panic!("Missing chosen recorded audio")};
        assert!(recorded.private_token.is_none());
        app.select_audio_source(false);let _=rx.try_recv();
        app.audio_private=true;app.audio_chapter=Some("anf03:vi.iv.i".into());
        app.account.saved.user=None;
        app.narration_tick(&ctx);
        assert!(matches!(rx.try_recv(),Ok(audio::Command::Stop)));
        assert!(!app.narration.enabled);assert!(!app.audio_private);assert!(app.audio_chapter.is_none());
        server.join().unwrap();
    }
}
