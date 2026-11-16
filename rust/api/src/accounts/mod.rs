//! Account identity and durable synchronization for every reader adapter.
mod auth;
mod documents;
pub(crate) mod protocol;
pub(crate) mod store;
#[cfg(test)]
mod tests;

use auth::{blocking, cookie, now, Auth, Config};
use axum::{
    body::to_bytes,
    extract::{Query, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{any, get, post},
    Json, Router,
};
use protocol::{parse_location, parse_revision, parse_study, valid_nonce};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use store::{valid_native_authorization, User};

struct Accounts {
    auth: Option<Arc<Auth>>,
    configured: bool,
    attempts: Mutex<HashMap<String, (i64, u8)>>,
}
impl Accounts {
    fn from_env(root: &Path) -> Self {
        let origin = std::env::var("CROSS_CANON_ACCOUNT_ORIGIN")
            .or_else(|_| std::env::var("BETTER_AUTH_URL"))
            .unwrap_or_default();
        let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
        let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default();
        let configured = !origin.is_empty() && !client_id.is_empty() && !client_secret.is_empty();
        let path = std::env::var_os("ACCOUNTS_DATABASE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("storage/accounts.db"));
        let auth = configured
            .then(|| {
                Config::new(&origin, client_id, client_secret)
                    .and_then(|config| Auth::new(config, &path))
            })
            .and_then(|result| match result {
                Ok(auth) => Some(Arc::new(auth)),
                Err(error) => {
                    tracing::error!("Account configuration unavailable: {error}");
                    None
                }
            });
        Self {
            auth,
            configured,
            attempts: Mutex::new(HashMap::new()),
        }
    }
    fn require(&self) -> Result<Arc<Auth>, Response> {
        self.auth
            .clone()
            .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "Sign-in is unavailable."))
    }
    fn rate_limit(&self, headers: &HeaderMap, category: &str) -> Result<(), Response> {
        let ip = headers
            .get("x-forwarded-for")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.split(',').next())
            .map(str::trim)
            .or_else(|| {
                headers
                    .get("cf-connecting-ip")
                    .and_then(|h| h.to_str().ok())
            })
            .or_else(|| headers.get("x-real-ip").and_then(|h| h.to_str().ok()))
            .unwrap_or("unknown");
        let time = now();
        let mut attempts = self.attempts.lock().map_err(unavailable)?;
        if attempts.len() >= 10_000 {
            attempts.retain(|_, (expires, _)| *expires > time);
        }
        let key = format!("{category}:{}", ip.chars().take(200).collect::<String>());
        if attempts.len() >= 10_000 && !attempts.contains_key(&key) {
            return Err(error(
                StatusCode::TOO_MANY_REQUESTS,
                "Please wait a minute and try again.",
            ));
        }
        let entry = attempts.entry(key).or_insert((time + 60_000, 0));
        if entry.0 <= time {
            *entry = (time + 60_000, 0);
        }
        if entry.1 >= 5 {
            return Err(error(
                StatusCode::TOO_MANY_REQUESTS,
                "Please wait a minute and try again.",
            ));
        }
        entry.1 += 1;
        Ok(())
    }
}

