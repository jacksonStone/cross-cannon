//! Transport-independent progressive text artifacts. Native readers can keep
//! their complete Library; browser adapters hydrate only requested Chapters.
use super::*;
use bincode::Options;
use std::io::Write;

#[derive(Serialize, Deserialize)]
struct Index {
    version: String,
    books: Vec<Book>,
    verses: Vec<Vec<u32>>,
    audio: BTreeMap<String, AudioLocation>,
}

pub(super) fn decode(root: &Path, bytes: &[u8]) -> Result<Library> {
    let index: Index = bincode::DefaultOptions::new()
        .with_limit(512 * 1024 * 1024)
        .deserialize(bytes)?;
    let mut numbers = index.verses.into_iter();
    let mut passages = Vec::new();
    for book in &index.books {
        for chapter in &book.chapters {
            for id in &chapter.passage_ids {
                let verses = numbers.next().context("Missing index verse coverage")?;
                let start = *verses.first().context("Empty index verse coverage")?;
                let end = *verses.last().unwrap();
                passages.push(Passage {
                    id: id.clone(),
                    corpus: book.corpus,
                    book_id: book.id.clone(),
                    book: book.title.clone(),
                    chapter_id: chapter.id.clone(),
                    chapter: chapter.number,
                    reference: format!(
                        "{} {}:{}{}",
                        book.title,
                        chapter.number,
                        start,
                        if start == end {
                            String::new()
                        } else {
                            format!("-{end}")
                        }
                    ),
                    text: String::new(),
                    original_text: String::new(),
                    author: book.author.clone(),
                    verse_start: start,
                    verse_end: end,
                    verses: verses
                        .into_iter()
                        .map(|number| Verse {
                            number,
                            text: String::new(),
                        })
                        .collect(),
                });
            }
        }
    }
    anyhow::ensure!(numbers.next().is_none(), "Extra index verse coverage");
    let mut library = Library {
        root: root.to_owned(),
        version: index.version,
        books: index.books,
        passages,
        lookup: HashMap::new(),
        book_lookup: HashMap::new(),
        chapter_lookup: HashMap::new(),
        book_passages: vec![],
        search_books: vec![],
        audio: index.audio.into_iter().collect(),
    };
    library.rebuild_indexes()?;
    library.validate()?;
    Ok(library)
}

impl Library {
    pub fn write_browser_index(&self, path: impl AsRef<Path>) -> Result<()> {
        let index = Index {
            version: self.version.clone(),
            books: self.books.clone(),
            verses: self
                .books
                .iter()
                .flat_map(|b| &b.chapters)
                .flat_map(|c| &c.passage_ids)
                .map(|id| {
                    self.passage(id)
                        .unwrap()
                        .verses
                        .iter()
                        .map(|v| v.number)
                        .collect()
                })
                .collect(),
            audio: self
                .audio
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        };
        let mut output = std::io::BufWriter::new(fs::File::create(path)?);
        output.write_all(b"CCIDX\0\x01\0")?;
        let mut compressed = flate2::write::GzEncoder::new(output, flate2::Compression::default());
        bincode::DefaultOptions::new().serialize_into(&mut compressed, &index)?;
        compressed.finish()?.flush()?;
        Ok(())
    }

    /// Immutable text fragment at Chapter granularity, independent of transport.
    pub fn fragment(&self, chapters: &[String]) -> Result<Self> {
        let mut selected: BTreeMap<usize, BTreeMap<usize, Chapter>> = BTreeMap::new();
        for chapter in chapters {
            let &(book, position) = self
                .chapter_lookup
                .get(chapter)
                .context("Unknown fragment Chapter")?;
            selected
                .entry(book)
                .or_default()
                .insert(position, self.books[book].chapters[position].clone());
        }
        let books: Vec<Book> = selected
            .into_iter()
            .map(|(index, chapters)| {
                let book = &self.books[index];
                Book {
                    id: book.id.clone(),
                    title: book.title.clone(),
                    author: book.author.clone(),
                    corpus: book.corpus,
                    chapters: chapters.into_values().collect(),
                }
            })
            .collect();
        let passages = books
            .iter()
            .flat_map(|b| &b.chapters)
            .flat_map(|c| &c.passage_ids)
            .filter_map(|id| self.passage(id).cloned())
            .collect();
        let mut fragment = Self {
            root: self.root.clone(),
            version: self.version.clone(),
            books,
            passages,
            lookup: HashMap::new(),
            book_lookup: HashMap::new(),
            chapter_lookup: HashMap::new(),
            book_passages: vec![],
            search_books: vec![],
            audio: HashMap::new(),
        };
        fragment.rebuild_indexes()?;
        fragment.validate()?;
        Ok(fragment)
    }

    pub fn chapter_ready(&self, id: &str) -> bool {
        self.chapter(id).is_some_and(|(_, c)| {
            !c.passage_ids.is_empty()
                && c.passage_ids
                    .iter()
                    .all(|id| self.passage(id).is_some_and(|p| !p.text.is_empty()))
        })
    }

