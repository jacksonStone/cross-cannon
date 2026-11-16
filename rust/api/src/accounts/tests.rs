//! HTTP contracts exercised against real SQLite account state. Google network
//! access is unnecessary for authentication, synchronization, and handoff tests.
use super::*;
use axum::{
    body::Body,
    http::{Method, Request as HttpRequest},
};
use http_body_util::BodyExt;
use rusqlite::params;
use tower::ServiceExt;

const ORIGIN: &str = "http://127.0.0.1:3005";
const USER: &str = "legacy-reader";

struct TestDatabase(PathBuf);
impl Drop for TestDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Fixture {
    router: Router,
    auth: Arc<Auth>,
    cookie: String,
    _database: TestDatabase,
}

impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "crosscanon-http-account-{}-{}",
            std::process::id(),
            auth::nonce().unwrap()
        ));
        let path = directory.join("accounts.db");
        initialize(&path).unwrap();
        let config = Config::new(
            ORIGIN,
            "test-client.apps.googleusercontent.com".into(),
            "test-only-google-secret".into(),
        )
        .unwrap();
        let auth = Arc::new(Auth::new(config, &path).unwrap());
        auth.store.with_connection(|db| {
            db.execute("INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,'reader@example.test',1,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z')", params![USER, "Reader <script>"])?;
            db.execute("INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES ('legacy-account','google-stable-subject','google',?,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z')", [USER])?;
            db.execute("INSERT INTO reader_progress VALUES (?,'fathers',?,4)", params![USER, json!({"version":2,"corpus":"fathers","chapterKey":"anf09:xii.iv.i","passageRange":"1-3"}).to_string()])?;
            db.execute("INSERT INTO study_items VALUES (?,'old-note',?,3)", params![USER, note("old-note").to_string()])?;
            Ok(())
        }).unwrap();
        let token = auth
            .sign_in(
                auth::Identity {
                    subject: "google-stable-subject".into(),
                    email: "reader@example.test".into(),
                    name: "Changed Google Name".into(),
                },
                now(),
            )
            .unwrap();
        let cookie = format!("{}={token}", auth.config.cookie_name("session"));
        let router = routes(Arc::new(Accounts {
            auth: Some(auth.clone()),
            configured: true,
            attempts: Mutex::new(HashMap::new()),
        }));
        Self {
            router,
            auth,
            cookie,
            _database: TestDatabase(directory),
        }
    }
    async fn request(
        &self,
        method: Method,
        path: &str,
        headers: &[(&str, &str)],
        body: impl Into<Body>,
    ) -> Response {
        let mut request = HttpRequest::builder().method(method).uri(path);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let response = self
            .router
            .clone()
            .oneshot(request.body(body.into()).unwrap())
            .await
            .unwrap();
        private_headers(&response);
        response
    }
    async fn get(&self, path: &str, headers: &[(&str, &str)]) -> Response {
        self.request(Method::GET, path, headers, Body::empty())
            .await
    }
    async fn post(&self, path: &str, headers: &[(&str, &str)], value: Value) -> Response {
        let mut headers = headers.to_vec();
        headers.push(("content-type", "application/json"));
        self.request(Method::POST, path, &headers, value.to_string())
            .await
    }
    fn browser(&self) -> [(&str, &str); 2] {
        [("cookie", &self.cookie), ("origin", ORIGIN)]
    }
}

fn private_headers(response: &Response) {
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    assert_eq!(response.headers()["vary"], "Cookie");
    assert_eq!(response.headers()["referrer-policy"], "no-referrer");
}
async fn json_response(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
fn location() -> Value {
    json!({"version":2,"corpus":"scripture","chapterKey":"John\t3","passageKey":"John:3:16"})
}
fn note(id: &str) -> Value {
    json!({"id":id,"kind":"note","location":location(),"reference":"John 3:16","quote":"For God so loved the world","title":"","body":"## A note\n\n**A connection**","color":"yellow","notebookId":null,"deleted":false,"createdAt":123456789})
}

#[tokio::test]
async fn existing_google_identity_restores_existing_progress_and_study_without_exposing_credentials(
) {
    let fixture = Fixture::new();
    let response = fixture
        .get("/api/account", &[("cookie", &fixture.cookie)])
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let result = json_response(response).await;
    assert_eq!(result["user"]["id"], USER);
    assert_eq!(
        result["user"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["email", "id", "name"]
    );
    assert_eq!(result["progress"]["fathers"]["revision"], 4);
    assert_eq!(
        result["progress"]["fathers"]["location"]["passageRange"],
        "1-3"
    );
    assert!(result.get("session").is_none());
    let result = json_response(
        fixture
            .get("/api/study", &[("cookie", &fixture.cookie)])
            .await,
    )
    .await;
    assert_eq!(result["userId"], USER);
    assert_eq!(result["records"][0]["item"]["id"], "old-note");
    assert_eq!(result["records"][0]["revision"], 3);
    let response = fixture
        .get("/account", &[("cookie", &fixture.cookie)])
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("frame-ancestors 'none'"));
    let html = String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("Reader &lt;script&gt;"));
    assert!(!html.contains("Reader <script>"));
    assert!(!html.contains("ccs_"));
}

