//! iOS can stop rendering or terminate without an exit callback. Keep its small
//! reader checkpoint synchronous and atomic, using the existing eframe format.
use super::*;
use std::collections::HashMap;
#[cfg(not(target_arch = "wasm32"))]
use std::{io::Write, path::Path};

pub(super) struct ReaderStorage {
    path: PathBuf,
    values: HashMap<String, String>,
    dirty: bool,
    reader: Option<ReaderState>,
    accounts: Option<account::Saved>,
    study_revision: Option<u64>,
    #[cfg(test)]
    pub(super) submissions: usize,
    #[cfg(test)]
    pub(super) writes: usize,
}

impl ReaderStorage {
    pub fn open(path: PathBuf) -> Result<Self> {
        #[cfg(not(target_arch = "wasm32"))]
        let values = match std::fs::read_to_string(&path) {
            Ok(contents) => ron::from_str(&contents).context("Read saved reader state")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error).context("Open saved reader state"),
        };
        #[cfg(target_arch = "wasm32")]
        let values = browser::storage_get(&path.to_string_lossy())?
            .map(|v| ron::from_str(&v))
            .transpose()?
            .unwrap_or_default();
        Ok(Self {
            path,
            values,
            dirty: false,
            reader: None,
            accounts: None,
            study_revision: None,
            #[cfg(test)]
            submissions: 0,
            #[cfg(test)]
            writes: 0,
        })
    }

    pub fn needs_retry(&self) -> bool {
        self.dirty
    }

    pub fn checkpoint(
        &mut self,
        reader: &ReaderState,
        accounts: &account::Saved,
        study: &study::Study,
    ) {
        if std::env::var_os("CROSS_CANON_FRESH").is_some() {
            return;
        }
        // Compare the small reader/account snapshots, whose mutation sites span
        // navigation, settings and cloud reconciliation. Never scan study text
        // here: all study mutations invalidate its revision inside Study.
        if self.reader.as_ref() != Some(reader) {
            eframe::set_value(self, "reader", reader);
            self.reader = Some(reader.clone());
        }
        if self.accounts.as_ref() != Some(accounts) {
            eframe::set_value(self, "accounts", accounts);
            self.accounts = Some(accounts.clone());
        }
        if self.study_revision != Some(study.revision()) {
            study.save(self);
            self.study_revision = Some(study.revision());
        }
        // Snapshots track prepared values, not durability. Failed atomic writes
        // leave dirty set and the complete latest values available for retry.
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn write(&mut self) -> Result<()> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(parent)?;
        let temporary = self.path.with_extension("ron.tmp");
        let contents = ron::ser::to_string(&self.values)?;
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        // A terminated write leaves the previous complete checkpoint intact.
        std::fs::rename(&temporary, &self.path)?;
        #[cfg(test)]
        {
            self.writes += 1;
        }
        self.dirty = false;
        Ok(())
    }
    #[cfg(target_arch = "wasm32")]
    fn write(&mut self) -> Result<()> {
        browser::storage_set(&self.path.to_string_lossy(), &ron::to_string(&self.values)?)?;
        self.dirty = false;
        Ok(())
    }
}

impl eframe::Storage for ReaderStorage {
    fn get_string(&self, key: &str) -> Option<String> {
        self.values.get(key).cloned()
    }

    fn set_string(&mut self, key: &str, value: String) {
        #[cfg(test)]
        {
            self.submissions += 1;
        }
        if self.values.get(key) != Some(&value) {
            self.values.insert(key.to_owned(), value);
            self.dirty = true;
        }
    }

