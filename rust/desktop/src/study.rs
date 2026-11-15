//! Offline study items share the web protocol and stable Reader Location anchors.
use super::*;
use std::io::Read;
use std::{
    cell::OnceCell,
    collections::{BTreeMap, HashMap},
    sync::LazyLock,
};

type Profile = BTreeMap<String, Entry>;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Item {
    pub id: String,
    pub kind: String,
    pub location: Option<account::Location>,
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
pub(super) struct Record {
    pub item: Item,
    pub revision: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct Entry {
    pub item: Item,
    pub revision: u64,
    pub dirty: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<Record>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alternatives: Vec<Record>,
}
#[derive(Default, Clone, Serialize, Deserialize)]
pub(super) struct Saved {
    profiles: BTreeMap<String, Profile>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    user_id: String,
    records: Vec<Record>,
}
struct Output {
    records: Vec<Record>,
    uploaded: BTreeMap<String, Item>,
}

pub(super) struct Study {
    saved: Saved,
    revision: u64,
    serialized: OnceCell<String>,
    marks: OnceCell<(String, HashMap<account::Location, String>)>,
    #[cfg(test)]
    serializations: std::cell::Cell<usize>,
    pub owner: String,
    pub status: String,
    pub editing: Option<Item>,
    focus_note: bool,
    pub anchor: Option<account::Location>,
    pub query: String,
    preview: bool,
    last_request: Instant,
    busy: bool,
    foreground_generation: u64,
    storage: Option<persistence::ReaderStorage>,
    pending_persist: bool,
    storage_error: Option<String>,
    tx: Sender<(String, Result<Output>)>,
    rx: Receiver<(String, Result<Output>)>,
}
impl Study {
    pub fn new(saved: Saved) -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            saved,
            revision: 0,
            serialized: OnceCell::new(),
            marks: OnceCell::new(),
            #[cfg(test)]
            serializations: std::cell::Cell::new(0),
            owner: "guest".into(),
            status: "Saved on this device".into(),
            editing: None,
            focus_note: false,
            anchor: None,
            query: String::new(),
            preview: false,
            last_request: Instant::now() - Duration::from_secs(30),
            busy: false,
            foreground_generation: 0,
            storage: None,
            pending_persist: false,
            storage_error: None,
            tx,
            rx,
        }
    }
    pub fn attach_storage(&mut self, path: PathBuf) -> Result<()> {
        let storage = persistence::ReaderStorage::open(path)?;
        if let Some(saved) = eframe::get_value(&storage, "study") {
            self.saved = saved;
        }
        self.storage = Some(storage);
        self.changed();
        self.checkpoint();
        Ok(())
    }
    pub fn checkpoint(&mut self) {
        if !self.pending_persist {
            return;
        }
        let mut storage = self.storage.take();
        if let Some(storage) = storage.as_mut() {
            self.save(storage);
            eframe::Storage::flush(storage);
            if storage.needs_retry() {
                self.storage_error = Some(
                    "Could not save study on this device. Free some storage and keep the app open."
                        .into(),
                );
            } else {
                self.pending_persist = false;
                self.storage_error = None;
            }
        }
        self.storage = storage;
    }
    fn changed(&mut self) {
        self.pending_persist = true;
        self.revision += 1;
        self.serialized.take();
        self.marks.take();
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn save(&self, storage: &mut dyn eframe::Storage) {
        let value = self.serialized.get_or_init(|| {
            #[cfg(test)]
            self.serializations.set(self.serializations.get() + 1);
            // Saved contains only protocol structs, strings and integers.
            ron::ser::to_string(&self.saved).expect("Serialize study checkpoint")
        });
        storage.set_string("study", value.clone());
    }
    pub fn put_edit(&mut self, item: Item, base: &Item) {
        let previous = self.profile().get(&item.id).cloned();
        self.put(item.clone());
        if let Some(previous) = previous {
            if previous.item != *base {
                let entry = self
                    .saved
                    .profiles
                    .get_mut(&self.owner)
                    .unwrap()
                    .get_mut(&item.id)
                    .unwrap();
                if let Some(conflict) = &entry.conflict {
                    if conflict.item != previous.item
                        && !entry.alternatives.iter().any(|v| v.item == previous.item)
                    {
                        entry.alternatives.push(Record {
                            item: previous.item,
                            revision: previous.revision,
                        });
                    }
                } else {
                    entry.conflict = Some(Record {
                        item: previous.item,
                        revision: previous.revision,
                    });
                }
            }
        }
    }
    pub fn profile(&self) -> &Profile {
        static EMPTY: LazyLock<Profile> = LazyLock::new(Profile::new);
        self.saved.profiles.get(&self.owner).unwrap_or(&EMPTY)
    }
    pub fn put(&mut self, item: Item) {
        self.changed();
        let profile = self.saved.profiles.entry(self.owner.clone()).or_default();
        let entry = profile.entry(item.id.clone()).or_insert_with(|| Entry {
            item: item.clone(),
            revision: 0,
            dirty: true,
            conflict: None,
            alternatives: vec![],
        });
        entry.item = item;
        entry.dirty = true;
        self.status = if self.owner == "guest" {
            "Saved on this device"
        } else {
            "Saved on this device · waiting to sync"
        }
        .into();
    }
    pub fn create(&mut self, kind: &str, passage: Option<&Passage>, original: bool) -> Result<()> {
        let mut bytes = [0u8; 16];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
        let item = Item {
            id: bytes.iter().map(|b| format!("{b:02x}")).collect(),
            kind: kind.into(),
            location: passage.map(account::Location::from_passage),
            reference: passage
                .map(|p| p.reference.chars().take(500).collect())
                .unwrap_or_default(),
            quote: passage
                .map(|p| p.reader_text(original).chars().take(2000).collect())
                .unwrap_or_default(),
            title: if kind == "notebook" {
                "New notebook".into()
            } else {
                String::new()
            },
            body: String::new(),
            color: "yellow".into(),
            notebook_id: None,
            deleted: false,
            created_at: Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_millis() as i64,
            ),
        };
        self.put(item.clone());
        self.focus_note = kind == "note";
        self.preview = false;
        self.editing = Some(item);
        Ok(())
    }
    pub fn resolve(&mut self, id: &str, local: bool) {
        self.changed();
        if let Some(entry) = self
            .saved
            .profiles
            .entry(self.owner.clone())
            .or_default()
            .get_mut(id)
        {
            if let Some(remote) = entry.conflict.take() {
                if !local {
                    entry.item = remote.item;
                }
                entry.revision = entry.revision.max(remote.revision);
                entry.dirty = true;
                entry.alternatives.clear();
            }
        }
    }
    pub fn resolve_alternative(&mut self, id: &str, index: usize) {
        self.changed();
        if let Some(entry) = self
            .saved
            .profiles
            .entry(self.owner.clone())
            .or_default()
            .get_mut(id)
        {
            if let Some(chosen) = entry.alternatives.get(index) {
                entry.item = chosen.item.clone();
                entry.dirty = true;
                entry.conflict = None;
                entry.alternatives.clear();
            }
        }
    }
    pub fn import_guest(&mut self) {
        if self.owner == "guest" {
            return;
        }
        let guest = self
            .saved
            .profiles
            .get("guest")
            .cloned()
            .unwrap_or_default();
        for entry in guest.values().filter(|e| !e.item.deleted) {
            let mut item = entry.item.clone();
            item.id = format!("guest_{}", item.id);
            item.notebook_id = item.notebook_id.map(|id| format!("guest_{id}"));
            if !self.profile().contains_key(&item.id) {
                self.put(item);
            }
        }
    }
    pub fn item_at(&self, kind: &str, passage: &Passage) -> Option<&Item> {
        let location = account::Location::from_passage(passage);
        self.saved
            .profiles
            .get(&self.owner)?
            .values()
            .map(|entry| &entry.item)
            .find(|item| {
                !item.deleted && item.kind == kind && item.location.as_ref() == Some(&location)
            })
    }
    /// Notes open the passage timeline; highlights remain a single optional mark.
    pub fn direct_action(&mut self, kind: &str, passage: &Passage, original: bool) -> Result<bool> {
        self.anchor = Some(account::Location::from_passage(passage));
        self.preview = false;
        if self.item_at(kind, passage).is_some() {
            self.editing = None;
            return Ok(true);
        }
        self.create(kind, Some(passage), original)?;
        let edit = kind == "note";
        if !edit {
            self.editing = None;
        }
        Ok(edit)
    }
    pub(super) fn finish_note(&mut self) {
        if let Some(item) = self.editing.take() {
            if item.kind == "note"
                && item.body.trim().is_empty()
                && item.title.trim().is_empty()
                && !self
                    .profile()
                    .get(&item.id)
                    .is_some_and(|e| e.conflict.is_some())
            {
                self.put(Item {
                    deleted: true,
                    ..item
                });
            }
        }
        self.preview = false;
    }
    pub fn storage_error(&self) -> Option<&str> {
        self.storage_error.as_deref()
    }
    pub fn marks(&mut self, passage: &Passage) -> Option<String> {
        let location = account::Location::from_passage(passage);
        // Owner is checked as well as mutation invalidation: account changes
        // must never display another profile's marks. Keep BTreeMap's first-ID
        // precedence when duplicate highlights await conflict resolution.
        if self
            .marks
            .get()
            .is_some_and(|(owner, _)| owner != &self.owner)
        {
            self.marks.take();
        }
        let (_, index) = self.marks.get_or_init(|| {
            let mut index = HashMap::new();
            for entry in self.profile().values() {
                let item = &entry.item;
                if !item.deleted && item.kind == "highlight" {
                    if let Some(location) = &item.location {
                        index
                            .entry(location.clone())
                            .or_insert_with(|| item.color.clone());
                    }
                }
            }
            (self.owner.clone(), index)
        });
        index.get(&location).cloned()
    }
    pub fn tick(
        &mut self,
        ctx: &egui::Context,
        owner: String,
        credentials: Option<(String, String, String)>,
    ) -> bool {
        let mut changed = false;
        let generation = mobile::activity(ctx).generation;
        if generation != self.foreground_generation {
            self.foreground_generation = generation;
            self.last_request = Instant::now() - Duration::from_secs(30);
        }
        if owner != self.owner {
            self.marks.take();
            self.owner = owner;
            self.editing = None;
            self.anchor = None;
            self.preview = false;
            self.query.clear();
            self.last_request = Instant::now() - Duration::from_secs(30);
            self.status = "Saved on this device".into();
        }
        while let Ok((owner, result)) = self.rx.try_recv() {
            self.busy = false;
            // An old request can update its own profile, never the newly active one.
            match result {
                Ok(output) => {
                    let profile = self.saved.profiles.entry(owner.clone()).or_default();
                    let mut merged = false;
                    for remote in output.records {
                        let local = profile.get(&remote.item.id).cloned();
                        let sent = output.uploaded.get(&remote.item.id);
                        let id = remote.item.id.clone();
                        let entry = reconcile(local, remote, sent);
                        if profile.get(&id) != Some(&entry) {
                            profile.insert(id, entry);
                            merged = true;
                        }
                    }
                    if owner == self.owner {
                        self.status = if profile.values().any(|e| e.conflict.is_some()) {
                            "Choose which version to keep"
                        } else if profile.values().any(|e| e.dirty) {
                            "Saved here · waiting to sync"
                        } else {
                            "Study is synced"
                        }
                        .into();
                    }
                    if merged {
                        self.changed();
                        changed = true;
                    }
                }
                Err(error) => {
                    if owner == self.owner {
                        self.status = if error.downcast_ref::<reqwest::Error>().and_then(|e| e.status()).is_some_and(|status| status.is_client_error()) {
                            "Study sync needs attention. Your changes stay saved here; check sign-in or edit the item and retry."
                        } else { "Saved here · waiting to reconnect" }.into();
                    }
                }
            }
        }
        if let Some((user, token, origin)) = credentials {
            if self.owner == format!("user:{user}")
                && !self.pending_persist
                && !self.busy
                && self.last_request.elapsed() > Duration::from_secs(5)
            {
                let owner = self.owner.clone();
                let snapshot = self.profile().clone();
                let tx = self.tx.clone();
                let ctx = ctx.clone();
                self.busy = true;
                self.last_request = Instant::now();
                std::thread::spawn(move || {
                    let result = synchronize(&origin, &token, &user, snapshot);
                    let _ = tx.send((owner, result));
                    ctx.request_repaint();
                });
            }
            // Credentials arrive only with a validated account refresh. That
            // refresh drives retries; the worker wakes the UI on completion.
        }
        changed
    }
}
fn reconcile(local: Option<Entry>, remote: Record, sent: Option<&Item>) -> Entry {
    let Some(mut local) = local else {
        return Entry {
            item: remote.item,
            revision: remote.revision,
            dirty: false,
            conflict: None,
            alternatives: vec![],
        };
    };
    if remote.revision < local.revision {
        return local;
    }
    if (!local.dirty && local.conflict.is_none()) || local.item == remote.item {
        if local.conflict.is_some() {
            local.revision = remote.revision;
            return local;
        }
        return Entry {
            item: remote.item,
            revision: remote.revision,
            dirty: false,
            conflict: None,
            alternatives: vec![],
        };
    }
    if sent == Some(&remote.item) {
        local.revision = remote.revision;
    } else if local.revision != remote.revision {
        local.revision = remote.revision;
        if let Some(conflict) = &local.conflict {
            if conflict.item != remote.item
                && !local.alternatives.iter().any(|v| v.item == remote.item)
            {
                local.alternatives.push(remote);
            }
        } else {
            local.conflict = Some(remote);
        }
    }
    local
}

