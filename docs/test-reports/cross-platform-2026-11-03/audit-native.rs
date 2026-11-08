// Audit-only tests appended to a disposable copy of the native crate.
// The two parity assertions intentionally fail on the audited implementation.
#[cfg(test)]
mod audit_20261103 {
    use super::*;
    use std::sync::OnceLock;

    fn library() -> Arc<Library> {
        static LIBRARY: OnceLock<Arc<Library>> = OnceLock::new();
        LIBRARY.get_or_init(|| Arc::new(Library::load(
            "/Users/jacksonstone/Desktop/ubuntu_box_software/cross-cannon"
        ).unwrap())).clone()
    }
    fn frame(app: &mut Desktop, ctx: &egui::Context, events: Vec<egui::Event>) -> egui::FullOutput {
        ctx.run(egui::RawInput {
            screen_rect: Some(Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(393.0, 844.0))),
            events, ..Default::default()
        }, |ctx| app.render(ctx))
    }
    fn locate(output: &egui::FullOutput, label: &str) -> egui::Pos2 {
        output.shapes.iter().rev().find_map(|shape| {
            if let egui::epaint::Shape::Text(text) = &shape.shape {
                let rect = Rect::from_min_size(text.pos, text.galley.size());
                if text.galley.job.text == label && shape.clip_rect.intersects(rect) {
                    return Some(rect.center());
                }
            }
            None
        }).unwrap_or_else(|| panic!("Missing visible label {label}"))
    }
    fn click(app: &mut Desktop, ctx: &egui::Context, label: &str) {
        for _ in 0..3 { frame(app,ctx,vec![]); }
        let output=frame(app,ctx,vec![]);
        let pos=locate(&output,label);
        for pressed in [true,false] {
            frame(app,ctx,vec![egui::Event::PointerMoved(pos),egui::Event::PointerButton {
                pos,button:egui::PointerButton::Primary,pressed,modifiers:egui::Modifiers::NONE
            }]);
        }
    }
    fn ready(app: &mut Desktop, ctx: &egui::Context) {
        let deadline=Instant::now()+Duration::from_secs(10);
        while app.busy && Instant::now()<deadline {
            std::thread::sleep(Duration::from_millis(10)); frame(app,ctx,vec![]);
        }
        assert!(!app.busy,"Search did not settle: {}",app.message);
    }
    #[test]
    fn audit_clear_all_preserves_selected_canon_like_web() {
        let ctx=egui::Context::default();
        let mut app=Desktop::initialize(&ctx,None,library());
        app.dialog=Some(Dialog::Search);app.filters_open=true;
        app.state.canon=Canon::Catholic;app.search_books=vec!["Sirach".into()];app.match_count=5;
        click(&mut app,&ctx,"Clear all");
        assert_eq!(app.match_count,10);assert!(app.search_books.is_empty());
        eprintln!("Observed native canon after Clear all: {:?}",app.state.canon);
        assert_eq!(app.state.canon,Canon::Catholic,"Web Clear all preserves the selected canon");
    }
    #[test]
    fn audit_out_of_canon_books_stay_cleared_like_web() {
        let ctx=egui::Context::default();
        let mut app=Desktop::initialize(&ctx,None,library());
        app.dialog=Some(Dialog::Search);app.filters_open=true;
        app.state.canon=Canon::Catholic;app.search_books=vec!["Sirach".into()];
        click(&mut app,&ctx,"Catholic");click(&mut app,&ctx,"Protestant");
        assert_eq!(app.state.canon,Canon::Protestant);assert!(app.search_request().books.is_empty());
        click(&mut app,&ctx,"Protestant");click(&mut app,&ctx,"Catholic");
        eprintln!("Observed native books after Catholic → Protestant → Catholic: {:?}",app.search_request().books);
        assert!(app.search_request().books.is_empty(),"Web prunes Sirach when leaving its canon; it must not silently reactivate");
    }
    #[test]
    fn audit_online_failure_recovers_to_local_keywords() {
        let ctx=egui::Context::default();let mut app=Desktop::initialize(&ctx,None,library());
        app.dialog=Some(Dialog::Search);app.state.api_url="http://127.0.0.1:9".into();
        app.query="beginning".into();app.search(&ctx,None);ready(&mut app,&ctx);
        assert!(app.results.is_empty());assert!(app.message.contains("unreachable"),"{}",app.message);
        app.semantic=false;app.search_books=vec!["Genesis".into()];app.search(&ctx,None);ready(&mut app,&ctx);
        assert!(!app.results.is_empty(),"{}",app.message);
        assert!(app.results.iter().all(|r|r.reference.starts_with("Genesis ")));
        app.query="zxqvnonexistentword".into();app.search(&ctx,None);ready(&mut app,&ctx);
        assert!(app.results.is_empty());assert_eq!(app.message,"No passages found");
    }
    #[test]
    fn audit_keyword_author_scope_and_validation() {
        let ctx=egui::Context::default();let mut app=Desktop::initialize(&ctx,None,library());
        app.dialog=Some(Dialog::Search);app.semantic=false;
        for query in ["  ab  ".to_owned(),"a".repeat(501)] {
            app.query=query;app.search(&ctx,None);assert!(!app.busy);
            assert!(app.message.contains("between 3 and 500"));
        }
        app.query="Rome".into();app.search_corpus=Some(Corpus::EarlyChristian);
        app.search_authors=vec!["Clement of Rome".into()];app.search(&ctx,None);ready(&mut app,&ctx);
        assert!(!app.results.is_empty());assert!(app.results.iter().all(|r|
            app.library.passage(&r.id).unwrap().author.as_deref()==Some("Clement of Rome")));
        eprintln!("Offline Clement / Rome results: {}",app.results.len());
    }
    #[test]
    fn audit_desktop_search_shows_a_result_without_scrolling() {
        let ctx=egui::Context::default();let library=library();
        let mut app=Desktop::initialize(&ctx,None,library.clone());
        app.dialog=Some(Dialog::Search);app.query="More money More Problems".into();
        app.results=library.passages.iter().take(10).map(|p|ResultPassage::local(p,0.6)).collect();
        app.message="10 passages".into();
        let reference=app.results[0].reference.to_uppercase();
        let mut visible=false;
        for _ in 0..5 {
            let output=ctx.run(egui::RawInput {
                screen_rect:Some(Rect::from_min_size(egui::Pos2::ZERO,egui::vec2(1000.0,900.0))),
                ..Default::default()
            },|ctx|app.render(ctx));
            visible=output.shapes.iter().any(|shape| {
                if let egui::epaint::Shape::Text(text)=&shape.shape {
                    text.galley.job.text==reference && shape.clip_rect.intersects(
                        Rect::from_min_size(text.pos,text.galley.size()))
                } else {false}
            });
        }
        eprintln!("Desktop first result reference visible before scrolling: {visible}");
        assert!(visible,"Web displays its first result beneath the form at 1000 × 900; native must not consume all remaining height for the action row");
    }
}
