//! Opt-in, serial release-mode timing of real native reader operations.
use super::*;
use std::collections::BTreeMap;

fn frame(app: &mut Desktop, ctx: &egui::Context, tick: &mut u64, events: Vec<egui::Event>) {
    *tick += 1;
    let _ = ctx.run(
        egui::RawInput {
            screen_rect: Some(Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(393.0, 852.0),
            )),
            time: Some(*tick as f64 / 60.0),
            events,
            ..Default::default()
        },
        |ctx| app.render(ctx),
    );
}

fn timed(mut operation: impl FnMut(), count: usize) -> f64 {
    let start = Instant::now();
    for _ in 0..count {
        operation();
    }
    start.elapsed().as_secs_f64() * 1000.0 / count as f64
}

// Exercise the iOS checkpoint path through App::update, not just render().
fn update_frame(app: &mut Desktop, ctx: &egui::Context, tick: &mut u64, scroll: bool) {
    use eframe::App;
    *tick += 1;
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(393.0, 852.0),
            )),
            time: Some(*tick as f64 / 60.0),
            events: if scroll {
                vec![
                    egui::Event::PointerMoved(egui::pos2(190.0, 450.0)),
                    egui::Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: egui::vec2(0.0, -30.0),
                        modifiers: egui::Modifiers::NONE,
                    },
                ]
            } else {
                vec![]
            },
            ..Default::default()
        },
        |ctx| app.update(ctx, &mut eframe::Frame::_new_kittest()),
    );
    // CPU tessellation is part of a rendered frame. GPU submission/presentation
    // still require the physical-device benchmark.
    std::hint::black_box(ctx.tessellate(output.shapes, output.pixels_per_point));
}

fn seed_study(app: &mut Desktop, count: usize) {
    for n in 0..count {
        app.study.put(study::Item {
            id: format!("benchmark-note-{n:06}"),
            kind: "note".into(),
            location: Some(account::Location::from_passage(app.current_passage())),
            reference: "Synthetic benchmark".into(),
            quote: "A saved passage".into(),
            title: String::new(),
            body: "A synthetic study note. ".repeat(40),
            color: "yellow".into(),
            notebook_id: None,
            deleted: false,
            created_at: Some(n as i64),
        });
    }
}

