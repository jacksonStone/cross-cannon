use anyhow::Result;
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
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
