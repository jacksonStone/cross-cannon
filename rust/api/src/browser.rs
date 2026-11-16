//! Public reader documents and immutable browser artifacts. Account routes remain
//! separate: only the shared reader can run without the Node application.
use crate::resources::serve_file;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::path::PathBuf;

pub fn router<S: Clone + Send + Sync + 'static>(root: PathBuf) -> Router<S> {
    Router::new()
        .route("/", get(shell))
        .route("/reader/{passage}", get(shell))
        .route("/reader/{passage}/", get(shell))
        .route("/church-fathers", get(shell))
        .route("/church-fathers/", get(shell))
        .route("/christian-classics", get(shell))
        .route("/christian-classics/", get(shell))
        .route("/christian-classics/read", get(shell))
        .route("/christian-classics/read/", get(shell))
        .route("/browser/{*file}", get(asset))
        .route("/cross-canon-rust-sw.js", get(worker))
        .route("/cross-canon-sw.js", get(worker))
        .route("/{file}", get(public_asset))
        .with_state(root)
}

async fn shell(State(root): State<PathBuf>, method: Method, headers: HeaderMap) -> Response {
    file(
        root.join("public/browser"),
        "index.html",
        "text/html; charset=utf-8",
        "no-cache",
        method,
        headers,
    )
    .await
}
async fn worker(State(root): State<PathBuf>, method: Method) -> Response {
    // The old URL intentionally serves the current worker, including when an
    // installed legacy reader asks for a query-string release version.
    serve_file(
        root.join("public"),
        "cross-canon-rust-sw.js",
        "text/javascript; charset=utf-8",
        "no-cache",
        &method,
        &HeaderMap::new(),
        None,
    )
    .await
}
fn content_type(name: &str) -> Option<&'static str> {
    Some(match name.rsplit('.').next()? {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "bin" => "application/octet-stream",
        "ttf" => "font/ttf",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webmanifest" => "application/manifest+json",
        _ => return None,
    })
}
fn immutable(name: &str) -> bool {
    name.split('.').any(|part| {
        part.len() == 20
            && part
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
async fn asset(
    State(root): State<PathBuf>,
    Path(name): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    // Validate decoded components as well as canonical containment in serve_file.
    // In particular a browser artifact must never resolve into public/ or storage/.
    if name.split('/').any(|part| {
        part.is_empty()
            || part.starts_with('.')
            || !part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    }) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(kind) = content_type(&name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let cache = if immutable(&name) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    file(
        root.join("public/browser"),
        &name,
        kind,
        cache,
        method,
        headers,
    )
    .await
}
async fn public_asset(
    State(root): State<PathBuf>,
    Path(name): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if ![
        "favicon-c26c421629d8.svg",
        "favicon.svg",
        "favicon-512-fd59821d9d5b.png",
        "favicon-512.png",
        "manifest-closed-book-v2.webmanifest",
        "manifest.webmanifest",
        "og-image.png",
        "og-image.svg",
    ]
    .contains(&name.as_str())
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    file(
        root.join("public"),
        &name,
        content_type(&name).unwrap(),
        "public, max-age=3600",
        method,
        headers,
    )
    .await
}
/// An explicit exclusion overrides a wildcard. Equal-quality supported codings
/// prefer Brotli, matching the previous static server's smaller transfer size.
fn encoding_quality(headers: &HeaderMap, encoding: &str) -> f32 {
    let mut exact: Option<f32> = None;
    let mut wildcard: Option<f32> = None;
    for value in headers.get_all("accept-encoding") {
        let Ok(value) = value.to_str() else {
            continue;
        };
        for entry in value.split(',') {
            let mut parts = entry.trim().split(';');
            let name = parts.next().unwrap_or("").trim();
            let mut quality = 1.0;
            for parameter in parts {
                if let Some((key, value)) = parameter.trim().split_once('=') {
                    if key.trim().eq_ignore_ascii_case("q") {
                        quality = value
                            .trim()
                            .parse::<f32>()
                            .ok()
                            .filter(|q| (0.0..=1.0).contains(q))
                            .unwrap_or(0.0);
                    }
                }
            }
            let target = if name.eq_ignore_ascii_case(encoding) {
                &mut exact
            } else if name == "*" {
                &mut wildcard
            } else {
                continue;
            };
            *target = Some(target.unwrap_or(0.0).max(quality));
        }
    }
    exact.or(wildcard).unwrap_or(0.0)
}

async fn file(
    directory: PathBuf,
    name: &str,
    kind: &str,
    cache: &str,
    method: Method,
    headers: HeaderMap,
) -> Response {
    // Precompression moves CPU work into the reproducible off-server build.
    // Ranges address identity bytes, never offsets in a compressed stream.
    let mut encoding = None;
    let mut info = None;
    let mut encoded = name.to_owned();
    if !headers.contains_key("range") {
        let mut choices = [
            ("br", "br", encoding_quality(&headers, "br")),
            ("gzip", "gz", encoding_quality(&headers, "gzip")),
        ];
        choices.sort_by(|a, b| b.2.total_cmp(&a.2));
        for (coding, extension, quality) in choices {
            if quality <= 0.0 {
                continue;
            }
            let candidate = format!("{name}.{extension}");
            if let Ok(metadata) = tokio::fs::metadata(directory.join(&candidate)).await {
                encoding = Some(coding);
                info = Some(metadata);
                encoded = candidate;
                break;
            }
        }
    }
    if info.is_none() {
        info = tokio::fs::metadata(directory.join(name)).await.ok();
    }
    let mut response = serve_file(
        directory,
        &encoded,
        kind,
        cache,
        &method,
        &headers,
        Some(false),
    )
    .await;
    response
        .headers_mut()
        .insert("vary", "Accept-Encoding".parse().unwrap());
    if response.status().is_success() {
        if let Some(encoding) = encoding {
            response
                .headers_mut()
                .insert("content-encoding", encoding.parse().unwrap());
        }
        if let Some(info) = info {
            if let Some(modified) = info
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            {
                let etag = format!(
                    "W/\"{}-{:x}-{:x}\"",
                    encoding.unwrap_or("identity"),
                    info.len(),
                    modified.as_nanos()
                );
                response.headers_mut().insert("etag", etag.parse().unwrap());
                let matches = headers
                    .get("if-none-match")
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| {
                        value.split(',').any(|tag| {
                            let tag = tag.trim();
                            tag == "*"
                                || tag.strip_prefix("W/").unwrap_or(tag)
                                    == etag.trim_start_matches("W/")
                        })
                    });
                if matches {
                    *response.status_mut() = StatusCode::NOT_MODIFIED;
                    *response.body_mut() = Body::empty();
                    response.headers_mut().remove("content-range");
                    // Axum fills absent lengths with the empty body's zero. A
                    // 304 may instead specify the complete selected representation.
                    response
                        .headers_mut()
                        .insert("content-length", info.len().to_string().parse().unwrap());
                }
            }
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    #[tokio::test]
    async fn guest_reader_artifacts_and_worker_contract() {
        let root = std::env::temp_dir().join(format!("cross-canon-browser-{}", std::process::id()));
        let browser = root.join("public/browser");
        tokio::fs::create_dir_all(browser.join("fonts"))
            .await
            .unwrap();
        for (name, bytes) in [
            ("index.html", b"<canvas id=app-canvas></canvas>".as_slice()),
            ("manifest.json", b"{\"version\":\"current\"}"),
            ("reader.0123456789abcdefabcd.wasm", b"wasm identity"),
            ("reader.0123456789abcdefabcd.wasm.gz", b"gzip encoding"),
            ("reader.0123456789abcdefabcd.wasm.br", b"brotli encoded"),
            ("fallback.wasm", b"wasm identity"),
            ("fallback.wasm.gz", b"gzip encoding"),
            ("fonts/SourceSerif4-Semibold.ttf", b"font"),
        ] {
            tokio::fs::write(browser.join(name), bytes).await.unwrap();
        }
        tokio::fs::write(
            root.join("public/cross-canon-rust-sw.js"),
            b"current worker",
        )
        .await
        .unwrap();
        tokio::fs::write(root.join("public/cross-canon-sw.js"), b"retired worker")
            .await
            .unwrap();
        tokio::fs::write(
            root.join("public/manifest-closed-book-v2.webmanifest"),
            b"{}",
        )
        .await
        .unwrap();
        let app = router::<()>(root.clone());
        for path in [
            "/",
            "/reader/0c558fd2c95099cf1909774d?selected=16",
            "/church-fathers",
            "/christian-classics",
            "/christian-classics/read?work=classics%3Aimitation",
            "/church-fathers/",
            "/christian-classics/",
            "/christian-classics/read/?work=classics%3Aimitation",
            "/reader/0c558fd2c95099cf1909774d/?selected=16",
        ] {
            for method in ["GET", "HEAD"] {
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .method(method)
                            .uri(path)
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), 200, "{method} {path}");
                assert!(
                    !response.headers().contains_key("location"),
                    "Reader Links must preserve their URL"
                );
                assert_eq!(response.headers()["cache-control"], "no-cache");
                let body = response.into_body().collect().await.unwrap().to_bytes();
                assert_eq!(body.is_empty(), method == "HEAD");
            }
        }
        for path in [
            "/cross-canon-rust-sw.js",
            "/cross-canon-sw.js?release=old-version",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["cache-control"], "no-cache");
            assert_eq!(
                response.into_body().collect().await.unwrap().to_bytes(),
                "current worker"
            );
        }
        for (accept, range, expected, coding, status) in [
            ("gzip, br", None, "brotli encoded", Some("br"), 200),
            ("br;q=0,gzip", None, "gzip encoding", Some("gzip"), 200),
            ("gzip", None, "gzip encoding", Some("gzip"), 200),
            (
                "br;q=0.2,gzip;q=0.9",
                None,
                "gzip encoding",
                Some("gzip"),
                200,
            ),
            ("*;q=0.5,br;q=0", None, "gzip encoding", Some("gzip"), 200),
            ("br;Q=0,gzip;q=0", None, "wasm identity", None, 200),
            ("br;q=invalid,gzip;q=0", None, "wasm identity", None, 200),
            ("gzip;q=0", None, "wasm identity", None, 200),
            ("identity", None, "wasm identity", None, 200),
            ("br,gzip", Some("bytes=0-3"), "wasm", None, 206),
        ] {
            for method in ["GET", "HEAD"] {
                let mut request = Request::builder()
                    .method(method)
                    .uri("/browser/reader.0123456789abcdefabcd.wasm")
                    .header("accept-encoding", accept);
                if let Some(range) = range {
                    request = request.header("range", range);
                }
                let response = app
                    .clone()
                    .oneshot(request.body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(response.status(), status);
                assert_eq!(response.headers()["content-type"], "application/wasm");
                assert_eq!(
                    response.headers()["content-length"],
                    expected.len().to_string()
                );
                assert_eq!(
                    response.headers()["cache-control"],
                    "public, max-age=31536000, immutable"
                );
                assert_eq!(response.headers()["vary"], "Accept-Encoding");
                assert_eq!(
                    response
                        .headers()
                        .get("content-encoding")
                        .map(|value| value.to_str().unwrap()),
                    coding
                );
                assert_eq!(
                    response.into_body().collect().await.unwrap().to_bytes(),
                    if method == "HEAD" { "" } else { expected }
                );
            }
        }
        let fallback = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/browser/fallback.wasm")
                    .header("accept-encoding", "br,gzip")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(fallback.headers()["content-encoding"], "gzip");
        assert_eq!(
            fallback.into_body().collect().await.unwrap().to_bytes(),
            "gzip encoding"
        );
        let identity = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/browser/reader.0123456789abcdefabcd.wasm")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let changed_encoding = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/browser/reader.0123456789abcdefabcd.wasm")
                    .header("accept-encoding", "br")
                    .header("if-none-match", identity.headers()["etag"].clone())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            changed_encoding.status(),
            200,
            "An identity validator must not suppress a Brotli response"
        );
        assert_eq!(changed_encoding.headers()["content-encoding"], "br");
        for (path, content_type) in [
            ("/browser/manifest.json", "application/json; charset=utf-8"),
            ("/browser/fonts/SourceSerif4-Semibold.ttf", "font/ttf"),
            (
                "/manifest-closed-book-v2.webmanifest",
                "application/manifest+json",
            ),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["content-type"], content_type);
        }
        for encoding in ["identity", "gzip", "br"] {
            let first = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/browser/reader.0123456789abcdefabcd.wasm")
                        .header("accept-encoding", encoding)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let etag = first.headers()["etag"].clone();
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/browser/reader.0123456789abcdefabcd.wasm")
                        .header("accept-encoding", encoding)
                        .header("if-none-match", etag)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), 304);
            assert_eq!(response.headers()["vary"], "Accept-Encoding");
            assert_eq!(
                response.headers()["content-length"],
                if encoding == "br" { "14" } else { "13" }
            );
            assert!(response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .is_empty());
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            root.join("public/cross-canon-sw.js"),
            browser.join("escape.js"),
        )
        .unwrap();
        for path in [
            "/browser/escape.js",
            "/browser/%2e%2e%2fcross-canon-sw.js",
            "/browser/../cross-canon-sw.js",
            "/browser/.secret.json",
            "/browser/missing.js",
            "/browser/index.html.gz",
            "/browser/index.html.br",
            "/storage/database.db",
            "/api/account",
            "/account",
            "/README.md",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), 404, "{path}");
        }
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            405,
            "Compatibility forms stay on the separate application"
        );
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
