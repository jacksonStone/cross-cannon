use anyhow::Result;
use axum::serve::{Listener, ListenerExt};
use cross_canon_core::{data_root, Library};
use r_cross_cannon::{engine::Engine, router, AppState};
use std::{future::IntoFuture, path::PathBuf, sync::Arc};
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        anyhow::ensure!(
            args.len() == 2 && args[0] == "--init-accounts",
            "Usage: r-cross-cannon [--init-accounts DATABASE_PATH]"
        );
        anyhow::ensure!(
            std::env::var("CROSS_CANNON_UPDATE_DB").as_deref() == Ok("1"),
            "Account schema changes require CROSS_CANNON_UPDATE_DB=1"
        );
        r_cross_cannon::initialize_accounts(std::path::Path::new(&args[1]))?;
        println!("Accounts database initialized explicitly.");
        return Ok(());
    }
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
    let library = Arc::new(Library::load_server(&root)?);
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
    let address = std::env::var("R_CROSS_CANNON_BIND").unwrap_or_else(|_| "127.0.0.1:3005".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    let compatibility = std::env::var("R_CROSS_CANNON_COMPAT_BIND")
        .ok()
        .filter(|value| !value.trim().is_empty());
    // Both sockets share this router, Library, search budget and account store.
    // Bind them before serving so a port conflict cannot start a partial app.
    let compat_listener = if let Some(address) = &compatibility {
        Some(tokio::net::TcpListener::bind(address).await?)
    } else {
        None
    };
    let app = router(state);
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    tokio::spawn(async move {
        shutdown_signal().await;
        let _ = shutdown_tx.send(true);
    });
    let mut primary_shutdown = shutdown_rx.clone();
    let primary = axum::serve(streaming_listener(listener), app.clone())
        .with_graceful_shutdown(async move {
            let _ = primary_shutdown.changed().await;
        })
        .into_future();
    tracing::info!("Cross Canon Rust app listening at http://{address}");
    if let Some(listener) = compat_listener {
        let mut compat_shutdown = shutdown_rx;
        tracing::info!(
            "Compatibility listener shares the same app: {}",
            compatibility.unwrap()
        );
        let compat = axum::serve(streaming_listener(listener), app)
            .with_graceful_shutdown(async move {
                let _ = compat_shutdown.changed().await;
            })
            .into_future();
        tokio::try_join!(primary, compat)?;
    } else {
        primary.await?;
    }
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
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
