//! Owner narration is a server capability, never an email check in the reader.
//! Plans contain canonical unit URLs and an explicit, cancellable chapter build.
//! Playback fetches one unit at a time while the server assembles verified units;
//! completed chapters replay as one private file without starting generation.
use super::*;
use anyhow::{bail, ensure};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Credentials {
    user: String,
    token: String,
    origin: String,
}
impl From<(String, String, String)> for Credentials {
    fn from((user, token, origin): (String, String, String)) -> Self {
        Self {
            user,
            token,
            origin,
        }
    }
}
#[derive(Deserialize)]
struct Capability {
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    chapter_id: String,
    version: String,
    units: Vec<Unit>,
    #[serde(default)]
    job: Option<Job>,
    #[serde(default)]
    completed_chapter: Option<Unit>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    start_url: String,
    cancel_url: String,
    status_url: String,
}
impl Job {
    fn validate(&self) -> Result<()> {
        ensure!(
            valid_id(&self.id)
                && self.start_url == format!("/api/narration/jobs/{}/start", self.id)
                && self.cancel_url == format!("/api/narration/jobs/{}/cancel", self.id)
                && self.status_url == format!("/api/narration/jobs/{}", self.id),
            "Invalid narration build address"
        );
        Ok(())
    }
}
fn valid_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
// This session exists before the metadata request, so Stop can invalidate a
// pending plan. Registering the job and cancellation share one lock; the server
// tombstones an intent even if cancel arrives before its matching start.
struct BuildSession {
    credentials: Credentials,
    intent: String,
    cancelled: AtomicBool,
    job: Mutex<Option<Job>>,
}
impl BuildSession {
    fn new(credentials: Credentials) -> Result<Arc<Self>> {
        let mut random = [0; 16];
        platform::random_bytes(&mut random)?;
        Ok(Arc::new(Self {
            credentials,
            intent: random.iter().map(|byte| format!("{byte:02x}")).collect(),
            cancelled: AtomicBool::new(false),
            job: Mutex::new(None),
        }))
    }
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let job = self.job.lock().unwrap().clone();
        if let Some(job) = job {
            let credentials = self.credentials.clone();
            let intent = self.intent.clone();
            platform::spawn(async move {
                let _ = build_request(&credentials, &job.cancel_url, &intent).await;
            });
        }
    }
    async fn start(&self, job: Job) -> Result<()> {
        job.validate()?;
        *self.job.lock().unwrap() = Some(job.clone());
        ensure!(!self.cancelled.load(Ordering::SeqCst), "Narration stopped");
        build_request(&self.credentials, &job.start_url, &self.intent).await?;
        ensure!(!self.cancelled.load(Ordering::SeqCst), "Narration stopped");
        Ok(())
    }
}
async fn build_request(credentials: &Credentials, path: &str, intent: &str) -> Result<()> {
    let client = platform::http_client(Duration::from_secs(30))?;
    platform::authenticated(
        client.post(format!("{}{}", credentials.origin, path)),
        &credentials.token,
    )
    .json(&serde_json::json!({"intent":intent}))
    .send()
    .await?
    .error_for_status()?;
    Ok(())
}

pub(super) enum PlaybackAction {
    Play(audio::PlaybackPlan),
    Retry(Result<()>),
}
#[derive(Deserialize)]
struct Unit {
    id: String,
    url: String,
    title: String,
}

enum Event {
    Capability(Result<Capability>),
    Plan(String, String, Result<Plan>),
    Retry(Result<()>),
}

