//! Prepare native reader data from existing immutable artifacts, without a DB.
use cross_canon_core::Library;
use std::{path::PathBuf, time::Instant};

fn main() -> anyhow::Result<()> {
    let root = PathBuf::from(std::env::args_os().nth(1).expect("source root"));
    let output = PathBuf::from(std::env::args_os().nth(2).expect("generated output path"));
    let started = Instant::now();
    let mut library = Library::load_artifacts(root)?;
    if std::env::args().any(|arg| arg == "--original-bible-audio") {
        library.use_original_bible_audio();
    }
    library.validate()?;
    library.write_native(&output)?;
    println!(
        "Prepared {} books / {} passages in {:.2}s: {}",
        library.books.len(),
        library.passages.len(),
        started.elapsed().as_secs_f64(),
        output.display()
    );
    Ok(())
}
