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
            RichText::new(excerpt(&selection.text, 1200))
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
                            RichText::new(excerpt(&note.text, 1200))
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

/// Keep ordinary passages complete, including paragraph breaks. Only shorten a
/// section when it is at least a third longer than the preview target.
fn excerpt(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit.saturating_add(limit / 3) {
        return text.to_owned();
    }
    let end = text
        .char_indices()
        .nth(limit)
        .map_or(text.len(), |(i, _)| i);
    let candidate = &text[..end];
    let end = if text[end..].starts_with(char::is_whitespace) {
        end
    } else {
        candidate.rfind(char::is_whitespace).unwrap_or_else(|| {
            text[end..]
                .find(char::is_whitespace)
                .map_or(text.len(), |next| end + next)
        })
    };
    let mut preview = text[..end].trim_end().to_owned();
    if let Some((end, _)) = preview.rmatch_indices(['.', '!', '?']).find(|(end, mark)| {
        preview[..*end].chars().count() >= limit / 2
            && (*mark != "."
                || !preview[..*end]
                    .chars()
                    .next_back()
                    .is_some_and(|c| c.is_ascii_digit()))
    }) {
        preview.truncate(end + 1);
    }
    preview.push('…');
    preview
}

#[cfg(test)]
mod tests {
    use super::excerpt;

    #[test]
    fn ordinary_commentary_passages_remain_complete_with_paragraph_breaks() {
        let text = format!(
            "{}\n\n{}",
            "A complete thought. ".repeat(35),
            "Another thought. ".repeat(45)
        );
        assert!(text.chars().count() > 1200 && text.chars().count() <= 1600);
        assert_eq!(excerpt(&text, 1200), text);
    }

    #[test]
    fn long_sections_keep_paragraphs_and_mark_omitted_text() {
        let text = format!(
            "{}\n\n{}",
            "A complete thought. ".repeat(25),
            "Another thought. ".repeat(100)
        );
        let preview = excerpt(&text, 1200);
        assert!(preview.contains("\n\n"));
        assert!(preview.ends_with(".…"));
        assert!(preview.chars().count() <= 1201);
        assert!(text.starts_with(preview.trim_end_matches('…')));
    }

    #[test]
    fn excerpts_keep_sentences_and_do_not_cut_unicode_words() {
        let text = "Christ’s rest is a gift.\n\nHe calls the weary to himself. His yoke is easy.";
        assert_eq!(excerpt(text, 200), text);
        assert_eq!(excerpt(text, 30), "Christ’s rest is a gift.…");
        assert_eq!(
            excerpt(
                "A complete sentence ends here? 11. A second thought continues.",
                35
            ),
            "A complete sentence ends here?…"
        );
        assert_eq!(
            excerpt("Ἀγάπη is patient and kind", 16),
            "Ἀγάπη is patient…"
        );
    }
}