fn synchronize(origin: &str, token: &str, user: &str, snapshot: Profile) -> Result<Output> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()?;
    let response: Response = client
        .get(format!("{origin}/api/study"))
        .bearer_auth(token)
        .send()?
        .error_for_status()?
        .json()?;
    anyhow::ensure!(
        response.user_id == user,
        "Account changed before study sync"
    );
    let mut records: BTreeMap<String, Record> = response
        .records
        .into_iter()
        .map(|r| (r.item.id.clone(), r))
        .collect();
    let mut uploaded = BTreeMap::new();
    for entry in snapshot.values() {
        let remote = records.get(&entry.item.id);
        if !entry.dirty
            || entry.conflict.is_some()
            || remote.is_some_and(|r| r.item == entry.item)
            || remote.map_or(0, |r| r.revision) != entry.revision
        {
            continue;
        }
        let response = client.post(format!("{origin}/api/study")).bearer_auth(token)
            .json(&serde_json::json!({"userId": user, "item": entry.item, "revision": entry.revision})).send()?;
        let conflict = response.status() == reqwest::StatusCode::CONFLICT;
        let response = if conflict {
            response
        } else {
            response.error_for_status()?
        };
        #[derive(Deserialize)]
        struct Write {
            saved: bool,
            record: Option<Record>,
        }
        let result: Write = response.json()?;
        if let Some(record) = result.record {
            if result.saved {
                uploaded.insert(entry.item.id.clone(), entry.item.clone());
            }
            records.insert(entry.item.id.clone(), record);
        }
    }
    Ok(Output {
        records: records.into_values().collect(),
        uploaded,
    })
}

