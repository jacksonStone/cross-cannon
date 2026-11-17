//! Display source paragraphs and Scripture coverage without changing indexed IDs
//! or vectors. Internal sentence positions remain available for reader navigation.
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

/// Serialize initialization, caching successes only so transient I/O can retry.
#[derive(Default)]
pub(crate) struct CatalogCache {
    catalog: OnceLock<Catalog>,
    loading: Mutex<()>,
}

impl CatalogCache {
    pub(crate) fn get(&self, root: &Path) -> Result<&Catalog> {
        if let Some(catalog) = self.catalog.get() {
            return Ok(catalog);
        }
        let _loading = self
            .loading
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self.catalog.get().is_none() {
            let catalog = Catalog::load(root)?;
            let _ = self.catalog.set(catalog);
        }
        Ok(self.catalog.get().unwrap())
    }
}

/// Metadata for one immutable release. Text chapters are read only to project a
/// selected result or initialize compact coverage; their JSON trees are dropped.
pub(crate) struct Catalog {
    version: String,
    pub(crate) quotations: HashMap<String, Vec<[u32; 2]>>,
    paths: HashMap<String, String>,
    commentary: HashMap<String, HashMap<u64, Vec<CommentaryChapter>>>,
}

struct CommentaryChapter {
    work: Arc<Value>,
    chapter: Value,
    coverage: Mutex<Option<Vec<[u64; 2]>>>,
}

fn read_artifact(root: &Path, path: &str) -> Result<Value> {
    anyhow::ensure!(
        path.starts_with("/christian-classics-text/") && !path.contains(".."),
        "Invalid commentary artifact path"
    );
    let directory = root.join("public/christian-classics-text").canonicalize()?;
    let file = root
        .join("public")
        .join(path.trim_start_matches('/'))
        .canonicalize()?;
    anyhow::ensure!(
        file.starts_with(directory),
        "Commentary artifact is outside its collection"
    );
    Ok(serde_json::from_slice(&fs::read(file)?)?)
}

impl Catalog {
    pub(crate) fn load(root: &Path) -> Result<Self> {
        let manifest = read_artifact(root, "/christian-classics-text/manifest.json")?;
        let mut index = read_artifact(
            root,
            manifest["bookIndexPath"]
                .as_str()
                .unwrap_or("/christian-classics-text/books.json"),
        )?;
        let mut catalog = Self {
            version: manifest["version"]
                .as_str()
                .unwrap_or("christian-classics-v1")
                .to_owned(),
            quotations: HashMap::new(),
            paths: HashMap::new(),
            commentary: HashMap::new(),
        };
        for book in index["books"]
            .as_array_mut()
            .context("Missing Classics books")?
        {
            let work = Arc::new(
                json!({"id":book["id"],"title":book["name"],"author":book["author"],"tradition":book["metadata"]["tradition"].as_str().unwrap_or("")}),
            );
            for chapter in book["chapters"].as_array_mut().into_iter().flatten() {
                if let Some(id) = chapter["id"].as_str() {
                    if let Some(path) = chapter["assetPath"].as_str() {
                        catalog.paths.insert(id.to_owned(), path.to_owned());
                    }
                    if chapter["quotationSentenceRanges"].is_array() {
                        catalog.quotations.insert(
                            id.to_owned(),
                            serde_json::from_value(chapter["quotationSentenceRanges"].clone())?,
                        );
                    }
                }
                if let (Some(book), Some(number)) = (
                    chapter["scriptureReference"]["book"].as_str(),
                    chapter["scriptureReference"]["chapter"].as_u64(),
                ) {
                    catalog
                        .commentary
                        .entry(book.to_owned())
                        .or_default()
                        .entry(number)
                        .or_default()
                        .push(CommentaryChapter {
                            work: work.clone(),
                            chapter: chapter.take(),
                            coverage: Mutex::new(None),
                        });
                }
            }
        }
        Ok(catalog)
    }

