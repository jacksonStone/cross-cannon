//! Resolve narration from immutable, licensed catalog text, never request text.
//!
//! Keep the server's one search Library: it already retains WEB display text.
//! Works' originals and MSB are loaded only for the requested Chapter. The
//! selected-chapter deserializer skips other MSB chapters without retaining them.
use anyhow::{bail, ensure, Context, Result};
use cross_canon_core::{Corpus, Library, Verse};
use ring::digest::{digest, SHA256};
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, Visitor};
use serde::Deserializer;
use serde_json::Value;
use std::{
    fmt, fs,
    io::BufReader,
    path::{Component, Path},
};

pub const MAX_UNIT_CHARS: usize = 600;
pub const MAX_CHAPTER_UNITS: usize = 8192;
const MAX_ARTIFACT_BYTES: u64 = 24 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ResolvedChapter {
    pub chapter_id: String,
    pub version: String,
    pub title: String,
    pub units: Vec<String>,
    /// Source/edition, exact version and exact complete text. A changed import
    /// or modernization cannot accidentally reuse narration of an older text.
    pub edition_identity: String,
}

pub fn resolve(
    root: &Path,
    library: &Library,
    chapter_id: &str,
    version: &str,
) -> Result<ResolvedChapter> {
    ensure!(chapter_id.len() <= 256, "Unknown narration chapter");
    let (book, chapter) = library
        .chapter(chapter_id)
        .context("Unknown narration chapter")?;
    // Work narration always prefers a materialized modernization, independent
    // of the visual Mod/Orig toggle. Normalize the legacy original request
    // alias before identity/cache selection so both requests replay one clip.
    let version = if book.corpus == Corpus::Scripture {
        version
    } else {
        ensure!(
            matches!(version, "original" | "modernized"),
            "Unsupported narration version"
        );
        "modernized"
    };
    let (text, edition) = match book.corpus {
        Corpus::Scripture => match version {
            "web" => {
                let text = chapter
                    .passage_ids
                    .iter()
                    .map(|id| {
                        let p = library.passage(id).context("Missing canonical passage")?;
                        ensure!(
                            p.chapter_id == chapter_id && !p.text.trim().is_empty(),
                            "Missing canonical text"
                        );
                        Ok(p.text.as_str())
                    })
                    .collect::<Result<Vec<_>>>()?
                    .join(" ");
                (text, format!("web:public-domain:{}", library.version))
            }
            "msb" => {
                let manifest =
                    read_json(&root.join("public/scripture-translations/manifest.json"))?;
                ensure!(
                    manifest["translation"] == "msb"
                        && manifest["rights"] == "Public domain"
                        && manifest["sourceUrl"] == "https://ebible.org/Scriptures/engmsb_usfm.zip"
                        && manifest["rightsUrl"] == "https://berean.bible/terms.htm",
                    "Narration rights are unsupported"
                );
                let file = open_bounded(&root.join("public/scripture-translations/msb.json"))?;
                let mut decoder = serde_json::Deserializer::from_reader(BufReader::new(file));
                let verses = SelectedTranslation {
                    chapter: chapter_id,
                }
                .deserialize(&mut decoder)?;
                decoder.end()?;
                ensure!(
                    !verses.is_empty(),
                    "This chapter has no MSB text; choose WEB"
                );
                ensure!(
                    verses.windows(2).all(|v| v[0].number < v[1].number)
                        && verses.iter().all(|v| !v.text.trim().is_empty()),
                    "Invalid canonical translation"
                );
                let text = verses
                    .iter()
                    .map(|v| v.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                (
                    text,
                    format!(
                        "msb:public-domain:{}:{}",
                        manifest["version"], manifest["sourceSha256"]
                    ),
                )
            }
            _ => bail!("Unsupported narration version"),
        },
        corpus => {
            ensure!(
                matches!(version, "original" | "modernized"),
                "Unsupported narration version"
            );
            let (index, prefix) = match corpus {
                Corpus::EarlyChristian => (
                    "public/church-fathers-preview/books.json",
                    "/church-fathers-preview/chapters/",
                ),
                Corpus::ChristianClassics => (
                    "public/christian-classics-text/books.json",
                    "/christian-classics-text/chapters/",
                ),
                _ => unreachable!(),
            };
            let index = read_json(&root.join(index))?;
            let work = index["books"]
                .as_array()
                .context("Missing canonical catalog")?
                .iter()
                .find(|work| work["id"] == book.id)
                .context("Unknown canonical work")?;
            let edition = licensed_edition(work, corpus)?;
            let entry = work["chapters"]
                .as_array()
                .context("Missing canonical chapter index")?
                .iter()
                .find(|entry| entry["id"] == chapter_id)
                .context("Unknown canonical chapter")?;
            let path = entry["assetPath"]
                .as_str()
                .context("Missing canonical chapter asset")?;
            let asset = read_json(&chapter_path(root, path, prefix)?)?;
            ensure!(
                asset["id"] == chapter_id,
                "Canonical chapter identity mismatch"
            );
            ensure!(
                asset["sourceVolumeId"] == work["metadata"]["source"]["id"]
                    && asset["metadata"]["source"] == work["metadata"]["source"],
                "Canonical edition mismatch"
            );
            let verses = asset["verses"]
                .as_array()
                .context("Missing canonical chapter text")?;
            ensure!(
                !verses.is_empty() && entry["verseCount"].as_u64() == Some(verses.len() as u64),
                "Incomplete canonical chapter"
            );
            let mut previous = 0;
            let mut words = Vec::with_capacity(verses.len());
            for verse in verses {
                let number = verse["verse"]
                    .as_u64()
                    .context("Invalid canonical passage number")?;
                ensure!(number > previous, "Unordered canonical passages");
                previous = number;
                let original = verse["text"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .context("Missing original text")?;
                // Match the reader's modernized projection passage by passage;
                // missing or blank materializations retain that source passage.
                let text = verse["modernizedText"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(original);
                words.push(text);
            }
            (words.join(" "), edition)
        }
    };
    ensure!(!text.trim().is_empty(), "No canonical narration text");
    let units = chapter_units(&text)?;
    let identity = serde_json::to_vec(&(book.id.as_str(), chapter_id, version, &edition, &text))?;
    Ok(ResolvedChapter {
        chapter_id: chapter_id.to_owned(),
        version: version.to_owned(),
        title: format!("{} · {}", book.title, chapter.title),
        units,
        edition_identity: hex(digest(&SHA256, &identity).as_ref()),
    })
}

/// Only the reviewed source editions below are eligible. "Old author" and
/// "available online" are deliberately not rights tests. See the rights note.
fn licensed_edition(work: &Value, corpus: Corpus) -> Result<String> {
    let metadata = &work["metadata"];
    let source = &metadata["source"];
    let id = source["id"].as_str().context("Missing canonical source")?;
    let url = source["sourceUrl"]
        .as_str()
        .context("Missing canonical source")?;
    let known = match corpus {
        Corpus::EarlyChristian => {
            const VOLUMES: &[&str] = &[
                "anf01", "anf02", "anf03", "anf04", "anf05", "anf06", "anf07", "anf08", "anf09",
                "anf10", "npnf101", "npnf102", "npnf103", "npnf104", "npnf105", "npnf106",
                "npnf107", "npnf108", "npnf109", "npnf110", "npnf111", "npnf112", "npnf113",
                "npnf114", "npnf201", "npnf202", "npnf203", "npnf204", "npnf205", "npnf206",
                "npnf207", "npnf208", "npnf209", "npnf210", "npnf211", "npnf212", "npnf213",
                "npnf214",
            ];
            VOLUMES.contains(&id)
                && source["provider"] == "CCEL"
                && url == format!("https://www.ccel.org/ccel/schaff/{id}.xml")
                && work["id"]
                    .as_str()
                    .is_some_and(|work_id| work_id.starts_with(&format!("{id}:")))
        }
        Corpus::ChristianClassics => {
            let expected = match work["id"].as_str() {
                Some("classics:imitation") => (
                    "imitation",
                    "https://www.gutenberg.org/ebooks/1653",
                    "Public domain in the USA",
                ),
                Some("classics:catena") => (
                    "catena",
                    "https://github.com/Isidore-Guild/catena",
                    "Public-domain historic translation; repository contributions CC0-1.0",
                ),
                Some("classics:henry") => (
                    "henry",
                    "https://www.ccel.org/ccel/henry/mhc.html",
                    "Public domain. May be copied and distributed freely.",
                ),
                Some("classics:wesley") => (
                    "wesley",
                    "https://www.ccel.org/ccel/wesley/notes.html",
                    "Public Domain",
                ),
                Some("classics:jfb") => (
                    "jfb",
                    "https://www.ccel.org/ccel/jamieson/jfb.html",
                    "Public Domain",
                ),
                Some("classics:keil-delitzsch") => (
                    "keil-delitzsch",
                    "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=KD",
                    "Public Domain",
                ),
                Some("classics:treasury-of-david") => (
                    "treasury-of-david",
                    "https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=TDavid",
                    "Public Domain",
                ),
                _ => bail!("Narration rights are unsupported"),
            };
            id == expected.0 && url == expected.1 && metadata["rights"] == expected.2
        }
        _ => false,
    };
    ensure!(known, "Narration rights are unsupported");
    Ok(serde_json::to_string(metadata)?)
}

fn chapter_path(root: &Path, asset: &str, prefix: &str) -> Result<std::path::PathBuf> {
    ensure!(
        asset.starts_with(prefix) && asset.ends_with(".json"),
        "Invalid canonical asset path"
    );
    let relative = asset.trim_start_matches('/');
    ensure!(
        Path::new(relative)
            .components()
            .all(|part| matches!(part, Component::Normal(_))),
        "Invalid canonical asset path"
    );
    let public = root.join("public").canonicalize()?;
    let path = public.join(relative).canonicalize()?;
    ensure!(path.starts_with(&public), "Invalid canonical asset path");
    Ok(path)
}

fn open_bounded(path: &Path) -> Result<fs::File> {
    let file = fs::File::open(path).context("Canonical narration artifact unavailable")?;
    ensure!(
        file.metadata()?.len() <= MAX_ARTIFACT_BYTES,
        "Canonical narration artifact exceeds limit"
    );
    Ok(file)
}
fn read_json(path: &Path) -> Result<Value> {
    Ok(serde_json::from_reader(BufReader::new(open_bounded(
        path,
    )?))?)
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn chapter_units(text: &str) -> Result<Vec<String>> {
    // Reject impossible plans before allocating their units. The second check
    // also bounds plans whose preferred sentence breaks produce shorter units.
    ensure!(
        text.chars().count() <= MAX_UNIT_CHARS * MAX_CHAPTER_UNITS,
        "Canonical narration chapter exceeds unit limit"
    );
    let units = split_units(text);
    ensure!(
        units.len() <= MAX_CHAPTER_UNITS,
        "Canonical narration chapter exceeds unit limit"
    );
    Ok(units)
}

/// No text rewriting: concatenating the units recovers every source byte,
/// including punctuation and whitespace. Prefer complete sentence boundaries,
/// then whitespace, and only split an overlong token at a UTF-8 boundary.
fn split_units(text: &str) -> Vec<String> {
    let mut remaining = text;
    let mut units = Vec::new();
    while let Some((end, _)) = remaining.char_indices().nth(MAX_UNIT_CHARS) {
        let candidate = &remaining[..end];
        let mut sentence = None;
        let mut whitespace = None;
        let mut punctuation = false;
        for (index, (offset, ch)) in candidate.char_indices().enumerate() {
            if ch.is_whitespace() && index >= MAX_UNIT_CHARS / 3 {
                whitespace = Some(offset + ch.len_utf8());
                if punctuation {
                    sentence = whitespace;
                }
            }
            if !ch.is_whitespace() {
                punctuation = matches!(ch, '.' | '!' | '?' | '。' | '！' | '？');
            }
        }
        let split = sentence.or(whitespace).unwrap_or(end);
        units.push(remaining[..split].to_owned());
        remaining = &remaining[split..];
    }
    if !remaining.is_empty() {
        units.push(remaining.to_owned());
    }
    units
}

struct SelectedTranslation<'a> {
    chapter: &'a str,
}
struct SelectedChapters<'a> {
    chapter: &'a str,
}
impl<'de> DeserializeSeed<'de> for SelectedTranslation<'_> {
    type Value = Vec<Verse>;
    fn deserialize<D: Deserializer<'de>>(
        self,
        decoder: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        struct TranslationVisitor<'a> {
            chapter: &'a str,
        }
        impl<'de> Visitor<'de> for TranslationVisitor<'_> {
            type Value = Vec<Verse>;
            fn expecting(&self, out: &mut fmt::Formatter) -> fmt::Result {
                out.write_str("a canonical translation object")
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut result = None;
                let mut translation = None;
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "translation" => translation = Some(map.next_value::<String>()?),
                        "chapters" => {
                            if result.is_some() {
                                return Err(serde::de::Error::duplicate_field("chapters"));
                            }
                            result = Some(map.next_value_seed(SelectedChapters {
                                chapter: self.chapter,
                            })?);
                        }
                        _ => {
                            map.next_value::<IgnoredAny>()?;
                        }
                    }
                }
                if translation.as_deref() != Some("msb") {
                    return Err(serde::de::Error::custom("Invalid canonical translation"));
                }
                result.ok_or_else(|| serde::de::Error::missing_field("chapters"))
            }
        }
        decoder.deserialize_map(TranslationVisitor {
            chapter: self.chapter,
        })
    }
}
impl<'de> DeserializeSeed<'de> for SelectedChapters<'_> {
    type Value = Vec<Verse>;
    fn deserialize<D: Deserializer<'de>>(
        self,
        decoder: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        struct ChaptersVisitor<'a> {
            chapter: &'a str,
        }
        impl<'de> Visitor<'de> for ChaptersVisitor<'_> {
            type Value = Vec<Verse>;
            fn expecting(&self, out: &mut fmt::Formatter) -> fmt::Result {
                out.write_str("canonical chapter text")
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut result = None;
                while let Some(key) = map.next_key::<String>()? {
                    if key == self.chapter {
                        if result.is_some() {
                            return Err(serde::de::Error::custom("Duplicate canonical chapter"));
                        }
                        result = Some(map.next_value::<Vec<Verse>>()?);
                    } else {
                        map.next_value::<IgnoredAny>()?;
                    }
                }
                Ok(result.unwrap_or_default())
            }
        }
        decoder.deserialize_map(ChaptersVisitor {
            chapter: self.chapter,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "cross-canon-narration-catalog-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let this = Self { root };
            this.put(
                "scripture-cache/manifest.json",
                &json!({"version":"abcdef"}),
            );
            this.put("scripture-cache/abcdef.json", &json!({"passages":[{
                "id":"John:3:16", "reference":"John 3:16", "verses":[{"number":16,"text":"For God so loved the world."}]
            }]}));
            this.put("public/continuous-audio.json", &json!({"chapters":{}}));
            for name in ["confessions", "first-clement", "city-of-god"] {
                this.put(
                    &format!("public/church-fathers-preview/{name}-audio-alignment.json"),
                    &json!({"chapters":{}}),
                );
            }
            let repo = super::super::test_inputs::root();
            let catalog =
                read_json(&repo.join("public/church-fathers-preview/books.json")).unwrap();
            let work = catalog["books"]
                .as_array()
                .unwrap()
                .iter()
                .find(|work| work["id"] == "anf03:vi.iv")
                .unwrap();
            this.put(
                "public/church-fathers-preview/books.json",
                &json!({"books":[work]}),
            );
            for chapter in work["chapters"].as_array().unwrap() {
                let path = format!("public{}", chapter["assetPath"].as_str().unwrap());
                this.put(&path, &read_json(&repo.join(&path)).unwrap());
            }
            this.put(
                "public/scripture-translations/manifest.json",
                &read_json(&repo.join("public/scripture-translations/manifest.json")).unwrap(),
            );
            this.put("public/scripture-translations/msb.json", &json!({"translation":"msb","chapters":{
                "John:1":[{"number":1,"text":"In the beginning was the Word."}],
                "John:3":[{"number":16,"text":"For God so loved the world that He gave His one and only Son."}]
            }}));
            this
        }
        fn put(&self, path: &str, value: &Value) {
            let path = self.root.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, serde_json::to_vec(value).unwrap()).unwrap();
        }
        fn library(&self) -> Library {
            Library::load_server(&self.root).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn all_on_prayer_originals_and_modernizations_match_actual_reader_projection() {
        let fixture = Fixture::new();
        let server = fixture.library();
        let reader = Library::load_artifacts(&fixture.root).unwrap();
        let work = reader.book("anf03:vi.iv").unwrap();
        assert_eq!(work.chapters.len(), 29);
        let mut passages = 0;
        for chapter in &work.chapters {
            for version in ["original", "modernized"] {
                let narration = resolve(&fixture.root, &server, &chapter.id, version).unwrap();
                let expected = chapter
                    .passage_ids
                    .iter()
                    .map(|id| reader.passage(id).unwrap().reader_text(false))
                    .collect::<Vec<_>>()
                    .join(" ");
                assert_eq!(
                    narration.units.concat(),
                    expected,
                    "{} {version}",
                    chapter.id
                );
                assert!(narration
                    .units
                    .iter()
                    .all(|unit| unit.chars().count() <= MAX_UNIT_CHARS));
                assert_eq!(narration.chapter_id, chapter.id);
                assert_eq!(narration.version, "modernized");
            }
            let index = read_json(&fixture.root.join(format!(
                "public/church-fathers-preview/chapters/{}.json",
                chapter.id.replace(':', "_")
            )))
            .unwrap();
            passages += index["verses"].as_array().unwrap().len();
        }
        assert_eq!(passages, 249);
        let modern = resolve(&fixture.root, &server, "anf03:vi.iv.i", "modernized").unwrap();
        let original = resolve(&fixture.root, &server, "anf03:vi.iv.i", "original").unwrap();
        assert!(modern
            .units
            .concat()
            .contains("a new piece of cloth be sewn to a new garment"));
        assert!(!original
            .units
            .concat()
            .contains("a new breadth be sewn to a new garment"));
        assert_eq!(modern.units, original.units);
        assert_eq!(modern.version, original.version);
        assert_eq!(modern.edition_identity, original.edition_identity);
    }

    #[test]
    fn mixed_work_passages_prefer_modernization_and_share_identity_across_aliases() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let path = "public/church-fathers-preview/chapters/anf03_vi.iv.i.json";
        let mut source = read_json(&fixture.root.join(path)).unwrap();
        let verses = source["verses"].as_array_mut().unwrap();
        assert!(verses.len() >= 4);
        verses[0]["text"] = json!("Original opening.");
        verses[0]["modernizedText"] = json!("Modern opening.");
        verses[1]["text"] = json!("Fallback absent.");
        verses[1].as_object_mut().unwrap().remove("modernizedText");
        verses[2]["text"] = json!("Fallback blank.");
        verses[2]["modernizedText"] = json!(" \t\n");
        verses[3]["text"] = json!("Fallback empty.");
        verses[3]["modernizedText"] = json!("");
        let expected = verses
            .iter()
            .map(|verse| {
                verse["modernizedText"]
                    .as_str()
                    .filter(|text| !text.trim().is_empty())
                    .unwrap_or(verse["text"].as_str().unwrap())
            })
            .collect::<Vec<_>>()
            .join(" ");
        fixture.put(path, &source);
        let modern = resolve(&fixture.root, &library, "anf03:vi.iv.i", "modernized").unwrap();
        let original_alias = resolve(&fixture.root, &library, "anf03:vi.iv.i", "original").unwrap();
        assert!(expected
            .starts_with("Modern opening. Fallback absent. Fallback blank. Fallback empty."));
        assert_eq!(modern.units.concat().as_bytes(), expected.as_bytes());
        assert_eq!(modern.units, original_alias.units);
        assert_eq!(modern.version, "modernized");
        assert_eq!(modern.version, original_alias.version);
        assert_eq!(modern.edition_identity, original_alias.edition_identity);
    }

    #[test]
    fn editions_are_exact_and_unknown_chapters_versions_and_rights_fail_closed() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let web = resolve(&fixture.root, &library, "John:3", "web").unwrap();
        let msb = resolve(&fixture.root, &library, "John:3", "msb").unwrap();
        assert_eq!(web.units.concat(), "For God so loved the world.");
        assert!(msb.units.concat().ends_with("His one and only Son."));
        assert_ne!(web.edition_identity, msb.edition_identity);
        for (id, version) in [
            ("../../../secrets", "modernized"),
            ("anf03:vi.iv.i", "custom"),
            ("John:3", "original"),
            ("anf03:vi.iv.i", "web"),
        ] {
            assert!(resolve(&fixture.root, &library, id, version).is_err());
        }
        let path = fixture
            .root
            .join("public/church-fathers-preview/books.json");
        let mut index = read_json(&path).unwrap();
        index["books"][0]["metadata"]["source"]["sourceUrl"] =
            json!("https://unknown.invalid/new-edition.xml");
        fixture.put("public/church-fathers-preview/books.json", &index);
        assert!(resolve(&fixture.root, &library, "anf03:vi.iv.i", "original").is_err());
        let unknown = json!({"id":"classics:unreviewed", "metadata":{"rights":"Public Domain","source":{"id":"new","sourceUrl":"https://example.invalid/free"}}});
        assert!(licensed_edition(&unknown, Corpus::ChristianClassics).is_err());
    }

    #[test]
    fn every_current_work_matches_a_reviewed_source_and_new_sources_do_not() {
        let repo = super::super::test_inputs::root();
        for (path, corpus) in [
            (
                "public/church-fathers-preview/books.json",
                Corpus::EarlyChristian,
            ),
            (
                "public/christian-classics-text/books.json",
                Corpus::ChristianClassics,
            ),
        ] {
            let catalog = read_json(&repo.join(path)).unwrap();
            for work in catalog["books"].as_array().unwrap() {
                assert!(licensed_edition(work, corpus).is_ok(), "{}", work["id"]);
                let mut changed = work.clone();
                changed["metadata"]["source"]["sourceUrl"] =
                    json!("https://example.invalid/unreviewed-edition");
                assert!(licensed_edition(&changed, corpus).is_err());
            }
        }
    }

    #[test]
    fn largest_existing_chapter_fits_bounded_plan_and_preserves_every_text_byte() {
        let fixture = Fixture::new();
        let repo = super::super::test_inputs::root();
        let index = read_json(&repo.join("public/christian-classics-text/books.json")).unwrap();
        let mut work = index["books"]
            .as_array()
            .unwrap()
            .iter()
            .find(|work| work["id"] == "classics:treasury-of-david")
            .unwrap()
            .clone();
        let chapter = work["chapters"]
            .as_array()
            .unwrap()
            .iter()
            .find(|chapter| chapter["scriptureReference"]["chapter"] == 119)
            .unwrap()
            .clone();
        let chapter_id = chapter["id"].as_str().unwrap();
        let asset_path = format!("public{}", chapter["assetPath"].as_str().unwrap());
        let source = read_json(&repo.join(&asset_path)).unwrap();
        work["chapters"] = json!([chapter.clone()]);
        fixture.put(
            "public/christian-classics-text/books.json",
            &json!({"books":[work]}),
        );
        fixture.put(&asset_path, &source);
        // Metadata-only server loading retains this one Chapter, not the full
        // commentary or a second complete reader Library.
        let library = fixture.library();
        assert!(library
            .chapter(chapter_id)
            .unwrap()
            .1
            .passage_ids
            .is_empty());
        for version in ["original", "modernized"] {
            let expected = source["verses"]
                .as_array()
                .unwrap()
                .iter()
                .map(|verse| {
                    verse["modernizedText"]
                        .as_str()
                        .filter(|text| !text.trim().is_empty())
                        .unwrap_or(verse["text"].as_str().unwrap())
                })
                .collect::<Vec<_>>()
                .join(" ");
            let plan = resolve(&fixture.root, &library, chapter_id, version).unwrap();
            assert_eq!(plan.version, "modernized");
            assert_eq!(plan.units.concat().as_bytes(), expected.as_bytes());
            assert!(
                plan.units.len() > 2048,
                "Regression fixture must exceed the old client limit"
            );
            assert!(plan.units.len() <= MAX_CHAPTER_UNITS);
            assert!(plan
                .units
                .iter()
                .all(|unit| unit.chars().count() <= MAX_UNIT_CHARS));
            eprintln!(
                "largest_chapter={chapter_id} version={version} characters={} bytes={} units={}",
                expected.chars().count(),
                expected.len(),
                plan.units.len()
            );
        }
    }

    #[test]
    fn future_oversized_chapter_fails_closed_before_an_unbounded_plan() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let asset_path = "public/church-fathers-preview/chapters/anf03_vi.iv.i.json";
        let mut source = read_json(&fixture.root.join(asset_path)).unwrap();
        source["verses"][0]["text"] = json!("a".repeat(MAX_UNIT_CHARS * MAX_CHAPTER_UNITS + 1));
        source["verses"][0]["modernizedText"] = source["verses"][0]["text"].clone();
        fixture.put(asset_path, &source);
        let error = resolve(&fixture.root, &library, "anf03:vi.iv.i", "original").unwrap_err();
        assert!(error.to_string().contains("exceeds unit limit"));

        // Sentence-preferred splits can reach the count limit before the raw
        // character ceiling. Cover that independent bound as well.
        let sentence = format!("{}. ", "a".repeat(MAX_UNIT_CHARS / 2));
        let text = sentence.repeat(MAX_CHAPTER_UNITS + 1);
        assert!(text.chars().count() < MAX_UNIT_CHARS * MAX_CHAPTER_UNITS);
        assert!(chapter_units(&text).is_err());
    }

    #[test]
    fn source_mutation_changes_identity_and_canonical_asset_path_cannot_escape() {
        let fixture = Fixture::new();
        let library = fixture.library();
        let before = resolve(&fixture.root, &library, "anf03:vi.iv.i", "modernized").unwrap();
        let path = "public/church-fathers-preview/chapters/anf03_vi.iv.i.json";
        let mut source = read_json(&fixture.root.join(path)).unwrap();
        source["verses"][0]["modernizedText"] = json!("Revised canonical text.");
        fixture.put(path, &source);
        let after = resolve(&fixture.root, &library, "anf03:vi.iv.i", "modernized").unwrap();
        assert_ne!(before.edition_identity, after.edition_identity);
        assert!(chapter_path(
            &fixture.root,
            "/church-fathers-preview/chapters/../../secrets.json",
            "/church-fathers-preview/chapters/"
        )
        .is_err());
        assert!(chapter_path(
            &fixture.root,
            "/elsewhere/secret.json",
            "/church-fathers-preview/chapters/"
        )
        .is_err());
        #[cfg(unix)]
        {
            let escape = fixture
                .root
                .join("public/church-fathers-preview/chapters/escape.json");
            std::os::unix::fs::symlink(fixture.root.join("scripture-cache/manifest.json"), escape)
                .unwrap();
            assert!(chapter_path(
                &fixture.root,
                "/church-fathers-preview/chapters/escape.json",
                "/church-fathers-preview/chapters/"
            )
            .is_err());
        }
    }

    #[test]
    fn deterministic_units_preserve_unicode_whitespace_punctuation_and_very_long_tokens() {
        for source in [
            "A short paragraph.\n\nNext paragraph.".to_owned(),
            "An ordinary sentence with quotations: “Read this.” ".repeat(200),
            "λόγος仁🙂".repeat(2000),
            "word ".repeat(10_000),
        ] {
            let units = split_units(&source);
            assert_eq!(units.concat(), source);
            assert_eq!(split_units(&source), units);
            assert!(units
                .iter()
                .all(|unit| !unit.trim().is_empty() && unit.chars().count() <= MAX_UNIT_CHARS));
        }
    }
}