    fn flush(&mut self) {
        if self.dirty {
            if let Err(error) = self.write() {
                eprintln!("Could not save reader state: {error:#}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use eframe::{App, Storage};

    fn checkpoint() -> PathBuf {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("crosscanon-reader-{}-{id}", std::process::id()))
            .join("reader.ron")
    }

    fn frame(app: &mut Desktop, ctx: &egui::Context, events: Vec<egui::Event>) {
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(393.0, 852.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| app.update(ctx, &mut eframe::Frame::_new_kittest()),
        );
    }

    #[test]
    fn changed_domains_retry_the_latest_checkpoint_without_repreparing_values() {
        let path = checkpoint();
        let mut storage = ReaderStorage::open(path.clone()).unwrap();
        let mut reader = ReaderState::default();
        let mut accounts = account::Saved::default();
        let study = study::Study::new(Default::default());
        storage.checkpoint(&reader, &accounts, &study);
        storage.flush();
        let initial = storage.submissions;
        storage.checkpoint(&reader, &accounts, &study);
        assert_eq!(storage.submissions, initial);
        reader.theme = Theme::Dark;
        reader.font_scale = 1.2;
        reader.scripture_translation = reading_translation::Translation::Msb;
        accounts.user = Some(account::User {
            id: "alice".into(),
            name: "Alice".into(),
            email: "test@example.com".into(),
        });
        std::fs::create_dir(path.with_extension("ron.tmp")).unwrap();
        storage.checkpoint(&reader, &accounts, &study);
        storage.flush();
        assert!(storage.needs_retry());
        reader.location_passage_id = "latest-passage".into();
        storage.checkpoint(&reader, &accounts, &study);
        storage.flush();
        assert!(storage.needs_retry());
        let prepared = storage.submissions;
        std::fs::remove_dir(path.with_extension("ron.tmp")).unwrap();
        storage.checkpoint(&reader, &accounts, &study);
        storage.flush();
        assert_eq!(
            storage.submissions, prepared,
            "Retry writes the retained values without serializing again"
        );
        assert!(!storage.needs_retry());
        let reopened = ReaderStorage::open(path.clone()).unwrap();
        assert!(eframe::get_value::<ReaderState>(&reopened, "reader").unwrap() == reader);
        assert!(eframe::get_value::<account::Saved>(&reopened, "accounts").unwrap() == accounts);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn reading_place_survives_termination_before_autosave() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let path = checkpoint();
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        app.reader_storage = Some(ReaderStorage::open(path.clone()).unwrap());
        for book in ["John", "anf09:xii.iv", "classics:imitation"] {
            let passages = &library.book(book).unwrap().chapters[2].passage_ids;
            let target = passages[1.min(passages.len() - 1)].clone();
            app.open(target.clone());
            frame(&mut app, &ctx, vec![]);
            // Reopen the disk checkpoint while the original app is still alive:
            // no timer, App::save, graceful shutdown, or storage Drop can help.
            let stored = ReaderStorage::open(path.clone()).unwrap();
            let restored_ctx = egui::Context::default();
            let mut restored = Desktop::initialize(&restored_ctx, Some(&stored), library.clone());
            assert_eq!(
                restored.state.location_passage_id, target,
                "Cold launch must resume the last Passage in {book}, before autosave"
            );
            assert_eq!(restored.scroll_target.as_deref(), Some(target.as_str()));
            assert_eq!(
                restored.active_chapter_id,
                library.passage(&target).unwrap().chapter_id
            );
            for _ in 0..3 {
                frame(&mut restored, &restored_ctx, vec![]);
            }
            assert_eq!(
                restored.state.location_passage_id, target,
                "Initial layout must keep the restored Passage in {book}"
            );
        }
        // Passive reading must save the visible Passage too, without a jump.
        app.open(library.book("John").unwrap().chapters[2].passage_ids[0].clone());
        frame(&mut app, &ctx, vec![]);
        let before = app.state.location_passage_id.clone();
        for _ in 0..6 {
            frame(
                &mut app,
                &ctx,
                vec![
                    egui::Event::PointerMoved(egui::pos2(180.0, 450.0)),
                    egui::Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: egui::vec2(0.0, -450.0),
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
        }
        assert_ne!(
            app.state.location_passage_id, before,
            "The reader must actually scroll to another Passage"
        );
        let stored = ReaderStorage::open(path.clone()).unwrap();
        let restored = Desktop::initialize(&egui::Context::default(), Some(&stored), library);
        assert_eq!(
            restored.state.location_passage_id,
            app.state.location_passage_id
        );
        assert_eq!(restored.state.fathers_location, app.state.fathers_location);
        assert_eq!(
            restored.state.classics_location,
            app.state.classics_location
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn existing_checkpoint_is_compatible_and_failed_writes_can_retry() {
        let path = checkpoint();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut original = crate::tests::MemoryStorage::default();
        let state = ReaderState {
            location_passage_id: "saved-passage".into(),
            ..Default::default()
        };
        eframe::set_value(&mut original, "reader", &state);
        std::fs::write(
            &path,
            ron::ser::to_string_pretty(
                &HashMap::from([("reader", original.get_string("reader").unwrap())]),
                Default::default(),
            )
            .unwrap(),
        )
        .unwrap();
        let mut stored = ReaderStorage::open(path.clone()).unwrap();
        assert_eq!(
            eframe::get_value::<ReaderState>(&stored, "reader")
                .unwrap()
                .location_passage_id,
            "saved-passage"
        );
        assert!(!stored.needs_retry());
        stored.set_string("reader", original.get_string("reader").unwrap());
        assert!(
            !stored.needs_retry(),
            "Unchanged frames must not write to disk"
        );
        // A stale/incomplete temporary file is ignored on startup and replaced.
        let temporary = path.with_extension("ron.tmp");
        std::fs::create_dir(&temporary).unwrap();
        stored.set_string("reader", "new state".into());
        stored.flush();
        assert!(stored.needs_retry());
        assert_eq!(
            ReaderStorage::open(path.clone())
                .unwrap()
                .get_string("reader"),
            original.get_string("reader")
        );
        std::fs::remove_dir(&temporary).unwrap();
        std::fs::write(&temporary, "incomplete").unwrap();
        stored.flush();
        assert!(!stored.needs_retry());
        assert_eq!(
            ReaderStorage::open(path.clone())
                .unwrap()
                .get_string("reader")
                .as_deref(),
            Some("new state")
        );
        assert!(!temporary.exists());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