fn note_date(item: &Item) -> String {
    item.created_at
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis)
        .map(|date| date.format("%b %-d, %Y · %H:%M UTC").to_string())
        .unwrap_or_else(|| "Earlier note".into())
}
fn render_note(ui: &mut egui::Ui, body: &str, theme: Theme) {
    note_markdown::show(ui, body, theme);
}
fn insert_markdown(
    ctx: &egui::Context,
    id: egui::Id,
    body: &mut String,
    before: &str,
    after: &str,
    placeholder: &str,
) {
    let mut state = egui::TextEdit::load_state(ctx, id).unwrap_or_default();
    let range = state
        .cursor
        .char_range()
        .map(|r| {
            let [a, b] = r.sorted();
            a.index..b.index
        })
        .unwrap_or(body.chars().count()..body.chars().count());
    let chars: Vec<char> = body.chars().collect();
    let start = range.start.min(chars.len());
    let end = range.end.min(chars.len());
    let selected: String = if start == end {
        placeholder.into()
    } else {
        chars[start..end].iter().collect()
    };
    let next = format!(
        "{}{}{}{}{}",
        chars[..start].iter().collect::<String>(),
        before,
        selected,
        after,
        chars[end..].iter().collect::<String>()
    );
    if next.chars().count() > 8000 {
        return;
    }
    *body = next;
    let first = start + before.chars().count();
    state
        .cursor
        .set_char_range(Some(egui::text::CCursorRange::two(
            egui::text::CCursor::new(first),
            egui::text::CCursor::new(first + selected.chars().count()),
        )));
    state.store(ctx, id);
}

