//! Lossless text storage, independent of the browser/native compression codec.
//! Reader models retain their ordinary strings; packages omit exact duplicates.
use super::*;
use bincode::Options;
use serde::ser::SerializeSeq;

#[derive(Serialize, Deserialize)]
struct StoredLibrary<V, B, P, A> {
    version: V,
    books: B,
    passages: P,
    audio: A,
}

// One wire schema serves borrowed serialization and owned deserialization.
#[derive(Serialize, Deserialize)]
struct StoredPassage<S, V> {
    id: S,
    corpus: Corpus,
    book_id: S,
    book: S,
    chapter_id: S,
    chapter: u32,
    reference: S,
    // None means the exact space-join of verses, or the display text respectively.
    // Some("") remains distinct from either reconstruction rule.
    text: Option<S>,
    original_text: Option<S>,
    author: Option<S>,
    verse_start: u32,
    verse_end: u32,
    verses: V,
}

struct Passages<'a>(&'a [Passage]);

fn matches_verses(text: &str, verses: &[Verse]) -> bool {
    let mut remaining = text;
    for (index, verse) in verses.iter().enumerate() {
        if index > 0 {
            let Some(rest) = remaining.strip_prefix(' ') else {
                return false;
            };
            remaining = rest;
        }
        let Some(rest) = remaining.strip_prefix(verse.text.as_str()) else {
            return false;
        };
        remaining = rest;
    }
    remaining.is_empty()
}

impl Serialize for Passages<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for passage in self.0 {
            sequence.serialize_element(&StoredPassage {
                id: passage.id.as_str(),
                corpus: passage.corpus,
                book_id: passage.book_id.as_str(),
                book: passage.book.as_str(),
                chapter_id: passage.chapter_id.as_str(),
                chapter: passage.chapter,
                reference: passage.reference.as_str(),
                text: (!matches_verses(&passage.text, &passage.verses))
                    .then_some(passage.text.as_str()),
                original_text: (passage.original_text != passage.text)
                    .then_some(passage.original_text.as_str()),
                author: passage.author.as_deref(),
                verse_start: passage.verse_start,
                verse_end: passage.verse_end,
                verses: passage.verses.as_slice(),
            })?;
        }
        sequence.end()
    }
}

pub(super) fn borrow(library: &Library) -> impl Serialize + '_ {
    StoredLibrary {
        version: library.version.as_str(),
        books: library.books.as_slice(),
        passages: Passages(&library.passages),
        // HashMap iteration must never change otherwise identical package bytes.
        audio: library
            .audio
            .iter()
            .map(|(key, value)| (key.as_str(), value))
            .collect::<BTreeMap<_, _>>(),
    }
}

type Decoded = StoredLibrary<
    String,
    Vec<Book>,
    Vec<StoredPassage<String, Vec<Verse>>>,
    BTreeMap<String, AudioLocation>,
>;

