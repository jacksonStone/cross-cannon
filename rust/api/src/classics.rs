//! Display source paragraphs and Scripture coverage without changing indexed IDs
//! or vectors. Internal sentence positions remain available for reader navigation.
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, path::Path};

pub(crate) fn display_results(root: &Path, results: &mut [Value]) -> Result<()> {
    if results.is_empty() {
        return Ok(());
    }
    let index: Value = serde_json::from_slice(&fs::read(
        root.join("public/christian-classics-text/books.json"),
    )?)?;
    for result in results {
        let chapter_id = result["chapterId"]
            .as_str()
            .context("Missing Classics chapter")?;
        let entry = index["books"]
            .as_array()
            .context("Missing Classics books")?
            .iter()
            .flat_map(|book| book["chapters"].as_array().into_iter().flatten())
            .find(|entry| entry["id"].as_str() == Some(chapter_id))
            .context("Unknown Classics chapter")?;
        let path = entry["assetPath"]
            .as_str()
            .context("Missing Classics chapter path")?;
        anyhow::ensure!(
            path.starts_with("/christian-classics-text/chapters/") && !path.contains(".."),
            "Invalid Classics chapter path"
        );
        let chapter: Value = serde_json::from_slice(&fs::read(
            root.join("public").join(path.trim_start_matches('/')),
        )?)?;
        apply_display(result, &chapter)?;
    }
    Ok(())
}

fn apply_display(result: &mut Value, chapter: &Value) -> Result<()> {
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
    let paragraphs: HashSet<_> = verses
        .iter()
        .filter(selected)
        .filter_map(|verse| verse["sourceParagraph"].as_u64())
        .collect();
    let displayed: Vec<_> = verses
        .iter()
        .filter(|verse| {
            selected(verse)
                || verse["sourceParagraph"]
                    .as_u64()
                    .is_some_and(|p| paragraphs.contains(&p))
        })
        .collect();
    anyhow::ensure!(!displayed.is_empty(), "Missing selected Classics text");
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
        apply_display(&mut result, &chapter).unwrap();
        assert_eq!(result["chapterReference"], "Henry · Proverbs 16:1");
        assert_eq!(
            result["highlightPassage"]["text"],
            "See Ps. x. 17. But most read it otherwise. That is, in short, 1. Man purposes."
        );
        assert_eq!(result["highlightPassage"]["id"], "ccw:original");
        assert_eq!(result["highlightPassage"]["rangeLabel"], "4-6");
        assert_eq!(result["score"], 0.7);
    }
}