    /// Validate a whole fragment before replacing text. IDs, chapter order,
    /// verse coverage and the existing audio model can never change on hydration.
    pub fn install_fragment(&mut self, fragment: Self) -> Result<()> {
        anyhow::ensure!(
            fragment.version == self.version,
            "Text fragment version mismatch"
        );
        fragment.validate()?;
        for book in &fragment.books {
            let expected = self.book(&book.id).context("Unknown text fragment Book")?;
            anyhow::ensure!(
                expected.title == book.title
                    && expected.corpus == book.corpus
                    && expected.author == book.author,
                "Text fragment Book mismatch"
            );
            for chapter in &book.chapters {
                anyhow::ensure!(
                    self.chapter(&chapter.id)
                        .is_some_and(|(b, c)| b.id == book.id && c == chapter),
                    "Text fragment Chapter mismatch"
                );
            }
        }
        for p in &fragment.passages {
            let expected = self
                .passage(&p.id)
                .context("Unknown text fragment Passage")?;
            anyhow::ensure!(
                !p.text.is_empty()
                    && expected.corpus == p.corpus
                    && expected.book_id == p.book_id
                    && expected.chapter_id == p.chapter_id
                    && expected.verse_start == p.verse_start
                    && expected.verse_end == p.verse_end
                    && expected
                        .verses
                        .iter()
                        .map(|v| v.number)
                        .eq(p.verses.iter().map(|v| v.number)),
                "Text fragment Passage mismatch"
            );
        }
        for book in &fragment.books {
            let index = self.book_lookup[&book.id];
            self.search_books[index] = OnceLock::new();
        }
        for passage in fragment.passages {
            let index = self.lookup[&passage.id];
            self.passages[index] = passage;
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn progressive_text_preserves_identity_audio_and_search_and_rejects_mixed_releases() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let full = Library::load_artifacts(&root).unwrap();
        let chapters = vec![
            "Genesis:1".into(),
            "Genesis:2".into(),
            "John:3".into(),
            full.book("anf09:xii.iv").unwrap().chapters[0].id.clone(),
        ];
        let mut shuffled = chapters.clone();
        shuffled.reverse();
        shuffled.push(chapters[0].clone());
        assert_eq!(
            full.fragment(&shuffled).unwrap().passages,
            full.fragment(&chapters).unwrap().passages
        );
        let mut source = full.fragment(&chapters).unwrap();
        source.audio = chapters
            .iter()
            .filter_map(|id| full.audio(id).map(|a| (id.clone(), a)))
            .collect();
        drop(full);
        let path =
            std::env::temp_dir().join(format!("crosscanon-index-{}.bin", std::process::id()));
        source.write_browser_index(&path).unwrap();
        let bytes = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        let mut index = Library::from_bytes(Path::new(""), &bytes).unwrap();
        assert_eq!(index.books, source.books);
        assert_eq!(index.audio, source.audio);
        for p in &source.passages {
            let restored = index.passage(&p.id).unwrap();
            assert_eq!(restored.verse_start, p.verse_start);
            assert_eq!(restored.verse_end, p.verse_end);
            assert_eq!(
                restored.verses.iter().map(|v| v.number).collect::<Vec<_>>(),
                p.verses.iter().map(|v| v.number).collect::<Vec<_>>()
            );
            assert!(restored.text.is_empty());
        }
        assert!(!index.chapter_ready("John:3"));
        assert!(index
            .search(
                "Nicodemus",
                Some(Corpus::Scripture),
                &[],
                10,
                Canon::Protestant
            )
            .is_empty());
        let john = source.fragment(&["John:3".into()]).unwrap();
        index.install_fragment(john.clone()).unwrap();
        assert!(index.chapter_ready("John:3"));
        assert!(!index.chapter_ready("Genesis:1"));
        assert_eq!(
            index
                .search(
                    "Nicodemus",
                    Some(Corpus::Scripture),
                    &[],
                    10,
                    Canon::Protestant
                )
                .iter()
                .map(|h| &h.id)
                .collect::<Vec<_>>(),
            source
                .search(
                    "Nicodemus",
                    Some(Corpus::Scripture),
                    &[],
                    10,
                    Canon::Protestant
                )
                .iter()
                .map(|h| &h.id)
                .collect::<Vec<_>>()
        );
        let before = index.passages.clone();
        let mut wrong = source.fragment(&["Genesis:1".into()]).unwrap();
        wrong.version.push_str("-other");
        assert!(index.install_fragment(wrong).is_err());
        assert_eq!(index.passages, before);
        let mut wrong = source.fragment(&["Genesis:1".into()]).unwrap();
        wrong.passages[0].verses[0].number = 999;
        assert!(index.install_fragment(wrong).is_err());
        assert_eq!(index.passages, before);
        let remaining = source
            .fragment(&["Genesis:1".into(), "Genesis:2".into(), chapters[3].clone()])
            .unwrap();
        index.install_fragment(remaining).unwrap();
        assert_eq!(index.passages, source.passages);
        assert_eq!(index.audio, source.audio);
    }
}