#[tokio::test]
async fn invalid_native_authorization_never_falls_back_to_a_valid_browser_cookie() {
    let fixture = Fixture::new();
    assert_eq!(
        json_response(fixture.get("/api/account", &[]).await).await["user"],
        Value::Null
    );
    assert_eq!(
        fixture.get("/api/study", &[]).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let headers = [
        ("cookie", fixture.cookie.as_str()),
        ("authorization", "Bearer invalid"),
        ("origin", ORIGIN),
    ];
    for path in ["/api/account", "/api/study"] {
        assert_eq!(
            fixture.get(path, &headers).await.status(),
            StatusCode::UNAUTHORIZED
        );
        let body = if path == "/api/study" {
            json!({"userId":USER,"item":note("blocked"),"revision":0})
        } else {
            json!({"location":location(),"revision":0})
        };
        assert_eq!(
            fixture.post(path, &headers, body).await.status(),
            StatusCode::UNAUTHORIZED
        );
    }
    assert!(!fixture
        .auth
        .store
        .progress(USER)
        .unwrap()
        .contains_key("scripture"));
    assert!(!fixture
        .auth
        .store
        .study(USER)
        .unwrap()
        .iter()
        .any(|record| record.item.id == "blocked"));
}

#[tokio::test]
async fn progress_http_validates_origin_body_and_compare_and_swap() {
    let fixture = Fixture::new();
    let body = json!({"location":location(),"revision":0,"userId":"attacker-chosen-id"});
    assert_eq!(
        fixture
            .post("/api/account", &[("origin", ORIGIN)], body.clone())
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        fixture
            .post("/api/account", &[("cookie", &fixture.cookie)], body.clone())
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        fixture
            .post(
                "/api/account",
                &[
                    ("cookie", &fixture.cookie),
                    ("origin", "https://attacker.example")
                ],
                body.clone()
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    for revision in [
        json!(-1),
        json!(1.5),
        json!("0"),
        json!(9_007_199_254_740_992i64),
    ] {
        assert_eq!(
            fixture
                .post(
                    "/api/account",
                    &fixture.browser(),
                    json!({"location":location(),"revision":revision})
                )
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    for invalid in [
        json!({"corpus":"unknown"}),
        json!({"version":2,"corpus":"scripture","chapterKey":""}),
        json!({"version":2,"corpus":"scripture","chapterKey":"John\t3","passageKey":{}}),
    ] {
        assert_eq!(
            fixture
                .post(
                    "/api/account",
                    &fixture.browser(),
                    json!({"location":invalid,"revision":0})
                )
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        fixture
            .request(Method::POST, "/api/account", &fixture.browser(), "{}")
            .await
            .status(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
    for malformed in ["{", "null", "[]"] {
        let mut headers = fixture.browser().to_vec();
        headers.push(("content-type", "application/json"));
        assert_eq!(
            fixture
                .request(Method::POST, "/api/account", &headers, malformed)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let mut oversized = body.clone();
    oversized["location"]["chapterKey"] = json!("x".repeat(5000));
    assert_eq!(
        fixture
            .post("/api/account", &fixture.browser(), oversized)
            .await
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let response = fixture
        .post("/api/account", &fixture.browser(), body.clone())
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_response(response).await["progress"]["revision"], 1);
    let mut newer = location();
    newer["chapterKey"] = json!("John\t4");
    assert_eq!(
        fixture
            .post(
                "/api/account",
                &fixture.browser(),
                json!({"location":newer,"revision":1})
            )
            .await
            .status(),
        StatusCode::OK
    );
    let stale = fixture
        .post(
            "/api/account",
            &fixture.browser(),
            json!({"location":location(),"revision":1}),
        )
        .await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let stale = json_response(stale).await;
    assert_eq!(stale["saved"], false);
    assert_eq!(stale["progress"]["location"]["chapterKey"], "John\t4");
    assert!(fixture
        .auth
        .store
        .progress("attacker-chosen-id")
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn study_http_keeps_unicode_dates_tombstones_and_account_identity() {
    let fixture = Fixture::new();
    let mut item = note("http-note");
    item["body"] = json!("😀".repeat(8000));
    assert_eq!(
        fixture
            .post(
                "/api/study",
                &fixture.browser(),
                json!({"userId":"wrong-account","item":item,"revision":0})
            )
            .await
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        fixture
            .post(
                "/api/study",
                &fixture.browser(),
                json!({"userId":USER,"item":item,"revision":0})
            )
            .await
            .status(),
        StatusCode::OK
    );
    item["body"] = json!("😀".repeat(8001));
    assert_eq!(
        fixture
            .post(
                "/api/study",
                &fixture.browser(),
                json!({"userId":USER,"item":item,"revision":1})
            )
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    item["body"] = json!("Edited by older client");
    item.as_object_mut().unwrap().remove("createdAt");
    item["deleted"] = json!(true);
    let response = fixture
        .post(
            "/api/study",
            &fixture.browser(),
            json!({"userId":USER,"item":item,"revision":1}),
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let result = json_response(response).await;
    assert_eq!(result["record"]["item"]["createdAt"], 123456789);
    let stale = fixture
        .post(
            "/api/study",
            &fixture.browser(),
            json!({"userId":USER,"item":note("http-note"),"revision":1}),
        )
        .await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_response(stale).await["record"]["item"]["deleted"],
        true
    );
}

#[tokio::test]
async fn native_http_requires_browser_consent_device_proof_and_one_use_ticket() {
    let fixture = Fixture::new();
    let response = fixture
        .post(
            "/api/native-login",
            &[],
            json!({"operation":"start","platform":"ios"}),
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let login = json_response(response).await;
    let id = login["id"].as_str().unwrap();
    let secret = login["secret"].as_str().unwrap();
    assert_eq!(
        fixture
            .post(
                "/api/native-login",
                &[("origin", ORIGIN)],
                json!({"operation":"approve","id":id})
            )
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        fixture
            .post(
                "/api/native-login",
                &[
                    ("cookie", &fixture.cookie),
                    ("origin", "https://attacker.example")
                ],
                json!({"operation":"approve","id":id})
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let approval = fixture
        .post(
            "/api/native-login",
            &fixture.browser(),
            json!({"operation":"approve","id":id}),
        )
        .await;
    assert_eq!(approval.status(), StatusCode::OK);
    let approval = json_response(approval).await;
    let ticket = approval["ticket"].as_str().unwrap();
    assert_eq!(
        fixture
            .post(
                "/api/native-login",
                &fixture.browser(),
                json!({"operation":"approve","id":id})
            )
            .await
            .status(),
        StatusCode::GONE
    );
    let pending = json_response(
        fixture
            .post(
                "/api/native-login",
                &[],
                json!({"operation":"poll","id":id,"secret":secret}),
            )
            .await,
    )
    .await;
    assert_eq!(pending["status"], "pending");
    assert!(pending.get("token").is_none());
    for body in [
        json!({"operation":"poll","id":id,"secret":"0".repeat(64),"ticket":ticket}),
        json!({"operation":"poll","id":id,"secret":secret,"ticket":"0".repeat(64)}),
    ] {
        assert_eq!(
            json_response(fixture.post("/api/native-login", &[], body).await).await["status"],
            "expired"
        );
    }
    assert_eq!(
        fixture
            .post(
                "/api/native-login",
                &[],
                json!({"operation":"poll","id":id,"secret":secret,"ticket":null})
            )
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let complete = json_response(
        fixture
            .post(
                "/api/native-login",
                &[],
                json!({"operation":"poll","id":id,"secret":secret,"ticket":ticket}),
            )
            .await,
    )
    .await;
    assert_eq!(complete["status"], "complete");
    let bearer = format!("Bearer {}", complete["token"].as_str().unwrap());
    assert_eq!(
        json_response(
            fixture
                .get("/api/account", &[("authorization", &bearer)])
                .await
        )
        .await["user"]["id"],
        USER
    );
    let headers = [("authorization", bearer.as_str())];
    assert_eq!(
        fixture
            .post(
                "/api/account",
                &headers,
                json!({"location":location(),"revision":0})
            )
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        fixture
            .post(
                "/api/account",
                &[
                    ("authorization", &bearer),
                    ("origin", "https://attacker.example")
                ],
                json!({"location":location(),"revision":1})
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        json_response(
            fixture
                .post(
                    "/api/native-login",
                    &[],
                    json!({"operation":"poll","id":id,"secret":secret,"ticket":ticket})
                )
                .await
        )
        .await["status"],
        "expired"
    );
    assert_eq!(
        fixture
            .post("/api/native-login", &headers, json!({"operation":"revoke"}))
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        fixture.get("/api/account", &headers).await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        json_response(
            fixture
                .get("/api/account", &[("cookie", &fixture.cookie)])
                .await
        )
        .await["user"]["id"],
        USER
    );
}

#[tokio::test]
async fn oauth_http_binds_redirects_and_clears_failed_flows_and_sign_out() {
    let fixture = Fixture::new();
    let body = json!({"provider":"google","callbackURL":"/account"});
    assert_eq!(
        fixture
            .post(
                "/api/auth/sign-in/social",
                &[("origin", "https://attacker.example")],
                body.clone()
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        fixture
            .post(
                "/api/auth/sign-in/social",
                &[("origin", ORIGIN)],
                json!({"provider":"google","callbackURL":"//attacker.example"})
            )
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let response = fixture
        .post("/api/auth/sign-in/social", &[("origin", ORIGIN)], body)
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let proof_cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let url = url::Url::parse(json_response(response).await["url"].as_str().unwrap()).unwrap();
    let query = url.query_pairs().collect::<HashMap<_, _>>();
    assert_eq!(
        url.origin().ascii_serialization(),
        "https://accounts.google.com"
    );
    assert_eq!(
        query["redirect_uri"],
        format!("{ORIGIN}/api/auth/callback/google")
    );
    assert_eq!(query["code_challenge_method"], "S256");
    assert!(valid_nonce(&query["state"]));
    assert!(valid_nonce(&query["nonce"]));
    let path = format!(
        "/api/auth/callback/google?state={}&error=access_denied",
        query["state"]
    );
    let response = fixture.get(&path, &[("cookie", &proof_cookie)]).await;
    assert_eq!(response.status(), StatusCode::FOUND);
    assert!(response.headers()["location"]
        .to_str()
        .unwrap()
        .contains("signin=failed"));
    let set_cookie = response.headers()["set-cookie"].to_str().unwrap();
    assert!(set_cookie.contains("Max-Age=0"));
    assert!(!set_cookie.contains("ccs_"));
    let replay = fixture.get(&path, &[("cookie", &proof_cookie)]).await;
    assert_eq!(replay.status(), StatusCode::FOUND);
    assert_eq!(replay.headers()["location"], "/account?signin=failed");
    let forged = fixture
        .get(
            "/api/auth/callback/google?state=forged&code=fake",
            &[("cookie", &proof_cookie)],
        )
        .await;
    assert_eq!(forged.status(), StatusCode::FOUND);
    assert!(forged.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    assert_eq!(
        fixture
            .post(
                "/api/auth/sign-out",
                &[("cookie", &fixture.cookie)],
                json!({})
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let out = fixture
        .post("/api/auth/sign-out", &fixture.browser(), json!({}))
        .await;
    assert_eq!(out.status(), StatusCode::OK);
    assert!(out.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    assert_eq!(
        json_response(
            fixture
                .get("/api/account", &[("cookie", &fixture.cookie)])
                .await
        )
        .await["user"],
        Value::Null
    );
}

#[tokio::test]
async fn disabled_accounts_and_method_errors_keep_private_headers() {
    let router = routes(Arc::new(Accounts {
        auth: None,
        configured: false,
        attempts: Mutex::new(HashMap::new()),
    }));
    for (method, path, status) in [
        (Method::GET, "/api/account", StatusCode::OK),
        (Method::GET, "/api/study", StatusCode::SERVICE_UNAVAILABLE),
        (
            Method::POST,
            "/api/account",
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            Method::GET,
            "/api/native-login",
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        (Method::PUT, "/api/account", StatusCode::METHOD_NOT_ALLOWED),
        (Method::GET, "/api/auth/unknown", StatusCode::NOT_FOUND),
        (Method::GET, "/account", StatusCode::OK),
        (Method::GET, "/account/native", StatusCode::OK),
    ] {
        let response = router
            .clone()
            .oneshot(
                HttpRequest::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{path}");
        private_headers(&response);
    }
}
