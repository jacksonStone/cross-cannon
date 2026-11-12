//! Verse-index lookup uses local source coverage, independently of online search.
use super::*;

pub(super) struct Note {
    pub passage_id: String,
    pub reference: String,
    pub text: String,
}

pub(super) struct Work {
    pub title: String,
    pub author: String,
    pub notes: Vec<Note>,
}

pub(super) struct Selection {
    reference: String,
    text: String,
    pub works: Vec<Work>,
    active_work: usize,
}

impl Desktop {
    pub(super) fn show_commentaries(&mut self, passage: &Passage) {
        self.commentary = Some(Selection {
            reference: passage.reference.clone(),
            text: passage.text.clone(),
            works: self.catalog.commentaries(&self.library, passage),
            active_work: 0,
        });
        self.dialog = Some(Dialog::Commentary);
    }

    pub(super) fn commentary_dialog(&mut self, ui: &mut egui::Ui, suppress_click: bool) {
        let Some(selection) = &mut self.commentary else {
            return;
        };
        let p = self.state.theme.palette();
        ui.label(RichText::new(&selection.reference).font(heading(22.0)));
        ui.label(RichText::new(&selection.text).font(serif(18.0)));
        ui.add_space(12.0);
        ui.label(RichText::new("Commentary indexed to these verses").color(p.muted));
        if selection.works.is_empty() {
            ui.add_space(12.0);
            ui.label("No commentary indexed to these verses is included in the collection yet.");
            return;
        }
        egui::ComboBox::from_id_salt("commentary-author")
            .selected_text(&selection.works[selection.active_work].author)
            .show_ui(ui, |ui| {
                for (index, work) in selection.works.iter().enumerate() {
                    ui.selectable_value(&mut selection.active_work, index, &work.author);
                }
            });
        let work = &selection.works[selection.active_work];
        ui.add_space(12.0);
        ui.label(RichText::new(&work.title).strong());
        let mut open = None;
        for note in &work.notes {
            ui.add_space(12.0);
            ui.separator();
            ui.label(RichText::new(&note.reference).color(p.accent));
            ui.label(RichText::new(&note.text).font(serif(18.0)));
            if control(ui, "View in context").clicked() && !suppress_click {
                open = Some(note.passage_id.clone());
            }
        }
        if let Some(id) = open {
            self.open(id);
        }
    }
}
