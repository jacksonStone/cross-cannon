//! Existing, immutable Cross Canon artifacts, shared by native desktop and API.
//! This crate has no networking, database writes, or artifact generation.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Corpus {
    #[default]
    Scripture,
    EarlyChristian,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Canon {
    #[default]
    Protestant,
    Catholic,
    Orthodox,
}
impl Canon {
    pub fn includes(self, book: &str) -> bool {
        let catholic = [
            "Tobit",
            "Judith",
            "Wisdom",
            "Sirach",
            "Baruch",
            "Daniel (Greek)",
            "Esther (Greek)",
            "1 Maccabees",
            "2 Maccabees",
        ];
        let orthodox = [
            "1 Esdras",
            "2 Esdras",
            "Prayer of Manasseh",
            "Psalm 151",
            "3 Maccabees",
            "4 Maccabees",
        ];
        self == Self::Orthodox
            || (!orthodox.contains(&book) && (self == Self::Catholic || !catholic.contains(&book)))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub id: String,
    pub corpus: Corpus,
    pub book_id: String,
    pub book: String,
    pub chapter_id: String,
    pub chapter: u32,
    pub reference: String,
    pub text: String,
    pub original_text: String,
    pub author: Option<String>,
    pub verse_start: u32,
    pub verse_end: u32,
}

impl Passage {
    pub fn reader_text(&self, original: bool) -> &str {
        if original {
            &self.original_text
        } else {
            &self.text
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub number: u32,
    pub title: String,
    pub passage_ids: Vec<String>,
    pub original_audio: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub corpus: Corpus,
    pub chapters: Vec<Chapter>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLocation {
    pub url: String,
    pub start_seconds: f64,
    pub end_seconds: Option<f64>,
}

pub struct Library {
    pub root: PathBuf,
    pub version: String,
    pub books: Vec<Book>,
    pub passages: Vec<Passage>,
    lookup: HashMap<String, usize>,
    audio: HashMap<String, AudioLocation>,
}

fn read_json(path: &Path) -> Result<Value> {
    serde_json::from_slice(
        &fs::read(path).with_context(|| format!("Missing local artifact {}", path.display()))?,
    )
    .with_context(|| format!("Invalid artifact {}", path.display()))
}
fn string(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_owned()
}
fn number(value: &Value, key: &str) -> u32 {
    value[key].as_u64().unwrap_or_default() as u32
}

impl Library {
    pub fn load(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let manifest = read_json(&root.join("scripture-cache/manifest.json"))?;
        let version = string(&manifest, "version");
        // The manifest controls the version; arbitrary paths never come from a request.
        if version.is_empty() || !version.chars().all(|c| c.is_ascii_hexdigit()) {
            bail!("Invalid scripture cache version");
        }
        let cache = read_json(&root.join(format!("scripture-cache/{version}.json")))?;
        let mut library = Self {
            root,
            version,
            books: vec![],
            passages: vec![],
            lookup: HashMap::new(),
            audio: HashMap::new(),
        };
        let mut scripture: BTreeMap<String, BTreeMap<u32, Chapter>> = BTreeMap::new();
        for value in cache["passages"]
            .as_array()
            .context("Missing scripture passages")?
        {
            let reference = string(value, "reference");
            let (book, location) = reference
                .rsplit_once(' ')
                .context("Invalid scripture reference")?;
            let chapter = location
                .split(':')
                .next()
                .context("Missing chapter")?
                .parse::<u32>()?;
            let chapter_id = format!("{book}:{chapter}");
            let verses = value["verses"]
                .as_array()
                .context("Missing scripture verses")?;
            let text = verses
                .iter()
                .map(|v| string(v, "text"))
                .collect::<Vec<_>>()
                .join(" ");
            let passage = Passage {
                id: string(value, "id"),
                corpus: Corpus::Scripture,
                book_id: book.into(),
                book: book.into(),
                chapter_id: chapter_id.clone(),
                chapter,
                reference: reference.clone(),
                original_text: text.clone(),
                text,
                author: None,
                verse_start: verses.first().map(|v| number(v, "number")).unwrap_or(1),
                verse_end: verses.last().map(|v| number(v, "number")).unwrap_or(1),
            };
            let entry = scripture
                .entry(book.into())
                .or_default()
                .entry(chapter)
                .or_insert_with(|| Chapter {
                    id: chapter_id,
                    number: chapter,
                    title: format!("{book} {chapter}"),
                    passage_ids: vec![],
                    original_audio: value["audioUrl"].as_str().map(str::to_owned),
                });
            entry.passage_ids.push(passage.id.clone());
            library.passages.push(passage);
        }
        for (title, chapters) in scripture {
            library.books.push(Book {
                id: title.clone(),
                title,
                author: None,
                corpus: Corpus::Scripture,
                chapters: chapters.into_values().collect(),
            });
        }
        library.books.sort_by_key(|book| {
            CANONICAL_BOOKS
                .iter()
                .position(|b| *b == book.title)
                .unwrap_or(999)
        });
        let index = read_json(
            &library
                .root
                .join("public/church-fathers-preview/books.json"),
        )?;
        for work in index["books"]
            .as_array()
            .context("Missing Early Christian book index")?
        {
            let mut book = Book {
                id: string(work, "id"),
                title: string(work, "book"),
                author: work["author"].as_str().map(str::to_owned),
                corpus: Corpus::EarlyChristian,
                chapters: vec![],
            };
            for entry in work["chapters"]
                .as_array()
                .context("Missing work chapters")?
            {
                let asset_path = string(entry, "assetPath");
                if !asset_path.starts_with("/church-fathers-preview/chapters/")
                    || asset_path.contains("..")
                {
                    bail!("Invalid chapter asset path");
                }
                let asset = read_json(
                    &library
                        .root
                        .join("public")
                        .join(asset_path.trim_start_matches('/')),
                )?;
                let id = string(entry, "id");
                let chapter_number = number(entry, "chapter");
                let verses = asset["verses"]
                    .as_array()
                    .context("Missing chapter verses")?;
                let mut ranges: Vec<&[Value]> = verses.chunks(3).collect();
                // Match the web reader: merge a trailing one/two verses into the preceding paragraph.
                if ranges.len() > 1 && ranges.last().is_some_and(|r| r.len() < 3) {
                    let start = (ranges.len() - 2) * 3;
                    ranges.truncate(ranges.len() - 2);
                    ranges.push(&verses[start..]);
                }
                let mut chapter = Chapter {
                    id: id.clone(),
                    number: chapter_number,
                    title: string(entry, "title"),
                    passage_ids: vec![],
                    original_audio: None,
                };
                for range in ranges {
                    let verse_start = number(&range[0], "verse");
                    let verse_end = number(range.last().unwrap(), "verse");
                    let text = range
                        .iter()
                        .map(|v| {
                            v["modernizedText"]
                                .as_str()
                                .filter(|s| !s.trim().is_empty())
                                .unwrap_or(v["text"].as_str().unwrap_or_default())
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                    let original_text = range
                        .iter()
                        .map(|v| string(v, "text"))
                        .collect::<Vec<_>>()
                        .join(" ");
                    let passage_id = format!("{id}:{verse_start}-{verse_end}");
                    chapter.passage_ids.push(passage_id.clone());
                    library.passages.push(Passage {
                        id: passage_id,
                        corpus: Corpus::EarlyChristian,
                        book_id: book.id.clone(),
                        book: book.title.clone(),
                        chapter_id: id.clone(),
                        chapter: chapter_number,
                        reference: format!(
                            "{} {chapter_number}:{verse_start}-{verse_end}",
                            book.title
                        ),
                        text,
                        original_text,
                        author: book.author.clone(),
                        verse_start,
                        verse_end,
                    });
                }
                book.chapters.push(chapter);
            }
            library.books.push(book);
        }
        library.lookup = library
            .passages
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), i))
            .collect();
        if library.lookup.len() != library.passages.len() {
            bail!("Duplicate passage IDs in local artifacts");
        }
        library.load_audio()?;
        Ok(library)
    }

    fn load_audio(&mut self) -> Result<()> {
        let continuous = read_json(&self.root.join("public/continuous-audio.json"))?;
        for (url, value) in continuous["chapters"]
            .as_object()
            .context("Missing continuous audio chapters")?
        {
            self.audio.insert(
                url.clone(),
                AudioLocation {
                    url: string(value, "url"),
                    start_seconds: value["startSeconds"].as_f64().unwrap_or(0.0),
                    end_seconds: value["endSeconds"].as_f64(),
                },
            );
        }
        for filename in [
            "confessions-audio-alignment.json",
            "first-clement-audio-alignment.json",
            "city-of-god-audio-alignment.json",
        ] {
            let alignment = read_json(
                &self
                    .root
                    .join("public/church-fathers-preview")
                    .join(filename),
            )?;
            for (id, value) in alignment["chapters"]
                .as_object()
                .context("Missing alignment chapters")?
            {
                self.audio.insert(
                    id.clone(),
                    AudioLocation {
                        url: string(value, "audioUrl"),
                        start_seconds: value["startSeconds"].as_f64().unwrap_or(0.0),
                        end_seconds: value["endSeconds"].as_f64(),
                    },
                );
            }
        }
        Ok(())
    }

    pub fn passage(&self, id: &str) -> Option<&Passage> {
        self.lookup.get(id).map(|i| &self.passages[*i])
    }
    pub fn book(&self, id: &str) -> Option<&Book> {
        self.books.iter().find(|b| b.id == id)
    }
    pub fn chapter(&self, id: &str) -> Option<(&Book, &Chapter)> {
        self.books
            .iter()
            .find_map(|b| b.chapters.iter().find(|c| c.id == id).map(|c| (b, c)))
    }
    pub fn audio(&self, chapter_id: &str) -> Option<AudioLocation> {
        if let Some(audio) = self.audio.get(chapter_id) {
            return Some(audio.clone());
        }
        let (_, chapter) = self.chapter(chapter_id)?;
        let original = chapter.original_audio.as_ref()?;
        Some(self.audio.get(original).cloned().unwrap_or(AudioLocation {
            url: original.clone(),
            start_seconds: 0.0,
            end_seconds: None,
        }))
    }
    pub fn search(
        &self,
        query: &str,
        corpus: Option<Corpus>,
        book_ids: &[String],
        limit: usize,
        canon: Canon,
    ) -> Vec<SearchHit> {
        let tokens: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
        if tokens.is_empty() {
            return vec![];
        }
        let mut hits: Vec<_> = self
            .passages
            .iter()
            .filter(|p| {
                (p.corpus != Corpus::Scripture || canon.includes(&p.book))
                    && corpus.is_none_or(|c| c == p.corpus)
                    && (book_ids.is_empty() || book_ids.contains(&p.book_id))
            })
            .filter_map(|p| {
                let text = p.text.to_lowercase();
                let reference = p.reference.to_lowercase();
                if !tokens
                    .iter()
                    .all(|t| text.contains(t) || reference.contains(t))
                {
                    return None;
                }
                let score = tokens
                    .iter()
                    .map(|t| text.matches(t).count() as f32)
                    .sum::<f32>()
                    / (text.len().max(100) as f32).sqrt();
                Some(SearchHit {
                    id: p.id.clone(),
                    chapter_id: p.chapter_id.clone(),
                    reference: p.reference.clone(),
                    corpus: p.corpus,
                    score,
                })
            })
            .collect();
        hits.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.id.cmp(&b.id)));
        hits.truncate(limit.min(100));
        hits
    }
    pub fn validate(&self) -> Result<()> {
        if self.books.is_empty() || self.passages.is_empty() {
            bail!("Local library is empty")
        }
        for book in &self.books {
            for chapter in &book.chapters {
                if chapter
                    .passage_ids
                    .iter()
                    .any(|id| self.passage(id).is_none())
                {
                    bail!("Broken chapter {}", chapter.id)
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub chapter_id: String,
    pub reference: String,
    pub corpus: Corpus,
    pub score: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub corpus: Option<Corpus>,
    #[serde(default)]
    pub canon: Canon,
    #[serde(default)]
    pub books: Vec<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub mode: SearchMode,
}
impl Default for SearchRequest {
    fn default() -> Self {
        Self {
            query: String::new(),
            source_id: None,
            corpus: None,
            canon: Canon::default(),
            books: vec![],
            limit: default_limit(),
            mode: SearchMode::default(),
        }
    }
}
fn default_limit() -> usize {
    10
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SearchMode {
    #[default]
    Keyword,
    Semantic,
}

pub const CANONICAL_BOOKS: &[&str] = &[
    "Genesis",
    "Exodus",
    "Leviticus",
    "Numbers",
    "Deuteronomy",
    "Joshua",
    "Judges",
    "Ruth",
    "1 Samuel",
    "2 Samuel",
    "1 Kings",
    "2 Kings",
    "1 Chronicles",
    "2 Chronicles",
    "1 Esdras",
    "2 Esdras",
    "Ezra",
    "Nehemiah",
    "Tobit",
    "Judith",
    "Esther",
    "Esther (Greek)",
    "1 Maccabees",
    "2 Maccabees",
    "3 Maccabees",
    "4 Maccabees",
    "Job",
    "Psalms",
    "Psalm 151",
    "Proverbs",
    "Ecclesiastes",
    "Song of Songs",
    "Wisdom",
    "Sirach",
    "Prayer of Manasseh",
    "Isaiah",
    "Jeremiah",
    "Lamentations",
    "Baruch",
    "Ezekiel",
    "Daniel",
    "Daniel (Greek)",
    "Hosea",
    "Joel",
    "Amos",
    "Obadiah",
    "Jonah",
    "Micah",
    "Nahum",
    "Habakkuk",
    "Zephaniah",
    "Haggai",
    "Zechariah",
    "Malachi",
    "Matthew",
    "Mark",
    "Luke",
    "John",
    "Acts",
    "Romans",
    "1 Corinthians",
    "2 Corinthians",
    "Galatians",
    "Ephesians",
    "Philippians",
    "Colossians",
    "1 Thessalonians",
    "2 Thessalonians",
    "1 Timothy",
    "2 Timothy",
    "Titus",
    "Philemon",
    "Hebrews",
    "James",
    "1 Peter",
    "2 Peter",
    "1 John",
    "2 John",
    "3 John",
    "Jude",
    "Revelation",
];

/// Resources beside a packaged executable, or a developer checkout. No downloads.
pub fn data_root() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("CROSS_CANON_DATA_DIR") {
        return Ok(path.into());
    }
    let exe = std::env::current_exe()?;
    let bundled = exe
        .parent()
        .context("Executable has no directory")?
        .join("../Resources/library");
    if bundled.join("scripture-cache/manifest.json").is_file() {
        return Ok(bundled);
    }
    let current = std::env::current_dir()?;
    if current.join("scripture-cache/manifest.json").is_file() {
        return Ok(current);
    }
    bail!("Local texts are missing. Install the complete Cross Canon Desktop app or set CROSS_CANON_DATA_DIR.")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_artifacts_are_complete_and_searchable_offline() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let library = Library::load(root).unwrap();
        library.validate().unwrap();
        assert_eq!(
            library
                .books
                .iter()
                .filter(|b| b.corpus == Corpus::Scripture)
                .count(),
            81
        );
        assert_eq!(
            library
                .books
                .iter()
                .filter(|b| b.corpus == Corpus::EarlyChristian)
                .count(),
            410
        );
        assert_eq!(
            library
                .passages
                .iter()
                .filter(|p| p.corpus == Corpus::Scripture)
                .count(),
            8360
        );
        assert_eq!(
            library
                .books
                .iter()
                .filter(|b| b.corpus == Corpus::EarlyChristian)
                .map(|b| b.chapters.len())
                .sum::<usize>(),
            12956
        );
        for (canon, count) in [
            (Canon::Protestant, 66),
            (Canon::Catholic, 75),
            (Canon::Orthodox, 81),
        ] {
            assert_eq!(
                library
                    .books
                    .iter()
                    .filter(|b| b.corpus == Corpus::Scripture && canon.includes(&b.title))
                    .count(),
                count
            );
        }
        let hits = library.search(
            "beginning",
            Some(Corpus::Scripture),
            &["Genesis".into()],
            10,
            Canon::Protestant,
        );
        assert!(!hits.is_empty());
        assert!(hits
            .iter()
            .all(|h| library.passage(&h.id).unwrap().book == "Genesis"));
        assert!(library
            .search("", None, &[], 10, Canon::Protestant)
            .is_empty());
        let audio = library.audio("Genesis:2").unwrap();
        assert!(audio.start_seconds > 260.0);
        assert!(audio.url.contains("continuous"));
        for p in library
            .passages
            .iter()
            .filter(|p| p.corpus == Corpus::EarlyChristian)
        {
            assert!(p.verse_end >= p.verse_start);
        }
    }
}
