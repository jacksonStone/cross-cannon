//! Serve existing artifacts without generating, modifying, or buffering whole files.
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::{io, path::PathBuf};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
};

pub fn router<S: Clone + Send + Sync + 'static>(root: PathBuf) -> Router<S> {
    Router::new()
        .route("/scripture-cache/{file}", get(scripture))
        .route("/church-fathers-preview/{file}", get(preview))
        .route("/church-fathers-preview/chapters/{file}", get(chapter))
        .route("/christian-classics-text/{file}", get(preview))
        .route("/christian-classics-text/chapters/{file}", get(chapter))
        .route("/audio/WEBD_AT/{file}", get(original_audio))
        .route("/audio/continuous/{file}", get(continuous_audio))
        .route("/cross-canon-sw-release-test.js", get(service_worker_test))
        .with_state(root)
}

const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const JSON: &str = "application/json; charset=utf-8";
fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "Not found").into_response()
}
fn token(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
fn gzip_accepted(headers: &HeaderMap) -> bool {
    headers
        .get("accept-encoding")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',').any(|entry| {
                let mut parts = entry.trim().split(';');
                parts
                    .next()
                    .is_some_and(|name| name.trim().eq_ignore_ascii_case("gzip"))
                    && !parts.any(|p| {
                        p.trim()
                            .strip_prefix("q=")
                            .is_some_and(|q| q.parse::<f32>().unwrap_or(0.0) <= 0.0)
                    })
            })
        })
}

async fn scripture(
    State(root): State<PathBuf>,
    Path(file): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let Some(version) = file.strip_suffix(".json").filter(|v| {
        v.len() == 16
            && v.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    }) else {
        return not_found();
    };
    let gzip = gzip_accepted(&headers);
    let name = if gzip {
        format!("{file}.gz")
    } else {
        file.clone()
    };
    let mut response = serve_file(
        root.join("scripture-cache"),
        &name,
        JSON,
        IMMUTABLE,
        &method,
        &HeaderMap::new(),
        None,
    )
    .await;
    if response.status().is_success() {
        let h = response.headers_mut();
        h.insert("etag", format!("\"{version}\"").parse().unwrap());
        h.insert("vary", "Accept-Encoding".parse().unwrap());
        if gzip {
            h.insert("content-encoding", "gzip".parse().unwrap());
        }
    }
    response
}
async fn preview(
    uri: Uri,
    State(root): State<PathBuf>,
    Path(file): Path<String>,
    method: Method,
) -> Response {
    if ![
        "books.json",
        "manifest.json",
        "city-of-god-audio-alignment.json",
        "confessions-audio-alignment.json",
        "first-clement-audio-alignment.json",
    ]
    .contains(&file.as_str())
    {
        return not_found();
    }
    serve_file(
        root.join(if uri.path().contains("/christian-classics-text/") {
            "public/christian-classics-text"
        } else {
            "public/church-fathers-preview"
        }),
        &file,
        JSON,
        "public, max-age=60",
        &method,
        &HeaderMap::new(),
        None,
    )
    .await
}
async fn chapter(
    uri: Uri,
    State(root): State<PathBuf>,
    Path(file): Path<String>,
    method: Method,
) -> Response {
    if !token(&file) || !file.ends_with(".json") {
        return not_found();
    }
    serve_file(
        root.join(if uri.path().contains("/christian-classics-text/") {
            "public/christian-classics-text/chapters"
        } else {
            "public/church-fathers-preview/chapters"
        }),
        &file,
        JSON,
        "public, max-age=60",
        &method,
        &HeaderMap::new(),
        None,
    )
    .await
}
async fn original_audio(
    State(root): State<PathBuf>,
    Path(file): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if !file
        .strip_suffix(".mp3")
        .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
    {
        return not_found();
    }
    serve_file(
        root.join("storage/audio/WEBD_AT"),
        &file,
        "audio/mpeg",
        "public, max-age=86400",
        &method,
        &headers,
        Some(false),
    )
    .await
}
async fn continuous_audio(
    State(root): State<PathBuf>,
    Path(file): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let valid = file
        .strip_suffix(".m4a")
        .and_then(|s| s.rsplit_once('-'))
        .is_some_and(|(name, hash)| {
            let group = name
                .strip_prefix("bible-")
                .or_else(|| name.strip_prefix("fathers-"));
            group.is_some_and(|s| {
                !s.is_empty()
                    && s.bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            }) && hash.len() == 16
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        });
    if !valid {
        return not_found();
    }
    serve_file(
        root.join("storage/audio/continuous"),
        &file,
        "audio/mp4",
        IMMUTABLE,
        &method,
        &headers,
        Some(true),
    )
    .await
}