pub(super) struct Narration {
    credentials: Option<Credentials>,
    generation: u64,
    tx: Sender<(u64, Event)>,
    rx: Receiver<(u64, Event)>,
    checked: Option<Instant>,
    context: egui::Context,
    pub enabled: bool,
    pub recorded: bool,
    pub active: bool,
    pending: Option<(String, String)>,
    wants_play: bool,
    ready: Option<(String, audio::PlaybackPlan)>,
    build: Option<Arc<BuildSession>>,
    retrying: bool,
    failed: bool,
}
impl Default for Narration {
    fn default() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            credentials: None,
            generation: 0,
            tx,
            rx,
            checked: None,
            enabled: false,
            recorded: false,
            active: false,
            pending: None,
            context: Default::default(),
            wants_play: false,
            ready: None,
            build: None,
            retrying: false,
            failed: false,
        }
    }
}
impl Narration {
    pub fn selected(&self) -> bool {
        self.enabled && !self.recorded
    }
    pub fn waiting(&self) -> bool {
        self.pending.is_some() || self.retrying
    }
    pub fn has_session(&self) -> bool {
        self.active || self.waiting() || self.ready.is_some() || self.build.is_some()
    }
    pub fn waiting_to_play(&self) -> bool {
        self.waiting() && self.wants_play
    }
    fn waiting_to_play_for(&self, chapter: &str) -> bool {
        self.wants_play
            && (self.retrying || self.pending.as_ref().is_some_and(|(id, _)| id == chapter))
    }
    fn run(&self, ctx: &egui::Context, job: impl platform::Task<Output = Event>) {
        let tx = self.tx.clone();
        let generation = self.generation;
        let ctx = ctx.clone();
        platform::spawn(async move {
            let _ = tx.send((generation, job.await));
            ctx.request_repaint();
        });
    }
    fn cancel(&mut self) {
        if let Some(build) = self.build.take() {
            build.cancel();
        }
        self.generation += 1;
        self.retrying = false;
        self.failed = false;
        self.pending = None;
        self.ready = None;
        self.wants_play = false;
        self.active = false;
    }
    pub fn stop(&mut self) {
        self.cancel();
    }
    pub fn tick(
        &mut self,
        ctx: &egui::Context,
        credentials: Option<(String, String, String)>,
    ) -> (bool, Option<Result<PlaybackAction>>) {
        self.context = ctx.clone();
        // Private narration currently has authenticated Apple and browser media
        // adapters. Other native targets keep their existing recorded playback.
        #[cfg(all(not(target_vendor = "apple"), not(target_arch = "wasm32"), not(test)))]
        let credentials: Option<(String, String, String)> = {
            let _ = credentials;
            None
        };
        let credentials = credentials.map(Credentials::from);
        let mut changed = self.credentials != credentials;
        if changed {
            self.cancel();
            self.credentials = credentials;
            self.enabled = false;
            self.recorded = false;
            self.checked = None;
        }
        if self.credentials.is_some()
            && self
                .checked
                .is_none_or(|time| time.elapsed() > Duration::from_secs(60))
        {
            let credentials = self.credentials.clone().unwrap();
            self.checked = Some(Instant::now());
            self.run(ctx, async move {
                Event::Capability(
                    async {
                        let client = platform::http_client(Duration::from_secs(15))?;
                        Ok(platform::authenticated(
                            client
                                .get(format!("{}/api/narration/capabilities", credentials.origin)),
                            &credentials.token,
                        )
                        .send()
                        .await?
                        .error_for_status()?
                        .json()
                        .await?)
                    }
                    .await,
                )
            });
        }
        let mut output = None;
        while let Ok((generation, event)) = self.rx.try_recv() {
            if generation != self.generation {
                continue;
            }
            match event {
                Event::Capability(Ok(capability)) => {
                    if self.enabled && !capability.enabled {
                        self.cancel();
                        changed = true;
                    }
                    self.enabled = capability.enabled;
                }
                Event::Retry(result) => {
                    self.retrying = false;
                    self.failed = result.is_err();
                    if self.wants_play {
                        output = Some(Ok(PlaybackAction::Retry(result)));
                    }
                }
                Event::Capability(Err(_)) => {} // Existing recorded audio remains usable offline.
                Event::Plan(chapter, version, result) => {
                    if self.pending.as_ref() != Some(&(chapter.clone(), version.clone())) {
                        continue;
                    }
                    self.pending = None;
                    let result = result.and_then(|plan| {
                        playback_plan(plan, &chapter, &version, self.credentials.as_ref().unwrap())
                    });
                    match result {
                        Ok(plan) if !self.wants_play => self.ready = Some((version, plan)),
                        other => output = Some(other.map(PlaybackAction::Play)),
                    }
                }
            }
        }
        (changed, output)
    }
    pub fn play(&mut self, chapter: &str, version: &str) -> Option<audio::PlaybackPlan> {
        if self.retrying {
            self.wants_play = !self.wants_play;
            return None;
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|(c, v)| c == chapter && v == version)
        {
            self.wants_play = !self.wants_play;
            return None;
        }
        if let Some((ready_version, plan)) = self.ready.take() {
            if ready_version == version && plan.chapters.first().is_some_and(|c| c.id == chapter) {
                self.wants_play = true;
                return Some(plan);
            }
        }
        self.cancel();
        let Some(credentials) = self.credentials.clone() else {
            return None;
        };
        let Ok(build) = BuildSession::new(credentials.clone()) else {
            return None;
        };
        self.build = Some(build.clone());
        self.pending = Some((chapter.into(), version.into()));
        self.wants_play = true;
        let chapter = chapter.to_string();
        let version = version.to_string();
        self.run(&self.context, async move {
            let result = async {
                let client = platform::http_client(Duration::from_secs(30))?;
                let response = platform::authenticated(client.post(format!("{}/api/narration/plan",credentials.origin)), &credentials.token)
                    .json(&serde_json::json!({"chapterId":chapter,"version":version})).send().await?;
                if !response.status().is_success() {
                    let status = response.status();
                    // Never echo private URLs, credentials, provider errors or text.
                    bail!(match status.as_u16() {
                        401|403 => "AI narration is unavailable for this account. Sign in again or choose Recorded audio.",
                        400|404|422 => "AI narration is unavailable for this text version. Choose Recorded audio when available.",
                        429 => "AI narration limit reached. Try again later or choose Recorded audio.",
                        _ => "AI narration could not load. Tap Play to retry.",
                    });
                }
                let plan = response.json::<Plan>().await?;
                // Validate all private addresses before a server build can start.
                playback_plan_ref(&plan, &chapter, &version)?;
                if plan.completed_chapter.is_none() {
                    if let Some(job) = plan.job.clone() { build.start(job).await?; }
                }
                Ok(plan)
            }.await;
            Event::Plan(chapter,version,result)
        });
        None
    }
    // Only a manual Play after a playback failure may resume a failed or
    // budget-limited build. Ordinary Pause/resume leaves generation alone.
    pub fn retry_build(&mut self) -> bool {
        if !self.failed {
            return false;
        }
        if self.retrying {
            return true;
        }
        let Some(previous) = self.build.as_ref() else {
            return false;
        };
        let Some(job) = previous.job.lock().unwrap().clone() else {
            return false;
        };
        let Ok(build) = BuildSession::new(previous.credentials.clone()) else {
            return false;
        };
        previous.cancel();
        self.build = Some(build.clone());
        self.retrying = true;
        self.wants_play = true;
        self.run(&self.context, async move {
            Event::Retry(build.start(job).await)
        });
        true
    }
}
fn playback_plan_ref(plan: &Plan, chapter: &str, version: &str) -> Result<()> {
    ensure!(
        plan.chapter_id == chapter && plan.version == version,
        "Narration text version changed. Tap Play to retry."
    );
    ensure!(
        !plan.units.is_empty() && plan.units.len() <= 8192,
        "Invalid narration plan"
    );
    if let Some(job) = &plan.job {
        job.validate()?;
    }
    for unit in &plan.units {
        ensure!(
            valid_id(&unit.id) && unit.url == format!("/api/narration/audio/{}", unit.id),
            "Invalid narration unit"
        );
    }
    if let Some(complete) = &plan.completed_chapter {
        ensure!(
            valid_id(&complete.id)
                && complete.url == format!("/api/narration/chapter/{}", complete.id),
            "Invalid narration chapter"
        );
    }
    Ok(())
}
fn playback_plan(
    plan: Plan,
    chapter: &str,
    version: &str,
    credentials: &Credentials,
) -> Result<audio::PlaybackPlan> {
    playback_plan_ref(&plan, chapter, version)?;
    let units = match plan.completed_chapter {
        Some(complete) => vec![complete],
        None => plan.units,
    };
    let chapters = units
        .into_iter()
        .map(|unit| {
            Ok(audio::PlaybackChapter {
                id: chapter.into(),
                title: format!("{} · AI narration", unit.title),
                audio: cross_canon_core::AudioLocation {
                    url: format!("{}{}", credentials.origin, unit.url),
                    start_seconds: 0.0,
                    end_seconds: None,
                },
                fallback: None,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(audio::PlaybackPlan {
        chapters,
        index: 0,
        private_token: {
            #[cfg(not(target_arch = "wasm32"))]
            {
                Some(credentials.token.clone())
            }
            #[cfg(target_arch = "wasm32")]
            {
                None
            }
        },
    })
}

impl Desktop {
    pub(super) fn narration_version(&self, chapter: &str) -> &'static str {
        let book = self
            .library
            .chapter(chapter)
            .map(|(book, _)| book)
            .unwrap_or_else(|| self.library.book(&self.current_passage().book_id).unwrap());
        if book.corpus == Corpus::Scripture {
            self.state
                .scripture_translation
                .narration_version(&book.title)
        } else {
            // Narration uses the available modernization independently of the
            // visual Original view; the server falls back to unchanged text.
            "modernized"
        }
    }
    pub(super) fn audio_available(&self, chapter: &str) -> bool {
        self.narration.selected()
            || self
                .state
                .scripture_translation
                .audio(&self.library, chapter)
                .is_some()
    }
    pub(super) fn audio_control_playing(&self, chapter: &str) -> bool {
        if self.narration.selected() {
            ((self.playing || self.audio_loading) && self.audio_chapter.as_deref() == Some(chapter))
                || self.narration.waiting_to_play_for(chapter)
        } else {
            self.playing || self.audio_loading || self.narration.waiting_to_play()
        }
    }
    pub(super) fn audio_label(&self) -> &'static str {
        match (
            self.narration.selected(),
            self.audio_control_playing(&self.active_chapter_id),
        ) {
            (true, true) => "Pause AI narration",
            (true, false) => "Play AI narration",
            (false, true) => "Pause audio",
            (false, false) => "Play audio",
        }
    }
    pub(super) fn audio_failed(&mut self, error: String) {
        self.playing = false;
        self.audio_loading = false;
        if self.audio_private {
            self.narration.failed = true;
        }
        if !self.audio_private {
            self.audio_chapter = None;
        }
        self.message = error;
    }
    pub(super) fn stop_audio(&mut self) {
        self.stop_audio_command(audio::Command::Stop);
    }
    pub(super) fn stop_audio_for_narration_chapter(&mut self, chapter: &str) {
        self.stop_audio_command(audio::Command::StopForNarrationChapter(chapter.into()));
    }
    fn stop_audio_command(&mut self, command: audio::Command) {
        self.narration.stop();
        let _ = self.audio_tx.send(command);
        self.audio_chapter = None;
        self.audio_loading = false;
        self.audio_private = false;
        self.playing = false;
        self.message.clear();
    }
    pub(super) fn select_audio_source(&mut self, recorded: bool) {
        if !self.narration.enabled || self.narration.recorded == recorded {
            return;
        }
        self.stop_audio();
        self.narration.recorded = recorded;
        self.message.clear();
    }
    pub(super) fn narration_tick(&mut self, ctx: &egui::Context) {
        let was_enabled = self.narration.enabled;
        let had_private_session = self.narration.has_session() || self.audio_private;
        let (changed, plan) = self
            .narration
            .tick(ctx, self.account.narration_credentials());
        if !was_enabled
            && self.narration.enabled
            && self.audio_chapter.is_some()
            && !self.audio_private
        {
            self.narration.recorded = true;
        }
        if changed && had_private_session {
            // tick has already invalidated the old account and may have begun
            // a fresh capability request. Do not cancel that new generation.
            let _ = self.audio_tx.send(audio::Command::Stop);
            self.audio_chapter = None;
            self.audio_loading = false;
            self.audio_private = false;
            self.playing = false;
            self.message.clear();
        }
        if let Some(plan) = plan {
            match plan {
                Ok(PlaybackAction::Retry(result)) => {
                    match result {
                        Ok(()) => { let _ = self.audio_tx.send(audio::Command::Toggle); }
                        Err(_) => self.audio_failed("AI narration could not resume. Tap Play to retry or choose Recorded audio.".into()),
                    }
                }
                Ok(PlaybackAction::Play(plan)) => {
                    self.narration.active = true;
                    self.audio_private = true;
                    let _ = self.audio_tx.send(audio::Command::Play(plan));
                }
                Err(_) => {
                    self.audio_chapter = None;
                    self.audio_loading = false;
                    self.audio_private = false;
                    self.playing = false;
                    self.message = "AI narration is unavailable for this text or account. Check your connection and tap Play to retry, or choose Recorded audio.".into();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn credentials() -> Credentials {
        Credentials {
            user: "private-test-owner".into(),
            token: "opaque-test-session".into(),
            origin: "https://reader.example.test".into(),
        }
    }
    fn plan() -> Plan {
        let id = "a".repeat(64);
        Plan {
            chapter_id: "anf03:vi.iv.i".into(),
            version: "modernized".into(),
            job: None,
            completed_chapter: None,
            units: vec![Unit {
                id: id.clone(),
                url: format!("/api/narration/audio/{id}"),
                title: "On Prayer 1".into(),
            }],
        }
    }
    #[test]
    fn narration_plan_rejects_cross_origin_and_changed_edition() {
        let c = credentials();
        let mut p = plan();
        p.units[0].url = "https://other.example/private".into();
        assert!(playback_plan(p, "anf03:vi.iv.i", "modernized", &c).is_err());
        assert!(playback_plan(plan(), "anf03:vi.iv.i", "original", &c).is_err());
        let p = playback_plan(plan(), "anf03:vi.iv.i", "modernized", &c).unwrap();
        assert_eq!(p.chapters.len(), 1);
        assert!(p.chapters[0].fallback.is_none());
        assert_eq!(p.private_token.as_deref(), Some("opaque-test-session"));
        assert!(p.chapters[0].title.ends_with("AI narration"));
    }
    #[test]
    fn large_chapter_plan_is_metadata_only_and_bounded() {
        let units = |count| {
            (0..count)
                .map(|index| {
                    let id = format!("{index:064x}");
                    Unit {
                        url: format!("/api/narration/audio/{id}"),
                        id,
                        title: "Long chapter".into(),
                    }
                })
                .collect()
        };
        let mut long = plan();
        long.units = units(2500);
        let playback = playback_plan(long, "anf03:vi.iv.i", "modernized", &credentials()).unwrap();
        assert_eq!(playback.chapters.len(), 2500);
        assert_eq!(playback.index, 0);
        let mut oversized = plan();
        oversized.units = units(8193);
        assert!(playback_plan(oversized, "anf03:vi.iv.i", "modernized", &credentials()).is_err());
    }
    #[test]
    fn account_change_discards_pending_ready_and_stale_provider_results() {
        let ctx = egui::Context::default();
        let mut state = Narration::default();
        state.credentials = Some(credentials());
        state.enabled = true;
        state.active = true;
        state.pending = Some(("anf03:vi.iv.i".into(), "modernized".into()));
        let stale = state.generation;
        state
            .tx
            .send((
                stale,
                Event::Plan("anf03:vi.iv.i".into(), "modernized".into(), Ok(plan())),
            ))
            .unwrap();
        let (changed, output) = state.tick(&ctx, None);
        assert!(changed);
        assert!(output.is_none());
        assert!(!state.enabled);
        assert!(!state.active);
        assert!(state.pending.is_none());
        assert!(state.ready.is_none());
    }
    fn job() -> Job {
        let id = "b".repeat(64);
        Job {
            start_url: format!("/api/narration/jobs/{id}/start"),
            cancel_url: format!("/api/narration/jobs/{id}/cancel"),
            status_url: format!("/api/narration/jobs/{id}"),
            id,
        }
    }
    #[test]
    fn completed_chapter_uses_one_private_file_and_validates_all_build_addresses() {
        let mut complete = plan();
        complete.job = Some(job());
        let id = "c".repeat(64);
        complete.completed_chapter = Some(Unit {
            id: id.clone(),
            url: format!("/api/narration/chapter/{id}"),
            title: "On Prayer 1".into(),
        });
        let playback =
            playback_plan(complete, "anf03:vi.iv.i", "modernized", &credentials()).unwrap();
        assert_eq!(playback.chapters.len(), 1);
        assert!(playback.chapters[0]
            .audio
            .url
            .ends_with(&format!("/chapter/{id}")));
        let mut invalid = job();
        invalid.cancel_url = "https://other.example.test/cancel".into();
        assert!(invalid.validate().is_err());
        let mut invalid = plan();
        invalid.completed_chapter = Some(Unit {
            id: id.clone(),
            url: format!("/api/narration/audio/{id}"),
            title: "Invalid route".into(),
        });
        assert!(playback_plan(invalid, "anf03:vi.iv.i", "modernized", &credentials()).is_err());
    }
    #[test]
    fn retained_build_counts_as_a_session_after_a_lost_start_reply() {
        let mut narration = Narration::default();
        narration.build = Some(BuildSession::new(credentials()).unwrap());
        assert!(!narration.active && !narration.waiting() && narration.ready.is_none());
        assert!(narration.has_session());
        narration.stop();
        assert!(!narration.has_session());
    }
    #[test]
    fn stop_before_metadata_reply_never_starts_a_build() {
        let build = BuildSession::new(credentials()).unwrap();
        build.cancel();
        let error = platform::block_on(build.start(job())).unwrap_err();
        assert_eq!(error.to_string(), "Narration stopped");
        let next = BuildSession::new(credentials()).unwrap();
        assert_eq!(next.intent.len(), 32);
        assert!(next.intent.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(build.intent, next.intent);
    }
    #[test]
    fn stop_during_start_sends_same_private_intent_and_account_change_cancels() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut c = credentials();
        c.origin = format!("http://{}", listener.local_addr().unwrap());
        let (requests_tx, requests_rx) = mpsc::channel();
        let server = std::thread::spawn(move || {
            for index in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(header_end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..header_end]);
                        let length: usize = headers
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .map(str::to_owned)
                            })
                            .unwrap()
                            .parse()
                            .unwrap();
                        if bytes.len() >= header_end + 4 + length {
                            break;
                        }
                    }
                }
                let request = String::from_utf8(bytes).unwrap();
                requests_tx.send(request).unwrap();
                if index == 0 {
                    std::thread::sleep(Duration::from_millis(80));
                }
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                    )
                    .unwrap();
            }
        });
        let build = BuildSession::new(c.clone()).unwrap();
        let task_build = build.clone();
        let (done_tx, done_rx) = mpsc::channel();
        platform::spawn(async move {
            let _ = done_tx.send(task_build.start(job()).await);
        });
        let start = requests_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        let mut state = Narration::default();
        state.credentials = Some(c);
        state.build = Some(build.clone());
        state.active = true;
        state.tick(&egui::Context::default(), None);
        let cancel = requests_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(start.starts_with(&format!("POST {} ", job().start_url)));
        assert!(cancel.starts_with(&format!("POST {} ", job().cancel_url)));
        for request in [start, cancel] {
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: bearer opaque-test-session"));
            let body = request.split("\r\n\r\n").nth(1).unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(body).unwrap()["intent"],
                build.intent
            );
        }
        assert!(done_rx
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .is_err());
        assert!(state.build.is_none());
        server.join().unwrap();
    }
}
