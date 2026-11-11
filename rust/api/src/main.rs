use anyhow::Result;
use axum::serve::{Listener, ListenerExt};
use cross_canon_core::{data_root, Library};
use r_cross_cannon::{engine::Engine, router, AppState};
use std::{path::PathBuf, sync::Arc};
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "r_cross_cannon=info,tower_http=info".into()),
        )
        .init();
    let root = data_root()?;
    let scripture = std::env::var_os("R_CROSS_CANNON_SCRIPTURE_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("storage/crosscannon.db"));
    let fathers = std::env::var_os("R_CROSS_CANNON_FATHERS_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("storage/early-christian-works.db"));
    let library = Arc::new(Library::load(&root)?);
    library.validate()?;
    let engine = Engine::load(library, &scripture, &fathers)?;
    tracing::info!(
        vectors = engine.count(),
        "Existing artifacts loaded read-only"
    );
    let state = Arc::new(AppState::new(
        engine,
        std::env::var("OPENAI_API_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty()),
    )?);
    let address = std::env::var("R_CROSS_CANNON_BIND").unwrap_or_else(|_| "127.0.0.1:3006".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    tracing::info!("R Cross Cannon listening at http://{address}/r/api");
    axum::serve(streaming_listener(listener), router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

fn streaming_listener(
    listener: tokio::net::TcpListener,
) -> impl Listener<Io = tokio::net::TcpStream, Addr = std::net::SocketAddr> {
    listener.tap_io(|socket| {
        // Async file reads can split headers from a small body. Nagle combined
        // with delayed ACKs otherwise adds ~40 ms on reused loopback sockets.
        if let Err(error) = socket.set_nodelay(true) {
            tracing::warn!("Could not disable Nagle for streaming connection: {error}");
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn accepted_streaming_connections_disable_nagle() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut listener = streaming_listener(listener);
        let client = tokio::spawn(tokio::net::TcpStream::connect(address));
        let (socket, _) = listener.accept().await;
        assert!(
            socket.nodelay().unwrap(),
            "Small streamed bodies must not wait for delayed ACKs"
        );
        client.await.unwrap().unwrap();
    }
}