/// None means an invalid or unsatisfiable single byte range.
fn byte_range(header: &str, size: u64) -> Option<(u64, u64)> {
    if size == 0 {
        return None;
    }
    let (start, end) = header.strip_prefix("bytes=")?.split_once('-')?;
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if start.is_empty() {
        if !digits(end) {
            return None;
        }
        let suffix: u64 = end.parse().ok()?;
        return (suffix > 0).then_some((size.saturating_sub(suffix), size - 1));
    }
    if !digits(start) || (!end.is_empty() && !digits(end)) {
        return None;
    }
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    (start < size && end >= start).then_some((start, end))
}

async fn serve_file(
    directory: PathBuf,
    name: &str,
    content_type: &str,
    cache: &str,
    method: &Method,
    request: &HeaderMap,
    strict_ranges: Option<bool>,
) -> Response {
    let Ok(directory) = fs::canonicalize(directory).await else {
        return not_found();
    };
    let Ok(path) = fs::canonicalize(directory.join(name)).await else {
        return not_found();
    };
    if !path.starts_with(&directory) {
        return not_found();
    }
    let Ok(mut file) = fs::File::open(path).await else {
        return not_found();
    };
    let Ok(info) = file.metadata().await else {
        return not_found();
    };
    if !info.is_file() {
        return not_found();
    }
    let mut response = Response::new(Body::empty());
    let h = response.headers_mut();
    h.insert("content-type", content_type.parse().unwrap());
    h.insert("cache-control", cache.parse().unwrap());
    h.insert("x-cross-canon-resource", "rust".parse().unwrap());
    let requested = request.get("range");
    let range = requested
        .and_then(|s| s.to_str().ok())
        .and_then(|s| byte_range(s, info.len()));
    if let Some(strict) = strict_ranges {
        h.insert("accept-ranges", "bytes".parse().unwrap());
        if strict && requested.is_some() && range.is_none() {
            h.insert(
                "content-range",
                format!("bytes */{}", info.len()).parse().unwrap(),
            );
            *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
            return response;
        }
    }
    let (start, length) = range
        .map(|(start, end)| (start, end - start + 1))
        .unwrap_or((0, info.len()));
    h.insert("content-length", length.to_string().parse().unwrap());
    if let Some((start, end)) = range {
        h.insert(
            "content-range",
            format!("bytes {start}-{end}/{}", info.len())
                .parse()
                .unwrap(),
        );
        *response.status_mut() = StatusCode::PARTIAL_CONTENT;
    }
    if *method == Method::HEAD {
        return response;
    }
    if file.seek(io::SeekFrom::Start(start)).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let stream =
        futures_util::stream::try_unfold((file, length), |(mut file, remaining)| async move {
            if remaining == 0 {
                return Ok::<_, io::Error>(None);
            }
            let mut buffer = vec![0; remaining.min(64 * 1024) as usize];
            let count = file.read(&mut buffer).await?;
            if count == 0 {
                return Err(io::Error::from(io::ErrorKind::UnexpectedEof));
            }
            buffer.truncate(count);
            Ok(Some((buffer, (file, remaining - count as u64))))
        });
    *response.body_mut() = Body::from_stream(stream);
    response
}

