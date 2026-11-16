//! Google authorization-code login and opaque, hashed browser sessions.
//! Provider tokens are verified and discarded; no provider credential vault is
//! needed because the reader only needs identity, never delegated Google access.
use super::store::{Store, User};
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use url::Url;

const DAY: i64 = 86_400_000;
const SESSION_LIFETIME: i64 = 30 * DAY;
const FLOW_LIFETIME: i64 = 600_000;

pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub(crate) fn nonce() -> Result<String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("Secure randomness unavailable"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
pub(crate) fn hash(value: &str) -> String {
    digest::digest(&digest::SHA256, value.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn date(millis: i64) -> String {
    chrono::DateTime::from_timestamp_millis(millis)
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn timestamp(value: &str) -> Result<i64> {
    Ok(chrono::DateTime::parse_from_rfc3339(value)?.timestamp_millis())
}

#[derive(Clone)]
pub(crate) struct Config {
    pub origin: Url,
    pub client_id: String,
    pub client_secret: String,
}
impl Config {
    pub fn new(origin: &str, client_id: String, client_secret: String) -> Result<Self> {
        let origin = Url::parse(origin)?;
        ensure!(
            origin.scheme() == "https"
                || origin.scheme() == "http"
                    && matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
            "Accounts require HTTPS except on loopback"
        );
        ensure!(
            origin.username().is_empty()
                && origin.password().is_none()
                && origin.query().is_none()
                && origin.fragment().is_none()
                && origin.path() == "/",
            "Account URL must be an origin"
        );
        ensure!(
            !client_id.is_empty() && !client_secret.is_empty(),
            "Missing Google credentials"
        );
        Ok(Self {
            origin,
            client_id,
            client_secret,
        })
    }
    pub fn origin(&self) -> String {
        self.origin.origin().ascii_serialization()
    }
    pub fn callback(&self) -> String {
        format!("{}/api/auth/callback/google", self.origin())
    }
    pub fn cookie_name(&self, kind: &str) -> String {
        format!(
            "{}crosscanon.{kind}",
            if self.origin.scheme() == "https" {
                "__Host-"
            } else {
                ""
            }
        )
    }
    pub fn cookie(&self, kind: &str, value: &str, age: i64) -> String {
        format!(
            "{}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
            self.cookie_name(kind),
            if self.origin.scheme() == "https" {
                "; Secure"
            } else {
                ""
            }
        )
    }
    pub fn return_url(&self, value: Option<&str>, default: &str) -> Result<String> {
        let value = value.unwrap_or(default);
        ensure!(
            value.len() <= 2048 && !value.chars().any(char::is_control) && !value.contains('\\'),
            "Invalid return address"
        );
        let url = self.origin.join(value)?;
        ensure!(
            url.origin() == self.origin.origin()
                && url.username().is_empty()
                && url.password().is_none(),
            "Invalid return origin"
        );
        Ok(url.to_string())
    }
}

pub(crate) struct Auth {
    pub config: Config,
    pub store: Store,
    client: reqwest::Client,
    provider: Provider,
    keys: Mutex<Option<(Instant, JwkSet)>>,
}
struct Provider {
    authorize: String,
    token: String,
    keys: String,
}
impl Default for Provider {
    fn default() -> Self {
        Self {
            authorize: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            keys: "https://www.googleapis.com/oauth2/v3/certs".into(),
        }
    }
}
#[derive(Serialize, Deserialize)]
pub(crate) struct Flow {
    proof: String,
    verifier: String,
    nonce: String,
    pub callback: String,
    pub error: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Session {
    pub user: User,
    pub id: String,
    pub expires_at: String,
    pub renewed: bool,
}
#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    email: String,
    email_verified: bool,
    name: Option<String>,
    nonce: String,
    iat: i64,
    azp: Option<String>,
    aud: serde_json::Value,
}

impl Auth {
    pub fn new(config: Config, path: &Path) -> Result<Self> {
        Ok(Self {
            config,
            store: Store::open(path)?,
            provider: Provider::default(),
            keys: Mutex::new(None),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .connect_timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
    pub fn start(
        &self,
        callback: Option<&str>,
        error: Option<&str>,
        time: i64,
    ) -> Result<(String, String)> {
        let state = nonce()?;
        let proof = nonce()?;
        let verifier = nonce()?;
        let id_nonce = nonce()?;
        let callback = self.config.return_url(callback, "/account")?;
        let error = self.config.return_url(error, "/account?signin=failed")?;
        let flow = Flow {
            proof: hash(&proof),
            verifier: verifier.clone(),
            nonce: id_nonce.clone(),
            callback,
            error,
        };
        self.store.with_connection(|db| {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute("DELETE FROM verification WHERE identifier LIKE 'crosscanon:oauth:%' AND expiresAt <= ?", [date(time)])?;
            let count: i64 = tx.query_row("SELECT COUNT(*) FROM verification WHERE identifier LIKE 'crosscanon:oauth:%'", [], |r| r.get(0))?;
            ensure!(count < 1000, "Too many pending sign-ins");
            tx.execute("INSERT INTO verification (id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)", params![nonce()?, format!("crosscanon:oauth:{}", hash(&state)), serde_json::to_string(&flow)?, date(time + FLOW_LIFETIME), date(time), date(time)])?;
            tx.commit()?;
            Ok(())
        })?;
        let mut url = Url::parse(&self.provider.authorize)?;
        url.query_pairs_mut().extend_pairs([
            ("client_id", self.config.client_id.as_str()),
            ("redirect_uri", &self.config.callback()),
            ("response_type", "code"),
            ("scope", "openid email profile"),
            ("state", &state),
            (
                "code_challenge",
                &URL_SAFE_NO_PAD
                    .encode(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref()),
            ),
            ("code_challenge_method", "S256"),
            ("nonce", &id_nonce),
        ]);
        Ok((url.to_string(), proof))
    }
    pub fn take_flow(&self, state: &str, proof: &str, time: i64) -> Result<Flow> {
        ensure!(
            super::protocol::valid_nonce(state) && super::protocol::valid_nonce(proof),
            "Invalid OAuth state"
        );
        self.store.with_connection(|db| {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let identifier = format!("crosscanon:oauth:{}", hash(state));
            let (value, expires): (String, String) = tx.query_row(
                "SELECT value,expiresAt FROM verification WHERE identifier=?",
                [&identifier],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let flow: Flow = serde_json::from_str(&value)?;
            ensure!(
                timestamp(&expires)? > time && constant_equal(&flow.proof, &hash(proof)),
                "Expired or unbound OAuth state"
            );
            tx.execute("DELETE FROM verification WHERE identifier=?", [identifier])?;
            tx.commit()?;
            Ok(flow)
        })
    }
    async fn signing_key(&self, kid: &str) -> Result<DecodingKey> {
        let mut keys = self.keys.lock().await;
        if let Some((loaded, set)) = keys
            .as_ref()
            .filter(|(loaded, _)| loaded.elapsed() < Duration::from_secs(1800))
        {
            let _ = loaded;
            if let Some(key) = set.find(kid) {
                return Ok(DecodingKey::from_jwk(key)?);
            }
        }
        let response = self
            .client
            .get(&self.provider.keys)
            .send()
            .await?
            .error_for_status()?;
        let set: JwkSet = bounded_json(response, 256_000).await?;
        let key = DecodingKey::from_jwk(set.find(kid).context("Unknown Google signing key")?)?;
        *keys = Some((Instant::now(), set));
        Ok(key)
    }
    pub async fn exchange(&self, code: &str, flow: &Flow) -> Result<Identity> {
        ensure!(
            !code.is_empty() && code.len() <= 4096,
            "Invalid authorization code"
        );
        let response = self
            .client
            .post(&self.provider.token)
            .form(&[
                ("client_id", self.config.client_id.as_str()),
                ("client_secret", self.config.client_secret.as_str()),
                ("redirect_uri", &self.config.callback()),
                ("grant_type", "authorization_code"),
                ("code", code),
                ("code_verifier", &flow.verifier),
            ])
            .send()
            .await?
            .error_for_status()?;
        let response: serde_json::Value = bounded_json(response, 64_000).await?;
        let token = response["id_token"]
            .as_str()
            .context("Missing Google identity token")?;
        let header = decode_header(token)?;
        ensure!(
            header.alg == Algorithm::RS256,
            "Invalid Google signing algorithm"
        );
        let key = self
            .signing_key(header.kid.as_deref().context("Missing signing key")?)
            .await?;
        self.verify_identity(token, flow, &key, now())
    }
    fn verify_identity(
        &self,
        token: &str,
        flow: &Flow,
        key: &DecodingKey,
        time: i64,
    ) -> Result<Identity> {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[&self.config.client_id]);
        validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
        validation.set_required_spec_claims(&["exp", "iat", "iss", "aud", "sub"]);
        validation.leeway = 30;
        let claims = decode::<Claims>(token, key, &validation)?.claims;
        ensure!(
            constant_equal(&claims.nonce, &flow.nonce)
                && claims.iat <= time / 1000 + 30
                && claims.iat >= time / 1000 - 3600,
            "Invalid Google nonce or issuance time"
        );
        ensure!(
            claims
                .azp
                .as_deref()
                .is_none_or(|azp| azp == self.config.client_id),
            "Invalid authorized party"
        );
        if claims.aud.as_array().is_some_and(|aud| aud.len() > 1) {
            ensure!(
                claims.azp.as_deref() == Some(&self.config.client_id),
                "Missing authorized party"
            );
        }
        ensure!(
            !claims.sub.is_empty()
                && claims.sub.len() <= 255
                && claims.email_verified
                && claims.email.len() <= 320
                && claims.email.contains('@'),
            "Unverified Google identity"
        );
        Ok(Identity {
            subject: claims.sub,
            email: claims.email.to_lowercase(),
            name: claims
                .name
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Reader".into()),
        })
    }
    pub fn sign_in(&self, identity: Identity, time: i64) -> Result<String> {
        let token = format!("ccs_{}", nonce()?);
        self.store.with_connection(|db| {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let user: Option<String> = tx.query_row("SELECT userId FROM account WHERE providerId='google' AND accountId=?", [&identity.subject], |r| r.get(0)).optional()?;
            let user = if let Some(user) = user { user } else {
                // Never link by email: the provider's stable subject owns identity.
                let existing: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM user WHERE email=? COLLATE NOCASE)", [&identity.email], |r| r.get(0))?;
                ensure!(!existing, "This email belongs to another provider identity");
                let user = nonce()?;
                tx.execute("INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)", params![user,identity.name,identity.email,date(time),date(time)])?;
                tx.execute("INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,'google',?,?,?)", params![nonce()?,identity.subject,user,date(time),date(time)])?;
                user
            };
            tx.execute("DELETE FROM session WHERE expiresAt <= ?", [date(time)])?;
            tx.execute("INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)", params![nonce()?,hash(&token),user,date(time+SESSION_LIFETIME),date(time),date(time)])?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(token)
    }
    pub fn session(&self, token: &str, time: i64) -> Result<Option<Session>> {
        if !token
            .strip_prefix("ccs_")
            .is_some_and(super::protocol::valid_nonce)
        {
            return Ok(None);
        }
        self.store.with_connection(|db| {
            let session = db.query_row("SELECT user.id,user.name,user.email,session.id,session.expiresAt,session.updatedAt FROM session JOIN user ON user.id=session.userId WHERE token=?", [hash(token)], |r| Ok((User{id:r.get(0)?,name:r.get(1)?,email:r.get(2)?},r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?))).optional()?;
            let Some((user,id,mut expires_at,updated)) = session else { return Ok(None); };
            if timestamp(&expires_at)? <= time { return Ok(None); }
            let renewed = timestamp(&updated)? <= time - DAY;
            if renewed {
                expires_at = date(time+SESSION_LIFETIME);
                db.execute("UPDATE session SET expiresAt=?,updatedAt=? WHERE id=?", params![expires_at,date(time),id])?;
            }
            Ok(Some(Session { user, id, expires_at, renewed }))
        })
    }
    pub fn sign_out(&self, token: &str) -> Result<()> {
        self.store.with_connection(|db| {
            db.execute("DELETE FROM session WHERE token=?", [hash(token)])?;
            Ok(())
        })
    }
}
pub(crate) struct Identity {
    pub subject: String,
    pub email: String,
    pub name: String,
}

fn constant_equal(a: &str, b: &str) -> bool {
    // Compare fixed-size MACs using ring's constant-time verifier.
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, b"crosscanon nonce comparison");
    let tag = ring::hmac::sign(&key, a.as_bytes());
    ring::hmac::verify(&key, b.as_bytes(), tag.as_ref()).is_ok()
}
async fn bounded_json<T: serde::de::DeserializeOwned>(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<T> {
    ensure!(
        response.content_length().unwrap_or(0) <= limit as u64,
        "Oversized provider response"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= limit,
            "Oversized provider response"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}

pub(crate) fn cookie<'a>(headers: &'a axum::http::HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all("cookie")
        .iter()
        .filter_map(|h| h.to_str().ok())
        .flat_map(|header| header.split(';'))
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then_some(value))
}

pub(crate) async fn blocking<T: Send + 'static>(
    auth: &Arc<Auth>,
    work: impl FnOnce(&Auth) -> Result<T> + Send + 'static,
) -> Result<T> {
    let auth = auth.clone();
    tokio::task::spawn_blocking(move || work(&auth)).await?
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
