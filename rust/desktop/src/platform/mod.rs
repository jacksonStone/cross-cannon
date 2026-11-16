//! Platform services vary; reader, dialogs, reconciliation and search contracts do not.
pub(crate) mod download_catalog;
use anyhow::Result;
use std::{future::Future, time::Duration};

#[cfg(not(target_arch = "wasm32"))]
pub(crate) trait Task: Future + Send + 'static {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Future + Send + 'static> Task for T {}
#[cfg(target_arch = "wasm32")]
pub(crate) trait Task: Future + 'static {}
#[cfg(target_arch = "wasm32")]
impl<T: Future + 'static> Task for T {}

pub(crate) fn spawn(job: impl Task<Output = ()>) {
    #[cfg(not(target_arch = "wasm32"))]
    runtime().spawn(job);
    #[cfg(target_arch = "wasm32")]
    wasm_bindgen_futures::spawn_local(job);
}

#[cfg(not(target_arch = "wasm32"))]
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("platform task runtime")
    })
}
#[cfg(all(test, not(target_arch = "wasm32")))]
pub(crate) fn block_on<F: Future>(job: F) -> F::Output {
    runtime().block_on(job)
}

// Keep the native connection pool shared while applying each caller's deadline
// to every request. A client-wide deadline would make study sync and search
// inherit whichever timeout initialized the pool first.
pub(crate) struct HttpClient {
    inner: reqwest::Client,
    timeout: Duration,
}
impl HttpClient {
    pub(crate) fn get(&self, url: impl reqwest::IntoUrl) -> reqwest::RequestBuilder {
        self.inner.get(url).timeout(self.timeout)
    }

    pub(crate) fn post(&self, url: impl reqwest::IntoUrl) -> reqwest::RequestBuilder {
        self.inner.post(url).timeout(self.timeout)
    }
}

pub(crate) fn http_client(timeout: Duration) -> Result<HttpClient> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
        let inner = CLIENT
            .get_or_init(|| {
                reqwest::Client::builder()
                    .timeout(Duration::from_secs(60))
                    .connect_timeout(Duration::from_secs(15))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .expect("platform HTTP client")
            })
            .clone();
        Ok(HttpClient { inner, timeout })
    }
    #[cfg(target_arch = "wasm32")]
    {
        Ok(HttpClient {
            inner: reqwest::Client::new(),
            timeout,
        })
    }
}

pub(crate) fn authenticated(
    request: reqwest::RequestBuilder,
    token: &str,
) -> reqwest::RequestBuilder {
    #[cfg(not(target_arch = "wasm32"))]
    {
        request.bearer_auth(token)
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = token;
        request.fetch_credentials_same_origin()
    }
}

pub(crate) fn epoch_millis() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as u64
    }
}

pub(crate) fn random_bytes(bytes: &mut [u8]) -> Result<()> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")?.read_exact(bytes)?;
    }
    #[cfg(target_arch = "wasm32")]
    {
        web_sys::window()
            .unwrap()
            .crypto()
            .map_err(|_| anyhow::anyhow!("Secure randomness unavailable"))?
            .get_random_values_with_u8_array(bytes)
            .map_err(|_| anyhow::anyhow!("Secure randomness unavailable"))?;
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use std::time::Instant;

// Browser performance clocks begin at navigation, so an already-due deadline
// may precede zero. Keep signed instants rather than underflowing Duration.
#[cfg(target_arch = "wasm32")]
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
pub(crate) struct Instant(f64);
#[cfg(target_arch = "wasm32")]
impl Instant {
    pub(crate) fn now() -> Self {
        Self(web_sys::window().unwrap().performance().unwrap().now())
    }
    pub(crate) fn elapsed(&self) -> Duration {
        Duration::from_secs_f64(((Self::now().0 - self.0) / 1000.0).max(0.0))
    }
}
#[cfg(target_arch = "wasm32")]
impl std::ops::Sub<Duration> for Instant {
    type Output = Self;
    fn sub(self, duration: Duration) -> Self {
        Self(self.0 - duration.as_secs_f64() * 1000.0)
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn caller_deadlines_apply_to_get_and_post_on_the_shared_pool() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            for _ in 0..4 {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "Missing HTTP request");
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        Err(e) => panic!("{e}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut buffer = [0; 4096];
                stream.read(&mut buffer).unwrap();
                std::thread::sleep(Duration::from_millis(150));
                // Timed-out clients may already have closed their socket.
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                );
            }
        });
        block_on(async {
            let fast = http_client(Duration::from_millis(30)).unwrap();
            let slow = http_client(Duration::from_secs(2)).unwrap();
            for (fast_request, slow_request) in [
                (fast.get(&url), slow.get(&url)),
                (fast.post(&url), slow.post(&url)),
            ] {
                let error = fast_request.send().await.unwrap_err();
                assert!(error.is_timeout(), "{error}");
                assert_eq!(
                    slow_request.send().await.unwrap().text().await.unwrap(),
                    "ok"
                );
            }
        });
        server.join().unwrap();
    }
}