    pub(crate) fn commentary(
        &self,
        root: &Path,
        book: &str,
        chapter: u32,
        start: u32,
        end: u32,
    ) -> Result<Value> {
        let mut works = vec![];
        if let Some(entries) = self
            .commentary
            .get(book)
            .and_then(|chapters| chapters.get(&(chapter as u64)))
        {
            for entry in entries {
                let mut coverage = entry
                    .coverage
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                if coverage.is_none() {
                    let asset = read_artifact(
                        root,
                        entry.chapter["assetPath"]
                            .as_str()
                            .context("Missing commentary text")?,
                    )?;
                    *coverage = Some(coverage_ranges(&asset));
                }
                let coverage = coverage.as_ref().unwrap();
                if coverage
                    .iter()
                    .any(|[a, b]| *a <= end as u64 && *b >= start as u64)
                {
                    let mut work = (*entry.work).clone();
                    work["chapter"] = entry.chapter.clone();
                    works.push(work);
                }
            }
        }
        Ok(json!({"error":null,"version":self.version,"works":works}))
    }

    pub(crate) fn display_results(
        &self,
        root: &Path,
        results: &mut [Value],
        exclude_quotations: bool,
    ) -> Result<()> {
        for result in results {
            let id = result["chapterId"]
                .as_str()
                .context("Missing Classics chapter")?;
            let path = self.paths.get(id).context("Unknown Classics chapter")?;
            anyhow::ensure!(
                path.starts_with("/christian-classics-text/chapters/") && !path.contains(".."),
                "Invalid Classics chapter path"
            );
            let chapter = read_artifact(root, path)?;
            apply_display(result, &chapter, exclude_quotations)?;
        }
        Ok(())
    }
}

// Store the union of coverage, not one duplicate range per sentence.
fn coverage_ranges(asset: &Value) -> Vec<[u64; 2]> {
    let mut ranges: Vec<_> = asset["verses"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|verse| verse["scriptureQuotation"] != true)
        .filter_map(|verse| {
            verse["scriptureVerseStart"]
                .as_u64()
                .map(|start| [start, verse["scriptureVerseEnd"].as_u64().unwrap_or(start)])
        })
        .collect();
    ranges.sort_unstable();
    ranges.dedup();
    let mut merged: Vec<[u64; 2]> = Vec::new();
    for [start, end] in ranges {
        if let Some(last) = merged.last_mut() {
            if start <= end && last[0] <= last[1] && start <= last[1].saturating_add(1) {
                last[1] = last[1].max(end);
                continue;
            }
        }
        merged.push([start, end]);
    }
    merged.shrink_to_fit();
    merged
}

