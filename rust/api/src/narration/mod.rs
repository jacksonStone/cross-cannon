//! Owner-only narration is an account API, never a public audio/static route.
//! Canonical text, rights, settings, allowance and cache reads are server owned.
mod cache;
mod catalog;
mod provider;
#[cfg(test)]
mod tests;

use super::{
    auth::blocking, browser_write, caller, error, json_body, private, with_cookie, Accounts,
};
use axum::{
    extract::{Path as UrlPath, Request, State},
    http::{HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use cache::{clip_id, hash, Cache, Descriptor, Limits};
use cross_canon_core::Library;
use provider::{ProviderConfig, SpeechSettings};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug)]
pub(super) struct Failure {
    status: StatusCode,
    message: &'static str,
}
impl Failure {
    fn unavailable() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "AI narration is temporarily unavailable.",
        }
    }
    fn missing() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: "Narration unit unavailable. Start AI narration again.",
        }
    }
    fn capacity() -> Self {
        Self {
            status: StatusCode::INSUFFICIENT_STORAGE,
            message: "AI narration storage is full. Existing narration can still play.",
        }
    }
    fn budget() -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "The daily AI narration allowance is used. Saved narration can still play.",
        }
    }
    fn busy() -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "AI narration is busy. Try again shortly.",
        }
    }
    fn provider() -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: "AI reading could not be verified. Tap Play to retry.",
        }
    }
}
impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let mut response = error(self.status, self.message);
        if self.status == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert("retry-after", "30".parse().unwrap());
        }
        response
    }
}
struct Service {
    owners: HashSet<String>,
    cache: Arc<Cache>,
    settings: SpeechSettings,
    provider: Arc<ProviderConfig>,
    resolution_slots: Arc<tokio::sync::Semaphore>,
}
impl Service {
    fn from_env(root: &Path) -> anyhow::Result<Option<Arc<Self>>> {
        let Some(key) = configured_provider_key(|name| std::env::var(name).ok())? else {
            return Ok(None);
        };
        let owners = std::env::var("CROSS_CANON_NARRATION_OWNER_EMAILS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect::<HashSet<_>>();
        anyhow::ensure!(
            !owners.is_empty()
                && owners.len() <= 4
                && owners.iter().all(|s| s.len() <= 320 && s.contains('@')),
            "Missing private narration owner configuration"
        );
        let path = PathBuf::from(
            std::env::var_os("CROSS_CANON_NARRATION_CACHE_DIR")
                .ok_or_else(|| anyhow::anyhow!("Missing private narration cache directory"))?,
        );
        anyhow::ensure!(
            path.is_absolute()
                && !path.starts_with(root.join("public"))
                && !path.starts_with(root.join("web"))
                && !path.starts_with(root.join("scripture-cache")),
            "Narration cache must be private"
        );
        let cache = Cache::open(
            path,
            Limits {
                daily_attempts: setting("CROSS_CANON_NARRATION_DAILY_ATTEMPTS", 40, 1, 1000)?,
                daily_characters: setting(
                    "CROSS_CANON_NARRATION_DAILY_CHARACTERS",
                    20000,
                    1,
                    1_000_000,
                )?,
                max_disk_bytes: setting(
                    "CROSS_CANON_NARRATION_CACHE_BYTES",
                    512 * 1024 * 1024,
                    cache::MAX_CLIP_BYTES * 2,
                    8 * 1024 * 1024 * 1024,
                )?,
                concurrency: setting("CROSS_CANON_NARRATION_CONCURRENCY", 1, 1, 2)? as usize,
            },
        )?;
        let mut settings = SpeechSettings::default();
        if let Ok(voice) = std::env::var("CROSS_CANON_NARRATION_VOICE") {
            settings.voice = voice;
        }
        if let Ok(speed) = std::env::var("CROSS_CANON_NARRATION_SPEED") {
            settings.speed = speed.parse()?;
        }
        anyhow::ensure!(settings.valid(), "Unsupported narration settings");
        Ok(Some(Arc::new(Self {
            owners,
            cache,
            settings,
            provider: Arc::new(ProviderConfig::openai(key)),
            resolution_slots: Arc::new(tokio::sync::Semaphore::new(2)),
        })))
    }
}

/// Credentials stay inside the server process. Sharing the existing embedding
/// credential requires its own exact opt-in; merely enabling narration must
/// never fall back to it. A dedicated narration credential always wins.
/// Keep this pure so tests need not mutate the process's private environment.
fn configured_provider_key(
    mut variable: impl FnMut(&str) -> Option<String>,
) -> anyhow::Result<Option<String>> {
    if variable("CROSS_CANON_NARRATION_ENABLED").as_deref() != Some("1") {
        return Ok(None);
    }
    if let Some(key) = variable("CROSS_CANON_NARRATION_API_KEY").filter(|key| !key.is_empty()) {
        return Ok(Some(key));
    }
    if variable("CROSS_CANON_NARRATION_USE_EMBEDDINGS_KEY").as_deref() == Some("1") {
        if let Some(key) = variable("OPENAI_API_KEY").filter(|key| !key.is_empty()) {
            return Ok(Some(key));
        }
    }
    anyhow::bail!("Missing narration provider configuration")
}

fn setting(name: &str, default: u64, min: u64, max: u64) -> anyhow::Result<u64> {
    let value = match std::env::var(name) {
        Ok(v) => v.parse::<u64>()?,
        Err(std::env::VarError::NotPresent) => default,
        Err(e) => return Err(e.into()),
    };
    anyhow::ensure!((min..=max).contains(&value), "Invalid narration limit");
    Ok(value)
}
struct Routes {
    accounts: Arc<Accounts>,
    root: PathBuf,
    library: Arc<Library>,
    service: Option<Arc<Service>>,
}
pub(super) fn router(accounts: Arc<Accounts>, root: PathBuf, library: Arc<Library>) -> Router {
    let service = match Service::from_env(&root) {
        Ok(s) => s,
        Err(_) => {
            tracing::error!("AI narration configuration unavailable; feature disabled");
            None
        }
    };
    routes(Arc::new(Routes {
        accounts,
        root,
        library,
        service,
    }))
}
fn routes(state: Arc<Routes>) -> Router {
    Router::new()
        .route("/api/narration/capabilities", get(capabilities))
        .route("/api/narration/plan", post(plan))
        .route("/api/narration/audio/{id}", get(audio))
        .layer(middleware::from_fn(private))
        .with_state(state)
}
async fn owner(
    state: &Routes,
    headers: &HeaderMap,
    write: bool,
) -> Result<(String, Option<String>), Response> {
    if headers
        .get("sec-fetch-site")
        .and_then(|s| s.to_str().ok())
        .is_some_and(|s| s != "same-origin" && s != "none")
    {
        return Err(error(StatusCode::FORBIDDEN, "Invalid narration origin."));
    }
    let service = state.service.as_ref().ok_or_else(|| {
        error(
            StatusCode::FORBIDDEN,
            "AI narration is unavailable for this account.",
        )
    })?;
    let auth = state.accounts.require()?;
    if write {
        browser_write(&auth, headers)?;
    }
    let caller = caller(&auth, headers).await?;
    let user = caller
        .user
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Sign in to use AI narration."))?;
    if !service.owners.contains(&user.email.to_lowercase()) {
        return Err(error(
            StatusCode::FORBIDDEN,
            "AI narration is unavailable for this account.",
        ));
    }
    // Existing authenticated browser/native identity, plus verified provider
    // linkage. A client email/flag and an unverified legacy row grant nothing.
    let id = user.id.clone();
    let verified=blocking(&auth,move |a|a.store.with_connection(|db|Ok(db.query_row("SELECT EXISTS(SELECT 1 FROM user WHERE id=? AND emailVerified=1 AND EXISTS(SELECT 1 FROM account WHERE userId=user.id AND providerId='google'))",[id],|r|r.get::<_,bool>(0))?))).await.map_err(|_|Failure::unavailable().into_response())?;
    if !verified {
        return Err(error(
            StatusCode::FORBIDDEN,
            "A verified account is required for AI narration.",
        ));
    }
    Ok((user.id, caller.renewed))
}
async fn capabilities(State(state): State<Arc<Routes>>, headers: HeaderMap) -> Response {
    match owner(&state, &headers, false).await {
        Ok((_, cookie)) => with_cookie(Json(json!({"enabled":true})).into_response(), cookie),
        Err(_) => Json(json!({"enabled":false})).into_response(),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanRequest {
    chapter_id: String,
    version: String,
}
async fn plan(State(state): State<Arc<Routes>>, request: Request) -> Result<Response, Response> {
    let (owner, cookie) = owner(&state, request.headers(), true).await?;
    let request: PlanRequest =
        serde_json::from_value(json_body(request, 2048).await?).map_err(|_| {
            error(
                StatusCode::BAD_REQUEST,
                "Choose a canonical chapter and text version.",
            )
        })?;
    if request.chapter_id.len() > 240 || request.version.len() > 24 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Invalid narration selection.",
        ));
    }
    let service = state.service.as_ref().unwrap().clone();
    let slot = service
        .resolution_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| Failure::busy().into_response())?;
    let root = state.root.clone();
    let library = state.library.clone();
    let resolved = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        catalog::resolve(&root, &library, &request.chapter_id, &request.version)
    })
    .await
    .map_err(|_| Failure::unavailable().into_response())?
    .map_err(|_| {
        error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "AI narration is not available for this text edition or its rights are not supported.",
        )
    })?;
    let account = hash(owner.as_bytes());
    let descriptors = resolved
        .units
        .iter()
        .enumerate()
        .map(|(i, text)| {
            let id = clip_id(
                &account,
                &resolved.chapter_id,
                &resolved.version,
                i,
                &resolved.edition_identity,
                text,
                &service.settings,
            );
            (
                id,
                Descriptor {
                    account: account.clone(),
                    chapter: resolved.chapter_id.clone(),
                    version: resolved.version.clone(),
                    unit: i,
                },
            )
        })
        .collect::<Vec<_>>();
    service
        .cache
        .describe(&descriptors)
        .map_err(IntoResponse::into_response)?;
    let units=descriptors.iter().enumerate().map(|(i,(id,_))|json!({"id":id,"url":format!("/api/narration/audio/{id}"),"title":format!("{} · {} of {}",resolved.title,i+1,descriptors.len())})).collect::<Vec<_>>();
    Ok(with_cookie(
        Json(json!({"chapterId":resolved.chapter_id,"version":resolved.version,"units":units}))
            .into_response(),
        cookie,
    ))
}
async fn audio(
    State(state): State<Arc<Routes>>,
    UrlPath(id): UrlPath<String>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let (owner, cookie) = owner(&state, &headers, false).await?;
    let service = state.service.as_ref().unwrap().clone();
    let slot = service
        .resolution_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| Failure::busy().into_response())?;
    let descriptor = service
        .cache
        .descriptor(&id)
        .map_err(IntoResponse::into_response)?;
    let account = hash(owner.as_bytes());
    if descriptor.account != account {
        return Err(Failure::missing().into_response());
    }
    let root = state.root.clone();
    let library = state.library.clone();
    let resolved = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        catalog::resolve(&root, &library, &descriptor.chapter, &descriptor.version)
            .map(|c| (c, descriptor.unit))
    })
    .await
    .map_err(|_| Failure::unavailable().into_response())?
    .map_err(|_| Failure::missing().into_response())?;
    let (chapter, index) = resolved;
    let text = chapter
        .units
        .get(index)
        .ok_or_else(|| Failure::missing().into_response())?;
    if clip_id(
        &account,
        &chapter.chapter_id,
        &chapter.version,
        index,
        &chapter.edition_identity,
        text,
        &service.settings,
    ) != id
    {
        return Err(Failure::missing().into_response());
    }
    let bytes = service
        .cache
        .clip(
            id,
            text.clone(),
            service.settings.clone(),
            service.provider.clone(),
        )
        .await
        .map_err(IntoResponse::into_response)?;
    Ok(with_cookie(
        (
            [("content-type", "audio/wav"), ("accept-ranges", "none")],
            bytes.as_ref().clone(),
        )
            .into_response(),
        cookie,
    ))
}
