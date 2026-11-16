//! These generated RSA keys belong only to the fake Google issuer in tests.
use super::*;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde_json::{json, Value};
use std::path::PathBuf;

struct Fixture {
    auth: Auth,
    directory: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "crosscanon-auth-{}-{}",
            std::process::id(),
            nonce().unwrap()
        ));
        let path = directory.join("accounts.db");
        super::super::initialize(&path).unwrap();
        let config = Config::new(
            "http://127.0.0.1:3005",
            "test-client".into(),
            "test-secret".into(),
        )
        .unwrap();
        Self {
            auth: Auth::new(config, &path).unwrap(),
            directory,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
fn flow() -> Flow {
    Flow {
        proof: hash("browser-proof"),
        verifier: nonce().unwrap(),
        nonce: nonce().unwrap(),
        callback: "http://127.0.0.1:3005/account".into(),
        error: "http://127.0.0.1:3005/account?signin=failed".into(),
    }
}
fn claims(flow: &Flow) -> Value {
    json!({"iss":"https://accounts.google.com","aud":"test-client","sub":"stable-google-id","email":"reader@example.com","email_verified":true,"name":"Reader","iat":now()/1000,"exp":now()/1000+3600,"nonce":flow.nonce})
}
fn token(claims: &Value, kid: &str) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(kid.into());
    encode(
        &header,
        claims,
        &EncodingKey::from_rsa_der(include_bytes!("fixtures/test-only-signing-key.der")),
    )
    .unwrap()
}
fn key() -> DecodingKey {
    let set: JwkSet = serde_json::from_str(include_str!("fixtures/test-only-jwks.json")).unwrap();
    DecodingKey::from_jwk(&set.keys[0]).unwrap()
}
#[test]
fn google_tokens_require_signature_issuer_audience_nonce_and_verified_identity() {
    let fixture = Fixture::new();
    let flow = flow();
    let valid = claims(&flow);
    let identity = fixture
        .auth
        .verify_identity(&token(&valid, "test-only"), &flow, &key(), now())
        .unwrap();
    assert_eq!(identity.subject, "stable-google-id");
    assert_eq!(identity.email, "reader@example.com");
    for (field, value) in [
        ("iss", json!("https://attacker.example")),
        ("aud", json!("other-client")),
        ("nonce", json!("another-browser")),
        ("email_verified", json!(false)),
        ("exp", json!(now() / 1000 - 3600)),
        ("iat", json!(now() / 1000 + 3600)),
        ("sub", json!("")),
        ("azp", json!("other-client")),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = value;
        assert!(
            fixture
                .auth
                .verify_identity(&token(&invalid, "test-only"), &flow, &key(), now())
                .is_err(),
            "{field}"
        );
    }
    for field in ["exp", "iat", "iss", "aud", "sub", "nonce"] {
        let mut invalid = valid.clone();
        invalid.as_object_mut().unwrap().remove(field);
        assert!(
            fixture
                .auth
                .verify_identity(&token(&invalid, "test-only"), &flow, &key(), now())
                .is_err(),
            "missing {field}"
        );
    }
    let mut multiple = valid.clone();
    multiple["aud"] = json!(["test-client", "other-client"]);
    assert!(fixture
        .auth
        .verify_identity(&token(&multiple, "test-only"), &flow, &key(), now())
        .is_err());
    multiple["azp"] = json!("test-client");
    assert!(fixture
        .auth
        .verify_identity(&token(&multiple, "test-only"), &flow, &key(), now())
        .is_ok());
    let mut parts: Vec<_> = token(&valid, "test-only")
        .split('.')
        .map(str::to_owned)
        .collect();
    let mut altered = valid;
    altered["sub"] = json!("forged-user");
    parts[1] = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&altered).unwrap());
    assert!(fixture
        .auth
        .verify_identity(&parts.join("."), &flow, &key(), now())
        .is_err());
    let unsigned = encode(
        &Header::new(Algorithm::HS256),
        &altered,
        &EncodingKey::from_secret(b"fake"),
    )
    .unwrap();
    assert!(fixture
        .auth
        .verify_identity(&unsigned, &flow, &key(), now())
        .is_err());
}
#[test]
fn state_is_browser_bound_expiring_single_use_and_return_urls_stay_same_origin() {
    let fixture = Fixture::new();
    let auth = &fixture.auth;
    let time = now();
    for origin in [
        "http://example.com",
        "https://u:p@example.com",
        "https://example.com/path",
        "https://example.com?query=x",
    ] {
        assert!(Config::new(origin, "client".into(), "secret".into()).is_err());
    }
    for target in [
        "https://attacker.example/",
        "//attacker.example/",
        "javascript:alert(1)",
        "/\\attacker.example/",
        "/account\r\nX-Evil: 1",
    ] {
        assert!(
            auth.config.return_url(Some(target), "/").is_err(),
            "{target}"
        );
    }
    let (url, proof) = auth
        .start(Some("/reader/passage?selected=16"), None, time)
        .unwrap();
    let query: std::collections::HashMap<_, _> = Url::parse(&url)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect();
    assert_eq!(query["redirect_uri"], auth.config.callback());
    assert_eq!(query["code_challenge_method"], "S256");
    let state = &query["state"];
    let stored = auth
        .store
        .with_connection(|db| {
            Ok(db.query_row("SELECT value FROM verification", [], |r| {
                r.get::<_, String>(0)
            })?)
        })
        .unwrap();
    assert!(!stored.contains(state));
    assert!(!stored.contains(&proof));
    assert!(auth.take_flow(state, &"f".repeat(64), time).is_err());
    let saved = auth.take_flow(state, &proof, time).unwrap();
    assert_eq!(
        URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, saved.verifier.as_bytes()).as_ref()),
        query["code_challenge"]
    );
    assert_eq!(saved.nonce, query["nonce"]);
    assert_eq!(
        saved.callback,
        "http://127.0.0.1:3005/reader/passage?selected=16"
    );
    assert!(auth.take_flow(state, &proof, time).is_err());
    let (url, proof) = auth.start(None, None, time).unwrap();
    let state = Url::parse(&url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    assert!(auth
        .take_flow(&state, &proof, time + FLOW_LIFETIME)
        .is_err());
    let secure = Config::new(
        "https://www.crosscanon.com",
        "client".into(),
        "secret".into(),
    )
    .unwrap();
    let cookie = secure.cookie("session", "test", 60);
    assert!(cookie.starts_with("__Host-crosscanon.session=test;"));
    for attribute in ["; Path=/", "; HttpOnly", "; Secure", "; SameSite=Lax"] {
        assert!(cookie.contains(attribute));
    }
    assert!(!cookie.contains("Domain="));
}
#[test]
fn opaque_sessions_are_hashed_renewed_expiring_revocable_and_do_not_link_by_email() {
    let fixture = Fixture::new();
    let auth = &fixture.auth;
    let time = now();
    let identity = || Identity {
        subject: "google-subject".into(),
        email: "reader@example.com".into(),
        name: "Reader".into(),
    };
    let token = auth.sign_in(identity(), time).unwrap();
    let first = auth.session(&token, time).unwrap().unwrap();
    assert!(!first.renewed);
    let stored = auth
        .store
        .with_connection(|db| {
            Ok(db.query_row("SELECT token FROM session", [], |r| r.get::<_, String>(0))?)
        })
        .unwrap();
    assert_ne!(stored, token);
    assert_eq!(stored, hash(&token));
    let renewed = auth.session(&token, time + DAY + 1).unwrap().unwrap();
    assert!(renewed.renewed);
    assert!(timestamp(&renewed.expires_at).unwrap() > timestamp(&first.expires_at).unwrap());
    let second = auth.sign_in(identity(), time + DAY).unwrap();
    assert_eq!(
        auth.session(&second, time + DAY).unwrap().unwrap().user.id,
        first.user.id
    );
    assert!(auth
        .sign_in(
            Identity {
                subject: "different-google-subject".into(),
                ..identity()
            },
            time
        )
        .is_err());
    assert!(auth.session(&token, time + 32 * DAY).unwrap().is_none());
    auth.sign_out(&second).unwrap();
    assert!(auth.session(&second, time + DAY).unwrap().is_none());
    assert!(auth
        .session("old-better-auth-token", time)
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn token_exchange_checks_pkce_uses_real_rs256_and_caches_google_keys() {
    use axum::{
        extract::Form,
        routing::{get, post},
        Json, Router,
    };
    use std::{
        collections::HashMap,
        future::IntoFuture,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };
    let mut fixture = Fixture::new();
    let flow = flow();
    let count = Arc::new(AtomicUsize::new(0));
    let jwt = token(&claims(&flow), "test-only");
    let expected = flow.verifier.clone();
    let keys_count = count.clone();
    let app=Router::new().route("/token",post(move |Form(form):Form<HashMap<String,String>>|{
        let jwt=jwt.clone();let expected=expected.clone();async move{
            assert_eq!(form["code_verifier"],expected);assert_eq!(form["grant_type"],"authorization_code");
            assert_eq!(form["client_id"],"test-client");assert_eq!(form["client_secret"],"test-secret");
            assert_eq!(form["redirect_uri"],"http://127.0.0.1:3005/api/auth/callback/google");
            Json(json!({"id_token":jwt,"access_token":"discard-me","refresh_token":"discard-me-too"}))
        }
    })).route("/keys",get(move ||{let count=keys_count.clone();async move{
        count.fetch_add(1,Ordering::SeqCst);Json(serde_json::from_str::<Value>(include_str!("fixtures/test-only-jwks.json")).unwrap())
    }}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    fixture.auth.provider.token = format!("{origin}/token");
    fixture.auth.provider.keys = format!("{origin}/keys");
    let server = tokio::spawn(axum::serve(listener, app).into_future());
    for _ in 0..2 {
        let identity = fixture
            .auth
            .exchange("real-test-code", &flow)
            .await
            .unwrap();
        assert_eq!(identity.subject, "stable-google-id");
    }
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert!(fixture.auth.exchange("", &flow).await.is_err());
    server.abort();
}

#[tokio::test]
async fn complete_google_callback_issues_cookie_once_then_authenticates_account_requests() {
    use axum::{
        body::Body,
        extract::Form,
        http::Request,
        routing::{get, post},
        Json, Router,
    };
    use http_body_util::BodyExt;
    use std::{
        collections::HashMap,
        future::IntoFuture,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };
    use tower::ServiceExt;
    let fixture = Fixture::new();
    let mut auth = Auth::new(
        fixture.auth.config.clone(),
        &fixture.directory.join("accounts.db"),
    )
    .unwrap();
    let (authorization, proof) = auth
        .start(Some("/reader/saved-passage"), None, now())
        .unwrap();
    let state = Url::parse(&authorization)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    let flow: Flow = auth
        .store
        .with_connection(|db| {
            let json: String = db.query_row("SELECT value FROM verification", [], |r| r.get(0))?;
            Ok(serde_json::from_str(&json)?)
        })
        .unwrap();
    let jwt = token(&claims(&flow), "test-only");
    let expected = flow.verifier.clone();
    let exchanges = Arc::new(AtomicUsize::new(0));
    let calls = exchanges.clone();
    let provider = Router::new()
        .route(
            "/token",
            post(move |Form(form): Form<HashMap<String, String>>| {
                let jwt = jwt.clone();
                let expected = expected.clone();
                let calls = calls.clone();
                async move {
                    assert_eq!(form["code"], "bound-code");
                    assert_eq!(form["code_verifier"], expected);
                    calls.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"id_token":jwt}))
                }
            }),
        )
        .route(
            "/keys",
            get(|| async {
                Json(
                    serde_json::from_str::<Value>(include_str!("fixtures/test-only-jwks.json"))
                        .unwrap(),
                )
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let provider_origin = format!("http://{}", listener.local_addr().unwrap());
    auth.provider.token = format!("{provider_origin}/token");
    auth.provider.keys = format!("{provider_origin}/keys");
    let server = tokio::spawn(axum::serve(listener, provider).into_future());
    let state_value = Arc::new(super::super::Accounts {
        auth: Some(Arc::new(auth)),
        configured: true,
        attempts: Mutex::new(HashMap::new()),
    });
    let app = super::super::routes(state_value.clone());
    let callback_url = format!("/api/auth/callback/google?code=bound-code&state={state}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&callback_url)
                .header("cookie", format!("crosscanon.oauth={proof}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 302);
    assert_eq!(
        response.headers()["location"],
        "http://127.0.0.1:3005/reader/saved-passage"
    );
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    assert!(!response
        .headers()
        .contains_key("access-control-allow-origin"));
    let session_cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|h| h.to_str().ok())
        .find(|h| h.starts_with("crosscanon.session="))
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let account = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/account")
                .header("cookie", &session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(account.status(), 200);
    let body: Value =
        serde_json::from_slice(&account.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["user"]["email"], "reader@example.com");
    assert_eq!(body["progress"], json!({}));
    let replay = app
        .oneshot(
            Request::builder()
                .uri(&callback_url)
                .header("cookie", format!("crosscanon.oauth={proof}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replay.status(), 302);
    assert!(replay
        .headers()
        .get_all("set-cookie")
        .iter()
        .all(|h| !h.to_str().unwrap().starts_with("crosscanon.session=")));
    assert_eq!(exchanges.load(Ordering::SeqCst), 1);
    let auth = state_value.auth.as_ref().unwrap();
    let (accounts, sessions): (i64, i64) = auth
        .store
        .with_connection(|db| {
            Ok((
                db.query_row("SELECT COUNT(*) FROM account", [], |r| r.get(0))?,
                db.query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0))?,
            ))
        })
        .unwrap();
    assert_eq!((accounts, sessions), (1, 1));
    server.abort();
}
