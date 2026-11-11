//! Exercise the actual native startup library path with an explicit time budget.
use cross_canon_core::Library;
use std::time::Instant;

fn main() -> anyhow::Result<()> {
    let root = std::env::args_os().nth(1).expect("library directory");
    let budget: f64 = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "0.7".into())
        .parse()?;
    let started = Instant::now();
    let library = Library::load(root)?;
    library.validate()?;
    let elapsed = started.elapsed().as_secs_f64();
    println!(
        "{} books / {} passages ready in {elapsed:.3}s (budget {budget:.3}s)",
        library.books.len(),
        library.passages.len()
    );
    anyhow::ensure!(elapsed <= budget, "Native startup library exceeded budget");
    if std::env::args().any(|arg| arg == "--opt-in-audio") {
        anyhow::ensure!(
            !library.root.join("storage").exists(),
            "Opt-in app must not bundle recordings"
        );
        let fathers = library
            .books
            .iter()
            .filter(|b| b.corpus == cross_canon_core::Corpus::EarlyChristian)
            .count();
        anyhow::ensure!(fathers == 410, "Missing offline Fathers texts");
        let mut chapters = 0;
        for book in &library.books {
            if book.corpus != cross_canon_core::Corpus::Scripture {
                continue;
            }
            for chapter in &book.chapters {
                if chapter.original_audio.is_none() {
                    continue;
                }
                let audio = library
                    .audio(&chapter.id)
                    .expect("recorded chapter must resolve");
                anyhow::ensure!(
                    audio.url.starts_with("/audio/WEBD_AT/")
                        && audio.start_seconds == 0.0
                        && audio.end_seconds.is_none(),
                    "Invalid original audio metadata"
                );
                chapters += 1;
            }
        }
        anyhow::ensure!(chapters == 1189, "Missing optional Bible recordings");
        println!("All 410 Fathers texts are offline; 1189 original Bible recordings are opt-in; no recordings bundled");
    }
    if std::env::args().any(|arg| arg == "--offline-audio") {
        let mut books = 0;
        let mut chapters = 0;
        for book in &library.books {
            if book.corpus != cross_canon_core::Corpus::Scripture {
                continue;
            }
            let mut recorded = false;
            for chapter in &book.chapters {
                if chapter.original_audio.is_none() {
                    continue;
                }
                let audio = library
                    .audio(&chapter.id)
                    .expect("recorded chapter must resolve");
                anyhow::ensure!(
                    audio.url.starts_with("/audio/") && !audio.url.contains(".."),
                    "Nonlocal Bible audio"
                );
                let path = library
                    .root
                    .join("storage")
                    .join(audio.url.trim_start_matches('/'));
                anyhow::ensure!(
                    path.metadata().is_ok_and(|m| m.len() > 0),
                    "Missing offline recording for {}",
                    chapter.id
                );
                chapters += 1;
                recorded = true;
            }
            books += usize::from(recorded);
        }
        anyhow::ensure!(
            books == 66 && chapters == 1189,
            "Bible audio coverage incomplete: {books} books / {chapters} chapters"
        );
        println!("All {books} recorded Bible books / {chapters} chapters resolve to bundled audio without a network");
    }
    Ok(())
}
