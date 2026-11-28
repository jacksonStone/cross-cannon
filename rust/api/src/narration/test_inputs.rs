//! Canonical, portable test data lives inside Rust's Docker/compiler boundary.
//! Full release verification explicitly requires the real runtime counterparts;
//! their absence or divergence fails rather than silently skipping assertions.
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn bundled() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/narration/fixtures/canonical")
}

fn pins() -> Value {
    serde_json::from_slice(
        &fs::read(bundled().join("pins.json")).expect("Pinned narration fixture inventory"),
    )
    .unwrap()
}

fn required_runtime_root(repo: PathBuf) -> PathBuf {
    for relative in pins()["files"].as_object().unwrap().keys() {
        assert!(
            repo.join(relative).is_file(),
            "Required real narration runtime input missing: {relative}"
        );
    }
    repo
}

pub(super) fn root() -> PathBuf {
    if std::env::var("CROSS_CANON_REQUIRE_NARRATION_RUNTIME_INPUTS").as_deref() == Ok("1") {
        required_runtime_root(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
    } else {
        bundled()
    }
}

fn read(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("Canonical narration input")).unwrap()
}

fn projection(catalog: Value) -> Value {
    let books = catalog["books"]
        .as_array()
        .unwrap()
        .iter()
        .map(|work| match work["id"].as_str() {
            Some("anf03:vi.iv") => work.clone(),
            Some("classics:treasury-of-david") => {
                let mut selected = work.clone();
                selected["chapters"] = Value::Array(
                    work["chapters"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|chapter| chapter["scriptureReference"]["chapter"] == 119)
                        .cloned()
                        .collect(),
                );
                assert_eq!(selected["chapters"].as_array().unwrap().len(), 1);
                selected
            }
            _ => json!({"id":work["id"],"metadata":work["metadata"]}),
        })
        .collect::<Vec<_>>();
    json!({"books":books})
}

#[test]
fn canonical_fixture_pins_and_required_runtime_inputs_match() {
    let pinned = bundled();
    let actual = root();
    let inventory = pins();
    assert_eq!(inventory["schema"], 1);
    assert_eq!(inventory["files"].as_object().unwrap().len(), 33);
    for (relative, record) in inventory["files"].as_object().unwrap() {
        let bytes = fs::read(pinned.join(relative)).expect("Pinned canonical fixture must exist");
        assert_eq!(
            super::cache::hash(&bytes),
            record["sha256"].as_str().unwrap(),
            "{relative}"
        );
        if record["kind"] == "catalog-projection" {
            assert_eq!(
                read(&pinned.join(relative)),
                projection(read(&actual.join(relative))),
                "{relative}"
            );
            assert_eq!(
                read(&pinned.join(relative))["books"]
                    .as_array()
                    .unwrap()
                    .len() as u64,
                inventory["catalogWorkCounts"][relative].as_u64().unwrap()
            );
        } else {
            assert_eq!(
                bytes,
                fs::read(actual.join(relative)).expect("Required canonical runtime input"),
                "{relative}"
            );
        }
    }
}

#[test]
fn requiring_real_runtime_inputs_does_not_fall_back_to_fixtures() {
    let missing = bundled().join("intentionally-absent-runtime-root");
    assert!(!missing.exists());
    assert!(std::panic::catch_unwind(|| required_runtime_root(missing)).is_err());
}
