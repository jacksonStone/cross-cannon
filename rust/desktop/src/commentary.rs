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
}

impl Desktop {
    pub(super) fn show_commentaries(&mut self, passage: &Passage) {
        #[cfg(target_arch = "wasm32")]
        if browser_library::defer_commentaries(&self.library, &self.catalog, passage) {
            return;
        }
        let displayed = self
            .reading_text
            .passage(passage, self.state.scripture_translation);
        self.commentary = Some(Selection {
            reference: passage.reference.clone(),
            text: displayed.text.clone(),
            works: self.catalog.commentaries(&self.library, passage),
        });
        self.dialog = Some(Dialog::Commentary);
    }

    pub(super) fn commentary_dialog(&mut self, ui: &mut egui::Ui, suppress_click: bool) {
        let Some(selection) = &mut self.commentary else {
            return;
        };
        let p = self.state.theme.palette();
        ui.label(RichText::new(&selection.reference).font(heading(22.0)));
        ui.label(
            RichText::new(excerpt(&selection.text, 180))
                .font(FontId::proportional(16.0))
                .color(p.muted),
        );
        if selection.works.is_empty() {
            ui.add_space(16.0);
            ui.label("No commentary indexed to these verses is included in the collection yet.");
            return;
        }
        let mut open = None;
        for work in &selection.works {
            for note in &work.notes {
                ui.add_space(22.0);
                ui.label(
                    RichText::new(format!("{} — {}", work.author, note.reference))
                        .size(16.0)
                        .strong(),
                )
                .on_hover_text(&work.title);
                ui.add_space(6.0);
                let quote = egui::Frame::new()
                    .inner_margin(egui::Margin {
                        left: 16,
                        ..Default::default()
                    })
                    .show(ui, |ui| {
                        ui.label(
                            RichText::new(excerpt(&note.text, 220))
                                .font(FontId::proportional(18.0)),
                        );
                        if ui
                            .add(
                                egui::Button::new(
                                    RichText::new("Source").color(p.accent).size(15.0),
                                )
                                .frame(false)
                                .min_size(egui::vec2(44.0, 44.0)),
                            )
                            .on_hover_text(format!("Read the complete section in {}", work.title))
                            .clicked()
                            && !suppress_click
                        {
                            open = Some(note.passage_id.clone());
                        }
                    });
                let rect = quote.response.rect;
                ui.painter().line_segment(
                    [
                        rect.left_top() + egui::vec2(2.0, 2.0),
                        rect.left_bottom() + egui::vec2(2.0, -2.0),
                    ],
                    egui::Stroke::new(3.0_f32, p.line),
                );
            }
        }
        if let Some(id) = open {
            self.open(id);
        }
    }
}

/// A source-worded preview; the complete contiguous section stays in `Note`.
fn excerpt(text: &str, limit: usize) -> String {
    let mut preview = String::new();
    let mut length = 0;
    let mut words = text.split_whitespace().peekable();
    while let Some(word) = words.peek() {
        let added = word.chars().count() + usize::from(!preview.is_empty());
        if length + added > limit && !preview.is_empty() {
            break;
        }
        if !preview.is_empty() {
            preview.push(' ');
        }
        preview.push_str(words.next().unwrap());
        length += added;
    }
    if words.peek().is_none() {
        return preview;
    }
    if let Some((end, _)) = preview.rmatch_indices(['.', '!', '?']).find(|(end, mark)| {
        *end >= limit / 2
            && (*mark != "."
                || !preview[..*end]
                    .chars()
                    .next_back()
                    .is_some_and(|c| c.is_ascii_digit()))
    }) {
        preview.truncate(end + 1);
    } else {
        preview.push('…');
    }
    preview
}

#[cfg(test)]
mod tests {
    use super::excerpt;

    #[test]
    fn excerpts_keep_source_sentences_and_do_not_cut_unicode_words() {
        let text = "Christ’s rest is a gift.\n\nHe calls the weary to himself. His yoke is easy.";
        assert_eq!(
            excerpt(text, 200),
            "Christ’s rest is a gift. He calls the weary to himself. His yoke is easy."
        );
        assert_eq!(excerpt(text, 30), "Christ’s rest is a gift.");
        assert_eq!(
            excerpt(
                "A complete sentence ends here? 11. A second thought continues.",
                35
            ),
            "A complete sentence ends here?"
        );
        assert_eq!(
            excerpt("Ἀγάπη is patient and kind", 18),
            "Ἀγάπη is patient…"
        );
    }
}
