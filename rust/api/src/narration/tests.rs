use super::super::auth::{self, now, Auth, Config};
use super::*;
use axum::{body::Body, http::Request as HttpRequest};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tower::ServiceExt;

const ORIGIN: &str = "http://127.0.0.1:3005";

#[test]
fn provider_configuration_has_no_implicit_embedding_key_fallback() {
    let mut reads = Vec::new();
    let result = configured_provider_key(|name| {
        reads.push(name.to_owned());
        match name {
            "CROSS_CANON_NARRATION_ENABLED" => Some("1".into()),
            "OPENAI_API_KEY" => Some("local-embedding-credential-fixture".into()),
            _ => None,
        }
    });
    assert!(result.is_err());
    assert!(!reads.iter().any(|name| name == "OPENAI_API_KEY"));
    assert_eq!(
        result.unwrap_err().to_string(),
        "Missing narration provider configuration"
    );
}

#[test]
fn provider_configuration_shares_existing_key_only_with_exact_opt_in() {
    for opt_in in [None, Some("0"), Some("true"), Some("1")] {
        let mut reads = Vec::new();
        let result = configured_provider_key(|name| {
            reads.push(name.to_owned());
            match name {
                "CROSS_CANON_NARRATION_ENABLED" => Some("1".into()),
                "CROSS_CANON_NARRATION_USE_EMBEDDINGS_KEY" => opt_in.map(str::to_owned),
                "OPENAI_API_KEY" => Some("local-embedding-credential-fixture".into()),
                _ => None,
            }
        });
        if opt_in == Some("1") {
            assert_eq!(
                result.unwrap().as_deref(),
                Some("local-embedding-credential-fixture")
            );
        } else {
            assert!(result.is_err());
            assert!(!reads.iter().any(|name| name == "OPENAI_API_KEY"));
        }
    }
    assert!(
        configured_provider_key(|name| match name {
            "CROSS_CANON_NARRATION_ENABLED" | "CROSS_CANON_NARRATION_USE_EMBEDDINGS_KEY" =>
                Some("1".into()),
            _ => None,
        })
        .is_err(),
        "An opt-in without an existing credential still fails closed"
    );
}

#[test]
fn provider_configuration_dedicated_key_wins_without_reading_shared_key() {
    let mut reads = Vec::new();
    let result = configured_provider_key(|name| {
        reads.push(name.to_owned());
        match name {
            "CROSS_CANON_NARRATION_ENABLED" | "CROSS_CANON_NARRATION_USE_EMBEDDINGS_KEY" => {
                Some("1".into())
            }
            "CROSS_CANON_NARRATION_API_KEY" => Some("local-dedicated-credential-fixture".into()),
            "OPENAI_API_KEY" => Some("local-embedding-credential-fixture".into()),
            _ => None,
        }
    })
    .unwrap();
    assert_eq!(
        result.as_deref(),
        Some("local-dedicated-credential-fixture")
    );
    assert!(!reads.iter().any(|name| name == "OPENAI_API_KEY"));
    assert!(!reads
        .iter()
        .any(|name| name == "CROSS_CANON_NARRATION_USE_EMBEDDINGS_KEY"));
}

#[test]
fn provider_configuration_disabled_never_reads_any_credential_or_shared_opt_in() {
    for enabled in [None, Some("0"), Some("true")] {
        let mut reads = Vec::new();
        let result = configured_provider_key(|name| {
            reads.push(name.to_owned());
            match name {
                "CROSS_CANON_NARRATION_ENABLED" => enabled.map(str::to_owned),
                "CROSS_CANON_NARRATION_API_KEY" | "OPENAI_API_KEY" => {
                    Some("local-unused-credential-fixture".into())
                }
                "CROSS_CANON_NARRATION_USE_EMBEDDINGS_KEY" => Some("1".into()),
                _ => None,
            }
        })
        .unwrap();
        assert!(result.is_none());
        assert_eq!(reads, vec!["CROSS_CANON_NARRATION_ENABLED"]);
    }
}