pub(crate) fn router(root: PathBuf) -> Router {
    routes(Arc::new(Accounts::from_env(&root)))
}
fn routes(state: Arc<Accounts>) -> Router {
    Router::new()
        .route("/api/account", get(account).post(save_progress))
        .route("/api/study", get(study).post(save_study))
        .route(
            "/api/native-login",
            post(native_login).get(|| async { StatusCode::METHOD_NOT_ALLOWED }),
        )
        .route("/api/auth/sign-in/social", post(sign_in))
        .route("/api/auth/callback/google", get(callback))
        .route("/api/auth/sign-out", post(sign_out))
        .route("/api/auth/get-session", get(session))
        .route(
            "/api/auth/{*path}",
            any(|| async { error(StatusCode::NOT_FOUND, "Authentication route not found.") }),
        )
        .route("/account", get(account_document))
        .route("/account/", get(account_document))
        .route("/account/native", get(native_document))
        .route("/account/native/", get(native_document))
        .route(
            "/account-assets/account.js",
            get(|| async {
                (
                    [("content-type", "text/javascript; charset=utf-8")],
                    documents::SCRIPT,
                )
            }),
        )
        .route(
            "/account-assets/account.css",
            get(|| async {
                (
                    [("content-type", "text/css; charset=utf-8")],
                    documents::CSS,
                )
            }),
        )
        .layer(middleware::from_fn(private))
        .with_state(state)
}
async fn private(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    for (name, value) in [
        ("cache-control", "private, no-store"),
        ("vary", "Cookie"),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
    ] {
        headers.insert(name, value.parse().unwrap());
    }
    response
}
fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}
fn unavailable(error: impl std::fmt::Display) -> Response {
    tracing::error!("Account operation failed: {error}");
    self::error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Accounts are temporarily unavailable.",
    )
}
fn same_origin(auth: &Auth, headers: &HeaderMap) -> Result<(), Response> {
    if headers.get("origin").and_then(|h| h.to_str().ok()) != Some(auth.config.origin().as_str()) {
        return Err(error(StatusCode::FORBIDDEN, "Invalid origin"));
    }
    Ok(())
}
fn browser_write(auth: &Auth, headers: &HeaderMap) -> Result<(), Response> {
    if !headers.contains_key("authorization") || headers.contains_key("origin") {
        same_origin(auth, headers)?;
    }
    Ok(())
}
async fn json_body(request: Request, limit: usize) -> Result<Value, Response> {
    if !request
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.starts_with("application/json"))
    {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response());
    }
    let bytes = to_bytes(request.into_body(), limit)
        .await
        .map_err(|_| StatusCode::PAYLOAD_TOO_LARGE.into_response())?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| StatusCode::BAD_REQUEST.into_response())?;
    if !value.is_object() {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    Ok(value)
}
struct Caller {
    user: Option<User>,
    renewed: Option<String>,
}
async fn caller(auth: &Arc<Auth>, headers: &HeaderMap) -> Result<Caller, Response> {
    // Presence of an invalid bearer credential must never fall back to cookies.
    if headers.contains_key("authorization") {
        let token = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(valid_native_authorization)
            .map(str::to_owned);
        let user = if let Some(token) = token {
            blocking(auth, move |a| a.store.user_for_native_token(&token, now()))
                .await
                .map_err(unavailable)?
        } else {
            None
        };
        return Ok(Caller {
            user,
            renewed: None,
        });
    }
    let token = cookie(headers, &auth.config.cookie_name("session")).map(str::to_owned);
    let Some(token) = token else {
        return Ok(Caller {
            user: None,
            renewed: None,
        });
    };
    let lookup = token.clone();
    let session = blocking(auth, move |a| a.session(&lookup, now()))
        .await
        .map_err(unavailable)?;
    Ok(Caller {
        renewed: session
            .as_ref()
            .filter(|s| s.renewed)
            .map(|_| auth.config.cookie("session", &token, 30 * 86_400)),
        user: session.map(|s| s.user),
    })
}
fn with_cookie(mut response: Response, cookie: Option<String>) -> Response {
    if let Some(cookie) = cookie {
        response
            .headers_mut()
            .append("set-cookie", cookie.parse().unwrap());
    }
    response
}
async fn account(
    State(state): State<Arc<Accounts>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    if !state.configured {
        return Ok(Json(json!({"configured":false,"user":null,"progress":{}})).into_response());
    }
    let auth = state.require()?;
    let caller = caller(&auth, &headers).await?;
    if headers.contains_key("authorization") && caller.user.is_none() {
        return Err(error(StatusCode::UNAUTHORIZED, "Sign in again."));
    }
    let progress = if let Some(user) = &caller.user {
        let id = user.id.clone();
        blocking(&auth, move |a| a.store.progress(&id))
            .await
            .map_err(unavailable)?
    } else {
        Default::default()
    };
    Ok(with_cookie(
        Json(json!({"configured":true,"user":caller.user,"progress":progress})).into_response(),
        caller.renewed,
    ))
}
async fn save_progress(
    State(state): State<Arc<Accounts>>,
    request: Request,
) -> Result<Response, Response> {
    let auth = state.require()?;
    browser_write(&auth, request.headers())?;
    let caller = caller(&auth, request.headers()).await?;
    let user = caller
        .user
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Sign in to sync progress."))?;
    let value = json_body(request, 4096).await?;
    let location = parse_location(&value["location"])
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Invalid reader location."))?;
    let revision = parse_revision(&value["revision"])
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Invalid reader location."))?;
    let result = blocking(&auth, move |a| {
        a.store.save_progress(&user.id, &location, revision)
    })
    .await
    .map_err(unavailable)?;
    let status = if result.saved {
        StatusCode::OK
    } else {
        StatusCode::CONFLICT
    };
    Ok(with_cookie(
        (status, Json(result)).into_response(),
        caller.renewed,
    ))
}
async fn study(
    State(state): State<Arc<Accounts>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let auth = state.require()?;
    let caller = caller(&auth, &headers).await?;
    let user = caller
        .user
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Sign in to sync study items"))?;
    let id = user.id.clone();
    let records = blocking(&auth, move |a| a.store.study(&id))
        .await
        .map_err(unavailable)?;
    Ok(with_cookie(
        Json(json!({"userId":user.id,"records":records})).into_response(),
        caller.renewed,
    ))
}
async fn save_study(
    State(state): State<Arc<Accounts>>,
    request: Request,
) -> Result<Response, Response> {
    let auth = state.require()?;
    browser_write(&auth, request.headers())?;
    let caller = caller(&auth, request.headers()).await?;
    let user = caller
        .user
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Sign in to sync study items"))?;
    let value = json_body(request, 96_000).await?;
    if value["userId"].as_str() != Some(&user.id) {
        return Err(error(
            StatusCode::CONFLICT,
            "Account changed. Reconnect before syncing.",
        ));
    }
    let item = parse_study(&value["item"])
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Invalid study item"))?;
    let revision = parse_revision(&value["revision"])
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Invalid study item"))?;
    let result = blocking(&auth, move |a| {
        a.store.save_study(&user.id, &item, revision)
    })
    .await
    .map_err(unavailable)?;
    let status = if result.saved {
        StatusCode::OK
    } else {
        StatusCode::CONFLICT
    };
    Ok(with_cookie(
        (status, Json(result)).into_response(),
        caller.renewed,
    ))
}
async fn native_login(
    State(state): State<Arc<Accounts>>,
    request: Request,
) -> Result<Response, Response> {
    let auth = state.require()?;
    if request.headers().contains_key("origin") {
        same_origin(&auth, request.headers())?;
    }
    let headers = request.headers().clone();
    let value = json_body(request, 4096).await?;
    match value["operation"].as_str() {
        Some("start") => {
            state.rate_limit(&headers, "native-login")?;
            let platform = value["platform"].as_str().map(str::to_owned);
            let result = blocking(&auth, move |a| {
                a.store
                    .start_native_login(&a.config.origin(), platform.as_deref(), now())
            })
            .await
            .map_err(|e| {
                if e.downcast_ref::<store::LoginCapacity>().is_some() {
                    error(StatusCode::TOO_MANY_REQUESTS, "Try again later")
                } else {
                    unavailable(e)
                }
            })?;
            Ok(Json(result).into_response())
        }
        Some("revoke") => {
            let token = headers
                .get("authorization")
                .and_then(|h| h.to_str().ok())
                .and_then(valid_native_authorization)
                .ok_or_else(|| StatusCode::UNAUTHORIZED.into_response())?
                .to_owned();
            let check = token.clone();
            if blocking(&auth, move |a| a.store.user_for_native_token(&check, now()))
                .await
                .map_err(unavailable)?
                .is_none()
            {
                return Err(StatusCode::UNAUTHORIZED.into_response());
            }
            blocking(&auth, move |a| a.store.revoke_native_login(&token))
                .await
                .map_err(unavailable)?;
            Ok(Json(json!({"revoked":true})).into_response())
        }
        operation => {
            let id = value["id"]
                .as_str()
                .filter(|id| valid_nonce(id))
                .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?
                .to_owned();
            match operation {
                Some("approve") => {
                    same_origin(&auth, &headers)?;
                    // Approval is browser consent, never bearer authentication.
                    if headers.contains_key("authorization") {
                        return Err(StatusCode::UNAUTHORIZED.into_response());
                    }
                    let caller = caller(&auth, &headers).await?;
                    let user = caller
                        .user
                        .ok_or_else(|| StatusCode::UNAUTHORIZED.into_response())?;
                    let ticket = blocking(&auth, move |a| {
                        a.store.approve_native_login(&id, &user.id, now())
                    })
                    .await
                    .map_err(unavailable)?;
                    let status = if ticket.is_some() {
                        StatusCode::OK
                    } else {
                        StatusCode::GONE
                    };
                    Ok(with_cookie(
                        (
                            status,
                            Json(json!({"approved":ticket.is_some(),"ticket":ticket})),
                        )
                            .into_response(),
                        caller.renewed,
                    ))
                }
                Some("poll") => {
                    let secret = value["secret"]
                        .as_str()
                        .filter(|s| valid_nonce(s))
                        .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?
                        .to_owned();
                    let ticket = if let Some(value) = value.get("ticket") {
                        Some(
                            value
                                .as_str()
                                .filter(|s| valid_nonce(s))
                                .ok_or_else(|| StatusCode::BAD_REQUEST.into_response())?
                                .to_owned(),
                        )
                    } else {
                        None
                    };
                    let result = blocking(&auth, move |a| {
                        a.store
                            .poll_native_login(&id, &secret, ticket.as_deref(), now())
                    })
                    .await
                    .map_err(unavailable)?;
                    let status = if matches!(result, store::PollResult::SlowDown) {
                        StatusCode::TOO_MANY_REQUESTS
                    } else {
                        StatusCode::OK
                    };
                    Ok((status, Json(result)).into_response())
                }
                _ => Err(StatusCode::BAD_REQUEST.into_response()),
            }
        }
    }
}
async fn sign_in(
    State(state): State<Arc<Accounts>>,
    request: Request,
) -> Result<Response, Response> {
    let auth = state.require()?;
    same_origin(&auth, request.headers())?;
    state.rate_limit(request.headers(), "google-login")?;
    let value = json_body(request, 4096).await?;
    if value["provider"] != "google" {
        return Err(error(StatusCode::BAD_REQUEST, "Unknown sign-in provider."));
    }
    for key in ["callbackURL", "errorCallbackURL"] {
        if value.get(key).is_some_and(|v| !v.is_string()) {
            return Err(error(StatusCode::BAD_REQUEST, "Invalid return address."));
        }
    }
    let callback = value["callbackURL"].as_str().map(str::to_owned);
    let error_url = value["errorCallbackURL"].as_str().map(str::to_owned);
    let (url, proof) = blocking(&auth, move |a| {
        a.start(callback.as_deref(), error_url.as_deref(), now())
    })
    .await
    .map_err(|_| {
        error(
            StatusCode::BAD_REQUEST,
            "Could not start sign-in. Check the return address and try again.",
        )
    })?;
    Ok(with_cookie(
        Json(json!({"url":url,"redirect":true})).into_response(),
        Some(auth.config.cookie("oauth", &proof, 600)),
    ))
}
async fn callback(
    State(state): State<Arc<Accounts>>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let auth = state.require()?;
    let state = query.get("state").cloned().unwrap_or_default();
    let proof = cookie(&headers, &auth.config.cookie_name("oauth"))
        .unwrap_or_default()
        .to_owned();
    let flow = blocking(&auth, move |a| a.take_flow(&state, &proof, now())).await;
    let mut response = if let Ok(flow) = flow {
        let result = if query.contains_key("error") {
            Err(anyhow::anyhow!("Google sign-in declined"))
        } else {
            auth.exchange(query.get("code").map(String::as_str).unwrap_or(""), &flow)
                .await
        };
        match result {
            Ok(identity) => {
                let token = blocking(&auth, move |a| a.sign_in(identity, now())).await;
                match token {
                    Ok(token) => with_cookie(
                        Redirect::to(&flow.callback).into_response(),
                        Some(auth.config.cookie("session", &token, 30 * 86_400)),
                    ),
                    Err(error) => {
                        tracing::error!("Google account creation failed: {error}");
                        Redirect::to(&flow.error).into_response()
                    }
                }
            }
            Err(error) => {
                tracing::warn!("Google sign-in was not completed: {error}");
                Redirect::to(&flow.error).into_response()
            }
        }
    } else {
        Redirect::to("/account?signin=failed").into_response()
    };
    // Redirect status remains 302 for the existing browser/native contract.
    *response.status_mut() = StatusCode::FOUND;
    Ok(with_cookie(
        response,
        Some(auth.config.cookie("oauth", "", 0)),
    ))
}
async fn sign_out(
    State(state): State<Arc<Accounts>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let auth = state.require()?;
    same_origin(&auth, &headers)?;
    if let Some(token) = cookie(&headers, &auth.config.cookie_name("session")) {
        let token = token.to_owned();
        blocking(&auth, move |a| a.sign_out(&token))
            .await
            .map_err(unavailable)?;
    }
    Ok(with_cookie(
        Json(json!({"success":true})).into_response(),
        Some(auth.config.cookie("session", "", 0)),
    ))
}
async fn session(
    State(state): State<Arc<Accounts>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let auth = state.require()?;
    if headers.contains_key("authorization") {
        return Err(error(
            StatusCode::UNAUTHORIZED,
            "Use the account endpoint for native credentials.",
        ));
    }
    let token = cookie(&headers, &auth.config.cookie_name("session"))
        .unwrap_or_default()
        .to_owned();
    let saved = token.clone();
    let result = blocking(&auth, move |a| a.session(&saved, now()))
        .await
        .map_err(unavailable)?;
    let renewed = result
        .as_ref()
        .filter(|s| s.renewed)
        .map(|_| auth.config.cookie("session", &token, 30 * 86_400));
    let response = if let Some(session) = result {
        Json(
            json!({"user":session.user,"session":{"id":session.id,"expiresAt":session.expires_at}}),
        )
    } else {
        Json(Value::Null)
    };
    Ok(with_cookie(response.into_response(), renewed))
}
async fn account_document(
    State(state): State<Arc<Accounts>>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    document(state, query, headers, false).await
}
async fn native_document(
    State(state): State<Arc<Accounts>>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    document(state, query, headers, true).await
}
async fn document(
    state: Arc<Accounts>,
    query: HashMap<String, String>,
    headers: HeaderMap,
    native: bool,
) -> Result<Response, Response> {
    let mut user = None;
    let mut login = None;
    let mut renewed = None;
    if let Some(auth) = &state.auth {
        // Account documents always describe the browser identity.
        let mut browser_headers = headers.clone();
        browser_headers.remove("authorization");
        let caller = caller(auth, &browser_headers).await?;
        user = caller.user;
        renewed = caller.renewed;
        if native {
            if let Some(id) = query.get("id").filter(|id| valid_nonce(id)) {
                let id = id.clone();
                login = blocking(auth, move |a| a.store.pending_native_login(&id, now()))
                    .await
                    .map_err(unavailable)?;
            }
        }
    }
    let mut response = with_cookie(
        Html(documents::render(
            user.as_ref(),
            login.as_ref(),
            native,
            state.auth.is_some(),
            query.contains_key("signin"),
        ))
        .into_response(),
        renewed,
    );
    response.headers_mut().insert("content-security-policy","default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'".parse().unwrap());
    Ok(response)
}

/// Schema work is available only through the explicit --init-accounts command.
pub fn initialize(path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let existed = path.exists();
    let db = rusqlite::Connection::open(path)?;
    #[cfg(unix)]
    if !existed {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = existed;
    db.execute_batch(include_str!("../../accounts-schema.sql"))?;
    let has_ticket = db
        .prepare("PRAGMA table_info(native_login)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == "ticket_hash");
    if !has_ticket {
        db.execute("ALTER TABLE native_login ADD COLUMN ticket_hash TEXT", [])?;
    }
    Ok(())
}
