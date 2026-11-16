//! Existing browser/native account wire contracts. Location limits count UTF-16
//! units; note limits count Unicode characters, matching the original clients.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Location {
    pub version: u32,
    pub corpus: String,
    pub chapter_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passage_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passage_range: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct SavedProgress {
    pub location: Location,
    pub revision: i64,
}
pub(crate) type Progress = BTreeMap<String, SavedProgress>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudyItem {
    pub id: String,
    pub kind: String,
    pub location: Option<Location>,
    pub reference: String,
    pub quote: String,
    pub title: String,
    pub body: String,
    pub color: String,
    pub notebook_id: Option<String>,
    pub deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct SavedStudy {
    pub item: StudyItem,
    pub revision: i64,
}

pub(crate) fn parse_revision(value: &Value) -> Option<i64> {
    integer(value, 9_007_199_254_740_991)
}

fn integer(value: &Value, max: i64) -> Option<i64> {
    let number = value.as_f64()?;
    (number.is_finite() && number.fract() == 0.0 && number >= 0.0 && number <= max as f64)
        .then_some(number as i64)
}

pub(crate) fn valid_nonce(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub(crate) fn parse_location(value: &Value) -> Option<Location> {
    let object = value.as_object()?;
    if object.get("version")?.as_f64()? != 2.0 {
        return None;
    }
    let corpus = object.get("corpus")?.as_str()?;
    if !matches!(corpus, "scripture" | "fathers" | "classics") {
        return None;
    }
    let chapter = object.get("chapterKey")?.as_str()?;
    if chapter.chars().all(js_whitespace) || chapter.encode_utf16().count() > 300 {
        return None;
    }
    let optional = |name| match object.get(name) {
        None => Some(None),
        Some(value) => {
            let text = value.as_str()?;
            (text.encode_utf16().count() <= 300).then(|| Some(text.to_owned()))
        }
    };
    Some(Location {
        version: 2,
        corpus: corpus.into(),
        chapter_key: chapter.into(),
        passage_key: optional("passageKey")?,
        passage_range: optional("passageRange")?,
    })
}

pub(crate) fn parse_study(value: &Value) -> Option<StudyItem> {
    let object = value.as_object()?;
    let id = object.get("id")?.as_str()?;
    if !valid_id(id) {
        return None;
    }
    let kind = object.get("kind")?.as_str()?;
    if !matches!(kind, "bookmark" | "highlight" | "note" | "notebook") {
        return None;
    }
    let location = if kind == "notebook" {
        if !object.get("location")?.is_null() {
            return None;
        }
        None
    } else {
        Some(parse_location(object.get("location")?)?)
    };
    let bounded = |name, limit| {
        let text = object.get(name)?.as_str()?;
        (text.chars().count() <= limit).then(|| text.to_owned())
    };
    let notebook_id = match object.get("notebookId")? {
        Value::Null => None,
        Value::String(parent) if valid_id(parent) && parent != id => Some(parent.clone()),
        _ => return None,
    };
    let color = object.get("color")?.as_str()?;
    if !matches!(color, "yellow" | "green" | "blue") {
        return None;
    }
    let created_at = match object.get("createdAt") {
        None => None,
        Some(value) => Some(integer(value, 8_640_000_000_000_000)?),
    };
    Some(StudyItem {
        id: id.into(),
        kind: kind.into(),
        location,
        reference: bounded("reference", 500)?,
        quote: bounded("quote", 2000)?,
        title: bounded("title", 200)?,
        body: bounded("body", 8000)?,
        color: color.into(),
        notebook_id,
        deleted: object.get("deleted")?.as_bool()?,
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(super) fn note() -> Value {
        json!({ "id": "note_1", "kind": "note", "location": { "version": 2, "corpus": "scripture", "chapterKey": "John\t3", "passageKey": "John:3:16" }, "reference": "John 3:16", "quote": "For God so loved the world", "title": "", "body": "", "color": "yellow", "notebookId": null, "deleted": false })
    }

    #[test]
    fn location_contract_preserves_keys_and_uses_utf16_limits() {
        let mut value = note()["location"].clone();
        value["unknown"] = json!("discarded");
        assert_eq!(
            serde_json::to_value(parse_location(&value).unwrap()).unwrap()["unknown"],
            Value::Null
        );
        value["chapterKey"] = json!("😀".repeat(150));
        assert!(parse_location(&value).is_some());
        value["chapterKey"] = json!("😀".repeat(151));
        assert!(parse_location(&value).is_none());
        for chapter in ["", " \t\n", "\u{feff}"] {
            value["chapterKey"] = json!(chapter);
            assert!(parse_location(&value).is_none());
        }
        value["chapterKey"] = json!("John\t3");
        value["passageKey"] = Value::Null;
        assert!(parse_location(&value).is_none());
        value.as_object_mut().unwrap().remove("passageKey");
        assert!(parse_location(&value).is_some());
        for corpus in ["scripture", "fathers", "classics"] {
            value["corpus"] = json!(corpus);
            assert_eq!(parse_location(&value).unwrap().corpus, corpus);
        }
    }

    #[test]
    fn study_contract_matches_unicode_limits_anchors_dates_and_ids() {
        let base = note();
        for kind in ["bookmark", "highlight", "note", "notebook"] {
            let mut item = base.clone();
            item["kind"] = json!(kind);
            if kind == "notebook" {
                item["location"] = Value::Null;
            }
            assert!(parse_study(&item).is_some());
        }
        for (field, limit) in [
            ("reference", 500),
            ("quote", 2000),
            ("title", 200),
            ("body", 8000),
        ] {
            let mut item = base.clone();
            item[field] = json!("😀".repeat(limit));
            assert!(parse_study(&item).is_some());
            item[field] = json!("😀".repeat(limit + 1));
            assert!(parse_study(&item).is_none());
        }
        for date in [
            json!(-1),
            json!(1.5),
            json!("yesterday"),
            json!(8_640_000_000_000_001i64),
            Value::Null,
        ] {
            let mut item = base.clone();
            item["createdAt"] = date;
            assert!(parse_study(&item).is_none());
        }
        let mut item = base.clone();
        item["createdAt"] = json!(8_640_000_000_000_000i64);
        assert!(parse_study(&item).is_some());
        for id in ["../bad", "", "é"] {
            let mut item = base.clone();
            item["id"] = json!(id);
            assert!(parse_study(&item).is_none());
        }
        item = base;
        item["notebookId"] = item["id"].clone();
        assert!(parse_study(&item).is_none());
        assert_eq!(parse_revision(&json!(1.0)), Some(1));
        for revision in [
            json!(-1),
            json!(1.5),
            json!(9_007_199_254_740_992i64),
            json!("1"),
        ] {
            assert!(parse_revision(&revision).is_none());
        }
    }
}
