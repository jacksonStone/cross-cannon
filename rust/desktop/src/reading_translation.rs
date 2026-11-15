//! Reading text only. Search requests and the canonical Library remain WEB.
use super::*;
use cross_canon_core::Verse;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Translation {
    #[default]
    Web,
    Msb,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_msb_reading_preserves_web_ids_search_text_and_complete_verse_coverage() {
        let root = std::env::var_os("CROSS_CANON_TEST_LIBRARY")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
        let library = Library::load(root).unwrap();
        let reading = ReadingText::new(&library);
        let expected: Text = serde_json::from_str(include_str!(
            "../../../public/scripture-translations/msb.json"
        ))
        .unwrap();
        let mut observed: HashMap<String, Vec<Verse>> = HashMap::new();
        let mut sample = None;
        for source in &library.passages {
            let displayed = reading.passage(source, Translation::Msb);
            assert_eq!(displayed.id, source.id);
            assert_eq!(reading.passage(source, Translation::Web), source);
            if expected.chapters.contains_key(&source.chapter_id) {
                observed
                    .entry(source.chapter_id.clone())
                    .or_default()
                    .extend(displayed.verses.clone());
                if source.book == "1 Timothy"
                    && source.chapter == 3
                    && source.verses.iter().any(|v| v.number == 16)
                {
                    assert!(source.text.contains("God was revealed in the flesh"));
                    assert!(displayed.text.contains("God appeared in the flesh"));
                    sample = Some(source.id.clone());
                }
            } else {
                assert_eq!(displayed, source);
            }
        }
        for verses in observed.values_mut() {
            verses.sort_by_key(|verse| verse.number);
        }
        assert_eq!(observed, expected.chapters);
        assert!(sample.is_some());
        assert_eq!(
            reading.label("Genesis", Translation::Msb),
            "MSB · Majority Standard Bible"
        );
        assert_eq!(
            reading.label("Tobit", Translation::Msb),
            "WEB · World English Bible"
        );
        let legacy: ReaderState = serde_json::from_str("{}").unwrap();
        assert_eq!(legacy.scripture_translation, Translation::Web);
    }
}

#[derive(Deserialize)]
struct Text {
    chapters: HashMap<String, Vec<Verse>>,
}

pub(super) struct ReadingText {
    passages: HashMap<String, Passage>,
    books: HashSet<String>,
}

impl ReadingText {
    pub fn new(library: &Library) -> Self {
        // Compiled into both native apps: available offline without a second index.
        let text: Text = serde_json::from_str(include_str!(
            "../../../public/scripture-translations/msb.json"
        ))
        .expect("validated, bundled MSB reading text");
        let books = text
            .chapters
            .keys()
            .filter_map(|key| key.rsplit_once(':').map(|(book, _)| book.to_owned()))
            .collect();
        let mut groups: HashMap<&str, Vec<&Passage>> = HashMap::new();
        for passage in &library.passages {
            if passage.corpus == Corpus::Scripture {
                groups.entry(&passage.chapter_id).or_default().push(passage);
            }
        }
        let mut passages = HashMap::new();
        for (chapter, mut group) in groups {
            let Some(verses) = text.chapters.get(chapter) else {
                continue;
            };
            group.sort_by_key(|passage| passage.verse_start);
            let mut assigned: Vec<Vec<Verse>> = vec![vec![]; group.len()];
            let mut index = 0;
            for verse in verses {
                while index + 1 < group.len() && group[index + 1].verse_start <= verse.number {
                    index += 1;
                }
                assigned[index].push(verse.clone());
            }
            for (original, verses) in group.into_iter().zip(assigned) {
                let mut passage = original.clone();
                if let (Some(first), Some(last)) = (verses.first(), verses.last()) {
                    passage.verse_start = first.number;
                    passage.verse_end = last.number;
                    passage.reference = format!(
                        "{} {}:{}{}",
                        passage.book,
                        passage.chapter,
                        first.number,
                        if first.number == last.number {
                            String::new()
                        } else {
                            format!("-{}", last.number)
                        }
                    );
                }
                passage.text = if verses.is_empty() {
                    "This passage is not included in MSB.".to_owned()
                } else {
                    verses
                        .iter()
                        .map(|verse| verse.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                passage.original_text = passage.text.clone();
                passage.verses = verses;
                passages.insert(passage.id.clone(), passage);
            }
        }
        Self { passages, books }
    }

    pub fn passage<'a>(&'a self, source: &'a Passage, translation: Translation) -> &'a Passage {
        if translation == Translation::Msb {
            self.passages.get(&source.id).unwrap_or(source)
        } else {
            source
        }
    }

    pub fn label(&self, book: &str, translation: Translation) -> &'static str {
        if translation == Translation::Msb && self.books.contains(book) {
            "MSB · Majority Standard Bible"
        } else {
            "WEB · World English Bible"
        }
    }
}