async fn service_worker_test(headers: HeaderMap, uri: Uri, method: Method) -> Response {
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    if !["127.0.0.1", "localhost"].contains(&host) {
        return not_found();
    }
    let query: std::collections::HashMap<_, _> =
        url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
            .into_owned()
            .collect();
    let release = query.get("release").map(String::as_str).unwrap_or("test");
    let encoded: String = release
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let fail = if query.get("failStage").is_some_and(|v| v == "1") {
        "&failStage=1"
    } else {
        ""
    };
    let core =
        serde_json::to_string(&format!("/cross-canon-sw.js?release={encoded}{fail}")).unwrap();
    let body = format!("/* Cross Canon local E2E release */\nimportScripts({core});\n");
    let length = body.len();
    let mut response = Response::new(if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(body)
    });
    let h = response.headers_mut();
    h.insert(
        "content-type",
        "text/javascript; charset=utf-8".parse().unwrap(),
    );
    h.insert("cache-control", "no-store".parse().unwrap());
    h.insert("content-length", length.to_string().parse().unwrap());
    h.insert("x-cross-canon-resource", "rust".parse().unwrap());
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    #[tokio::test]
    async fn existing_resource_contracts() {
        let root =
            std::env::temp_dir().join(format!("cross-canon-resources-{}", std::process::id()));
        for directory in [
            "scripture-cache",
            "public/church-fathers-preview/chapters",
            "storage/audio/WEBD_AT",
            "storage/audio/continuous",
        ] {
            fs::create_dir_all(root.join(directory)).await.unwrap();
        }
        for (path, data) in [
            (
                "storage/audio/continuous/bible-test-0123456789abcdef.m4a",
                b"0123456789".as_slice(),
            ),
            ("storage/audio/WEBD_AT/test.mp3", b"0123456789"),
            ("scripture-cache/0123456789abcdef.json", b"{}"),
            ("scripture-cache/0123456789abcdef.json.gz", b"compressed"),
            ("public/church-fathers-preview/books.json", b"{}"),
            ("public/church-fathers-preview/chapters/test.json", b"{}"),
        ] {
            fs::write(root.join(path), data).await.unwrap();
        }
        let app = router::<()>(root.clone());
        for (range, expected, text) in [
            ("bytes=3-5", 206, "345"),
            ("bytes=-2", 206, "89"),
            ("bytes=8-99", 206, "89"),
            ("bytes=8-", 206, "89"),
            ("bytes=4-2", 416, ""),
            ("bytes=10-", 416, ""),
            ("bytes=-0", 416, ""),
            ("bytes=0-1,3-4", 416, ""),
        ] {
            let r = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/audio/continuous/bible-test-0123456789abcdef.m4a")
                        .header("range", range)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(r.status().as_u16(), expected, "{range}");
            assert_eq!(r.headers()["x-cross-canon-resource"], "rust");
            if expected == 416 {
                assert_eq!(r.headers()["content-range"], "bytes */10");
            }
            assert_eq!(r.into_body().collect().await.unwrap().to_bytes(), text);
        }
        for method in ["GET", "HEAD"] {
            let r = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri("/audio/WEBD_AT/test.mp3")
                        .header("range", "bytes=invalid")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(r.status(), 200);
            assert_eq!(r.headers()["content-length"], "10");
            let body = r.into_body().collect().await.unwrap().to_bytes();
            assert_eq!(body.len(), if method == "HEAD" { 0 } else { 10 });
        }
        for (accept, body, compressed) in [
            ("gzip", "compressed", true),
            ("gzip;q=0, identity", "{}", false),
        ] {
            let r = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/scripture-cache/0123456789abcdef.json")
                        .header("accept-encoding", accept)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(r.status(), 200);
            assert_eq!(r.headers()["etag"], "\"0123456789abcdef\"");
            assert_eq!(r.headers().contains_key("content-encoding"), compressed);
            assert_eq!(r.into_body().collect().await.unwrap().to_bytes(), body);
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            root.join("scripture-cache/0123456789abcdef.json"),
            root.join("public/church-fathers-preview/chapters/escape.json"),
        )
        .unwrap();
        for path in [
            "/scripture-cache/no.json",
            "/church-fathers-preview/private.json",
            "/church-fathers-preview/chapters/escape.json",
            "/church-fathers-preview/chapters/%2e%2e%2fbooks.json",
            "/audio/WEBD_AT/%2e%2e%2ftest.mp3",
            "/audio/continuous/missing.m4a",
        ] {
            let r = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(r.status(), 404, "{path}");
        }
        for host in ["localhost:3005", "www.crosscanon.com"] {
            let r = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/cross-canon-sw-release-test.js?release=a%20b&failStage=1")
                        .header("host", host)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                r.status().as_u16(),
                if host.starts_with("localhost") {
                    200
                } else {
                    404
                }
            );
            if r.status() == 200 {
                let bytes = r.into_body().collect().await.unwrap().to_bytes();
                let body = String::from_utf8(bytes.to_vec()).unwrap();
                assert!(body.contains("release=a%20b&failStage=1"));
                assert!(body.contains("\nimportScripts("));
            }
        }
        fs::remove_dir_all(root).await.unwrap();
    }
}
