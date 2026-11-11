//! Existing, immutable Cross Canon artifacts, shared by native desktop and API.
//! This crate has no networking, database writes, or artifact generation.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Corpus {
    #[default]
    Scripture,
    EarlyChristian,
    ChristianClassics,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
    pub verses: Vec<Verse>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Verse {
    pub number: u32,
    pub text: String,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub number: u32,
    pub title: String,
    pub passage_ids: Vec<String>,
    pub original_audio: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub corpus: Corpus,
    pub chapters: Vec<Chapter>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLocation {
    pub url: String,
    pub start_seconds: f64,
    pub end_seconds: Option<f64>,
}

#[derive(Serialize, Deserialize)]
pub struct Library {
    #[serde(skip)]
    pub root: PathBuf,
    pub version: String,
    pub books: Vec<Book>,
    pub passages: Vec<Passage>,
    #[serde(skip)]
    lookup: HashMap<String, usize>,
    #[serde(skip)]
    book_lookup: HashMap<String, usize>,
    #[serde(skip)]
    chapter_lookup: HashMap<String, (usize, usize)>,
    #[serde(skip)]
    book_passages: Vec<Vec<usize>>,
    #[serde(skip)]
    search_books: Vec<OnceLock<Vec<SearchText>>>,
    audio: HashMap<String, AudioLocation>,
}

struct SearchText {
    passage: usize,
    text: String,
    reference: String,
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
        let root = root.as_ref();
        let packed = root.join("native-library.bin");
        if packed.is_file() {
            return Self::load_native(root, &fs::read(packed)?);
        }
        Self::load_artifacts(root)
    }

    /// Build-time preparation of existing texts; never reads or changes a database.
    pub fn load_artifacts(root: impl AsRef<Path>) -> Result<Self> {
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
            book_lookup: HashMap::new(),
            chapter_lookup: HashMap::new(),
            book_passages: vec![],
            search_books: vec![],
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
                verses: verses
                    .iter()
                    .map(|v| Verse {
                        number: number(v, "number"),
                        text: string(v, "text"),
                    })
                    .collect(),
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
        for (corpus, index_path, asset_prefix) in [
            (
                Corpus::EarlyChristian,
                "public/church-fathers-preview/books.json",
                "/church-fathers-preview/chapters/",
            ),
            (
                Corpus::ChristianClassics,
                "public/christian-classics-text/books.json",
                "/christian-classics-text/chapters/",
            ),
        ] {
            let index_path = library.root.join(index_path);
            if corpus == Corpus::ChristianClassics && !index_path.is_file() {
                continue;
            }
            let index = read_json(&index_path)?;
            for work in index["books"]
                .as_array()
                .context("Missing Early Christian book index")?
            {
                let mut book = Book {
                    id: string(work, "id"),
                    title: string(work, "book"),
                    author: work["author"].as_str().map(str::to_owned),
                    corpus,
                    chapters: vec![],
                };
                for entry in work["chapters"]
                    .as_array()
                    .context("Missing work chapters")?
                {
                    let asset_path = string(entry, "assetPath");
                    if !asset_path.starts_with(asset_prefix) || asset_path.contains("..") {
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
                            corpus,
                            book_id: book.id.clone(),
                            book: book.title.clone(),
                            chapter_id: id.clone(),
                            chapter: chapter_number,
                            reference: format!(
                                "{} {}:{verse_start}-{verse_end}",
                                book.title,
                                entry["reference"]
                                    .as_str()
                                    .map(str::to_owned)
                                    .unwrap_or_else(|| chapter_number.to_string())
                            ),
                            text,
                            original_text,
                            author: book.author.clone(),
                            verse_start,
                            verse_end,
                            verses: range
                                .iter()
                                .map(|v| Verse {
                                    number: number(v, "verse"),
                                    text: v["modernizedText"]
                                        .as_str()
                                        .filter(|s| !s.trim().is_empty())
                                        .unwrap_or(v["text"].as_str().unwrap_or_default())
                                        .to_owned(),
                                })
                                .collect(),
                        });
                    }
                    book.chapters.push(chapter);
                }
                library.books.push(book);
            }
        }
        library.rebuild_indexes()?;
        library.load_audio()?;
        Ok(library)
    }

    fn load_native(root: &Path, bytes: &[u8]) -> Result<Self> {
        use bincode::Options;
        use std::io::Read;
        const HEADER: &[u8] = b"CCLIB\0\x03\0";
        const GZIP_HEADER: &[u8] = b"CCLIB\0\x02\0";
        const LEGACY_HEADER: &[u8] = b"CCLIB\0\x01\0";
        anyhow::ensure!(
            bytes.starts_with(HEADER)
                || bytes.starts_with(GZIP_HEADER)
                || bytes.starts_with(LEGACY_HEADER),
            "Unsupported native library format"
        );
        let expanded = if bytes.starts_with(HEADER) {
            let size_bytes: [u8; 8] = bytes
                .get(8..16)
                .context("Missing native library size")?
                .try_into()?;
            let size = u64::from_le_bytes(size_bytes);
            anyhow::ensure!(
                size > 0 && size <= 512 * 1024 * 1024,
                "Native library exceeds size limit"
            );
            let mut decoded = Vec::with_capacity(size as usize);
            let mut decoder = zstd::stream::read::Decoder::new(&bytes[16..])?;
            decoder.window_log_max(29)?;
            decoder
                .take(size + 1)
                .read_to_end(&mut decoded)
                .context("Invalid compressed native library")?;
            anyhow::ensure!(decoded.len() as u64 == size, "Invalid native library size");
            Some(decoded)
        } else if bytes.starts_with(GZIP_HEADER) {
            let mut decoded = Vec::new();
            flate2::read::GzDecoder::new(&bytes[HEADER.len()..])
                .take(512 * 1024 * 1024 + 1)
                .read_to_end(&mut decoded)
                .context("Invalid compressed native library")?;
            anyhow::ensure!(
                decoded.len() <= 512 * 1024 * 1024,
                "Native library exceeds size limit"
            );
            Some(decoded)
        } else {
            None
        };
        let payload = expanded.as_deref().unwrap_or(&bytes[HEADER.len()..]);
        let mut library: Self = bincode::DefaultOptions::new()
            .with_limit(512 * 1024 * 1024)
            .deserialize(payload)
            .context("Invalid packaged native library")?;
        library.root = root.to_path_buf();
        let manifest = read_json(&root.join("scripture-cache/manifest.json"))?;
        anyhow::ensure!(
            manifest["version"].as_str() == Some(&library.version),
            "Stale native library"
        );
        library.rebuild_indexes()?;
        library.validate()?;
        Ok(library)
    }

    fn rebuild_indexes(&mut self) -> Result<()> {
        self.lookup = self
            .passages
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), i))
            .collect();
        anyhow::ensure!(
            self.lookup.len() == self.passages.len(),
            "Duplicate passage IDs in local library"
        );
        self.book_lookup = self
            .books
            .iter()
            .enumerate()
            .map(|(i, b)| (b.id.clone(), i))
            .collect();
        self.chapter_lookup = self
            .books
            .iter()
            .enumerate()
            .flat_map(|(b, book)| {
                book.chapters
                    .iter()
                    .enumerate()
                    .map(move |(c, chapter)| (chapter.id.clone(), (b, c)))
            })
            .collect();
        self.search_books = (0..self.books.len()).map(|_| OnceLock::new()).collect();
        self.book_passages = vec![vec![]; self.books.len()];
        for (index, passage) in self.passages.iter().enumerate() {
            let book = self
                .book_lookup
                .get(&passage.book_id)
                .context("Passage has no Book")?;
            self.book_passages[*book].push(index);
        }
        Ok(())
    }

    pub fn write_native(&self, path: impl AsRef<Path>) -> Result<()> {
        use bincode::Options;
        use std::io::Write;
        let mut output = std::io::BufWriter::new(fs::File::create(path)?);
        output.write_all(b"CCLIB\0\x03\0")?;
        let bytes = bincode::DefaultOptions::new().serialize(self)?;
        output.write_all(&(bytes.len() as u64).to_le_bytes())?;
        let mut compressed = zstd::stream::write::Encoder::new(output, 9)?;
        compressed.include_checksum(true)?;
        compressed.set_pledged_src_size(Some(bytes.len() as u64))?;
        compressed.write_all(&bytes)?;
        let mut output = compressed.finish()?;
        output.flush()?;
        Ok(())
    }

    /// Native iOS packaging can retain the smaller, original chapter recordings
    /// byte for byte instead of bundling the larger re-encoded book copies.
    /// This changes only the generated native library, never source manifests.
    pub fn use_original_bible_audio(&mut self) {
        for book in &self.books {
            if book.corpus != Corpus::Scripture {
                continue;
            }
            for chapter in &book.chapters {
                if let Some(original) = &chapter.original_audio {
                    self.audio.insert(
                        chapter.id.clone(),
                        AudioLocation {
                            url: original.split('?').next().unwrap_or(original).into(),
                            start_seconds: 0.0,
                            end_seconds: None,
                        },
                    );
                }
            }
        }
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
        self.book_lookup.get(id).map(|i| &self.books[*i])
    }
    pub fn chapter(&self, id: &str) -> Option<(&Book, &Chapter)> {
        self.chapter_lookup
            .get(id)
            .map(|&(b, c)| (&self.books[b], &self.books[b].chapters[c]))
    }
    pub fn audio(&self, chapter_id: &str) -> Option<AudioLocation> {
        if let Some(audio) = self.audio.get(chapter_id) {
            return Some(audio.clone());
        }
        let (_, chapter) = self.chapter(chapter_id)?;
        let original = chapter.original_audio.as_ref()?;
        let key = original.split('?').next().unwrap_or(original);
        Some(self.audio.get(key).cloned().unwrap_or(AudioLocation {
            url: original.clone(),
            start_seconds: 0.0,
            end_seconds: None,
        }))
    }
    pub fn original_audio(&self, chapter_id: &str) -> Option<AudioLocation> {
        let (book, chapter) = self.chapter(chapter_id)?;
        // Fathers alignments are exact chapter offsets; an unaligned fallback
        // would incorrectly restart a multi-chapter recording from its beginning.
        if book.corpus != Corpus::Scripture {
            return None;
        }
        Some(AudioLocation {
            url: chapter.original_audio.clone()?,
            start_seconds: 0.0,
            end_seconds: None,
        })
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
        let limit = limit.min(100);
        if tokens.is_empty() || limit == 0 {
            return vec![];
        }
        let mut hits = Vec::new();
        for (index, book) in self.books.iter().enumerate() {
            if (book.corpus == Corpus::Scripture && !canon.includes(&book.title))
                || corpus.is_some_and(|c| c != book.corpus)
                || (!book_ids.is_empty() && !book_ids.contains(&book.id))
            {
                continue;
            }
            // Normalize only searched Books, once. This cache is never serialized
            // or built during startup, and is shared safely by search workers.
            let texts = self.search_books[index].get_or_init(|| {
                self.book_passages[index]
                    .iter()
                    .map(|&passage| {
                        let p = &self.passages[passage];
                        SearchText {
                            passage,
                            text: p.text.to_lowercase(),
                            reference: p.reference.to_lowercase(),
                        }
                    })
                    .collect()
            });
            for entry in texts {
                if !tokens
                    .iter()
                    .all(|t| entry.text.contains(t) || entry.reference.contains(t))
                {
                    continue;
                }
                let score = tokens
                    .iter()
                    .map(|t| entry.text.matches(t).count() as f32)
                    .sum::<f32>()
                    / (entry.text.len().max(100) as f32).sqrt();
                hits.push((&self.passages[entry.passage], score));
            }
        }
        let compare = |a: &(&Passage, f32), b: &(&Passage, f32)| {
            b.1.total_cmp(&a.1).then(a.0.id.cmp(&b.0.id))
        };
        if hits.len() > limit {
            hits.select_nth_unstable_by(limit, compare);
            hits.truncate(limit);
        }
        hits.sort_unstable_by(compare);
        hits.into_iter()
            .map(|(p, score)| SearchHit {
                id: p.id.clone(),
                chapter_id: p.chapter_id.clone(),
                reference: p.reference.clone(),
                corpus: p.corpus,
                score,
            })
            .collect()
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
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub web: bool,
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
            authors: vec![],
            web: false,
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
    // iOS puts its resources beside the executable, unlike a macOS .app.
    let mobile = exe
        .parent()
        .context("Executable has no directory")?
        .join("library");
    if mobile.join("scripture-cache/manifest.json").is_file() {
        return Ok(mobile);
    }
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
    bail!("Local texts are missing. Install the complete Cross Canon app or set CROSS_CANON_DATA_DIR.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexed_keyword_search_preserves_exact_legacy_results() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let library = Library::load_artifacts(&root).unwrap();
        assert!(
            library.search_books.iter().all(|book| book.get().is_none()),
            "Startup must not normalize all text"
        );
        for (query, corpus, books, canon, limit) in [
            ("love", None, vec![], Canon::Orthodox, 20),
            (
                "fear comfort",
                Some(Corpus::Scripture),
                vec![],
                Canon::Protestant,
                5,
            ),
            (
                "John 3",
                Some(Corpus::Scripture),
                vec!["John".into()],
                Canon::Catholic,
                100,
            ),
            (
                "LOVE love",
                Some(Corpus::EarlyChristian),
                vec![],
                Canon::Protestant,
                1,
            ),
            (
                "city",
                Some(Corpus::EarlyChristian),
                vec!["npnf102:iv".into()],
                Canon::Orthodox,
                200,
            ),
            ("the", Some(Corpus::Scripture), vec![], Canon::Catholic, 20),
            ("λόγος", None, vec![], Canon::Orthodox, 10),
            ("İ", None, vec![], Canon::Orthodox, 10),
            ("", None, vec![], Canon::Orthodox, 20),
            ("love", None, vec![], Canon::Orthodox, 0),
            ("God", None, vec!["unknown".into()], Canon::Orthodox, 20),
        ] {
            let tokens: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
            let mut expected: Vec<_> = library
                .passages
                .iter()
                .filter(|p| {
                    (p.corpus != Corpus::Scripture || canon.includes(&p.book))
                        && corpus.is_none_or(|c| c == p.corpus)
                        && (books.is_empty() || books.contains(&p.book_id))
                })
                .filter_map(|p| {
                    if tokens.is_empty() {
                        return None;
                    }
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
                    Some((p.id.clone(), score))
                })
                .collect();
            expected.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            expected.truncate(limit.min(100));
            let actual = library.search(query, corpus, &books, limit, canon);
            assert_eq!(
                actual
                    .iter()
                    .map(|h| (&h.id, h.score.to_bits()))
                    .collect::<Vec<_>>(),
                expected
                    .iter()
                    .map(|h| (&h.0, h.1.to_bits()))
                    .collect::<Vec<_>>(),
                "Search behavior changed for {query}"
            );
            let cached = library.search(query, corpus, &books, limit, canon);
            assert_eq!(
                actual.iter().map(|h| &h.id).collect::<Vec<_>>(),
                cached.iter().map(|h| &h.id).collect::<Vec<_>>()
            );
        }
        for book in &library.books {
            assert_eq!(library.book(&book.id).unwrap().id, book.id);
            for chapter in &book.chapters {
                let (indexed_book, indexed_chapter) = library.chapter(&chapter.id).unwrap();
                assert_eq!(indexed_book.id, book.id);
                assert_eq!(indexed_chapter.id, chapter.id);
            }
        }
    }
    #[test]
    fn original_bible_audio_keeps_chapter_files_and_fathers_alignment() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut library = Library::load_artifacts(&root).unwrap();
        let clement = library.book("anf09:xii.iv").unwrap().chapters[0].id.clone();
        let fathers_before = library.audio(&clement);
        library.use_original_bible_audio();
        let mut chapters = 0;
        for book in &library.books {
            if book.corpus != Corpus::Scripture {
                continue;
            }
            for chapter in &book.chapters {
                if let Some(source) = &chapter.original_audio {
                    let audio = library.audio(&chapter.id).unwrap();
                    assert_eq!(audio.url, source.split('?').next().unwrap());
                    assert_eq!(audio.start_seconds, 0.0);
                    assert_eq!(audio.end_seconds, None);
                    assert!(root
                        .join("storage")
                        .join(audio.url.trim_start_matches('/'))
                        .is_file());
                    chapters += 1;
                }
            }
        }
        assert_eq!(chapters, 1189);
        assert_eq!(library.audio(&clement), fathers_before);
    }
    #[test]
    fn native_bundle_restores_every_passage_without_source_chapter_files() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let source = Library::load_artifacts(&root).unwrap();
        let destination =
            std::env::temp_dir().join(format!("crosscanon-native-{}", std::process::id()));
        fs::create_dir_all(destination.join("scripture-cache")).unwrap();
        fs::copy(
            root.join("scripture-cache/manifest.json"),
            destination.join("scripture-cache/manifest.json"),
        )
        .unwrap();
        source
            .write_native(destination.join("native-library.bin"))
            .unwrap();
        let loaded = Library::load(&destination).unwrap();
        assert_eq!(source.books, loaded.books);
        assert_eq!(source.passages, loaded.passages);
        assert_eq!(source.audio, loaded.audio);
        assert_eq!(loaded.root, destination);
        for passage in &source.passages {
            assert_eq!(loaded.passage(&passage.id), Some(passage));
        }
        assert!(loaded.audio("Genesis:2").unwrap().start_seconds > 260.0);
        let mut compressed = fs::read(destination.join("native-library.bin")).unwrap();
        assert!(
            compressed.len() < 60_000_000,
            "Complete text including the four Classics should compress losslessly below 60 MB"
        );
        compressed.truncate(compressed.len() - 10);
        assert!(
            Library::load_native(&destination, &compressed).is_err(),
            "Truncated compressed data must be rejected"
        );
        fs::write(
            destination.join("scripture-cache/manifest.json"),
            r#"{"version":"deadbeef"}"#,
        )
        .unwrap();
        assert!(
            Library::load(&destination).is_err(),
            "stale native data must be rejected"
        );
        fs::write(
            destination.join("native-library.bin"),
            b"CCLIB\0\x01\0truncated",
        )
        .unwrap();
        assert!(
            Library::load(&destination).is_err(),
            "partial native data must be rejected"
        );
        fs::remove_dir_all(destination).unwrap();
    }
    #[test]
    fn actual_artifacts_are_complete_and_searchable_offline() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let library = Library::load(root).unwrap();
        library.validate().unwrap();
        let classics: Vec<_> = library
            .books
            .iter()
            .filter(|book| book.corpus == Corpus::ChristianClassics)
            .collect();
        assert_eq!(classics.len(), 4);
        assert_eq!(
            classics
                .iter()
                .map(|book| book.chapters.len())
                .sum::<usize>(),
            2580
        );
        let classic_hits = library.search(
            "humility",
            Some(Corpus::ChristianClassics),
            &[],
            10,
            Canon::Protestant,
        );
        assert_eq!(classic_hits.len(), 10);
        assert!(classic_hits
            .iter()
            .all(|hit| library.passage(&hit.id).unwrap().corpus == Corpus::ChristianClassics));
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