fn apply_display(result: &mut Value, chapter: &Value, exclude_quotations: bool) -> Result<()> {
    let verses = chapter["verses"]
        .as_array()
        .context("Missing Classics sentences")?;
    let start = result["highlightPassage"]["verseStart"]
        .as_u64()
        .context("Missing sentence start")?;
    let end = result["highlightPassage"]["verseEnd"]
        .as_u64()
        .unwrap_or(start);
    let selected = |verse: &&Value| {
        verse["verse"]
            .as_u64()
            .is_some_and(|v| v >= start && v <= end)
    };
    anyhow::ensure!(
        verses.iter().any(|verse| selected(&verse)),
        "Missing selected Classics text"
    );
    let paragraphs: HashSet<_> = verses
        .iter()
        .filter(selected)
        .filter_map(|verse| verse["sourceParagraph"].as_u64())
        .collect();
    let displayed: Vec<_> = verses
        .iter()
        .filter(|verse| !exclude_quotations || verse["scriptureQuotation"] != true)
        .filter(|verse| {
            selected(verse)
                || verse["sourceParagraph"]
                    .as_u64()
                    .is_some_and(|p| paragraphs.contains(&p))
        })
        .collect();
    if displayed.is_empty() {
        result["highlightPassage"]["text"] = json!("");
        return Ok(());
    }
    let first = displayed
        .iter()
        .filter_map(|verse| verse["scriptureVerseStart"].as_u64())
        .min();
    let last = displayed
        .iter()
        .filter_map(|verse| {
            verse["scriptureVerseEnd"]
                .as_u64()
                .or_else(|| verse["scriptureVerseStart"].as_u64())
        })
        .max();
    let coverage = &chapter["scriptureReference"];
    let title = chapter["book"].as_str().context("Missing Classics title")?;
    let reference = if let (Some(book), Some(ch), Some(first), Some(last)) = (
        coverage["book"].as_str(),
        coverage["chapter"].as_u64(),
        first,
        last,
    ) {
        let range = if first == last {
            first.to_string()
        } else {
            format!("{first}–{last}")
        };
        format!("{title} · {book} {ch}:{range}")
    } else {
        format!(
            "{title} · {}",
            chapter["reference"].as_str().unwrap_or_default()
        )
    };
    result["chapterReference"] = json!(reference);
    result["highlightPassage"]["reference"] = json!(reference);
    result["highlightPassage"]["text"] = json!(displayed
        .iter()
        .filter_map(|verse| verse["text"].as_str())
        .collect::<Vec<_>>()
        .join(" "));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_coverage_preserves_gaps_and_excludes_quotes() {
        let asset = json!({"verses":[
            {"scriptureVerseStart":1,"scriptureVerseEnd":3},
            {"scriptureVerseStart":1,"scriptureVerseEnd":3},
            {"scriptureVerseStart":4},
            {"scriptureVerseStart":5,"scriptureQuotation":true},
            {"scriptureVerseStart":7,"scriptureVerseEnd":9},
            {"scriptureVerseStart":8,"scriptureVerseEnd":10}
        ]});
        let ranges = coverage_ranges(&asset);
        assert_eq!(ranges, vec![[1, 4], [7, 10]]);
        for start in 1..=12 {
            for end in start..=12 {
                let original = asset["verses"].as_array().unwrap().iter().any(|v| {
                    v["scriptureQuotation"] != true
                        && v["scriptureVerseStart"].as_u64().is_some_and(|a| {
                            a <= end && v["scriptureVerseEnd"].as_u64().unwrap_or(a) >= start
                        })
                });
                assert_eq!(
                    ranges.iter().any(|[a, b]| *a <= end && *b >= start),
                    original
                );
            }
        }
    }

    #[test]
    fn source_paragraphs_replace_fragments_without_changing_navigation_or_scores() {
        let chapter = json!({"book":"Henry", "reference":"Proverbs 16", "scriptureReference":{"book":"Proverbs","chapter":16}, "verses":[
            {"verse":3,"text":"See Ps. x.","sourceParagraph":2,"scriptureVerseStart":1,"scriptureVerseEnd":1},
            {"verse":4,"text":"17.","sourceParagraph":2,"scriptureVerseStart":1,"scriptureVerseEnd":1},
            {"verse":5,"text":"But most read it otherwise.","sourceParagraph":2,"scriptureVerseStart":1,"scriptureVerseEnd":1},
            {"verse":6,"text":"That is, in short, 1.","sourceParagraph":2,"scriptureVerseStart":1,"scriptureVerseEnd":1},
            {"verse":7,"text":"Man purposes.","sourceParagraph":2,"scriptureVerseStart":1,"scriptureVerseEnd":1},
            {"verse":8,"text":"Next note.","sourceParagraph":3,"scriptureVerseStart":2,"scriptureVerseEnd":2}
        ]});
        let mut result = json!({"score":0.7,"highlightPassage":{"id":"ccw:original", "verseStart":4,"verseEnd":6,"rangeLabel":"4-6"}});
        apply_display(&mut result, &chapter, true).unwrap();
        assert_eq!(result["chapterReference"], "Henry · Proverbs 16:1");
        assert_eq!(
            result["highlightPassage"]["text"],
            "See Ps. x. 17. But most read it otherwise. That is, in short, 1. Man purposes."
        );
        assert_eq!(result["highlightPassage"]["id"], "ccw:original");
        assert_eq!(result["highlightPassage"]["rangeLabel"], "4-6");
        assert_eq!(result["score"], 0.7);
    }

    #[test]
    fn search_previews_exclude_quotation_paragraphs_and_keep_inline_citations() {
        let chapter = json!({"book":"Henry", "reference":"Acts 6", "verses":[
            {"verse":1,"text":"1 And in those days.","sourceParagraph":1,"scriptureQuotation":true},
            {"verse":2,"text":"2 Then the twelve.","sourceParagraph":1,"scriptureQuotation":true},
            {"verse":3,"text":"A note quoting the twelve.","sourceParagraph":2}
        ]});
        let mut quote_only = json!({"highlightPassage":{"verseStart":1,"verseEnd":2}});
        apply_display(&mut quote_only, &chapter, true).unwrap();
        assert_eq!(quote_only["highlightPassage"]["text"], "");
        let mut mixed =
            json!({"score":0.7,"highlightPassage":{"id":"original", "verseStart":2,"verseEnd":3}});
        apply_display(&mut mixed, &chapter, true).unwrap();
        assert_eq!(
            mixed["highlightPassage"]["text"],
            "A note quoting the twelve."
        );
        assert_eq!(mixed["highlightPassage"]["id"], "original");
        assert_eq!(mixed["score"], 0.7);
    }
}