#[test]
fn unchanged_updates_do_not_prepare_checkpoints() {
    let library =
        Arc::new(Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap());
    let ctx = egui::Context::default();
    let mut app = Desktop::initialize(&ctx, None, library);
    let path = std::env::temp_dir()
        .join(format!("crosscanon-unchanged-{}", std::process::id()))
        .join("reader.ron");
    app.reader_storage = Some(persistence::ReaderStorage::open(path.clone()).unwrap());
    seed_study(&mut app, 50);
    let mut tick = 0;
    for _ in 0..10 {
        update_frame(&mut app, &ctx, &mut tick, false);
    }
    let storage = app.reader_storage.as_mut().unwrap();
    storage.submissions = 0;
    let writes = storage.writes;
    for _ in 0..10 {
        update_frame(&mut app, &ctx, &mut tick, false);
    }
    let storage = app.reader_storage.as_ref().unwrap();
    assert_eq!(
        storage.writes, writes,
        "Unchanged frames must not write files"
    );
    assert_eq!(
        storage.submissions, 0,
        "Unchanged frames must not prepare serialized checkpoints"
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
#[ignore = "Serial release-mode full update/checkpoint/tessellation audit"]
fn active_reading_update_audit() {
    let root = std::env::var_os("CROSS_CANON_PERF_LIBRARY")
        .map(PathBuf::from)
        .expect(
            "Set CROSS_CANON_PERF_LIBRARY to the current packaged library (including Classics)",
        );
    let library = Arc::new(Library::load(root).unwrap());
    let mut metrics = BTreeMap::<String, f64>::new();
    for count in [0, 5000] {
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let path = std::env::temp_dir()
            .join(format!("crosscanon-active-{}-{count}", std::process::id()))
            .join("reader.ron");
        app.reader_storage = Some(persistence::ReaderStorage::open(path.clone()).unwrap());
        seed_study(&mut app, count);
        let mut tick = 0;
        let passage = app.current_passage().clone();
        metrics.insert(
            format!("{count}_mark_lookup_ms"),
            timed(
                || {
                    std::hint::black_box(app.study.marks(&passage));
                },
                2000,
            ),
        );
        for (label, book) in [
            ("scripture", "John"),
            ("work", "npnf102:iv"),
            ("classic", "classics:imitation"),
        ] {
            app.open(library.book(book).unwrap().chapters[0].passage_ids[0].clone());
            for _ in 0..10 {
                update_frame(&mut app, &ctx, &mut tick, false);
            }
            metrics.insert(
                format!("{label}_{count}_still_update_ms"),
                timed(|| update_frame(&mut app, &ctx, &mut tick, false), 60),
            );
            let initial_location = app.state.location_passage_id.clone();
            metrics.insert(
                format!("{label}_{count}_scroll_update_ms"),
                timed(|| update_frame(&mut app, &ctx, &mut tick, true), 120),
            );
            assert_ne!(
                app.state.location_passage_id, initial_location,
                "The scroll workload must actually move through passages"
            );
            metrics.insert(
                format!("{label}_{count}_render_ms"),
                timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 60),
            );
        }
        metrics.insert(
            format!("{count}_checkpoint_submissions"),
            app.reader_storage.as_ref().unwrap().submissions as f64,
        );
        metrics.insert(
            format!("{count}_file_writes"),
            app.reader_storage.as_ref().unwrap().writes as f64,
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    println!(
        "ACTIVE_READING_PERF {}",
        serde_json::to_string(&metrics).unwrap()
    );
    if std::env::var_os("CROSS_CANON_PERF_ENFORCE").is_some() {
        for label in ["scripture", "work", "classic"] {
            assert!(
                metrics[&format!("{label}_5000_still_update_ms")]
                    < metrics[&format!("{label}_0_still_update_ms")] + 1.0,
                "Unchanged {label} updates must not scale with serialized note content"
            );
        }
    }
}

#[test]
fn selecting_a_passage_does_not_relayout_the_whole_work() {
    let library =
        Arc::new(Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap());
    let ctx = egui::Context::default();
    let mut app = Desktop::initialize(&ctx, None, library.clone());
    app.open(library.book("npnf102:iv").unwrap().chapters[0].passage_ids[0].clone());
    let mut tick = 0;
    for _ in 0..4 {
        frame(&mut app, &ctx, &mut tick, vec![]);
    }
    app.selected = Some(app.state.location_passage_id.clone());
    frame(&mut app, &ctx, &mut tick, vec![]);
    let galleys = ctx.fonts(|f| f.num_galleys_in_cache());
    assert!(galleys < 200, "Selecting one passage must retain off-screen geometry, not reshape the whole Work: {galleys}");
}

#[test]
#[ignore = "Serial release-mode performance audit using the actual packaged library"]
fn native_performance_audit() {
    let root = std::env::var_os("CROSS_CANON_PERF_LIBRARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.tmp/ios-speed/library")
        });
    let start = Instant::now();
    let library = Arc::new(Library::load(root).unwrap());
    let mut metrics = BTreeMap::<String, f64>::new();
    metrics.insert(
        "library_load_ms".into(),
        start.elapsed().as_secs_f64() * 1000.0,
    );
    metrics.insert(
        "keyword_all_first_ms".into(),
        timed(
            || {
                std::hint::black_box(library.search("love", None, &[], 20, Canon::Orthodox));
            },
            1,
        ),
    );
    let chapter_ids: Vec<_> = library
        .books
        .iter()
        .flat_map(|b| &b.chapters)
        .step_by(13)
        .map(|c| c.id.clone())
        .collect();
    metrics.insert(
        "chapter_lookup_batch_ms".into(),
        timed(
            || {
                for id in &chapter_ids {
                    std::hint::black_box(library.chapter(id).unwrap());
                }
            },
            3,
        ),
    );
    metrics.insert(
        "keyword_all_love_ms".into(),
        timed(
            || {
                std::hint::black_box(library.search("love", None, &[], 20, Canon::Orthodox));
            },
            3,
        ),
    );
    metrics.insert(
        "keyword_bible_ms".into(),
        timed(
            || {
                std::hint::black_box(library.search(
                    "fear comfort",
                    Some(Corpus::Scripture),
                    &[],
                    20,
                    Canon::Orthodox,
                ));
            },
            3,
        ),
    );
    metrics.insert(
        "download_catalog_ms".into(),
        timed(
            || {
                std::hint::black_box(downloads::Downloads::new(&library));
            },
            2,
        ),
    );

    let ctx = egui::Context::default();
    let mut app = Desktop::initialize(&ctx, None, library.clone());
    let (audio_tx, audio_rx) = mpsc::channel();
    app.audio_tx = Arc::new(audio_tx); // Measure real plan preparation without starting playback/network.
    let mut tick = 0;
    for (label, book_id) in [
        ("genesis", "Genesis"),
        ("psalms", "Psalms"),
        ("city_of_god", "npnf102:iv"),
    ] {
        app.open(library.book(book_id).unwrap().chapters[0].passage_ids[0].clone());
        metrics.insert(
            format!("reader_first_{label}_ms"),
            timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 1),
        );
        for _ in 0..3 {
            frame(&mut app, &ctx, &mut tick, vec![]);
        }
        metrics.insert(
            format!("reader_warm_{label}_ms"),
            timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 30),
        );
        metrics.insert(
            format!("scroll_{label}_ms"),
            timed(
                || {
                    frame(
                        &mut app,
                        &ctx,
                        &mut tick,
                        vec![egui::Event::MouseWheel {
                            unit: egui::MouseWheelUnit::Point,
                            delta: egui::vec2(0.0, -30.0),
                            modifiers: egui::Modifiers::NONE,
                        }],
                    )
                },
                30,
            ),
        );
        app.selected = Some(app.state.location_passage_id.clone());
        metrics.insert(
            format!("select_{label}_ms"),
            timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 1),
        );
        app.selected = None;
        frame(&mut app, &ctx, &mut tick, vec![]);
        let chapter = library.book(book_id).unwrap().chapters[0].id.clone();
        metrics.insert(
            format!("audio_plan_{label}_ms"),
            timed(
                || {
                    app.audio_chapter = None;
                    app.play_audio(&chapter);
                    let _ = audio_rx.try_recv();
                },
                3,
            ),
        );
    }
    app.show_jump();
    app.jump_corpus = Corpus::EarlyChristian;
    app.jump_book = "npnf102:iv".into();
    for _ in 0..3 {
        frame(&mut app, &ctx, &mut tick, vec![]);
    }
    metrics.insert(
        "jump_fathers_frame_ms".into(),
        timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 10),
    );
    app.dialog = Some(Dialog::Settings);
    for _ in 0..3 {
        frame(&mut app, &ctx, &mut tick, vec![]);
    }
    metrics.insert(
        "settings_frame_ms".into(),
        timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 10),
    );
    app.dialog = Some(Dialog::Downloads);
    metrics.insert(
        "downloads_first_frame_ms".into(),
        timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 1),
    );
    metrics.insert(
        "downloads_warm_frame_ms".into(),
        timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 10),
    );
    app.dialog = Some(Dialog::Search);
    app.results = library
        .search("love", None, &[], 20, Canon::Orthodox)
        .iter()
        .map(|h| ResultPassage::local(library.passage(&h.id).unwrap(), h.score))
        .collect();
    for _ in 0..3 {
        frame(&mut app, &ctx, &mut tick, vec![]);
    }
    metrics.insert(
        "search_results_frame_ms".into(),
        timed(|| frame(&mut app, &ctx, &mut tick, vec![]), 10),
    );
    println!("NATIVE_PERF {}", serde_json::to_string(&metrics).unwrap());
    if std::env::var_os("CROSS_CANON_PERF_ENFORCE").is_some() {
        assert!(
            metrics["keyword_all_love_ms"] < 50.0,
            "Offline search exceeds 50ms responsiveness budget"
        );
        assert!(
            metrics["jump_fathers_frame_ms"] < 4.0,
            "Work picker exceeds 4ms frame budget"
        );
        assert!(
            metrics["reader_first_city_of_god_ms"] < 250.0,
            "Opening a long Work exceeds 250ms CPU budget for exact geometry"
        );
        assert!(
            metrics["select_city_of_god_ms"] < 10.0,
            "Selection must not rebuild an entire Work"
        );
    }
}
