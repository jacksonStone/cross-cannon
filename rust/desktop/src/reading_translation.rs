//! Selected reading text and recordings. Search and canonical identity remain WEB.
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

#[derive(Deserialize)]
struct RecordingBook {
    prefix: String,
    chapters: u32,
}

fn msb_recordings() -> &'static HashMap<String, RecordingBook> {
    static BOOKS: std::sync::OnceLock<HashMap<String, RecordingBook>> = std::sync::OnceLock::new();
    BOOKS.get_or_init(|| {
        #[derive(Deserialize)]
        struct Manifest {
            books: HashMap<String, RecordingBook>,
        }
        serde_json::from_str::<Manifest>(include_str!(
            "../../../public/scripture-translations/msb-audio.json"
        ))
        .expect("validated MSB recording catalog")
        .books
    })
}

impl Translation {
    pub(super) fn audio(
        self,
        library: &Library,
        chapter_id: &str,
    ) -> Option<cross_canon_core::AudioLocation> {
        let (book, chapter) = library.chapter(chapter_id)?;
        if self == Self::Msb && book.corpus == Corpus::Scripture {
            if let Some(recording) = msb_recordings().get(&book.title) {
                if (1..=recording.chapters).contains(&chapter.number) {
                    return Some(cross_canon_core::AudioLocation {
                        url: format!(
                            "https://openbible.com/audio/msb/{}_{:03}_D.mp3",
                            recording.prefix, chapter.number
                        ),
                        start_seconds: if matches!(chapter_id, "Matthew:6" | "Matthew:7") {
                            3.0
                        } else {
                            0.0
                        },
                        end_seconds: None,
                    });
                }
                return None;
            }
        }
        // Books outside MSB's scope display WEB text and retain its recordings.
        library.audio(chapter_id)
    }

    pub(super) fn fallback(
        self,
        library: &Library,
        chapter_id: &str,
    ) -> Option<cross_canon_core::AudioLocation> {
        let (book, _) = library.chapter(chapter_id)?;
        if self == Self::Msb
            && book.corpus == Corpus::Scripture
            && msb_recordings().contains_key(&book.title)
        {
            return None;
        }
        library.original_audio(chapter_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translation_audio_catalog_covers_every_msb_chapter() {
        let text: Text = serde_json::from_str(include_str!(
            "../../../public/scripture-translations/msb.json"
        ))
        .unwrap();
        let recordings = msb_recordings();
        assert_eq!(recordings.len(), 66);
        assert_eq!(
            recordings
                .values()
                .map(|book| book.chapters as usize)
                .sum::<usize>(),
            1189
        );
        for id in text.chapters.keys() {
            let (book, chapter) = id.rsplit_once(':').unwrap();
            let chapter: u32 = chapter.parse().unwrap();
            assert!(
                (1..=recordings[book].chapters).contains(&chapter),
                "Missing MSB audio: {id}"
            );
        }
    }

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

    #[test]
    fn incremental_chapters_match_bundled_reading_without_replacing_previous_chapters() {
        let library =
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
        let complete = ReadingText::new(&library);
        let mut text: Text = serde_json::from_str(include_str!(
            "../../../public/scripture-translations/msb.json"
        ))
        .unwrap();
        let mut incremental = ReadingText::default();
        let chapters = ["Genesis:1", "1 Timothy:3"];
        let first = &library.chapter(chapters[0]).unwrap().1.passage_ids[0];
        assert_eq!(
            incremental.passage(library.passage(first).unwrap(), Translation::Msb),
            library.passage(first).unwrap(),
        );
        for (index, chapter) in chapters.into_iter().enumerate() {
            let verses = text.chapters.remove(chapter).unwrap();
            let json = serde_json::json!({ "chapters": { chapter: verses } }).to_string();
            incremental.add_json(&library, &json).unwrap();
            for loaded in &chapters[..=index] {
                for id in &library.chapter(loaded).unwrap().1.passage_ids {
                    let source = library.passage(id).unwrap();
                    assert_eq!(
                        incremental.passage(source, Translation::Msb),
                        complete.passage(source, Translation::Msb),
                    );
                    assert_eq!(incremental.passage(source, Translation::Web), source);
                }
            }
        }
        assert!(incremental.add_json(&library, "invalid JSON").is_err());
        assert_eq!(
            incremental.passage(library.passage(first).unwrap(), Translation::Msb),
            complete.passage(library.passage(first).unwrap(), Translation::Msb),
        );
        assert_eq!(
            incremental.label("Genesis", Translation::Msb),
            complete.label("Genesis", Translation::Msb)
        );
        assert_eq!(
            incremental.label("Tobit", Translation::Msb),
            complete.label("Tobit", Translation::Msb)
        );
    }

    #[test]
    #[ignore = "Serial release-mode incremental Chapter translation timing"]
    fn incremental_translation_projection_audit() {
        let library =
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
        let text: Text = serde_json::from_str(include_str!(
            "../../../public/scripture-translations/msb.json"
        ))
        .unwrap();
        let json =
            serde_json::json!({ "chapters": { "John:3": text.chapters["John:3"] } }).to_string();
        let mut reading = ReadingText::default();
        let start = std::time::Instant::now();
        for _ in 0..1000 {
            reading.add_json(&library, &json).unwrap();
            std::hint::black_box(&reading);
        }
        eprintln!(
            "single_chapter_projection_us={:.2}; library_passages={}",
            start.elapsed().as_secs_f64() * 1000.0,
            library.passages.len()
        );
    }
}

#[derive(Deserialize)]
struct Text {
    chapters: HashMap<String, Vec<Verse>>,
}

#[derive(Clone, Default)]
pub(super) struct ReadingText {
    passages: HashMap<String, Passage>,
    books: HashSet<String>,
}

impl ReadingText {
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new(library: &Library) -> Self {
        let text: Text = serde_json::from_str(include_str!(
            "../../../public/scripture-translations/msb.json"
        ))
        .expect("validated, bundled MSB reading text");
        Self::project(library, text)
    }
    #[cfg(target_arch = "wasm32")]
    pub fn new(_library: &Library) -> Self {
        Self::default()
    }

    #[cfg(any(target_arch = "wasm32", test))]
    pub fn add_json(&mut self, library: &Library, json: &str) -> Result<()> {
        let projection = Self::project(library, serde_json::from_str(json)?);
        self.passages.extend(projection.passages);
        self.books.extend(projection.books);
        Ok(())
    }

    fn project(library: &Library, text: Text) -> Self {
        let books = text
            .chapters
            .keys()
            .filter_map(|key| key.rsplit_once(':').map(|(book, _)| book.to_owned()))
            .collect();
        let mut passages = HashMap::new();
        // Progressive readers supply a handful of Chapters at a time. Resolve
        // those Chapters through the shared identity index rather than scanning
        // and grouping the complete Library again for every incoming fragment.
        for (id, verses) in text.chapters {
            let Some((book, chapter)) = library.chapter(&id) else {
                continue;
            };
            if book.corpus != Corpus::Scripture {
                continue;
            }
            let mut group: Vec<_> = chapter
                .passage_ids
                .iter()
                .filter_map(|id| library.passage(id))
                .filter(|passage| !passage.text.is_empty())
                .collect();
            if group.is_empty() {
                continue;
            }
            group.sort_by_key(|passage| passage.verse_start);
            let mut assigned: Vec<Vec<Verse>> = vec![vec![]; group.len()];
            let mut index = 0;
            for verse in &verses {
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