pub(super) fn decode(root: &Path, bytes: &[u8], limit: u64) -> Result<Library> {
    let stored: Decoded = bincode::DefaultOptions::new()
        .with_limit(limit)
        .deserialize(bytes)
        .context("Invalid packed text library")?;
    // Omitted strings expand during reconstruction. Bound those bytes as well
    // as the decompressed package, before allocating each derived string.
    let mut expanded_bytes = bytes.len() as u64;
    let mut reserve = |length: usize| -> Result<()> {
        expanded_bytes = expanded_bytes
            .checked_add(length as u64)
            .filter(|size| *size <= limit)
            .context("Reconstructed text library exceeds size limit")?;
        Ok(())
    };
    let mut passages = Vec::with_capacity(stored.passages.len());
    for passage in stored.passages {
        let text = if let Some(text) = passage.text {
            text
        } else {
            let length = passage
                .verses
                .iter()
                .try_fold(passage.verses.len().saturating_sub(1), |size, verse| {
                    size.checked_add(verse.text.len())
                })
                .context("Reconstructed text library exceeds size limit")?;
            reserve(length)?;
            let mut text = String::with_capacity(length);
            for (index, verse) in passage.verses.iter().enumerate() {
                if index > 0 {
                    text.push(' ');
                }
                text.push_str(&verse.text);
            }
            text
        };
        let original_text = if let Some(original) = passage.original_text {
            original
        } else {
            reserve(text.len())?;
            text.clone()
        };
        passages.push(Passage {
            id: passage.id,
            corpus: passage.corpus,
            book_id: passage.book_id,
            book: passage.book,
            chapter_id: passage.chapter_id,
            chapter: passage.chapter,
            reference: passage.reference,
            text,
            original_text,
            author: passage.author,
            verse_start: passage.verse_start,
            verse_end: passage.verse_end,
            verses: passage.verses,
        });
    }
    Ok(Library {
        root: root.to_owned(),
        version: stored.version,
        books: stored.books,
        passages,
        lookup: HashMap::new(),
        book_lookup: HashMap::new(),
        chapter_lookup: HashMap::new(),
        book_passages: vec![],
        search_books: vec![],
        server_search: None,
        audio: stored.audio.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture() -> Library {
        let first = " Ἀγάπη\nkeeps exact whitespace ".repeat(80);
        let verses = vec![
            Verse {
                number: 1,
                text: first,
            },
            Verse {
                number: 3,
                text: "末尾 😀 ".into(),
            },
        ];
        let joined = verses
            .iter()
            .map(|v| v.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let mut passages = Vec::new();
        for (index, text, original) in [
            (0, joined.as_str(), joined.as_str()),
            (
                1,
                "Explicit\ndisplay—not the verse join",
                "Distinct original\nquotation",
            ),
            (2, "", ""),
            (3, joined.as_str(), ""),
        ] {
            passages.push(Passage {
                id: format!("work:1:{index}"),
                corpus: Corpus::ChristianClassics,
                book_id: "work".into(),
                book: "A Work".into(),
                chapter_id: "work:1".into(),
                chapter: 1,
                reference: format!("A Work 1:{index}"),
                text: text.into(),
                original_text: original.into(),
                author: Some("An Author".into()),
                verse_start: 1,
                verse_end: 3,
                verses: verses.clone(),
            });
        }
        let book = Book {
            id: "work".into(),
            title: "A Work".into(),
            author: Some("An Author".into()),
            corpus: Corpus::ChristianClassics,
            chapters: vec![Chapter {
                id: "work:1".into(),
                number: 1,
                title: "Chapter One".into(),
                passage_ids: passages.iter().map(|p| p.id.clone()).collect(),
                original_audio: Some("/audio/original.mp3".into()),
            }],
        };
        let mut library = Library {
            root: PathBuf::new(),
            version: "abcdef".into(),
            books: vec![book],
            passages,
            lookup: HashMap::new(),
            book_lookup: HashMap::new(),
            chapter_lookup: HashMap::new(),
            book_passages: vec![],
            search_books: vec![],
            server_search: None,
            audio: [
                (
                    "work:1".into(),
                    AudioLocation {
                        url: "/audio/book.mp3".into(),
                        start_seconds: 12.5,
                        end_seconds: Some(80.25),
                    },
                ),
                (
                    "/audio/original.mp3".into(),
                    AudioLocation {
                        url: "/audio/original.mp3".into(),
                        start_seconds: 0.0,
                        end_seconds: None,
                    },
                ),
            ]
            .into(),
        };
        library.rebuild_indexes().unwrap();
        library.validate().unwrap();
        library
    }

    fn assert_same(source: &Library, restored: &Library) {
        assert_eq!(restored.version, source.version);
        assert_eq!(restored.books, source.books);
        assert_eq!(restored.passages, source.passages);
        assert_eq!(restored.audio, source.audio);
        assert_eq!(restored.audio("work:1"), source.audio("work:1"));
        for passage in &source.passages {
            assert_eq!(restored.passage(&passage.id), Some(passage));
        }
    }

    #[test]
    fn packed_codecs_preserve_unicode_whitespace_explicit_text_and_empty_originals() {
        let source = fixture();
        let raw = bincode::DefaultOptions::new().serialize(&source).unwrap();
        let packed = bincode::DefaultOptions::new()
            .serialize(&borrow(&source))
            .unwrap();
        assert!(
            packed.len() < raw.len() * 3 / 4,
            "Exact duplicates should be omitted"
        );
        for native in [false, true] {
            let path = std::env::temp_dir().join(format!(
                "crosscanon-packed-{}-{native}.bin",
                std::process::id()
            ));
            if native {
                source.write_native(&path).unwrap();
            } else {
                source.write_browser(&path).unwrap();
            }
            let bytes = fs::read(&path).unwrap();
            assert_eq!(
                &bytes[..8],
                if native {
                    b"CCLIB\0\x05\0"
                } else {
                    b"CCLIB\0\x04\0"
                }
            );
            let restored = Library::from_bytes(Path::new("restored"), &bytes).unwrap();
            assert_same(&source, &restored);
            assert_eq!(restored.root, Path::new("restored"));
            assert!(Library::from_bytes(Path::new(""), &bytes[..bytes.len() - 4]).is_err());
            fs::remove_file(&path).unwrap();
        }
    }

    #[test]
    fn packed_codecs_are_deterministic_across_audio_map_insertion_order() {
        let first = fixture();
        let mut second = fixture();
        let mut entries = second.audio.drain().collect::<Vec<_>>();
        entries.sort_by(|a, b| b.0.cmp(&a.0));
        second.audio.extend(entries);
        for native in [false, true] {
            let paths = ["first", "second"].map(|name| {
                std::env::temp_dir().join(format!(
                    "crosscanon-packed-{name}-{}-{native}.bin",
                    std::process::id()
                ))
            });
            for (source, path) in [(&first, &paths[0]), (&second, &paths[1])] {
                if native {
                    source.write_native(path).unwrap();
                } else {
                    source.write_browser(path).unwrap();
                }
            }
            assert_eq!(fs::read(&paths[0]).unwrap(), fs::read(&paths[1]).unwrap());
            for path in paths {
                fs::remove_file(path).unwrap();
            }
        }
    }

    #[test]
    fn legacy_uncompressed_gzip_and_zstd_packages_remain_readable() {
        let source = fixture();
        let payload = bincode::DefaultOptions::new().serialize(&source).unwrap();
        let mut raw = b"CCLIB\0\x01\0".to_vec();
        raw.extend(&payload);
        let mut gzip = flate2::write::GzEncoder::new(
            b"CCLIB\0\x02\0".to_vec(),
            flate2::Compression::default(),
        );
        gzip.write_all(&payload).unwrap();
        let mut zstd = b"CCLIB\0\x03\0".to_vec();
        zstd.extend((payload.len() as u64).to_le_bytes());
        zstd.extend(zstd::stream::encode_all(payload.as_slice(), 9).unwrap());
        for bytes in [raw, gzip.finish().unwrap(), zstd] {
            assert_same(
                &source,
                &Library::from_bytes(Path::new(""), &bytes).unwrap(),
            );
        }
    }

    #[test]
    fn limits_cover_derived_strings_and_declared_native_expansion() {
        let source = fixture();
        let payload = bincode::DefaultOptions::new()
            .serialize(&borrow(&source))
            .unwrap();
        let error = decode(Path::new(""), &payload, payload.len() as u64 + 1)
            .err()
            .unwrap()
            .to_string();
        assert!(
            error.contains("Reconstructed text library exceeds size limit"),
            "{error}"
        );
        let mut native = b"CCLIB\0\x05\0".to_vec();
        native.extend((768u64 * 1024 * 1024 + 1).to_le_bytes());
        assert!(Library::from_bytes(Path::new(""), &native)
            .err()
            .unwrap()
            .to_string()
            .contains("exceeds size limit"));
    }
}
