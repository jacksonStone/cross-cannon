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
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum BuildState {
    Ready,
    Running,
    Complete,
    Cancelled,
    Budget,
    StorageFull,
    Failed,
    Interrupted,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildProgress {
    id: String,
    state: BuildState,
    completed_units: usize,
    total_units: usize,
    #[serde(default)]
    completed_chapter: Option<Unit>,
}
impl BuildProgress {
    fn validate(&self, job: &Job) -> Result<()> {
        ensure!(
            self.id == job.id
                && self.total_units > 0
                && self.total_units <= 8192
                && self.completed_units <= self.total_units,
            "Chapter progress could not be read. Tap Play to retry."
        );
        if let Some(chapter) = &self.completed_chapter {
            ensure!(
                valid_id(&chapter.id)
                    && chapter.url == format!("/api/narration/chapter/{}", chapter.id),
                "Chapter progress could not be read. Tap Play to retry."
            );
        }
        ensure!(
            self.state != BuildState::Complete
                || (self.completed_units == self.total_units && self.completed_chapter.is_some()),
            "Chapter progress could not be read. Tap Play to retry."
        );
        Ok(())
    }
    fn ongoing(&self) -> bool {
        matches!(self.state, BuildState::Ready | BuildState::Running)
    }
    fn label(&self) -> String {
        let saved = format!(
            "{} of {} batches saved",
            self.completed_units, self.total_units
        );
        match self.state {
            BuildState::Running if self.completed_units < self.total_units => {
                format!("{saved} · Preparing next batch")
            }
            BuildState::Running => format!("{saved} · Joining chapter audio…"),
            BuildState::Ready => format!("{saved} · Ready to prepare chapter audio"),
            BuildState::Complete => format!(
                "Chapter audio saved · {} batches · Ready to replay",
                self.total_units
            ),
            BuildState::Budget => {
                format!("{saved} · Daily allowance reached. Play after the 00:00 UTC reset to continue.")
            }
            BuildState::StorageFull => {
                format!("{saved} · Audio storage is full. Saved batches remain playable.")
            }
            BuildState::Failed => {
                format!("{saved} · Batch preparation stopped. Tap Play to retry.")
            }
            BuildState::Interrupted => {
                format!("{saved} · Chapter preparation was interrupted. Tap Play to resume.")
            }
            BuildState::Cancelled => {
                format!("{saved} · Chapter preparation stopped. Tap Play to resume.")
            }
        }
    }
}
fn request_problem(status: u16) -> &'static str {
    match status {
        401 => "Sign in again to prepare chapter audio.",
        403 => "Your account does not have access to this chapter audio.",
        400 | 404 | 422 => {
            "This text edition cannot be narrated. Choose Recorded audio when available."
        }
        429 => {
            "Chapter audio is paused by a generation limit. Tap Play later to resume saved batches."
        }
        507 => "Audio storage is full. Saved batches remain playable.",
        _ => "Chapter audio request failed. Tap Play to retry.",
    }
}
const CONNECTION_PROBLEM: &str = "Connection interrupted. Tap Play to retry chapter audio.";

// This session exists before the metadata request, so Stop can invalidate a
// pending plan. Registering the job and cancellation share one lock; the server
// tombstones an intent even if cancel arrives before its matching start.
struct BuildSession {
    credentials: Credentials,
    intent: String,
    cancelled: AtomicBool,
    start_finished: AtomicBool,
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
            start_finished: AtomicBool::new(false),
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
        let result = build_request(&self.credentials, &job.start_url, &self.intent).await;
        // Until Start finishes, GET can still describe a previous terminal run.
        // Open after errors too: a lost reply may hide an accepted worker.
        self.start_finished.store(true, Ordering::SeqCst);
        result?;
        ensure!(!self.cancelled.load(Ordering::SeqCst), "Narration stopped");
        Ok(())
    }
}
async fn build_request(credentials: &Credentials, path: &str, intent: &str) -> Result<()> {
    let client = platform::http_client(Duration::from_secs(30))?;
    let response = platform::authenticated(
        client.post(format!("{}{}", credentials.origin, path)),
        &credentials.token,
    )
    .json(&serde_json::json!({"intent":intent}))
    .send()
    .await
    .map_err(|_| anyhow::anyhow!(CONNECTION_PROBLEM))?;
    ensure!(
        response.status().is_success(),
        request_problem(response.status().as_u16())
    );
    Ok(())
}

pub(super) enum PlaybackAction {
    Play(audio::PlaybackPlan),
    Retry(Result<()>),
}
#[derive(Clone, Deserialize)]
struct Unit {
    id: String,
    url: String,
    title: String,
}