impl Desktop {
    pub(super) fn study_dialog(&mut self, ui: &mut egui::Ui, suppress_click: bool) {
        if let Some(error) = &self.study.storage_error {
            ui.colored_label(egui::Color32::DARK_RED, error);
        }
        if let Some(mut item) = self.study.editing.clone() {
            let base = item.clone();
            let editor_id = ui.make_persistent_id(("study-note-editor", &item.id));
            let mut format = None;
            ui.horizontal_wrapped(|ui| {
                if !self.study.preview {
                    for (label, before, after, placeholder) in [
                        ("B", "**", "**", "text"),
                        ("Italic", "*", "*", "text"),
                        ("H", "\n## ", "", "Heading"),
                        ("List", "\n- ", "", "List item"),
                        ("Quote", "\n> ", "", "Quote"),
                    ] {
                        let response = ui.add_sized([44.0, 44.0], egui::Button::new(label));
                        response.widget_info(|| {
                            egui::WidgetInfo::labeled(
                                egui::WidgetType::Button,
                                ui.is_enabled(),
                                match label {
                                    "B" => "Bold",
                                    "H" => "Heading",
                                    _ => label,
                                },
                            )
                        });
                        if response.clicked() && !suppress_click {
                            format = Some((before, after, placeholder));
                        }
                    }
                }
                if ui
                    .button(if self.study.preview {
                        "Write"
                    } else {
                        "Preview"
                    })
                    .clicked()
                    && !suppress_click
                {
                    self.study.preview = !self.study.preview;
                }
            });
            ui.separator();
            if ui.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::B)) {
                format = Some(("**", "**", "text"));
            }
            if ui.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::I)) {
                format = Some(("*", "*", "text"));
            }
            if let Some((before, after, placeholder)) = format {
                insert_markdown(
                    ui.ctx(),
                    editor_id,
                    &mut item.body,
                    before,
                    after,
                    placeholder,
                );
                self.study.focus_note = true;
            }
            ui.add_space(10.0);
            if self.study.preview {
                render_note(ui, &item.body, self.state.theme);
                ui.add_space(20.0);
            } else {
                let theme = self.state.theme;
                let mut layouter = |ui: &egui::Ui, source: &str, width: f32| {
                    note_markdown::editor_layout(ui, source, width, theme)
                };
                let writing_height = (ui.clip_rect().bottom() - ui.cursor().top() - 4.0).max(66.0);
                let response = ui.add(
                    egui::TextEdit::multiline(&mut item.body)
                        .id(editor_id)
                        .layouter(&mut layouter)
                        .hint_text("What do you notice about this passage?")
                        .font(egui::FontId::proportional(17.0))
                        .frame(false)
                        .char_limit(8000)
                        .desired_rows(3)
                        .min_size(egui::vec2(0.0, writing_height))
                        .desired_width(f32::INFINITY),
                );
                response.widget_info(|| {
                    egui::WidgetInfo::labeled(
                        egui::WidgetType::TextEdit,
                        ui.is_enabled(),
                        "Passage note",
                    )
                });
                if std::mem::take(&mut self.study.focus_note) {
                    response.request_focus();
                }
            }
            if item != base {
                self.study.put_edit(item.clone(), &base);
                self.study.editing = Some(item.clone());
                self.account.persist_now = true;
            }
            return;
        }
        // The timeline performs mutations while iterating; the editor and all
        // read-only lookup helpers can borrow without copying an entire profile.
        let profile = self.study.profile().clone();
        if self.study.anchor.is_none() {
            ui.add_space(8.0);
            ui.add(
                egui::TextEdit::singleline(&mut self.study.query)
                    .hint_text("Find a passage or note…")
                    .desired_width(f32::INFINITY),
            );
        }
        let mut groups: Vec<(account::Location, Vec<&Entry>)> = Vec::new();
        for entry in profile.values() {
            if (entry.item.deleted && entry.conflict.is_none()) || entry.item.kind == "notebook" {
                continue;
            }
            let Some(location) = &entry.item.location else {
                continue;
            };
            if self.study.anchor.as_ref().is_some_and(|a| a != location) {
                continue;
            }
            if let Some((_, entries)) = groups.iter_mut().find(|(a, _)| a == location) {
                entries.push(entry);
            } else {
                groups.push((location.clone(), vec![entry]));
            }
        }
        if let Some(anchor) = &self.study.anchor {
            if groups.is_empty() {
                groups.push((anchor.clone(), vec![]));
            }
        }
        groups.sort_by_key(|(_, entries)| {
            std::cmp::Reverse(
                entries
                    .iter()
                    .filter_map(|e| e.item.created_at)
                    .max()
                    .unwrap_or(0),
            )
        });
        let mut count = 0;
        for (location, entries) in groups {
            let passage = location
                .passage(&self.library)
                .and_then(|id| self.library.passage(&id))
                .map(|p| {
                    self.reading_text
                        .passage(p, self.state.scripture_translation)
                })
                .cloned();
            let reference = passage
                .as_ref()
                .map(|p| p.reference.clone())
                .unwrap_or_else(|| {
                    entries
                        .first()
                        .map(|e| e.item.reference.clone())
                        .unwrap_or_default()
                });
            let query = self.study.query.to_lowercase();
            if self.study.anchor.is_none()
                && !format!(
                    "{} {}",
                    reference,
                    entries
                        .iter()
                        .map(|e| format!("{} {}", e.item.title, e.item.body))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
                .to_lowercase()
                .contains(&query)
            {
                continue;
            }
            count += 1;
            ui.push_id(format!("study-group-{}", count), |ui| {
                ui.add_space(14.0);
                if self.study.anchor.is_none() {
                    ui.label(RichText::new(&reference).font(heading(23.0)));
                }
                let quote = passage
                    .as_ref()
                    .map(|p| p.reader_text(self.state.original).to_string())
                    .unwrap_or_else(|| {
                        entries
                            .first()
                            .map(|e| e.item.quote.clone())
                            .unwrap_or_default()
                    });
                ui.collapsing("Passage text", |ui| {
                    ui.label(quote);
                });
                ui.add_space(8.0);
                if let Some(passage) = &passage {
                    let mark = entries
                        .iter()
                        .find(|e| e.item.kind == "highlight" && !e.item.deleted);
                    let mut chosen = None;
                    let mut add_note = false;
                    ui.horizontal_wrapped(|ui| {
                        if !Self::compact(ui.ctx()) {
                            ui.label(RichText::new("Highlight").small().weak());
                        }
                        for (name, color) in [
                            ("None", None),
                            ("Yellow", Some("yellow")),
                            ("Green", Some("green")),
                            ("Blue", Some("blue")),
                        ] {
                            let active = mark.map(|e| e.item.color.as_str()) == color;
                            let fill = match color {
                                Some("yellow") => egui::Color32::from_rgb(210, 183, 80),
                                Some("green") => egui::Color32::from_rgb(135, 165, 115),
                                Some("blue") => egui::Color32::from_rgb(130, 171, 199),
                                _ => ui.visuals().text_color(),
                            };
                            let (rect, response) = ui
                                .allocate_exact_size(egui::vec2(44.0, 44.0), egui::Sense::click());
                            response.widget_info(|| {
                                egui::WidgetInfo::selected(
                                    egui::WidgetType::Button,
                                    ui.is_enabled(),
                                    active,
                                    format!("{name} highlight"),
                                )
                            });
                            if color.is_some() {
                                ui.painter().circle_filled(rect.center(), 9.0, fill);
                            } else {
                                let center = rect.center();
                                let stroke = Stroke::new(1.5_f32, fill);
                                ui.painter().line_segment(
                                    [
                                        center + egui::vec2(-3.0, -3.0),
                                        center + egui::vec2(3.0, 3.0),
                                    ],
                                    stroke,
                                );
                                ui.painter().line_segment(
                                    [
                                        center + egui::vec2(-3.0, 3.0),
                                        center + egui::vec2(3.0, -3.0),
                                    ],
                                    stroke,
                                );
                            }
                            if active {
                                ui.painter().circle_stroke(
                                    rect.center(),
                                    13.0,
                                    Stroke::new(1.0_f32, ui.visuals().selection.stroke.color),
                                );
                            }
                            if response
                                .on_hover_text(format!("{name} highlight"))
                                .clicked()
                                && !suppress_click
                            {
                                chosen = Some(color);
                            }
                        }
                        add_note = ui.button("+ Add note").clicked() && !suppress_click;
                    });
                    if let Some(color) = chosen {
                        if let Some(color) = color {
                            let mut item = if let Some(mark) = mark {
                                mark.item.clone()
                            } else {
                                if let Err(error) = self.study.create(
                                    "highlight",
                                    Some(passage),
                                    self.state.original,
                                ) {
                                    self.study.status = error.to_string();
                                    return;
                                }
                                let Some(item) = self.study.editing.take() else {
                                    return;
                                };
                                item
                            };
                            item.color = color.into();
                            self.study.put(item);
                        }
                        for duplicate in entries
                            .iter()
                            .filter(|e| e.item.kind == "highlight" && !e.item.deleted)
                            .skip(if color.is_some() { 1 } else { 0 })
                        {
                            if duplicate.conflict.is_none() {
                                self.study.put(Item {
                                    deleted: true,
                                    ..duplicate.item.clone()
                                });
                            }
                        }
                        self.account.persist_now = true;
                    }
                    if add_note {
                        if let Err(error) =
                            self.study
                                .create("note", Some(passage), self.state.original)
                        {
                            self.study.status = error.to_string();
                        }
                        self.account.persist_now = true;
                    }
                }
                let mut notes: Vec<_> = entries
                    .iter()
                    .filter(|e| e.item.kind == "note" && !e.item.deleted)
                    .collect();
                notes.sort_by_key(|e| std::cmp::Reverse(e.item.created_at.unwrap_or(0)));
                if notes.is_empty() {
                    ui.add_space(12.0);
                    ui.label(
                        RichText::new("A thought, a question, a connection. Keep a note here.")
                            .weak(),
                    );
                }
                for entry in notes {
                    let item = &entry.item;
                    ui.push_id(&item.id, |ui| {
                        ui.add_space(18.0);
                        ui.separator();
                        ui.add_space(8.0);
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(note_date(item)).small().weak());
                            if ui.button("Edit").clicked() && !suppress_click {
                                self.study.editing = Some(item.clone());
                                self.study.preview = false;
                                self.study.focus_note = true;
                            }
                        });
                        if !item.title.is_empty() {
                            ui.label(RichText::new(&item.title).font(heading(20.0)));
                        }
                        render_note(ui, &item.body, self.state.theme);
                    });
                }
                if self.study.anchor.is_none()
                    && ui.button("Read passage").clicked()
                    && !suppress_click
                {
                    if let Some(id) = location.passage(&self.library) {
                        self.open(id);
                        self.dialog = None;
                    }
                }
                for entry in &entries {
                    if entry.item.kind == "bookmark" && !entry.item.deleted {
                        ui.horizontal_wrapped(|ui| {
                            ui.label(if entry.item.title.is_empty() {
                                "Saved passage"
                            } else {
                                &entry.item.title
                            });
                            if ui.button("Remove bookmark").clicked() && !suppress_click {
                                self.study.put(Item {
                                    deleted: true,
                                    ..entry.item.clone()
                                });
                                self.account.persist_now = true;
                            }
                        });
                    }
                }
            });
            for entry in entries {
                self.study_conflict(ui, entry, suppress_click);
            }
        }
        if count == 0 {
            ui.add_space(24.0);
            ui.label("Your notes and highlights will appear here. Select a passage to begin.");
        }
        if self.study.anchor.is_none() {
            ui.add_space(20.0);
            ui.collapsing("Sync options", |ui| {
                if self.study.owner != "guest"
                    && ui.button("Copy guest study into account").clicked()
                    && !suppress_click
                {
                    self.study.import_guest();
                    self.account.persist_now = true;
                }
                for entry in profile.values().filter(|e| e.item.kind == "notebook") {
                    self.study_conflict(ui, entry, suppress_click);
                }
            });
        }
        self.study_status(ui);
    }
    pub(super) fn study_editor_footer(&mut self, ui: &mut egui::Ui) {
        let Some(item) = self.study.editing.clone() else {
            return;
        };
        ui.separator();
        let delete_width = ui.fonts(|fonts| {
            fonts
                .layout_no_wrap(
                    "Delete note".into(),
                    egui::TextStyle::Button.resolve(ui.style()),
                    self.state.theme.palette().ink,
                )
                .size()
                .x
        }) + ui.spacing().button_padding.x * 2.0;
        let meta_width =
            (ui.available_width() - delete_width - ui.spacing().item_spacing.x).max(60.0);
        let mut remove = false;
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.set_width(meta_width);
                ui.add(
                    egui::Label::new(RichText::new(&self.study.status).small().weak()).truncate(),
                )
                .on_hover_text(&self.study.status);
                let date = note_date(&item);
                ui.add(egui::Label::new(RichText::new(&date).small().weak()).truncate())
                    .on_hover_text(date);
            });
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                remove = control(ui, "Delete note").clicked();
            });
        });
        if remove {
            self.study.put_edit(
                Item {
                    deleted: true,
                    ..item.clone()
                },
                &item,
            );
            self.study.editing = None;
            self.account.persist_now = true;
        }
    }
    fn study_status(&self, ui: &mut egui::Ui) {
        ui.add_space(16.0);
        ui.label(RichText::new(&self.study.status).small().weak());
    }
    fn study_conflict(&mut self, ui: &mut egui::Ui, entry: &Entry, suppress_click: bool) {
        if let Some(remote) = &entry.conflict {
            ui.label("Another device changed this item.");
            ui.label(if remote.item.deleted {
                "Deleted on that device".into()
            } else {
                format!("On that device: {} {}", remote.item.title, remote.item.body)
            });
            for (index, version) in entry.alternatives.iter().enumerate() {
                ui.label(format!(
                    "Additional version: {} {}",
                    version.item.title, version.item.body
                ));
                if ui.button("Keep this additional version").clicked() && !suppress_click {
                    self.study.resolve_alternative(&entry.item.id, index);
                    self.account.persist_now = true;
                }
            }
            for (local, label) in [
                (true, "Keep this device’s version"),
                (false, "Keep synced version"),
            ] {
                if ui.button(label).clicked() && !suppress_click {
                    self.study.resolve(&entry.item.id, local);
                    self.account.persist_now = true;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_markdown_uses_a_distinct_bold_font() {
        let ctx = egui::Context::default();
        theme::fonts(&ctx);
        Theme::Dark.apply(&ctx);
        let output = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                render_note(ui, "plain **exampletext**", Theme::Dark);
            });
        });
        let mut regular = None;
        let mut bold = None;
        for shape in output.shapes {
            if let egui::epaint::Shape::Text(text) = shape.shape {
                for section in &text.galley.job.sections {
                    let content = &text.galley.job.text[section.byte_range.clone()];
                    if content.contains("plain") {
                        regular = Some(section.format.font_id.clone());
                    }
                    if content.contains("exampletext") {
                        bold = Some(section.format.font_id.clone());
                    }
                }
            }
        }
        assert!(
            regular.is_some() && bold.is_some(),
            "Both text runs must render"
        );
        assert_ne!(
            regular, bold,
            "**exampletext** must use a visibly bold font"
        );
    }
    fn note() -> Item {
        serde_json::from_value(serde_json::json!({
            "id":"web-note-1", "kind":"note", "location":{"version":2,"corpus":"scripture","chapterKey":"John\t3","passageKey":"John:3:16"},
            "reference":"John 3:16", "quote":"For God so loved the world", "title":"Love", "body":"An observation", "color":"yellow", "notebookId":null, "deleted":false
        })).unwrap()
    }

    fn marked_passage(corpus: Corpus) -> Passage {
        Passage {
            id: "test-passage".into(),
            corpus,
            book_id: "test-book".into(),
            book: "Test".into(),
            chapter_id: "test-chapter".into(),
            chapter: 3,
            reference: "Test 3:16".into(),
            text: "Text".into(),
            original_text: "Text".into(),
            author: None,
            verse_start: 16,
            verse_end: 17,
            verses: vec![],
        }
    }

    #[test]
    fn indexed_marks_follow_edits_deletion_conflicts_import_and_late_sync() {
        let ctx = egui::Context::default();
        for corpus in [
            Corpus::Scripture,
            Corpus::EarlyChristian,
            Corpus::ChristianClassics,
        ] {
            let passage = marked_passage(corpus);
            let mut study = Study::new(Saved::default());
            assert_eq!(study.marks(&passage), None);
            let mut mark = Item {
                id: "a".into(),
                kind: "highlight".into(),
                location: Some(account::Location::from_passage(&passage)),
                ..note()
            };
            study.put(mark.clone());
            assert_eq!(study.marks(&passage).as_deref(), Some("yellow"));
            study.put(Item {
                id: "z".into(),
                color: "green".into(),
                ..mark.clone()
            });
            assert_eq!(
                study.marks(&passage).as_deref(),
                Some("yellow"),
                "Duplicate precedence must remain stable"
            );
            mark.color = "blue".into();
            study.put(mark.clone());
            assert_eq!(study.marks(&passage).as_deref(), Some("blue"));
            study.put(Item {
                deleted: true,
                ..mark.clone()
            });
            assert_eq!(study.marks(&passage).as_deref(), Some("green"));
            study.tick(&ctx, "user:alice".into(), None);
            assert_eq!(study.marks(&passage), None);
            study.import_guest();
            assert_eq!(study.marks(&passage).as_deref(), Some("green"));

            // A late response merges into its own inactive profile, and returning
            // to that profile must rebuild the mark index from the merged data.
            study
                .tx
                .send((
                    "guest".into(),
                    Ok(Output {
                        records: vec![Record {
                            item: mark.clone(),
                            revision: 2,
                        }],
                        uploaded: BTreeMap::new(),
                    }),
                ))
                .unwrap();
            study.tick(&ctx, "user:alice".into(), None);
            assert_eq!(study.marks(&passage).as_deref(), Some("green"));
            study.tick(&ctx, "guest".into(), None);
            assert_eq!(
                study.marks(&passage).as_deref(),
                Some("green"),
                "Unresolved cloud edits must not replace the local mark"
            );
            study.resolve("a", false);
            assert_eq!(study.marks(&passage).as_deref(), Some("blue"));
            study.tick(&ctx, "user:bob".into(), None);
            assert_eq!(
                study.marks(&passage),
                None,
                "Marks must remain account-specific"
            );
        }
    }

    #[test]
    fn study_serialization_is_shared_by_both_checkpoints_and_invalidated_by_sync() {
        let path =
            std::env::temp_dir().join(format!("crosscanon-study-cache-{}", std::process::id()));
        let mut primary = persistence::ReaderStorage::open(path.join("reader.ron")).unwrap();
        let mut study = Study::new(Saved::default());
        study.attach_storage(path.join("study.ron")).unwrap();
        study.put(note());
        study.checkpoint();
        study.save(&mut primary);
        let prepared = study.serializations.get();
        study.save(&mut primary);
        assert_eq!(
            study.serializations.get(),
            prepared,
            "Two storage consumers reuse the prepared study value"
        );
        let ctx = egui::Context::default();
        study
            .tx
            .send((
                "guest".into(),
                Ok(Output {
                    records: vec![Record {
                        item: Item {
                            body: "Remote edit".into(),
                            ..note()
                        },
                        revision: 2,
                    }],
                    uploaded: BTreeMap::new(),
                }),
            ))
            .unwrap();
        study.tick(&ctx, "guest".into(), None);
        study.checkpoint();
        study.save(&mut primary);
        assert_eq!(study.serializations.get(), prepared + 1);
        let saved: Saved = eframe::get_value(&primary, "study").unwrap();
        let remote = saved.profiles["guest"]["web-note-1"]
            .conflict
            .as_ref()
            .unwrap();
        assert_eq!(remote.item.body, "Remote edit");
        study.resolve("web-note-1", false);
        study.checkpoint();
        study.save(&mut primary);
        let saved: Saved = eframe::get_value(&primary, "study").unwrap();
        assert_eq!(
            saved.profiles["guest"]["web-note-1"].item.body,
            "Remote edit"
        );
        assert_eq!(study.serializations.get(), prepared + 2);
        let revision = study.revision();
        let output = || {
            Ok(Output {
                records: vec![Record {
                    item: Item {
                        body: "Remote edit".into(),
                        ..note()
                    },
                    revision: 2,
                }],
                uploaded: BTreeMap::new(),
            })
        };
        study.tx.send(("guest".into(), output())).unwrap();
        study.tick(&ctx, "guest".into(), None);
        study.checkpoint();
        let acknowledged = study.revision();
        assert!(
            acknowledged > revision,
            "An acknowledgement clearing dirty must be persisted"
        );
        study.tx.send(("guest".into(), output())).unwrap();
        study.tick(&ctx, "guest".into(), None);
        assert_eq!(
            study.revision(),
            acknowledged,
            "Identical clean sync responses must not invalidate the checkpoint"
        );
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn passage_actions_keep_one_highlight_and_allow_dated_notes() {
        let library =
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
        let passage = library
            .passage(&library.books[0].chapters[0].passage_ids[0])
            .unwrap();
        let mut study = Study::new(Saved::default());
        assert!(!study.direct_action("highlight", passage, false).unwrap());
        assert!(study.direct_action("highlight", passage, false).unwrap());
        assert!(study.editing.is_none());
        assert_eq!(
            study
                .profile()
                .values()
                .filter(|e| e.item.kind == "highlight")
                .count(),
            1
        );
        study.direct_action("note", passage, false).unwrap();
        let first = study.editing.as_ref().unwrap().clone();
        assert!(first.created_at.is_some());
        study.direct_action("note", passage, false).unwrap();
        assert!(study.editing.is_none());
        study.create("note", Some(passage), false).unwrap();
        assert_eq!(
            study
                .profile()
                .values()
                .filter(|e| e.item.kind == "note")
                .count(),
            2
        );
        study.finish_note();
        assert_eq!(
            study
                .profile()
                .values()
                .filter(|e| e.item.kind == "note" && !e.item.deleted)
                .count(),
            1
        );
    }

    #[test]
    fn markdown_toolbar_wraps_unicode_selection_without_changing_other_text() {
        let ctx = egui::Context::default();
        let id = egui::Id::new("note-editor");
        let mut state = egui::TextEdit::load_state(&ctx, id).unwrap_or_default();
        state
            .cursor
            .set_char_range(Some(egui::text::CCursorRange::two(
                egui::text::CCursor::new(2),
                egui::text::CCursor::new(3),
            )));
        state.store(&ctx, id);
        let mut body = "A 😀 thought".to_string();
        insert_markdown(&ctx, id, &mut body, "**", "**", "text");
        assert_eq!(body, "A **😀** thought");
        assert_eq!(note_date(&note()), "Earlier note");
        let mut dated = note();
        dated.created_at = Some(1_794_571_200_000);
        let restored: Item = serde_json::from_str(&serde_json::to_string(&dated).unwrap()).unwrap();
        assert_eq!(restored.created_at, dated.created_at);
    }

    #[test]
    fn web_records_roundtrip_and_inflight_edits_keep_their_queue() {
        let item = note();
        let sent = item.clone();
        let mut edited = item.clone();
        edited.body = "Typed during request".into();
        let entry = Entry {
            item: edited.clone(),
            revision: 0,
            dirty: true,
            conflict: None,
            alternatives: vec![],
        };
        let merged = reconcile(
            Some(entry),
            Record {
                item: sent.clone(),
                revision: 1,
            },
            Some(&sent),
        );
        assert_eq!(merged.item.body, edited.body);
        assert_eq!(merged.revision, 1);
        assert!(merged.dirty);
        assert!(merged.conflict.is_none());
        let mut deleted = item.clone();
        deleted.deleted = true;
        let conflicted = reconcile(
            Some(merged),
            Record {
                item: deleted,
                revision: 2,
            },
            None,
        );
        assert!(conflicted.conflict.unwrap().item.deleted);
        let value = serde_json::to_value(&item).unwrap();
        assert_eq!(value["location"]["passageKey"], "John:3:16");
        assert!(value.get("notebookId").is_some());
    }
    #[test]
    fn native_study_survives_checkpoint_and_profiles_are_isolated() {
        use eframe::{App, Storage};
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let path = std::env::temp_dir().join(format!(
            "crosscanon-study-{}.ron",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        app.reader_storage = Some(persistence::ReaderStorage::open(path.clone()).unwrap());
        app.study.put(note());
        app.dialog = Some(Dialog::Study);
        let _ = ctx.run(egui::RawInput::default(), |ctx| {
            app.update(ctx, &mut eframe::Frame::_new_kittest())
        });
        let stored = persistence::ReaderStorage::open(path.clone()).unwrap();
        assert!(stored.get_string("study").is_some());
        let restored = Desktop::initialize(&egui::Context::default(), Some(&stored), library);
        assert_eq!(
            restored.study.profile()["web-note-1"].item.body,
            "An observation"
        );
        app.study.owner = "user:alice".into();
        assert!(app.study.profile().is_empty());
        app.study.import_guest();
        assert!(app.study.profile().contains_key("guest_web-note-1"));
        app.study.import_guest();
        assert_eq!(app.study.profile().len(), 1);
        app.study.owner = "user:bob".into();
        assert!(app.study.profile().is_empty());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn stale_native_editor_preserves_remote_deletion_and_disk_failure_blocks_uploads() {
        let mut study = Study::new(Saved::default());
        let base = note();
        let mut deleted = base.clone();
        deleted.deleted = true;
        study
            .saved
            .profiles
            .entry("guest".into())
            .or_default()
            .insert(
                base.id.clone(),
                Entry {
                    item: deleted,
                    revision: 2,
                    dirty: false,
                    conflict: None,
                    alternatives: vec![],
                },
            );
        let mut edited = base.clone();
        edited.body = "Typed while remote changed".into();
        study.put_edit(edited, &base);
        assert!(
            study.profile()[&base.id]
                .conflict
                .as_ref()
                .unwrap()
                .item
                .deleted
        );
        let path = std::env::temp_dir().join(format!(
            "crosscanon-study-failure-{}.ron",
            std::process::id()
        ));
        study.attach_storage(path.clone()).unwrap();
        std::fs::create_dir(path.with_extension("ron.tmp")).unwrap();
        study.put(base);
        study.checkpoint();
        assert!(study.pending_persist);
        assert!(study.storage_error.is_some());
        std::fs::remove_dir(path.with_extension("ron.tmp")).unwrap();
        study.checkpoint();
        assert!(!study.pending_persist);
        assert!(study.storage_error.is_none());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn acknowledgements_keep_new_conflicts_and_ignore_old_revisions() {
        let a = note();
        let mut b = a.clone();
        b.body = "Competing draft".into();
        let mut c = a.clone();
        c.body = "Current draft".into();
        let entry = Entry {
            item: c,
            revision: 1,
            dirty: true,
            conflict: Some(Record {
                item: b.clone(),
                revision: 1,
            }),
            alternatives: vec![],
        };
        let merged = reconcile(
            Some(entry),
            Record {
                item: a.clone(),
                revision: 2,
            },
            Some(&a),
        );
        assert_eq!(merged.conflict.as_ref().unwrap().item, b);
        let stale = reconcile(
            Some(merged.clone()),
            Record {
                item: a,
                revision: 1,
            },
            None,
        );
        assert_eq!(stale.revision, 2);
        assert_eq!(stale.item, merged.item);
    }
    #[test]
    fn study_ui_fits_phone_and_desktop() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for (width, height) in [
            (320.0, 852.0),
            (393.0, 852.0),
            (1100.0, 852.0),
            (320.0, 480.0),
            (393.0, 480.0),
        ] {
            let ctx = egui::Context::default();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            app.dialog = Some(Dialog::Study);
            app.study.put(note());
            for editing in [false, true] {
                app.study.editing = editing.then(note);
                for frame in 0..3 {
                    let mut save = None;
                    let mut close = None;
                    let mut date = None;
                    let output = ctx.run(
                        egui::RawInput {
                            screen_rect: Some(Rect::from_min_size(
                                egui::Pos2::ZERO,
                                egui::vec2(width, height),
                            )),
                            ..Default::default()
                        },
                        |ctx| app.render(ctx),
                    );
                    for shape in output.shapes {
                        if let egui::epaint::Shape::Text(text) = shape.shape {
                            if editing {
                                let rect = Rect::from_min_size(text.pos, text.galley.size());
                                match text.galley.job.text.as_str() {
                                    "Save" => save = Some(rect),
                                    "×" => close = Some(rect),
                                    "Earlier note" => date = Some(rect),
                                    _ => {}
                                }
                            }
                            if [
                                "Saved on this device",
                                "Markdown supported · Saves as you write",
                                "Earlier note",
                            ]
                            .contains(&text.galley.job.text.as_str())
                            {
                                assert!(text.pos.x + text.galley.size().x <= width - 8.0);
                            }
                            assert!(!["All notebooks", "All study items", "New notebook"]
                                .contains(&text.galley.job.text.as_str()));
                        }
                    }
                    if editing && frame == 2 {
                        let (save, close, date) = (save.unwrap(), close.unwrap(), date.unwrap());
                        assert!(
                            (save.center().y - close.center().y).abs() < 1.0,
                            "Save and X must share the header row"
                        );
                        assert!(save.right() < close.left(), "Save belongs beside X");
                        assert!(
                            date.top() > height - 100.0 && date.bottom() < height,
                            "Date stays in the bottom footer: {date:?}"
                        );
                        assert!(date.left() < save.left(), "Date belongs at the bottom left");
                        for pressed in [true, false] {
                            let _ = ctx.run(
                                egui::RawInput {
                                    screen_rect: Some(Rect::from_min_size(
                                        egui::Pos2::ZERO,
                                        egui::vec2(width, height),
                                    )),
                                    events: vec![
                                        egui::Event::PointerMoved(save.center()),
                                        egui::Event::PointerButton {
                                            pos: save.center(),
                                            button: egui::PointerButton::Primary,
                                            pressed,
                                            modifiers: egui::Modifiers::NONE,
                                        },
                                    ],
                                    ..Default::default()
                                },
                                |ctx| app.render(ctx),
                            );
                        }
                        assert!(
                            app.study.editing.is_none(),
                            "The header Save action must finish editing"
                        );
                        assert_eq!(
                            app.study.profile()["web-note-1"].item.body,
                            "An observation"
                        );
                    }
                }
            }
        }
    }
}
