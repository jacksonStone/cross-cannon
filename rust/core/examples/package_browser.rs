//! Split existing immutable texts into an identity index and bounded Chapter fragments.
use cross_canon_core::Library;
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::PathBuf};
fn main() -> anyhow::Result<()> {
    let root = PathBuf::from(std::env::args_os().nth(1).expect("source root"));
    let output = PathBuf::from(std::env::args_os().nth(2).expect("output directory"));
    fs::create_dir_all(output.join("chunks"))?;
    let library = Library::load_artifacts(&root)?;
    library.validate()?;
    library.write_browser_index(output.join("library.bin"))?;
    let mut restored = Library::from_bytes(&root, &fs::read(output.join("library.bin"))?)?;
    anyhow::ensure!(
        restored.books == library.books,
        "Browser identity changed Book/Chapter metadata"
    );
    let translation: Value = serde_json::from_slice(&fs::read(
        root.join("public/scripture-translations/msb.json"),
    )?)?;
    let mut batches: Vec<Vec<String>> = vec![];
    let mut batch = vec![];
    let mut size = 0;
    for book in &library.books {
        for chapter in &book.chapters {
            let bytes: usize = chapter
                .passage_ids
                .iter()
                .filter_map(|id| library.passage(id))
                .map(|p| {
                    p.text.len()
                        + p.original_text.len()
                        + p.verses.iter().map(|v| v.text.len()).sum::<usize>()
                })
                .sum();
            if !batch.is_empty() && size + bytes > 384 * 1024 {
                batches.push(std::mem::take(&mut batch));
                size = 0;
            }
            batch.push(chapter.id.clone());
            size += bytes;
        }
        if !batch.is_empty() {
            batches.push(std::mem::take(&mut batch));
            size = 0;
        }
    }
    let mut chapters = BTreeMap::new();
    for (index, ids) in batches.iter().enumerate() {
        let name = format!("chunks/text-{index:04}.bin");
        let fragment = library.fragment(ids)?;
        fragment.write_browser(output.join(&name))?;
        // Verify the exact encoded fragments, including every Work in the full
        // corpus, rather than relying only on a few sample Chapter tests.
        restored.install_fragment(Library::from_bytes(&root, &fs::read(output.join(&name))?)?)?;
        let msb: BTreeMap<_, _> = ids
            .iter()
            .filter_map(|id| translation["chapters"].get(id).map(|v| (id, v)))
            .collect();
        let reading = if msb.is_empty() {
            None
        } else {
            let name = format!("chunks/msb-{index:04}.json");
            fs::write(
                output.join(&name),
                serde_json::to_vec(&json!({"chapters":msb}))?,
            )?;
            Some(name)
        };
        for id in ids {
            chapters.insert(id, json!({"text":name,"reading":reading}));
        }
    }
    fs::write(output.join("archive.json"), serde_json::to_vec(&chapters)?)?;
    println!(
        "Prepared {} chapter fragments; identity index {} bytes",
        batches.len(),
        fs::metadata(output.join("library.bin"))?.len()
    );
    Ok(())
}