enum Event {
    Capability(Result<Capability>),
    Plan(String, String, Result<Plan>),
    Retry(Result<()>),
    Metadata(usize),
    Progress(String, Result<BuildProgress>),
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
    known_total: usize,
    progress: Option<BuildProgress>,
    last_poll: Option<Instant>,
    polling: bool,
    problem: Option<String>,
    poll_problem: Option<String>,
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
            known_total: 0,
            progress: None,
            last_poll: None,
            polling: false,
            problem: None,
            poll_problem: None,
        }
    }
}
impl Narration {
    pub fn status(&self) -> Option<String> {
        if !self.has_session() {
            return None;
        }
        if let Some(problem) = &self.problem {
            return Some(problem.clone());
        }
        if let Some(problem) = &self.poll_problem {
            return Some(match &self.progress {
                Some(progress) => format!(
                    "{} of {} batches saved · {problem}",
                    progress.completed_units, progress.total_units
                ),
                None => problem.clone(),
            });
        }
        if let Some(progress) = &self.progress {
            if progress.state == BuildState::Complete && self.failed {
                return Some("Chapter audio saved · Playback paused. Tap Play to retry.".into());
            }
            return Some(progress.label());
        }
        if self.known_total > 0 {
            return Some(format!(
                "Preparing chapter audio · {} batches",
                self.known_total
            ));
        }
        Some("Preparing chapter audio…".into())
    }
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
        self.known_total = 0;
        self.progress = None;
        self.last_poll = None;
        self.polling = false;
        self.problem = None;
        self.poll_problem = None;
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
                Event::Metadata(total) => {
                    self.known_total = total;
                }
                Event::Progress(id, result) => {
                    self.polling = false;
                    let job = self
                        .build
                        .as_ref()
                        .and_then(|build| build.job.lock().unwrap().clone());
                    if job.as_ref().is_none_or(|job| job.id != id) {
                        continue;
                    }
                    match result.and_then(|progress| {
                        progress.validate(job.as_ref().unwrap())?;
                        Ok(progress)
                    }) {
                        Ok(progress) => {
                            // A successful status read proves what happened after
                            // an ambiguous/lost Start reply. Ready alone does not.
                            if progress.state != BuildState::Ready {
                                self.problem = None;
                            }
                            self.progress = Some(progress);
                            self.poll_problem = None;
                        }
                        Err(error) => self.poll_problem = Some(error.to_string()),
                    }
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
                        self.known_total = plan.units.len();
                        if let Some(complete) = &plan.completed_chapter {
                            self.progress = Some(BuildProgress {
                                id: plan
                                    .job
                                    .as_ref()
                                    .map(|job| job.id.clone())
                                    .unwrap_or_else(|| complete.id.clone()),
                                state: BuildState::Complete,
                                completed_units: plan.units.len(),
                                total_units: plan.units.len(),
                                completed_chapter: Some(complete.clone()),
                            });
                        }
                        playback_plan(plan, &chapter, &version, self.credentials.as_ref().unwrap())
                    });
                    match result {
                        Ok(plan) if !self.wants_play => self.ready = Some((version, plan)),
                        other => output = Some(other.map(PlaybackAction::Play)),
                    }
                }
            }
        }
        // Status reads never start or retry generation. One in-flight request
        // per session; terminal states remain visible until a manual Play.
        let ongoing = self.progress.as_ref().is_none_or(BuildProgress::ongoing);
        if ongoing {
            if let Some(build) = self
                .build
                .as_ref()
                .filter(|build| build.start_finished.load(Ordering::SeqCst))
            {
                let job = build.job.lock().unwrap().clone();
                if let Some(job) = job {
                    ctx.request_repaint_after(Duration::from_secs(1));
                    if !self.polling
                        && self
                            .last_poll
                            .is_none_or(|last| last.elapsed() >= Duration::from_secs(1))
                    {
                        self.polling = true;
                        self.last_poll = Some(Instant::now());
                        let credentials = build.credentials.clone();
                        self.run(ctx, async move {
                            let result = async {
                                let client = platform::http_client(Duration::from_secs(15))?;
                                let response = platform::authenticated(
                                    client.get(format!("{}{}", credentials.origin, job.status_url)),
                                    &credentials.token,
                                )
                                .send()
                                .await
                                .map_err(|_| anyhow::anyhow!(CONNECTION_PROBLEM))?;
                                ensure!(
                                    response.status().is_success(),
                                    request_problem(response.status().as_u16())
                                );
                                response.json::<BuildProgress>().await.map_err(|_| {
                                    anyhow::anyhow!(
                                        "Chapter progress could not be read. Tap Play to retry."
                                    )
                                })
                            }
                            .await;
                            Event::Progress(job.id, result)
                        });
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
        let metadata_tx = self.tx.clone();
        let generation = self.generation;
        let metadata_context = self.context.clone();
        self.run(&self.context, async move {
            let result = async {
                let client = platform::http_client(Duration::from_secs(30))?;
                let response = platform::authenticated(
                    client.post(format!("{}/api/narration/plan", credentials.origin)),
                    &credentials.token,
                )
                .json(&serde_json::json!({"chapterId":chapter,"version":version}))
                .send()
                .await
                .map_err(|_| anyhow::anyhow!(CONNECTION_PROBLEM))?;
                if !response.status().is_success() {
                    let status = response.status();
                    // Never echo private URLs, credentials, provider errors or text.
                    bail!(request_problem(status.as_u16()));
                }
                let plan = response.json::<Plan>().await.map_err(|_| {
                    anyhow::anyhow!("Chapter audio response could not be read. Tap Play to retry.")
                })?;
                // Validate all private addresses before a server build can start.
                playback_plan_ref(&plan, &chapter, &version)?;
                let _ = metadata_tx.send((generation, Event::Metadata(plan.units.len())));
                metadata_context.request_repaint();
                if plan.completed_chapter.is_none() {
                    if let Some(job) = plan.job.clone() {
                        build.start(job).await?;
                    }
                }
                Ok(plan)
            }
            .await;
            Event::Plan(chapter, version, result)
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
        self.generation += 1;
        self.build = Some(build.clone());
        self.progress = None;
        self.poll_problem = None;
        self.problem = None;
        self.last_poll = None;
        self.polling = false;
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
    pub(super) fn reader_status(&self) -> String {
        if let Some(error) = self.study.storage_error() {
            return error.to_string();
        }
        if self.narration.selected() {
            if let Some(status) = self.narration.status() {
                return status;
            }
        }
        self.message.clone()
    }
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
            (true, false) if self.narration.failed => "Retry chapter audio",
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
                Ok(PlaybackAction::Retry(result)) => match result {
                    Ok(()) => {
                        // Preserve preparing state until the adapter reports a
                        // real Playing, Paused or Error event.
                        self.audio_loading = true;
                        let _ = self.audio_tx.send(audio::Command::Toggle);
                    }
                    Err(error) => {
                        self.narration.problem = Some(error.to_string());
                        self.audio_failed(error.to_string());
                    }
                },
                Ok(PlaybackAction::Play(plan)) => {
                    self.narration.active = true;
                    self.audio_private = true;
                    self.audio_loading = true;
                    let _ = self.audio_tx.send(audio::Command::Play(plan));
                }
                Err(error) => {
                    self.narration.failed = true;
                    self.narration.problem = Some(error.to_string());
                    self.audio_chapter = None;
                    self.audio_loading = false;
                    self.audio_private = false;
                    self.playing = false;
                    self.message = error.to_string();
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
    fn progress(state: BuildState, saved: usize) -> BuildProgress {
        BuildProgress {
            id: job().id,
            state,
            completed_units: saved,
            total_units: 4,
            completed_chapter: None,
        }
    }
    #[test]
    fn batch_progress_is_typed_bounded_and_terminal_states_are_honest() {
        let running = progress(BuildState::Running, 2);
        running.validate(&job()).unwrap();
        assert_eq!(
            running.label(),
            "2 of 4 batches saved · Preparing next batch"
        );
        assert!(running.ongoing());
        for (state, expected) in [
            (BuildState::Budget, "00:00 UTC reset"),
            (BuildState::StorageFull, "storage is full"),
            (BuildState::Failed, "Tap Play to retry"),
            (BuildState::Interrupted, "Tap Play to resume"),
            (BuildState::Cancelled, "Tap Play to resume"),
        ] {
            let status = progress(state, 2);
            assert!(!status.ongoing());
            assert!(status.label().contains("2 of 4 batches saved"));
            assert!(status.label().contains(expected));
            assert!(!status.label().to_lowercase().contains("unavailable"));
            assert!(!status.label().contains("Preparing next batch"));
        }
        let mut invalid = running;
        invalid.completed_units = 5;
        assert!(invalid.validate(&job()).is_err());
        invalid.completed_units = 2;
        invalid.id = "f".repeat(64);
        assert!(invalid.validate(&job()).is_err());
        let incomplete = progress(BuildState::Complete, 4);
        assert!(incomplete.validate(&job()).is_err());
    }
    #[test]
    fn stop_clears_progress_and_late_old_status_cannot_restore_it() {
        let ctx = egui::Context::default();
        let mut state = Narration::default();
        state.credentials = Some(credentials());
        state.checked = Some(Instant::now());
        state.active = true;
        state.progress = Some(progress(BuildState::Running, 2));
        let stale = state.generation;
        state.stop();
        assert!(state.progress.is_none() && !state.polling && state.known_total == 0);
        state
            .tx
            .send((
                stale,
                Event::Progress(job().id, Ok(progress(BuildState::Budget, 2))),
            ))
            .unwrap();
        let c = credentials();
        state.tick(&ctx, Some((c.user, c.token, c.origin)));
        assert!(state.progress.is_none());
        assert!(state.status().is_none());
    }
    #[test]
    fn known_metadata_and_safe_permission_errors_are_not_generic_unavailability() {
        let mut state = Narration::default();
        state.pending = Some(("chapter".into(), "modernized".into()));
        assert_eq!(state.status().as_deref(), Some("Preparing chapter audio…"));
        state.known_total = 12;
        assert_eq!(
            state.status().as_deref(),
            Some("Preparing chapter audio · 12 batches")
        );
        assert_ne!(request_problem(401), request_problem(422));
        assert_ne!(request_problem(429), CONNECTION_PROBLEM);
        state.problem = Some(request_problem(403).into());
        assert_eq!(state.status().as_deref(), Some(request_problem(403)));
        assert!(!state
            .status()
            .unwrap()
            .to_lowercase()
            .contains("unavailable"));
    }
    #[test]
    fn terminal_job_status_does_not_turn_cached_pause_resume_into_generation_retry() {
        let c = credentials();
        let mut state = Narration::default();
        state.credentials = Some(c.clone());
        state.checked = Some(Instant::now());
        state.active = true;
        let build = BuildSession::new(c.clone()).unwrap();
        *build.job.lock().unwrap() = Some(job());
        state.build = Some(build);
        state
            .tx
            .send((
                state.generation,
                Event::Progress(job().id, Ok(progress(BuildState::Budget, 2))),
            ))
            .unwrap();
        state.tick(&egui::Context::default(), Some((c.user, c.token, c.origin)));
        assert!(state.status().unwrap().contains("Daily allowance reached"));
        assert!(!state.failed);
        assert!(
            !state.retry_build(),
            "Cached audio resume must not start another generation"
        );
        assert!(
            !state.polling,
            "Terminal status does not schedule another poll"
        );
    }
    #[test]
    fn verified_progress_replaces_a_lost_start_reply_but_ready_retains_it() {
        let c = credentials();
        let ctx = egui::Context::default();
        let mut state = Narration::default();
        state.credentials = Some(c.clone());
        state.checked = Some(Instant::now());
        state.last_poll = Some(Instant::now());
        state.active = true;
        let build = BuildSession::new(c.clone()).unwrap();
        *build.job.lock().unwrap() = Some(job());
        state.build = Some(build);
        for status in [BuildState::Ready, BuildState::Running, BuildState::Budget] {
            state.problem = Some(CONNECTION_PROBLEM.into());
            state
                .tx
                .send((
                    state.generation,
                    Event::Progress(job().id, Ok(progress(status, 2))),
                ))
                .unwrap();
            state.tick(
                &ctx,
                Some((c.user.clone(), c.token.clone(), c.origin.clone())),
            );
            if status == BuildState::Ready {
                assert_eq!(state.status().as_deref(), Some(CONNECTION_PROBLEM));
            } else {
                assert!(state.problem.is_none());
                assert_eq!(state.status().unwrap(), progress(status, 2).label());
            }
        }
    }
    #[test]
    fn polling_gate_opens_after_start_success_and_lost_reply_error() {
        use std::io::{Read, Write};
        for status in ["200 OK", "502 Bad Gateway"] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let mut c = credentials();
            c.origin = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0; 4096];
                let n = stream.read(&mut request).unwrap();
                assert!(
                    String::from_utf8_lossy(&request[..n]).starts_with("POST /api/narration/jobs/")
                );
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
                )
                .unwrap();
            });
            let build = BuildSession::new(c.clone()).unwrap();
            *build.job.lock().unwrap() = Some(job());
            let mut state = Narration::default();
            state.credentials = Some(c.clone());
            state.checked = Some(Instant::now());
            state.build = Some(build.clone());
            state.known_total = 4;
            state.tick(&egui::Context::default(), Some((c.user, c.token, c.origin)));
            assert!(
                !state.polling,
                "A pending Start must not poll the previous terminal record"
            );
            assert!(!build.start_finished.load(Ordering::SeqCst));
            let result = platform::block_on(build.start(job()));
            assert_eq!(result.is_ok(), status.starts_with("200"));
            assert!(
                build.start_finished.load(Ordering::SeqCst),
                "Both success and error permit authoritative status recovery"
            );
            server.join().unwrap();
        }
    }
}
