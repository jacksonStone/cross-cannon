//! Offline work discovery is distinct from theme/paragraph search. Its small
//! catalog supplements the existing text bundle without changing its format.
use super::*;
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path, sync::OnceLock};

#[derive(Default, Deserialize)]
pub(super) struct Catalog {
    #[serde(default)]
    pub works: HashMap<String, WorkDetails>,
    #[serde(default)]
    chapters: HashMap<String, ChapterDetails>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct WorkDetails {
    pub genre: Option<String>,
    pub tradition: Option<String>,
    pub authorship_date_range: Option<String>,
    pub translator: Option<String>,
    pub edition: Option<String>,
    pub rights: Option<String>,
    pub source: Option<SourceDetails>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct SourceDetails {
    pub source_url: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ChapterDetails {
    scripture_reference: Option<ScriptureReference>,
    paragraphs: Vec<Paragraph>,
    asset_path: Option<String>,
    #[serde(skip)]
    loaded_paragraphs: OnceLock<Vec<Paragraph>>,
}

#[derive(Deserialize)]
struct ScriptureReference {
    book: String,
    chapter: u32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Paragraph {
    start: u32,
    end: u32,
    scripture_start: Option<u32>,
    scripture_end: Option<u32>,
    #[serde(default)]
    scripture_quotation: bool,
}

impl Catalog {
    /// Byte ranges in the displayed text, keeping canonical passage IDs intact.
    pub fn quotation_ranges(
        &self,
        library: &Library,
        passage: &Passage,
        displayed: &str,
    ) -> Vec<std::ops::Range<usize>> {
        let Some(details) = self.chapters.get(&passage.chapter_id) else {
            return vec![];
        };
        let paragraphs = details.paragraphs(&library.root);
        let mut ranges: Vec<std::ops::Range<usize>> = vec![];
        let mut cursor = 0;
        for verse in &passage.verses {
            let Some(offset) = displayed[cursor..].find(&verse.text) else {
                continue;
            };
            let start = cursor + offset;
            let end = start + verse.text.len();
            if paragraphs
                .iter()
                .any(|p| p.scripture_quotation && verse.number >= p.start && verse.number <= p.end)
            {
                if let Some(previous) = ranges
                    .last_mut()
                    .filter(|r| displayed[r.end..start].trim().is_empty())
                {
                    previous.end = end;
                } else {
                    ranges.push(start..end);
                }
            }
            cursor = end;
        }
        ranges
    }

    pub fn load(root: &Path) -> Arc<Self> {
        static CATALOGS: OnceLock<std::sync::Mutex<HashMap<PathBuf, Arc<Catalog>>>> =
            OnceLock::new();
        let mut catalogs = CATALOGS.get_or_init(Default::default).lock().unwrap();
        catalogs
            .entry(root.to_owned())
            .or_insert_with(|| {
                let bundled = fs::read(root.join("catalog.json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok());
                Arc::new(bundled.unwrap_or_else(|| Self::from_artifacts(root)))
            })
            .clone()
    }

    fn from_artifacts(root: &Path) -> Self {
        let mut catalog = Self::default();
        for path in [
            "public/church-fathers-preview/books.json",
            "public/christian-classics-text/books.json",
        ] {
            let Some(index) = fs::read(root.join(path))
                .ok()
                .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
            else {
                continue;
            };
            for book in index["books"].as_array().into_iter().flatten() {
                if let Some(id) = book["id"].as_str() {
                    catalog.works.insert(
                        id.into(),
                        serde_json::from_value(book["metadata"].clone()).unwrap_or_default(),
                    );
                    if id.starts_with("classics:") {
                        for chapter in book["chapters"].as_array().into_iter().flatten() {
                            if let Some(id) = chapter["id"].as_str() {
                                if let Ok(details) = serde_json::from_value(chapter.clone()) {
                                    catalog.chapters.insert(id.into(), details);
                                }
                            }
                        }
                    }
                }
            }
        }
        catalog
    }

    #[cfg(target_arch = "wasm32")]
    pub fn commentary_chapters(&self, source: &Passage) -> Vec<String> {
        self.chapters
            .iter()
            .filter(|(_, details)| {
                details
                    .scripture_reference
                    .as_ref()
                    .is_some_and(|r| r.book == source.book && r.chapter == source.chapter)
            })
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn commentaries(&self, library: &Library, source: &Passage) -> Vec<commentary::Work> {
        if source.corpus != Corpus::Scripture {
            return vec![];
        }
        library
            .books
            .iter()
            .filter(|book| book.corpus == Corpus::ChristianClassics)
            .filter_map(|book| {
                let mut notes = vec![];
                for chapter in &book.chapters {
                    let Some(details) = self.chapters.get(&chapter.id) else {
                        continue;
                    };
                    let Some(reference) = &details.scripture_reference else {
                        continue;
                    };
                    if reference.book != source.book || reference.chapter != source.chapter {
                        continue;
                    }
                    let passages: Vec<_> = chapter
                        .passage_ids
                        .iter()
                        .filter_map(|id| library.passage(id))
                        .collect();
                    let mut segments: Vec<Vec<&Paragraph>> = vec![];
                    for paragraph in details.paragraphs(&library.root) {
                        if paragraph.scripture_quotation {
                            continue;
                        }
                        let Some(start) = paragraph.scripture_start else {
                            continue;
                        };
                        let end = paragraph.scripture_end.unwrap_or(start);
                        if start > source.verse_end || end < source.verse_start {
                            continue;
                        }
                        // Source paragraphs and stored passage chunks are not
                        // result boundaries: keep each contiguous relevant run.
                        if let Some(segment) = segments.last_mut().filter(|segment| {
                            segment.last().unwrap().end.checked_add(1) == Some(paragraph.start)
                        }) {
                            segment.push(paragraph);
                        } else {
                            segments.push(vec![paragraph]);
                        }
                    }
                    for segment in segments {
                        let Some(passage) = passages.iter().find(|p| {
                            p.verse_start <= segment[0].start && p.verse_end >= segment[0].start
                        }) else {
                            continue;
                        };
                        let text = segment
                            .iter()
                            .map(|paragraph| {
                                passages
                                    .iter()
                                    .flat_map(|p| &p.verses)
                                    .filter(|v| {
                                        v.number >= paragraph.start && v.number <= paragraph.end
                                    })
                                    .map(|v| v.text.as_str())
                                    .collect::<Vec<_>>()
                                    .join(" ")
                            })
                            .filter(|text| !text.is_empty())
                            .collect::<Vec<_>>()
                            .join("\n\n");
                        if text.is_empty() {
                            continue;
                        }
                        let start = segment
                            .iter()
                            .filter_map(|p| p.scripture_start)
                            .min()
                            .unwrap();
                        let end = segment
                            .iter()
                            .filter_map(|p| p.scripture_end.or(p.scripture_start))
                            .max()
                            .unwrap();
                        let range = if start == end {
                            start.to_string()
                        } else {
                            format!("{start}–{end}")
                        };
                        notes.push(commentary::Note {
                            passage_id: passage.id.clone(),
                            reference: format!("{} {}:{range}", reference.book, reference.chapter),
                            text,
                        });
                    }
                }
                (!notes.is_empty()).then(|| commentary::Work {
                    title: book.title.clone(),
                    author: book.author.clone().unwrap_or_else(|| book.title.clone()),
                    notes,
                })
            })
            .collect()
    }

    pub fn decorate(&self, library: &Library, hit: &mut ResultPassage) {
        if hit.corpus != Corpus::ChristianClassics {
            return;
        }
        let Some(passage) = library.passage(&hit.id) else {
            return;
        };
        // Older text bundles can still show an honest chapter label.
        if hit.reference == passage.reference {
            if let Some((reference, _)) = hit.reference.rsplit_once(':') {
                hit.reference = reference.to_owned();
            }
        }
        let Some(details) = self.chapters.get(&passage.chapter_id) else {
            return;
        };
        let overlapping: Vec<_> = details
            .paragraphs(&library.root)
            .iter()
            .filter(|p| p.start <= passage.verse_end && p.end >= passage.verse_start)
            .collect();
        let paragraphs: Vec<_> = overlapping
            .iter()
            .copied()
            .filter(|p| !p.scripture_quotation)
            .collect();
        if paragraphs.is_empty() {
            if !overlapping.is_empty() {
                hit.text.clear();
            }
            return;
        }
        if let Some((_, chapter)) = library.chapter(&passage.chapter_id) {
            hit.text = chapter
                .passage_ids
                .iter()
                .filter_map(|id| library.passage(id))
                .flat_map(|p| &p.verses)
                .filter(|v| {
                    paragraphs
                        .iter()
                        .any(|p| v.number >= p.start && v.number <= p.end)
                })
                .map(|v| v.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
        }
        if let (Some(reference), Some(start), Some(end)) = (
            &details.scripture_reference,
            paragraphs.iter().filter_map(|p| p.scripture_start).min(),
            paragraphs
                .iter()
                .filter_map(|p| p.scripture_end.or(p.scripture_start))
                .max(),
        ) {
            let range = if start == end {
                start.to_string()
            } else {
                format!("{start}–{end}")
            };
            hit.reference = format!(
                "{} · {} {}:{range}",
                passage.book, reference.book, reference.chapter
            );
        }
    }
}

impl ChapterDetails {
    fn paragraphs(&self, root: &Path) -> &[Paragraph] {
        if !self.paragraphs.is_empty() {
            return &self.paragraphs;
        }
        self.loaded_paragraphs
            .get_or_init(|| self.read_paragraphs(root))
    }

    fn read_paragraphs(&self, root: &Path) -> Vec<Paragraph> {
        // Development libraries retain the immutable assets; packaged libraries
        // already carry these same paragraph/verse mappings in catalog.json.
        let Some(path) = self.asset_path.as_deref().filter(|path| {
            path.starts_with("/christian-classics-text/chapters/") && !path.contains("..")
        }) else {
            return vec![];
        };
        let Some(asset) = fs::read(root.join("public").join(path.trim_start_matches('/')))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        else {
            return vec![];
        };
        let mut paragraphs: Vec<Paragraph> = vec![];
        let mut previous = None;
        for verse in asset["verses"].as_array().into_iter().flatten() {
            let (Some(group), Some(number)) =
                (verse["sourceParagraph"].as_u64(), verse["verse"].as_u64())
            else {
                return vec![];
            };
            let start = verse["scriptureVerseStart"].as_u64().map(|v| v as u32);
            let end = verse["scriptureVerseEnd"]
                .as_u64()
                .map(|v| v as u32)
                .or(start);
            if previous == Some(group) {
                let paragraph = paragraphs.last_mut().unwrap();
                paragraph.end = number as u32;
                paragraph.scripture_start =
                    paragraph.scripture_start.into_iter().chain(start).min();
                paragraph.scripture_end = paragraph.scripture_end.into_iter().chain(end).max();
            } else {
                paragraphs.push(Paragraph {
                    start: number as u32,
                    end: number as u32,
                    scripture_start: start,
                    scripture_end: end,
                    scripture_quotation: verse["scriptureQuotation"] == true,
                });
            }
            previous = Some(group);
        }
        paragraphs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Arc<Library> {
        static LIBRARY: OnceLock<Arc<Library>> = OnceLock::new();
        LIBRARY
            .get_or_init(|| {
                Arc::new(
                    Library::load(
                        std::env::var_os("CROSS_CANON_TEST_LIBRARY")
                            .map(PathBuf::from)
                            .unwrap_or_else(|| {
                                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
                            }),
                    )
                    .unwrap(),
                )
            })
            .clone()
    }

    #[test]
    fn offline_paragraph_metadata_repairs_the_exact_screenshot_without_changing_its_source() {
        let library = library();
        let passage = library.passage("classics:henry:Prov.16:4-6").unwrap();
        let mut hit = ResultPassage::local(passage, 0.7);
        let catalog: Catalog = serde_json::from_value(serde_json::json!({"chapters": {
            "classics:henry:Prov.16": {"scriptureReference":{"book":"Proverbs","chapter":16},
                "paragraphs":[{"start":2,"end":12,"scriptureStart":1,"scriptureEnd":1}]}
        }}))
        .unwrap();
        catalog.decorate(&library, &mut hit);
        assert_eq!(
            hit.reference,
            "Commentary on the Whole Bible · Proverbs 16:1"
        );
        assert!(hit.text.starts_with("As we read this"));
        assert!(hit.text.ends_with("a blessing."));
        assert_eq!(hit.source_id, passage.id);
        assert_eq!(hit.score, 0.7);
        let mut corrected = ResultPassage::local(passage, 0.7);
        corrected.reference = hit.reference.clone();
        Catalog::default().decorate(&library, &mut corrected);
        assert_eq!(
            corrected.reference, hit.reference,
            "Never strip a server's real Scripture coverage"
        );
    }

    fn render(
        app: &mut Desktop,
        ctx: &egui::Context,
        width: f32,
        events: Vec<egui::Event>,
    ) -> egui::FullOutput {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(width, 852.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| app.render(ctx),
        )
    }

    fn label_position(output: &egui::FullOutput, label: &str) -> egui::Pos2 {
        output
            .shapes
            .iter()
            .find_map(|shape| match &shape.shape {
                egui::Shape::Text(text)
                    if text.galley.job.text == label && shape.clip_rect.contains(text.pos) =>
                {
                    Some(text.pos + text.galley.size() / 2.0)
                }
                _ => None,
            })
            .unwrap_or_else(|| panic!("Missing visible catalog label: {label}"))
    }

    fn tap(app: &mut Desktop, ctx: &egui::Context, width: f32, pos: egui::Pos2) {
        for pressed in [true, false] {
            render(
                app,
                ctx,
                width,
                vec![
                    egui::Event::PointerMoved(pos),
                    egui::Event::PointerButton {
                        pos,
                        button: egui::PointerButton::Primary,
                        pressed,
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
        }
    }

    #[test]
    fn selected_scripture_views_indexed_commentaries_without_search_on_phone_and_desktop() {
        let library = library();
        let passage = library.book("Psalms").unwrap().chapters[116].passage_ids[0].clone();
        for width in [393.0, 1000.0] {
            let ctx = egui::Context::default();
            ctx.enable_accesskit();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.state.api_url = "http://127.0.0.1:1/r/api".into();
            app.open(passage.clone());
            app.selected = Some(passage.clone());
            app.query = "a previous theme".into();
            app.search_corpus = Some(Corpus::EarlyChristian);
            app.search_authors = vec!["Clement of Rome".into()];
            app.search_books = vec!["Luke".into()];
            app.semantic = false;
            for _ in 0..3 {
                render(&mut app, &ctx, width, vec![]);
            }
            let output = render(&mut app, &ctx, width, vec![]);
            let node = &output
                .platform_output
                .accesskit_update
                .as_ref()
                .unwrap()
                .nodes
                .iter()
                .find(|(_, node)| node.label() == Some("View commentaries"))
                .expect("Accessible commentary action")
                .1;
            let bounds = node.bounds().unwrap();
            assert_eq!(bounds.width(), 44.0);
            assert_eq!(bounds.height(), 44.0);
            let button = egui::pos2(
                ((bounds.x0 + bounds.x1) / 2.0) as f32,
                ((bounds.y0 + bounds.y1) / 2.0) as f32,
            );
            assert!(button.x < width && button.y < 852.0);
            tap(&mut app, &ctx, width, button);
            assert!(matches!(app.dialog, Some(Dialog::Commentary)));
            assert!(!app.busy);
            assert!(app.search_source.is_none());
            assert_eq!(app.query, "a previous theme");
            let works = &app.commentary.as_ref().unwrap().works;
            assert!(works
                .iter()
                .any(|work| work.author.starts_with("Matthew Henry")));
            assert!(works.iter().all(|work| !work.notes.is_empty()));
            assert!(works
                .iter()
                .flat_map(|work| &work.notes)
                .all(|note| note.reference.starts_with("Psalms 117:")));
            assert!(!output.shapes.iter().any(|shape| matches!(&shape.shape,
                egui::Shape::Text(text) if ["Copy", "Copy link", "Search commentaries"].contains(&text.galley.job.text.as_str()))));
            let output = render(&mut app, &ctx, width, vec![]);
            label_position(&output, "Commentaries");
        }
    }

    #[test]
    fn commentary_lookup_groups_contiguous_relevant_paragraphs() {
        let library = library();
        let mut source = library
            .passage(&library.book("Matthew").unwrap().chapters[4].passage_ids[0])
            .unwrap()
            .clone();
        source.verse_start = 3;
        source.verse_end = 3;
        let chapter = library
            .book("classics:henry")
            .unwrap()
            .chapters
            .iter()
            .find(|chapter| chapter.id.ends_with(":Matt.5"))
            .unwrap();
        let catalog: Catalog = serde_json::from_value(serde_json::json!({"chapters": {
            chapter.id.clone(): {"scriptureReference":{"book":"Matthew","chapter":5}, "paragraphs":[
                {"start":2,"end":4,"scriptureStart":3,"scriptureEnd":3},
                {"start":5,"end":7,"scriptureStart":3,"scriptureEnd":3}
            ]}
        }}))
        .unwrap();
        let works = catalog.commentaries(&library, &source);
        assert_eq!(works.len(), 1);
        assert_eq!(
            works[0].notes.len(),
            1,
            "Adjacent commentary paragraphs belong to one result"
        );
        let note = &works[0].notes[0];
        let text = |start, end| {
            chapter
                .passage_ids
                .iter()
                .filter_map(|id| library.passage(id))
                .flat_map(|p| &p.verses)
                .filter(|v| v.number >= start && v.number <= end)
                .map(|v| v.text.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        };
        assert_eq!(note.text, format!("{}\n\n{}", text(2, 4), text(5, 7)));
        assert_eq!(note.reference, "Matthew 5:3");
        assert_eq!(note.passage_id, chapter.passage_ids[0]);
    }

    #[test]
    fn commentary_lookup_keeps_gaps_and_chapters_separate() {
        let library = library();
        let mut source = library
            .passage(&library.book("Matthew").unwrap().chapters[4].passage_ids[0])
            .unwrap()
            .clone();
        source.verse_start = 3;
        source.verse_end = 3;
        let chapter = library
            .book("classics:henry")
            .unwrap()
            .chapters
            .iter()
            .find(|chapter| chapter.id.ends_with(":Matt.5"))
            .unwrap();
        let next = library
            .book("classics:henry")
            .unwrap()
            .chapters
            .iter()
            .find(|chapter| chapter.id.ends_with(":Matt.6"))
            .unwrap();
        for middle in [
            serde_json::json!({"start":3,"end":3,"scriptureStart":4}),
            serde_json::json!({"start":3,"end":3}),
            serde_json::json!({"start":3,"end":3,"scriptureStart":3,"scriptureQuotation":true}),
        ] {
            let catalog: Catalog = serde_json::from_value(serde_json::json!({"chapters": {
                chapter.id.clone(): {"scriptureReference":{"book":"Matthew","chapter":5}, "paragraphs":[
                    {"start":1,"end":2,"scriptureStart":3}, middle,
                    {"start":4,"end":5,"scriptureStart":3},
                    {"start":7,"end":8,"scriptureStart":3}
                ]},
                next.id.clone(): {"scriptureReference":{"book":"Matthew","chapter":5}, "paragraphs":[
                    {"start":9,"end":10,"scriptureStart":3}
                ]}
            }})).unwrap();
            let works = catalog.commentaries(&library, &source);
            assert_eq!(works[0].notes.len(), 4);
            assert!(works[0]
                .notes
                .iter()
                .all(|note| note.reference == "Matthew 5:3"));
            assert_eq!(works[0].notes[3].passage_id, next.passage_ids[2]);
        }
    }

    #[test]
    fn john_three_sixteen_commentaries_preserve_complete_contiguous_sections() {
        let library = library();
        let mut source = library
            .passage(&library.book("John").unwrap().chapters[2].passage_ids[0])
            .unwrap()
            .clone();
        source.verse_start = 16;
        source.verse_end = 16;
        let catalog = Catalog::load(&library.root);
        let works = catalog.commentaries(&library, &source);
        for (author, first, last) in [
            ("Thomas Aquinas", 199, 258),
            ("Matthew Henry and continuators", 26, 671),
            ("John Wesley", 35, 44),
        ] {
            let work = works.iter().find(|work| work.author == author).unwrap();
            assert_eq!(
                work.notes.len(),
                1,
                "{} should be one continuous section",
                work.author
            );
            let note = &work.notes[0];
            let passage = library.passage(&note.passage_id).unwrap();
            let details = &catalog.chapters[&passage.chapter_id];
            let expected_paragraphs = details
                .paragraphs(&library.root)
                .iter()
                .filter(|p| {
                    !p.scripture_quotation
                        && p.scripture_start.is_some_and(|start| {
                            start <= 16 && p.scripture_end.unwrap_or(start) >= 16
                        })
                })
                .count();
            assert_eq!(note.text.split("\n\n").count(), expected_paragraphs);
            let expected = library
                .chapter(&passage.chapter_id)
                .unwrap()
                .1
                .passage_ids
                .iter()
                .filter_map(|id| library.passage(id))
                .flat_map(|p| &p.verses)
                .filter(|v| v.number >= first && v.number <= last)
                .map(|v| v.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            assert_eq!(note.text.replace("\n\n", " "), expected);
        }
    }

    #[test]
    fn commentary_lookup_matches_book_chapter_and_overlapping_verse_ranges_only() {
        let library = library();
        let catalog = Catalog::load(&library.root);
        let mut source = library
            .passage(&library.book("Matthew").unwrap().chapters[4].passage_ids[0])
            .unwrap()
            .clone();
        source.verse_start = 3;
        source.verse_end = 3;
        let chapter_id = library
            .passage(
                &library
                    .book("classics:henry")
                    .unwrap()
                    .chapters
                    .iter()
                    .find(|chapter| chapter.id.ends_with(":Matt.5"))
                    .unwrap()
                    .passage_ids[0],
            )
            .unwrap()
            .chapter_id
            .clone();
        let packaged: Catalog = serde_json::from_value(serde_json::json!({"chapters": {
            chapter_id: {"scriptureReference":{"book":"Matthew","chapter":5}, "paragraphs":[
                {"start":1,"end":1,"scriptureStart":1,"scriptureEnd":2},
                {"start":2,"end":2,"scriptureStart":3,"scriptureEnd":3},
                {"start":3,"end":3,"scriptureStart":4,"scriptureEnd":6}
            ]}
        }}))
        .unwrap();
        let exact = packaged.commentaries(&library, &source);
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].notes.len(), 1);
        assert_eq!(exact[0].notes[0].reference, "Matthew 5:3");
        source.verse_start = 2;
        let grouped = packaged.commentaries(&library, &source);
        assert_eq!(grouped[0].notes.len(), 1);
        assert_eq!(grouped[0].notes[0].reference, "Matthew 5:1–3");
        source.verse_start = 3;
        let works = catalog.commentaries(&library, &source);
        for author in [
            "Thomas Aquinas",
            "Matthew Henry and continuators",
            "John Wesley",
        ] {
            assert!(works.iter().any(|work| work.author == author));
        }
        for work in &works {
            assert!(!work.notes.is_empty());
            assert!(work
                .notes
                .iter()
                .all(|note| note.reference.starts_with("Matthew 5:")));
            assert!(!work.notes.iter().any(|note| note
                .text
                .contains("We have here a general account of this sermon.")));
        }
        source.verse_start = 1000;
        source.verse_end = 1001;
        assert!(catalog.commentaries(&library, &source).is_empty());
        source.verse_start = 1;
        source.verse_end = 1;
        source.chapter = 999;
        assert!(catalog.commentaries(&library, &source).is_empty());
        source.corpus = Corpus::ChristianClassics;
        assert!(catalog.commentaries(&library, &source).is_empty());
    }

    #[test]
    fn acts_six_quotes_are_retained_for_reading_but_excluded_from_previews() {
        let library = library();
        let catalog = Catalog::load(&library.root);
        let mut source = library
            .passage(&library.book("Acts").unwrap().chapters[5].passage_ids[0])
            .unwrap()
            .clone();
        source.verse_start = 1;
        source.verse_end = 4;
        let works = catalog.commentaries(&library, &source);
        let henry = works
            .iter()
            .find(|w| w.author.starts_with("Matthew Henry"))
            .unwrap();
        assert!(henry
            .notes
            .iter()
            .any(|n| n.text.starts_with("Having seen the church's struggles")));
        assert!(!henry
            .notes
            .iter()
            .any(|n| n.text.contains("1 And in those days")));

        let quote = library.passage("classics:henry:Acts.6:25-27").unwrap();
        assert!(!catalog
            .quotation_ranges(&library, quote, &quote.text)
            .is_empty());
        let mut hit = ResultPassage::local(quote, 0.7);
        catalog.decorate(&library, &mut hit);
        assert!(
            hit.text.is_empty(),
            "A standalone quotation must not become a search preview"
        );
        let mixed = library.passage("classics:henry:Acts.6:28-30").unwrap();
        let mut hit = ResultPassage::local(mixed, 0.7);
        catalog.decorate(&library, &mut hit);
        assert!(!hit
            .text
            .contains("4 But we will give ourselves continually"));
        assert!(hit.text.starts_with("Having seen the church's struggles"));
        assert_eq!(hit.source_id, mixed.id);
        assert_eq!(hit.score, 0.7);
    }

    #[test]
    fn reading_henry_from_catalog_bounds_first_frame_text_layout() {
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library());
        app.show_library();
        app.jump_corpus = Corpus::ChristianClassics;
        app.jump_filter = "Henry".into();
        for _ in 0..3 {
            render(&mut app, &ctx, 393.0, vec![]);
        }
        let output = render(&mut app, &ctx, 393.0, vec![]);
        tap(&mut app, &ctx, 393.0, label_position(&output, "1"));
        assert_eq!(app.current_passage().book_id, "classics:henry");
        // Navigation is only half the action: the next frame actually opens
        // Henry's very large commentary on memory-constrained phones.
        let start = Instant::now();
        let output = render(&mut app, &ctx, 393.0, vec![]);
        let galleys = ctx.fonts(|fonts| fonts.num_galleys_in_cache());
        eprintln!(
            "HENRY_FIRST_FRAME elapsed={:?} galleys={galleys}",
            start.elapsed()
        );
        assert!(galleys < 1000, "Opening Henry must bound text layout to nearby chapters, got {galleys} cached text layouts");
        assert!(output.shapes.iter().any(|shape| matches!(&shape.shape,
            egui::Shape::Text(text) if text.galley.job.text.contains("Genesis"))));
        let last = app
            .library
            .book("classics:henry")
            .unwrap()
            .chapters
            .last()
            .unwrap()
            .passage_ids[0]
            .clone();
        for id in ["classics:henry:Prov.16:4-6".into(), last] {
            app.open(id.clone());
            for width in [393.0, 852.0, 320.0] {
                for _ in 0..3 {
                    render(&mut app, &ctx, width, vec![]);
                }
                assert_eq!(app.state.location_passage_id, id);
                assert!(ctx.fonts(|fonts| fonts.num_galleys_in_cache()) < 2000);
            }
        }
        let saved = app.state.location_passage_id.clone();
        let mut storage = crate::tests::MemoryStorage::default();
        eframe::App::save(&mut app, &mut storage);
        let restored_ctx = egui::Context::default();
        let mut restored = Desktop::initialize(&restored_ctx, Some(&storage), library());
        render(&mut restored, &restored_ctx, 393.0, vec![]);
        assert_eq!(restored.state.location_passage_id, saved);
        assert!(restored_ctx.fonts(|fonts| fonts.num_galleys_in_cache()) < 2000);
    }

    #[test]
    fn phone_library_filters_by_keyboard_and_only_navigates_when_chapter_is_selected() {
        let library = library();
        for width in [320.0, 393.0, 1000.0] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            let original = app.current_passage().id.clone();
            app.show_library();
            for _ in 0..3 {
                render(&mut app, &ctx, width, vec![]);
            }
            let output = render(&mut app, &ctx, width, vec![]);
            tap(&mut app, &ctx, width, label_position(&output, "Classics"));
            assert_eq!(
                app.current_passage().id,
                original,
                "Browsing must not replace Reader Location"
            );
            assert!(app.dialog == Some(Dialog::Library));
            ctx.memory_mut(|memory| memory.request_focus(Id::new("library-query")));
            render(
                &mut app,
                &ctx,
                width,
                vec![egui::Event::Text("Henry".into())],
            );
            assert_eq!(app.jump_filter, "Henry");
            let output = render(&mut app, &ctx, width, vec![]);
            label_position(&output, "Commentary on the Whole Bible");
            for shape in &output.shapes {
                if let egui::Shape::Text(text) = &shape.shape {
                    if shape.clip_rect.contains(text.pos) {
                        assert!(
                            text.pos.x + text.galley.size().x <= width - 6.0,
                            "Catalog text exceeds phone width {width}: {}",
                            text.galley.job.text
                        );
                    }
                }
            }
            tap(&mut app, &ctx, width, label_position(&output, "1"));
            assert_eq!(app.current_passage().book_id, "classics:henry");
            assert_eq!(app.state.scripture_location, original);
            assert!(app.dialog.is_none());
        }
    }
}
