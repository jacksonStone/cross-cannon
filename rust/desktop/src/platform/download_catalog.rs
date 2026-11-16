use cross_canon_core::{Corpus, Library};
use std::collections::BTreeSet;
#[derive(Clone)]
pub(crate) struct Work {
    pub id: String,
    pub corpus: Corpus,
    pub title: String,
    pub chapters: usize,
    pub total_chapters: usize,
    pub urls: Vec<String>,
    pub downloaded: usize,
    pub bytes: u64,
}

pub(crate) const ALL_BIBLE: &str = "__all_bible_audio__";
pub(crate) fn works(library: &Library) -> Vec<Work> {
    let mut works: Vec<Work> = library
        .books
        .iter()
        .filter_map(|book| {
            let audio = book
                .chapters
                .iter()
                .filter_map(|c| library.audio(&c.id))
                .collect::<Vec<_>>();
            if audio.is_empty() {
                return None;
            }
            let chapters = audio.len();
            let urls = audio
                .into_iter()
                .map(|a| a.url)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            Some(Work {
                id: book.id.clone(),
                corpus: book.corpus,
                title: book.title.clone(),
                chapters,
                total_chapters: book.chapters.len(),
                urls,
                downloaded: 0,
                bytes: 0,
            })
        })
        .collect();
    let bible: Vec<_> = works
        .iter()
        .filter(|w| w.corpus == Corpus::Scripture)
        .collect();
    let urls: Vec<_> = bible
        .iter()
        .flat_map(|w| w.urls.iter().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if !urls.is_empty() {
        let chapters = bible.iter().map(|w| w.chapters).sum();
        works.insert(
            0,
            Work {
                id: ALL_BIBLE.into(),
                corpus: Corpus::Scripture,
                title: "Entire Bible".into(),
                chapters,
                total_chapters: chapters,
                urls,
                downloaded: 0,
                bytes: 0,
            },
        );
    }
    works
}
