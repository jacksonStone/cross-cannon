pub mod engine;
mod resources;
mod web;
use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use cross_canon_core::{SearchMode, SearchRequest};
use engine::{normalize, Engine};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

pub struct AppState {
    pub engine: Arc<Engine>,
    pub client: reqwest::Client,
    pub api_key: Option<String>,
    slots: Arc<Semaphore>,
    // A fixed global ceiling bounds paid query embeddings even behind a proxy.
    query_budget: Mutex<(Instant, u32)>,
}
impl AppState {
    pub fn new(engine: Engine, api_key: Option<String>) -> anyhow::Result<Self> {
        Ok(Self {
            engine: Arc::new(engine),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .build()?,
            api_key,
            slots: Arc::new(Semaphore::new(4)),
            query_budget: Mutex::new((Instant::now(), 0)),
        })
    }
}
struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
fn bad(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}
fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!("{error}");
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Search could not be completed".into(),
    )
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .nest(
            "/r/api/resources",
            resources::router(state.engine.library.root.clone()),
        )
        .route("/r/api", get(health))
        .route("/r/api/health", get(health))
        .route("/r/api/books", get(books))
        .route("/r/api/search", post(search))
        .fallback(|| async {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error":"Route not found"})),
            )
        })
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(
        json!({"service":"R Cross Cannon","version":env!("CARGO_PKG_VERSION"),"status":"ok","cacheVersion":state.engine.library.version,"books":state.engine.library.books.len(),"passages":state.engine.library.passages.len(),"storedVectors":state.engine.count(),"semanticQueries":state.api_key.is_some(),"webSearch":true,"resourceRoutes":true}),
    )
}
async fn books(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(
        json!({"books":state.engine.library.books.iter().map(|b|json!({"id":b.id,"title":b.title,"author":b.author,"corpus":b.corpus,"chapters":b.chapters.len()})).collect::<Vec<_>>()}),
    )
}
async fn search(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SearchRequest>,
) -> Result<Json<Value>, ApiError> {
    if !(1..=100).contains(&request.limit) {
        return Err(bad("limit must be between 1 and 100"));
    }
    if request.query.chars().count() > 2000
        || request.books.len() > 100
        || request.authors.len() > 3
    {
        return Err(bad("Search is too large"));
    }
    if request.query.trim().is_empty() && request.source_id.is_none() {
        return Err(bad("Provide query or sourceId"));
    }
    if request.source_id.is_some() && !request.query.trim().is_empty() {
        return Err(bad("Provide either query or sourceId"));
    }
    if request
        .books
        .iter()
        .any(|id| state.engine.library.book(id).is_none())
    {
        return Err(bad("Unknown book filter"));
    }
    if request.web
        && (request.corpus.is_none()
            || matches!(request.mode, SearchMode::Keyword) && request.source_id.is_none())
    {
        return Err(bad("Web searches require a semantic target corpus"));
    }
    if request.authors.iter().any(|a| {
        !state
            .engine
            .library
            .books
            .iter()
            .any(|b| b.author.as_ref() == Some(a))
    }) {
        return Err(bad("Unknown author filter"));
    }
    let _slot = state.slots.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Search is busy; try again shortly".into(),
        )
    })?;
    let start = Instant::now();
    let mode = if request.source_id.is_some() {
        SearchMode::Semantic
    } else {
        request.mode
    };
    let engine = state.engine.clone();
    let source = if let Some(id) = request.source_id.clone() {
        let reader = engine.clone();
        let target = request.corpus;
        Some(
            tokio::task::spawn_blocking(move || reader.source(&id, target))
                .await
                .map_err(internal)?
                .map_err(|e| bad(e.to_string()))?,
        )
    } else {
        None
    };
    let source_metadata = request
        .web
        .then(|| source.as_ref().map(|s| s.metadata.clone()))
        .flatten();
    let hits: Value = match mode {
        SearchMode::Keyword => tokio::task::spawn_blocking(move || {
            json!(engine.library.search(
                &request.query,
                request.corpus,
                &request.books,
                request.limit,
                request.canon,
            ))
        })
        .await
        .map_err(internal)?,
        SearchMode::Semantic => {
            let embedding = if let Some(source) = &source {
                source.embedding.clone()
            } else {
                let config = engine
                    .config(request.corpus)
                    .map_err(|e| bad(e.to_string()))?;
                let key=state.api_key.as_ref().ok_or_else(||ApiError(StatusCode::SERVICE_UNAVAILABLE,"Theme search is unavailable; keyword and similar-passage search remain available".into()))?;
                {
                    let mut budget = state.query_budget.lock().map_err(internal)?;
                    if budget.0.elapsed() > Duration::from_secs(60) {
                        *budget = (Instant::now(), 0)
                    }
                    if budget.1 >= 30 {
                        return Err(ApiError(
                            StatusCode::TOO_MANY_REQUESTS,
                            "Theme search limit reached; try again in a minute".into(),
                        ));
                    }
                    budget.1 += 1;
                }
                let response=state.client.post("https://api.openai.com/v1/embeddings").bearer_auth(key).json(&json!({"model":config.model,"dimensions":config.dimensions,"input":request.query})).send().await.map_err(|e|{tracing::warn!("Embedding request failed: {e}");ApiError(StatusCode::BAD_GATEWAY,"Query embedding provider is unavailable".into())})?;
                if !response.status().is_success() {
                    tracing::warn!("Embedding provider status {}", response.status());
                    return Err(ApiError(
                        StatusCode::BAD_GATEWAY,
                        "Query embedding provider is unavailable".into(),
                    ));
                }
                let payload: Value = response.json().await.map_err(internal)?;
                let values = payload["data"][0]["embedding"]
                    .as_array()
                    .ok_or_else(|| internal("Invalid embedding response"))?;
                let mut embedding = values
                    .iter()
                    .map(|v| {
                        v.as_f64()
                            .map(|n| n as f32)
                            .ok_or_else(|| internal("Invalid embedding value"))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                normalize(&mut embedding).map_err(internal)?;
                embedding
            };
            let web = request.web;
            tokio::task::spawn_blocking(move || -> anyhow::Result<Value> {
                if web {
                    Ok(json!(engine.web_results(
                        &embedding,
                        &request,
                        source.as_ref()
                    )?))
                } else {
                    Ok(json!(engine.semantic(&embedding, &request)?))
                }
            })
            .await
            .map_err(internal)?
            .map_err(internal)?
        }
    };
    Ok(Json(
        json!({"mode":mode,"results":hits,"source":source_metadata,"elapsedMs":start.elapsed().as_secs_f64()*1000.0}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cross_canon_core::{Corpus, Library};
    use http_body_util::BodyExt;
    use std::path::Path;
    use tower::ServiceExt;
    #[tokio::test]
    async fn actual_readonly_indexes_search_and_api_contract() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let library = Arc::new(Library::load(&root).unwrap());
        let engine = Engine::load(
            library,
            &root.join("storage/crosscannon.db"),
            &root.join("storage/early-christian-works.db"),
        )
        .unwrap();
        assert!(engine.count() > 20000);
        let genesis = engine.library.book("Genesis").unwrap().chapters[0].passage_ids[0].clone();
        let query = engine
            .source_embedding(&genesis, Some(Corpus::Scripture))
            .unwrap();
        let request = SearchRequest {
            source_id: Some(genesis.clone()),
            corpus: Some(Corpus::Scripture),
            books: vec!["John".into()],
            limit: 5,
            ..Default::default()
        };
        let hits = engine.semantic(&query, &request).unwrap();
        assert_eq!(hits.len(), 5);
        assert!(hits
            .iter()
            .all(|h| engine.library.passage(&h.id).unwrap().book == "John"));
        // Web searches reuse exact selected paragraph vectors and preserve highlights.
        let web_request = SearchRequest {
            web: true,
            ..request.clone()
        };
        let scripture = engine.web_results(&query, &web_request, None).unwrap();
        assert_eq!(scripture.len(), 5);
        assert!(scripture.iter().all(|r| r["type"] == "paragraph"));
        let db = engine.connection(Corpus::Scripture).unwrap();
        let (paragraph, verse, bytes): (String, u32, Vec<u8>) = db.query_row(
            "SELECT paragraph_id,verse,embedding FROM paragraph_verses WHERE embedding IS NOT NULL LIMIT 1",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        ).unwrap();
        let verse_query = engine::decode_embedding(&bytes, query.len()).unwrap();
        let highlighted = engine
            .web_results(
                &verse_query,
                &SearchRequest {
                    corpus: Some(Corpus::Scripture),
                    web: true,
                    limit: 100,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert!(highlighted
            .iter()
            .any(|r| r["id"] == paragraph && r["highlightVerse"] == verse));
        let first_clement = engine
            .library
            .books
            .iter()
            .find(|b| b.author.as_deref() == Some("Clement of Rome"))
            .unwrap();
        let early_id = first_clement.chapters[0].passage_ids[0].clone();
        let source = engine.source(&early_id, Some(Corpus::Scripture)).unwrap();
        assert!(source.database_id.starts_with("ecw:"));
        assert!(source.metadata["text"].is_string());
        let by_id = engine
            .source(&source.database_id, Some(Corpus::Scripture))
            .unwrap();
        assert_eq!(source.embedding, by_id.embedding);
        let early_request = SearchRequest {
            source_id: Some(early_id),
            corpus: Some(Corpus::EarlyChristian),
            authors: vec!["Clement of Rome".into()],
            limit: 5,
            web: true,
            ..Default::default()
        };
        let early = engine
            .web_results(&source.embedding, &early_request, Some(&source))
            .unwrap();
        assert_eq!(early.len(), 5);
        assert!(early.iter().all(|r| r["author"] == "Clement of Rome"
            && r["highlightPassage"]["id"] != source.database_id
            && r["highlightPassage"]["text"].is_string()));
        let unique: std::collections::HashSet<_> = early
            .iter()
            .map(|r| r["chapterId"].as_str().unwrap())
            .collect();
        assert_eq!(unique.len(), early.len());
        let classic_id =
            engine.library.book("classics:imitation").unwrap().chapters[0].passage_ids[0].clone();
        let classic_source = engine.source(&classic_id, Some(Corpus::Scripture)).unwrap();
        assert!(classic_source.database_id.starts_with("ccw:"));
        assert_eq!(
            engine
                .source(&classic_source.database_id, Some(Corpus::ChristianClassics))
                .unwrap()
                .embedding,
            classic_source.embedding
        );
        let classics = engine
            .web_results(
                &query,
                &SearchRequest {
                    corpus: Some(Corpus::ChristianClassics),
                    authors: vec!["Thomas à Kempis".into()],
                    limit: 5,
                    web: true,
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        assert_eq!(classics.len(), 5);
        assert!(classics.iter().all(|result| result["chapterId"]
            .as_str()
            .unwrap()
            .starts_with("classics:imitation:")
            && result["author"] == "Thomas à Kempis"));
        let app = router(Arc::new(AppState::new(engine, None).unwrap()));
        for (body, status) in [
            (
                json!({"query":"beginning","books":["Genesis"],"limit":3}),
                200,
            ),
            (json!({"sourceId":genesis.clone(),"limit":3}), 200),
            (
                json!({"sourceId":genesis.clone(),"corpus":"christian-classics","web":true,"authors":["Thomas à Kempis"],"limit":3}),
                200,
            ),
            (
                json!({"sourceId":classic_source.database_id,"corpus":"scripture","web":true,"limit":3}),
                200,
            ),
            (json!({"query":"love","mode":"semantic"}), 503),
            (json!({"query":""}), 400),
            (json!({"query":"love","limit":101}), 400),
            (json!({"query":"love","books":["unknown"]}), 400),
            (
                json!({"sourceId":genesis.clone(),"corpus":"scripture","web":true,"limit":3}),
                200,
            ),
            (
                json!({"sourceId":source.database_id,"corpus":"early-christian","web":true,"authors":["Clement of Rome"],"limit":3}),
                200,
            ),
            (
                json!({"sourceId":"ecw:missing","corpus":"scripture","web":true}),
                400,
            ),
            (
                json!({"sourceId":genesis.clone(),"corpus":"scripture","web":true,"authors":["missing"]}),
                400,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .method("POST")
                        .uri("/r/api/search")
                        .header("content-type", "application/json")
                        .body(axum::body::Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), status, "{body}");
            let data: Value =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            if status == 200 {
                assert_eq!(data["results"].as_array().unwrap().len(), 3)
            } else {
                assert!(data["error"].is_string())
            }
        }
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/r/api/health")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