struct Fixture {
    root: PathBuf,
    auth: Arc<Auth>,
    accounts: Arc<Accounts>,
    library: Arc<Library>,
    cookie: String,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "crosscanon-narration-http-{}",
            auth::nonce().unwrap()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let db = root.join("accounts.db");
        super::super::initialize(&db).unwrap();
        let auth = Arc::new(
            Auth::new(
                Config::new(ORIGIN, "test-client".into(), "test-only-secret".into()).unwrap(),
                &db,
            )
            .unwrap(),
        );
        let token = auth
            .sign_in(
                auth::Identity {
                    subject: "owner-subject".into(),
                    email: "owner@example.test".into(),
                    name: "Owner".into(),
                },
                now(),
            )
            .unwrap();
        let cookie = format!("{}={token}", auth.config.cookie_name("session"));
        let library:Library=serde_json::from_value(json!({"version":"test-web-v1","books":[{"id":"John","title":"John","corpus":"scripture","chapters":[{"id":"John:3","number":3,"title":"John 3","passageIds":["John:3:16"]}]}],"passages":[{"id":"John:3:16","corpus":"scripture","bookId":"John","book":"John","chapterId":"John:3","chapter":3,"reference":"John 3:16","text":"For God so loved the world.","originalText":"For God so loved the world.","verseStart":16,"verseEnd":16,"verses":[]}],"audio":{}})).unwrap();
        library
            .write_native(root.join("fixture-library.bin"))
            .unwrap();
        let library = Library::from_bytes(
            &root,
            &std::fs::read(root.join("fixture-library.bin")).unwrap(),
        )
        .unwrap();
        let accounts = Arc::new(Accounts {
            auth: Some(auth.clone()),
            configured: true,
            attempts: Default::default(),
        });
        Self {
            root,
            auth,
            accounts,
            library: Arc::new(library),
            cookie,
        }
    }
    fn with_on_prayer() -> Self {
        let mut f = Self::new();
        let repo = super::test_inputs::root();
        let index: Value = serde_json::from_slice(
            &std::fs::read(repo.join("public/church-fathers-preview/books.json")).unwrap(),
        )
        .unwrap();
        let mut work = index["books"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["id"] == "anf03:vi.iv")
            .unwrap()
            .clone();
        let chapter = work["chapters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == "anf03:vi.iv.i")
            .unwrap()
            .clone();
        work["chapters"] = json!([chapter]);
        let source =
            std::fs::read(repo.join("public/church-fathers-preview/chapters/anf03_vi.iv.i.json"))
                .unwrap();
        std::fs::create_dir_all(f.root.join("public/church-fathers-preview/chapters")).unwrap();
        std::fs::write(
            f.root.join("public/church-fathers-preview/books.json"),
            serde_json::to_vec(&json!({"books":[work]})).unwrap(),
        )
        .unwrap();
        std::fs::write(
            f.root
                .join("public/church-fathers-preview/chapters/anf03_vi.iv.i.json"),
            source,
        )
        .unwrap();
        let mut library = serde_json::to_value(f.library.as_ref()).unwrap();
        library["books"].as_array_mut().unwrap().push(json!({"id":"anf03:vi.iv","title":"On Prayer","corpus":"early-christian","author":"Tertullian","chapters":[{"id":"anf03:vi.iv.i","number":1,"title":"Chapter 1","passageIds":["on-prayer-fixture-identity"]}]}));
        library["passages"].as_array_mut().unwrap().push(json!({"id":"on-prayer-fixture-identity","corpus":"early-christian","bookId":"anf03:vi.iv","book":"On Prayer","chapterId":"anf03:vi.iv.i","chapter":1,"reference":"On Prayer 1","text":"Identity only; the server reads the real pinned chapter asset.","originalText":"Identity only; the server reads the real pinned chapter asset.","author":"Tertullian","verseStart":1,"verseEnd":12,"verses":[]}));
        let library: Library = serde_json::from_value(library).unwrap();
        library
            .write_native(f.root.join("fixture-library.bin"))
            .unwrap();
        f.library = Arc::new(
            Library::from_bytes(
                &f.root,
                &std::fs::read(f.root.join("fixture-library.bin")).unwrap(),
            )
            .unwrap(),
        );
        f
    }
    fn cache(&self, attempts: u64) -> Arc<Cache> {
        Cache::open(
            self.root.join("cache"),
            Limits {
                daily_attempts: attempts,
                daily_characters: 20000,
                max_disk_bytes: 64 * 1024 * 1024,
                concurrency: 1,
            },
        )
        .unwrap()
    }
    fn app(&self, cache: Arc<Cache>, provider: ProviderConfig) -> Router {
        routes(Arc::new(Routes {
            accounts: self.accounts.clone(),
            root: self.root.clone(),
            library: self.library.clone(),
            service: Some(Arc::new(Service {
                owners: HashSet::from(["owner@example.test".into()]),
                cache,
                settings: SpeechSettings::default(),
                provider: Arc::new(provider),
                resolution_slots: Arc::new(tokio::sync::Semaphore::new(2)),
            })),
        }))
    }
    fn token_for(&self, email: &str, subject: &str) -> String {
        let token = self
            .auth
            .sign_in(
                auth::Identity {
                    subject: subject.into(),
                    email: email.into(),
                    name: "Reader".into(),
                },
                now(),
            )
            .unwrap();
        format!("{}={token}", self.auth.config.cookie_name("session"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> Response {
    let mut b = HttpRequest::builder().method(method).uri(path);
    if let Some(cookie) = cookie {
        b = b.header("cookie", cookie);
    }
    if method == "POST" {
        b = b
            .header("origin", ORIGIN)
            .header("content-type", "application/json");
    }
    app.clone()
        .oneshot(
            b.body(
                body.map(|v| Body::from(v.to_string()))
                    .unwrap_or_else(Body::empty),
            )
            .unwrap(),
        )
        .await
        .unwrap()
}
async fn data(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
async fn plan_url(app: &Router, cookie: &str) -> String {
    let response = request(
        app,
        "POST",
        "/api/narration/plan",
        Some(cookie),
        Some(json!({"chapterId":"John:3","version":"web"})),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let plan = data(response).await;
    assert_eq!(plan["units"].as_array().unwrap().len(), 1);
    plan["units"][0]["url"].as_str().unwrap().into()
}
async fn mock() -> (
    ProviderConfig,
    Arc<AtomicUsize>,
    Arc<AtomicBool>,
    tokio::task::JoinHandle<()>,
) {
    mock_with_statuses(Vec::new()).await
}
// Even output_audio.done is not a successful terminal response. The mock can
// emit partial PCM plus audio.done before incomplete/cancelled response.done.
async fn mock_with_statuses(
    statuses: Vec<&'static str>,
) -> (
    ProviderConfig,
    Arc<AtomicUsize>,
    Arc<AtomicBool>,
    tokio::task::JoinHandle<()>,
) {
    mock_with_capture(statuses, None).await
}
async fn mock_with_capture(
    statuses: Vec<&'static str>,
    submitted: Option<Arc<std::sync::Mutex<Vec<String>>>>,
) -> (
    ProviderConfig,
    Arc<AtomicUsize>,
    Arc<AtomicBool>,
    tokio::task::JoinHandle<()>,
) {
    mock_with_transcripts(statuses, submitted, Vec::new()).await
}
async fn mock_with_transcripts(
    statuses: Vec<&'static str>,
    submitted: Option<Arc<std::sync::Mutex<Vec<String>>>>,
    transcripts: Vec<String>,
) -> (
    ProviderConfig,
    Arc<AtomicUsize>,
    Arc<AtomicBool>,
    tokio::task::JoinHandle<()>,
) {
    let statuses = Arc::new(statuses);
    let transcripts = Arc::new(transcripts);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}", listener.local_addr().unwrap());
    let count = Arc::new(AtomicUsize::new(0));
    let fail = Arc::new(AtomicBool::new(false));
    let calls = count.clone();
    let failure = fail.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let calls = calls.clone();
            let failure = failure.clone();
            let statuses = statuses.clone();
            let transcripts = transcripts.clone();
            let submitted = submitted.clone();
            tokio::spawn(async move {
                let mut ws = accept_async(stream).await.unwrap();
                let attempt = calls.fetch_add(1, Ordering::SeqCst);
                let final_status = statuses.get(attempt).copied().unwrap_or("completed");
                ws.send(Message::Text(
                    json!({"type":"session.created","session":{"id":"local"}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                let update: Value =
                    serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap())
                        .unwrap();
                ws.send(Message::Text(
                    json!({"type":"session.updated","session":update["session"]})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                let request: Value =
                    serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap())
                        .unwrap();
                let text = request["response"]["input"][0]["content"][0]["text"]
                    .as_str()
                    .unwrap()
                    .to_owned();
                if let Some(submitted) = submitted {
                    submitted.lock().unwrap().push(text.clone());
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                if failure.load(Ordering::SeqCst) {
                    let _ = ws
                        .send(Message::Text(
                            json!({"type":"error","error":{"message":"private provider detail"}})
                                .to_string()
                                .into(),
                        ))
                        .await;
                    return;
                }
                let transcript = transcripts.get(attempt).unwrap_or(&text);
                use base64::Engine;
                let samples = if final_status == "completed" {
                    2400
                } else {
                    120
                };
                let pcm = (0..samples)
                    .flat_map(|n| {
                        (((n as f64 * 440.0 * std::f64::consts::TAU / 24000.0).sin() * 2000.0)
                            as i16)
                            .to_le_bytes()
                    })
                    .collect::<Vec<_>>();
                let event = |kind: &str| json!({"type":kind,"response_id":"r","item_id":"i","output_index":0,"content_index":0});
                let mut audio = event("response.output_audio.delta");
                audio["delta"] = json!(base64::engine::general_purpose::STANDARD.encode(pcm));
                let mut delta = event("response.output_audio_transcript.delta");
                delta["delta"] = json!(transcript);
                let mut done = event("response.output_audio_transcript.done");
                done["transcript"] = json!(transcript);
                for e in [
                    json!({"type":"response.created","response":{"id":"r","status":"in_progress"}}),
                    audio,
                    delta,
                    event("response.output_audio.done"),
                    done,
                    json!({"type":"response.done","response":{"id":"r","status":final_status,"output":[{"id":"i","type":"message","status":"completed","role":"assistant","content":[{"type":"output_audio","transcript":transcript}]}],"usage":{"input_tokens":100,"output_tokens":50,"output_token_details":{"audio_tokens":45}}}}),
                ] {
                    if ws.send(Message::Text(e.to_string().into())).await.is_err() {
                        break;
                    }
                }
                let _ = ws.next().await;
                let _ = ws.close(None).await;
            });
        }
    });
    (ProviderConfig::loopback(endpoint), count, fail, task)
}

#[tokio::test]
async fn owner_auth_concurrent_misses_persistent_replay_and_private_reads() {
    let f = Fixture::new();
    let (provider, calls, _, task) = mock().await;
    let cache = f.cache(4);
    let app = f.app(cache.clone(), provider.clone());
    for cookie in [None, Some("invalid=cookie")] {
        assert_eq!(
            data(request(&app, "GET", "/api/narration/capabilities", cookie, None).await).await
                ["enabled"],
            false
        );
    }
    assert_eq!(
        data(
            request(
                &app,
                "GET",
                "/api/narration/capabilities",
                Some(&f.cookie),
                None
            )
            .await
        )
        .await["enabled"],
        true
    );
    let url = plan_url(&app, &f.cookie).await;
    assert_eq!(calls.load(Ordering::SeqCst), 0, "plan must not generate");
    let (a, b) = tokio::join!(
        request(&app, "GET", &url, Some(&f.cookie), None),
        request(&app, "GET", &url, Some(&f.cookie), None)
    );
    for r in [&a, &b] {
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()["cache-control"], "private, no-store");
        assert_eq!(r.headers()["content-type"], "audio/wav");
    }
    let a = a.into_body().collect().await.unwrap().to_bytes();
    let b = b.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(a, b);
    assert_eq!(&a[..4], b"RIFF");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let other = f.token_for("other@example.test", "other-subject");
    assert_eq!(
        request(&app, "GET", &url, Some(&other), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/narration/plan",
            Some(&other),
            Some(json!({"chapterId":"John:3","version":"web"}))
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    // Stop the entire provider and reopen persistent storage: replay still works.
    drop(app);
    drop(cache);
    task.abort();
    let restarted = f.app(f.cache(1), provider);
    let replay = request(&restarted, "GET", &url, Some(&f.cookie), None).await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(replay.into_body().collect().await.unwrap().to_bytes(), a);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn failure_retry_budget_and_no_partial_cache() {
    let f = Fixture::new();
    let (provider, calls, fail, task) = mock().await;
    let app = f.app(f.cache(2), provider);
    let url = plan_url(&app, &f.cookie).await;
    fail.store(true, Ordering::SeqCst);
    let failed = request(&app, "GET", &url, Some(&f.cookie), None).await;
    assert_eq!(failed.status(), StatusCode::BAD_GATEWAY);
    let error = data(failed).await.to_string();
    assert!(!error.contains("private provider detail"));
    assert!(std::fs::read_dir(f.root.join("cache")).unwrap().all(|e| !e
        .unwrap()
        .path()
        .extension()
        .is_some_and(|e| e == "partial" || e == "wav")));
    fail.store(false, Ordering::SeqCst);
    assert_eq!(
        request(&app, "GET", &url, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", &url, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    task.abort();
}

#[tokio::test]
async fn unverified_identity_invalid_bearer_csrf_arbitrary_text_and_default_off_fail_closed() {
    let f = Fixture::new();
    let (provider, calls, _, task) = mock().await;
    let app = f.app(f.cache(2), provider);
    let bad = HttpRequest::builder()
        .method("POST")
        .uri("/api/narration/plan")
        .header("content-type", "application/json")
        .header("cookie", &f.cookie)
        .body(Body::from(
            json!({"chapterId":"John:3","version":"web"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(bad).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let bad = HttpRequest::builder()
        .uri("/api/narration/capabilities")
        .header("cookie", &f.cookie)
        .header("authorization", "Bearer invalid")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        data(app.clone().oneshot(bad).await.unwrap()).await["enabled"],
        false
    );
    assert_eq!(request(&app,"POST","/api/narration/plan",Some(&f.cookie),Some(json!({"chapterId":"John:3","version":"web","text":"User supplied text must not be accepted."}))).await.status(),StatusCode::BAD_REQUEST);
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/narration/plan",
            Some(&f.cookie),
            Some(json!({"chapterId":"John:3","version":"arbitrary"}))
        )
        .await
        .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    f.auth
        .store
        .with_connection(|db| {
            db.execute("UPDATE user SET emailVerified=0", [])?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        data(
            request(
                &app,
                "GET",
                "/api/narration/capabilities",
                Some(&f.cookie),
                None
            )
            .await
        )
        .await["enabled"],
        false
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let off = routes(Arc::new(Routes {
        accounts: f.accounts.clone(),
        root: f.root.clone(),
        library: f.library.clone(),
        service: None,
    }));
    assert_eq!(
        data(
            request(
                &off,
                "GET",
                "/api/narration/capabilities",
                Some(&f.cookie),
                None
            )
            .await
        )
        .await["enabled"],
        false
    );
    task.abort();
}

#[tokio::test]
async fn native_bearer_works_without_browser_origin_and_revocation_blocks_saved_audio() {
    let f = Fixture::new();
    let (provider, calls, _, task) = mock().await;
    let app = f.app(f.cache(1), provider);
    let token = format!("ccn_{}", auth::nonce().unwrap());
    let token_hash = cache::hash(token.as_bytes());
    f.auth
        .store
        .with_connection(|db| {
            let user: String = db.query_row(
                "SELECT id FROM user WHERE email='owner@example.test'",
                [],
                |r| r.get(0),
            )?;
            db.execute(
                "INSERT INTO native_session (token_hash,user_id,expires_at) VALUES (?,?,?)",
                rusqlite::params![token_hash, user, now() + 60000],
            )?;
            Ok(())
        })
        .unwrap();
    let call = |method: &str, path: &str, body: Option<Value>| {
        let mut request = HttpRequest::builder()
            .method(method)
            .uri(path)
            .header("authorization", format!("Bearer {token}"));
        if body.is_some() {
            request = request.header("content-type", "application/json");
        }
        app.clone().oneshot(
            request
                .body(
                    body.map(|b| Body::from(b.to_string()))
                        .unwrap_or_else(Body::empty),
                )
                .unwrap(),
        )
    };
    let response = call(
        "POST",
        "/api/narration/plan",
        Some(json!({"chapterId":"John:3","version":"web"})),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let plan = data(response).await;
    let url = plan["units"][0]["url"].as_str().unwrap();
    assert_eq!(
        call("GET", url, None).await.unwrap().status(),
        StatusCode::OK
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    f.auth
        .store
        .with_connection(|db| {
            db.execute("DELETE FROM native_session", [])?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        call("GET", url, None).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    task.abort();
}

#[tokio::test]
async fn allowance_is_persistent_failures_count_and_disk_limit_does_not_block_hits() {
    let f = Fixture::new();
    let (provider, calls, fail, task) = mock().await;
    let cache = f.cache(1);
    let app = f.app(cache.clone(), provider.clone());
    let url = plan_url(&app, &f.cookie).await;
    fail.store(true, Ordering::SeqCst);
    assert_eq!(
        request(&app, "GET", &url, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::BAD_GATEWAY
    );
    drop(app);
    drop(cache);
    let cache = f.cache(1);
    let app = f.app(cache.clone(), provider.clone());
    fail.store(false, Ordering::SeqCst);
    assert_eq!(
        request(&app, "GET", &url, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    // Explicit allowance increase allows one retry. Completed clip remains readable
    // when the storage ceiling is subsequently reduced below existing disk usage.
    drop(app);
    drop(cache);
    let cache = f.cache(2);
    let app = f.app(cache.clone(), provider.clone());
    assert_eq!(
        request(&app, "GET", &url, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::OK
    );
    let filler = std::fs::File::create(f.root.join("cache/full-fixture")).unwrap();
    filler.set_len(64 * 1024 * 1024).unwrap();
    assert_eq!(
        plan_url(&app, &f.cookie).await,
        url,
        "full cache must allow replay via the actual Play plan path"
    );
    let missing_id = "c".repeat(64);
    assert!(cache
        .describe(&[(
            missing_id.clone(),
            Descriptor {
                account: "private-owner".into(),
                chapter: "John:4".into(),
                version: "web".into(),
                unit: 0
            }
        )])
        .is_err());
    assert!(
        cache.descriptor(&missing_id).is_err(),
        "rejected plan must not grow persistent descriptors"
    );

    assert_eq!(
        request(&app, "GET", &url, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    task.abort();
}

#[test]
fn exact_identity_covers_account_version_source_voice_speed_and_protocol_and_cache_is_exclusive() {
    let s = SpeechSettings::default();
    let key = |owner: &str, version: &str, edition: &str, text: &str, settings: &SpeechSettings| {
        clip_id(owner, "John:3", version, 0, edition, text, settings)
    };
    let base = key("owner", "web", "edition1", "canonical text", &s);
    for changed in [
        key("other", "web", "edition1", "canonical text", &s),
        key("owner", "msb", "edition1", "canonical text", &s),
        key("owner", "web", "edition2", "canonical text", &s),
        key("owner", "web", "edition1", "changed text", &s),
        key(
            "owner",
            "web",
            "edition1",
            "canonical text",
            &SpeechSettings {
                voice: "marin".into(),
                ..s.clone()
            },
        ),
        key(
            "owner",
            "web",
            "edition1",
            "canonical text",
            &SpeechSettings {
                speed: 0.9,
                ..s.clone()
            },
        ),
    ] {
        assert_ne!(base, changed);
    }
    assert!(cache::valid_id(&base));
    assert!(!cache::valid_id("../../secrets"));
    assert!(!cache::valid_id(&"A".repeat(64)));
    let f = Fixture::new();
    let cache = f.cache(1);
    assert!(
        Cache::open(
            f.root.join("cache"),
            Limits {
                daily_attempts: 1,
                daily_characters: 1000,
                max_disk_bytes: 64 * 1024 * 1024,
                concurrency: 1
            }
        )
        .is_err(),
        "second writer must not bypass dedup or allowance"
    );
    drop(cache);
    std::fs::write(f.root.join("cache/interrupted.partial"), b"not audio").unwrap();
    let _cache = f.cache(1);
    assert!(!f.root.join("cache/interrupted.partial").exists());
}

#[tokio::test]
async fn pending_synthesis_reserves_space_against_concurrent_plan_metadata() {
    let f = Fixture::new();
    let (provider, calls, _, task) = mock().await;
    let cache = f.cache(3);
    let app = f.app(cache.clone(), provider);
    let url = plan_url(&app, &f.cookie).await;
    let used = std::fs::read_dir(f.root.join("cache"))
        .unwrap()
        .map(|e| e.unwrap().metadata().unwrap().len())
        .sum::<u64>();
    let ceiling = 64 * 1024 * 1024;
    let filler = std::fs::File::create(f.root.join("cache/quota-fixture")).unwrap();
    filler
        .set_len(ceiling - used - cache::MAX_CLIP_BYTES - 32 * 1024 - 4096)
        .unwrap();
    let app2 = app.clone();
    let cookie = f.cookie.clone();
    let playing =
        tokio::spawn(async move { request(&app2, "GET", &url, Some(&cookie), None).await });
    for _ in 0..100 {
        if calls.load(Ordering::SeqCst) == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let new = "d".repeat(64);
    let rejected = cache.describe(&[(
        new.clone(),
        Descriptor {
            account: "owner".into(),
            chapter: "John:4".into(),
            version: "web".into(),
            unit: 0,
        },
    )]);
    assert_eq!(
        rejected.unwrap_err().status,
        StatusCode::INSUFFICIENT_STORAGE,
        "new plans must not consume the pending clip's reserved space"
    );
    assert!(cache.descriptor(&new).is_err());
    assert_eq!(playing.await.unwrap().status(), StatusCode::OK);
    let actual = std::fs::read_dir(f.root.join("cache"))
        .unwrap()
        .map(|e| e.unwrap().metadata().unwrap().len())
        .sum::<u64>();
    assert!(actual <= ceiling);
    task.abort();
}

#[tokio::test]
async fn even_two_allowlisted_accounts_cannot_read_each_others_clips() {
    let f = Fixture::new();
    let (provider, calls, _, task) = mock().await;
    let other = f.token_for("second-owner@example.test", "second-owner-subject");
    let app = routes(Arc::new(Routes {
        accounts: f.accounts.clone(),
        root: f.root.clone(),
        library: f.library.clone(),
        service: Some(Arc::new(Service {
            owners: HashSet::from([
                "owner@example.test".into(),
                "second-owner@example.test".into(),
            ]),
            cache: f.cache(4),
            settings: SpeechSettings::default(),
            provider: Arc::new(provider),
            resolution_slots: Arc::new(tokio::sync::Semaphore::new(2)),
        })),
    }));
    let first = plan_url(&app, &f.cookie).await;
    let second = plan_url(&app, &other).await;
    assert_ne!(first, second);
    assert_eq!(
        request(&app, "GET", &first, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", &first, Some(&other), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, "GET", &second, Some(&f.cookie), None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        request(&app, "GET", &second, Some(&other), None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    task.abort();
}

#[tokio::test]
async fn audio_done_then_incomplete_or_cancelled_never_promotes_and_completed_retry_replays_after_restart(
) {
    let f = Fixture::new();
    let (provider, calls, _, task) =
        mock_with_statuses(vec!["incomplete", "cancelled", "completed"]).await;
    let cache = f.cache(4);
    let app = f.app(cache.clone(), provider.clone());
    let url = plan_url(&app, &f.cookie).await;
    for status in ["incomplete", "cancelled"] {
        // Mock sends real partial PCM, transcript and output_audio.done before
        // the non-completed final response.done. Neither done marker suffices.
        assert_eq!(
            request(&app, "GET", &url, Some(&f.cookie), None)
                .await
                .status(),
            StatusCode::BAD_GATEWAY,
            "{status}"
        );
        assert!(
            std::fs::read_dir(f.root.join("cache")).unwrap().all(|e| !e
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "wav" || ext == "partial")),
            "{status} must not promote partial audio"
        );
    }
    let complete = request(&app, "GET", &url, Some(&f.cookie), None).await;
    assert_eq!(complete.status(), StatusCode::OK);
    let expected = complete.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&expected[..4], b"RIFF");
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    drop(app);
    drop(cache);
    task.abort();
    let restarted = f.app(f.cache(4), provider);
    assert_eq!(plan_url(&restarted, &f.cookie).await, url);
    let replay = request(&restarted, "GET", &url, Some(&f.cookie), None).await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(
        replay.into_body().collect().await.unwrap().to_bytes(),
        expected
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        3,
        "retained completed retry must replay with provider stopped"
    );
}

#[tokio::test]
async fn on_prayer_submits_modernization_even_for_original_alias_and_only_changed_text_misses() {
    let f = Fixture::with_on_prayer();
    let submitted = Arc::new(std::sync::Mutex::new(Vec::new()));
    let (provider, calls, _, task) = mock_with_capture(Vec::new(), Some(submitted.clone())).await;
    let app = f.app(f.cache(32), provider);
    let get_plan = |version: &'static str| {
        request(
            &app,
            "POST",
            "/api/narration/plan",
            Some(&f.cookie),
            Some(json!({"chapterId":"anf03:vi.iv.i","version":version})),
        )
    };
    let original_alias = data(get_plan("original").await).await;
    let modernized = data(get_plan("modernized").await).await;
    assert_eq!(
        original_alias, modernized,
        "visual text mode must not create a different narration identity"
    );
    assert_eq!(modernized["version"], "modernized");
    let units = modernized["units"].as_array().unwrap();
    for unit in units {
        assert_eq!(
            request(
                &app,
                "GET",
                unit["url"].as_str().unwrap(),
                Some(&f.cookie),
                None
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    let spoken = submitted.lock().unwrap().concat();
    assert!(spoken.contains("a new piece of cloth be sewn to a new garment"));
    assert!(!spoken.contains("a new breadth be sewn to a new garment"));
    let count = calls.load(Ordering::SeqCst);
    let replay = data(get_plan("original").await).await;
    assert_eq!(replay, modernized);
    assert_eq!(
        request(
            &app,
            "GET",
            units[0]["url"].as_str().unwrap(),
            Some(&f.cookie),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        count,
        "visual toggle must not synthesize another copy"
    );
    let path = f
        .root
        .join("public/church-fathers-preview/chapters/anf03_vi.iv.i.json");
    let mut changed: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    changed["verses"][0]["modernizedText"] =
        json!("A changed canonical modernization begins here.");
    std::fs::write(path, serde_json::to_vec(&changed).unwrap()).unwrap();
    let revised = data(get_plan("modernized").await).await;
    assert_ne!(revised["units"][0]["id"], units[0]["id"]);
    assert_eq!(
        request(
            &app,
            "GET",
            revised["units"][0]["url"].as_str().unwrap(),
            Some(&f.cookie),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        count + 1,
        "changed resolved modernization must miss"
    );
    assert!(submitted
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .starts_with("A changed canonical modernization begins here."));
    task.abort();
}

#[tokio::test]
async fn actual_canary_typography_promotes_only_complete_matching_audio_and_replays_after_reopen() {
    let f = Fixture::new();
    let canary: Value =
        serde_json::from_str(include_str!("fixtures/on-prayer-canary.json")).unwrap();
    let source = canary["source"].as_str().unwrap().to_owned();
    let transcript = canary["transcript"].as_str().unwrap().to_owned();
    let wrong_words = transcript.replace("new piece of cloth", "new breadth");
    assert_ne!(wrong_words, transcript);
    let (provider, calls, _, task) = mock_with_transcripts(
        vec![
            "incomplete",
            "cancelled",
            "failed",
            "completed",
            "completed",
        ],
        None,
        vec![
            transcript.clone(),
            transcript.clone(),
            transcript.clone(),
            wrong_words,
            transcript,
        ],
    )
    .await;
    let provider = Arc::new(provider);
    let settings = provider::SpeechSettings::default();
    let id = cache::clip_id(
        "owner-test",
        "anf03:vi.iv.i",
        "modernized",
        0,
        "canary-fixture",
        &source,
        &settings,
    );
    let cache = f.cache(5);
    for (attempt, invalid) in ["incomplete", "cancelled", "failed", "wrong words"]
        .iter()
        .enumerate()
    {
        assert!(
            cache
                .clip(
                    id.clone(),
                    source.clone(),
                    settings.clone(),
                    provider.clone()
                )
                .await
                .is_err(),
            "{invalid}"
        );
        assert_eq!(calls.load(Ordering::SeqCst), attempt + 1);
        assert!(
            std::fs::read_dir(f.root.join("cache")).unwrap().all(|e| !e
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "wav" || ext == "partial")),
            "{invalid} must not promote audio"
        );
    }
    let accepted = cache
        .clip(
            id.clone(),
            source.clone(),
            settings.clone(),
            provider.clone(),
        )
        .await
        .unwrap();
    assert_eq!(&accepted[..4], b"RIFF");
    assert!(accepted[44..].iter().any(|b| *b != 0));
    assert_eq!(calls.load(Ordering::SeqCst), 5);
    drop(cache);
    task.abort();
    task.await.unwrap_err();
    // With the mock server stopped and a zero-generation budget, a miss cannot
    // succeed or contact the provider. Only the atomically promoted WAV replays.
    let reopened = cache::Cache::open(
        f.root.join("cache"),
        cache::Limits {
            daily_attempts: 0,
            daily_characters: 0,
            max_disk_bytes: 64 * 1024 * 1024,
            concurrency: 1,
        },
    )
    .unwrap();
    let replay = reopened.clip(id, source, settings, provider).await.unwrap();
    assert_eq!(replay, accepted);
    assert_eq!(calls.load(Ordering::SeqCst), 5);
}

#[tokio::test]
async fn cedar_default_cannot_reuse_marin_clip_and_both_replay_without_provider() {
    let f = Fixture::new();
    let settings = SpeechSettings::default();
    assert_eq!(settings.voice, "cedar");
    assert!(settings.valid());
    let marin = SpeechSettings {
        voice: "marin".into(),
        ..settings.clone()
    };
    let source = "A new piece of cloth is sewn to a new garment.".to_owned();
    let identity = |speech: &SpeechSettings| {
        clip_id(
            "voice-test-owner",
            "anf03:vi.iv.i",
            "modernized",
            0,
            "voice-test-edition",
            &source,
            speech,
        )
    };
    let old_id = identity(&marin);
    let new_id = identity(&settings);
    assert_ne!(old_id, new_id, "Cedar must not replay the prior voice");
    let (provider, calls, _, task) = mock().await;
    let provider = Arc::new(provider);
    let cache = f.cache(2);
    let old = cache
        .clip(
            old_id.clone(),
            source.clone(),
            marin.clone(),
            provider.clone(),
        )
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let new = cache
        .clip(
            new_id.clone(),
            source.clone(),
            settings.clone(),
            provider.clone(),
        )
        .await
        .unwrap();
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "Cedar is a distinct cache miss even with Marin retained"
    );
    drop(cache);
    task.abort();
    task.await.unwrap_err();
    let reopened = Cache::open(
        f.root.join("cache"),
        Limits {
            daily_attempts: 0,
            daily_characters: 0,
            max_disk_bytes: 64 * 1024 * 1024,
            concurrency: 1,
        },
    )
    .unwrap();
    for (id, voice, expected) in [(old_id, marin, old), (new_id, settings, new)] {
        assert_eq!(
            reopened
                .clip(id, source.clone(), voice, provider.clone())
                .await
                .unwrap(),
            expected
        );
    }
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "Post-reopen replay must use neither provider nor budget"
    );
}
