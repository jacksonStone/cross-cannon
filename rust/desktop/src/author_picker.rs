//! Searchable author selection shared by the browser and native Library.
use eframe::egui::{self, Id, Key, Modifiers, RichText};

#[derive(Default)]
pub(super) struct AuthorPicker {
    query: String,
    selected: String,
    open: bool,
    active: usize,
}

impl AuthorPicker {
    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    fn matches<'a>(&self, authors: &'a [String]) -> Vec<&'a str> {
        let query = if self.query == self.selected {
            String::new()
        } else {
            self.query.trim().to_lowercase()
        };
        std::iter::once("")
            .chain(authors.iter().map(String::as_str))
            .filter(|author| label(author).to_lowercase().contains(&query))
            .collect()
    }

    fn choose(&mut self, author: &str) -> String {
        self.selected = author.to_owned();
        self.query = author.to_owned();
        self.open = false;
        author.to_owned()
    }

    pub(super) fn show(
        &mut self,
        ui: &mut egui::Ui,
        selected: &str,
        authors: &[String],
        suppress_click: bool,
    ) -> Option<String> {
        if selected != self.selected {
            self.selected = selected.to_owned();
            self.query = selected.to_owned();
            self.open = false;
        }
        let id = Id::new("library-author-query");
        let (down, up, enter, escape) = if self.open && ui.memory(|m| m.has_focus(id)) {
            ui.input_mut(|input| {
                (
                    input.consume_key(Modifiers::NONE, Key::ArrowDown),
                    input.consume_key(Modifiers::NONE, Key::ArrowUp),
                    input.consume_key(Modifiers::NONE, Key::Enter),
                    input.consume_key(Modifiers::NONE, Key::Escape),
                )
            })
        } else {
            (false, false, false, false)
        };
        let field = ui.add(
            egui::TextEdit::singleline(&mut self.query)
                .id(id)
                .hint_text("All authors · type to find")
                .char_limit(200)
                .margin(egui::vec2(10.0, 10.0))
                .desired_width(f32::INFINITY),
        );
        field.widget_info(|| {
            egui::WidgetInfo::labeled(
                egui::WidgetType::TextEdit,
                ui.is_enabled(),
                "Find a Library author",
            )
        });
        if field.changed() || field.clicked() || field.gained_focus() {
            self.open = true;
            self.active = 0;
        }
        if escape {
            self.open = false;
        }
        if !self.open {
            return None;
        }
        let matches = self.matches(authors);
        self.active = self.active.min(matches.len().saturating_sub(1));
        if down {
            self.active = (self.active + 1).min(matches.len().saturating_sub(1));
        }
        if up {
            self.active = self.active.saturating_sub(1);
        }
        if enter {
            if let Some(author) = matches.get(self.active) {
                field.surrender_focus();
                return Some(self.choose(author));
            }
        }
        let mut chosen = None;
        egui::Frame::NONE
            .fill(ui.visuals().extreme_bg_color)
            .stroke(ui.visuals().widgets.noninteractive.bg_stroke)
            .inner_margin(6.0)
            .corner_radius(6.0)
            .show(ui, |ui| {
                ui.label(
                    RichText::new(format!("{} suggestions · ↑ ↓ then Enter", matches.len()))
                        .small()
                        .weak(),
                );
                ui.style_mut().spacing.scroll.floating = false;
                super::touch_scroll::vertical(
                    ui,
                    "library-author-suggestions",
                    132.0,
                    false,
                    |ui, dragging| {
                        if matches.is_empty() {
                            ui.label("No matching authors");
                        }
                        for (index, author) in matches.iter().enumerate() {
                            let response = ui.add_sized(
                                [ui.available_width(), 36.0],
                                egui::Button::new(label(author)).selected(index == self.active),
                            );
                            if (down || up) && index == self.active {
                                response.scroll_to_me(Some(egui::Align::Center));
                            }
                            if response.clicked() && !suppress_click && !dragging {
                                chosen = Some((*author).to_owned());
                            }
                        }
                    },
                );
            });
        if let Some(author) = chosen {
            field.surrender_focus();
            return Some(self.choose(&author));
        }
        None
    }
}

fn label(author: &str) -> &str {
    if author.is_empty() {
        "All authors"
    } else {
        author
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_filters_authors_and_keyboard_commits_a_suggestion() {
        let ctx = egui::Context::default();
        let authors = vec![
            "Augustine".into(),
            "Clement of Alexandria".into(),
            "Clement of Rome".into(),
        ];
        let mut picker = AuthorPicker::default();
        let render = |picker: &mut AuthorPicker, events| {
            let mut choice = None;
            let _ = ctx.run(
                egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(500.0, 500.0),
                    )),
                    events,
                    ..Default::default()
                },
                |ctx| {
                    egui::CentralPanel::default().show(ctx, |ui| {
                        choice = picker.show(ui, "", &authors, false);
                    });
                },
            );
            choice
        };
        render(&mut picker, vec![]);
        ctx.memory_mut(|memory| memory.request_focus(Id::new("library-author-query")));
        render(&mut picker, vec![egui::Event::Text("cLeM".into())]);
        assert_eq!(
            picker.matches(&authors),
            ["Clement of Alexandria", "Clement of Rome"]
        );
        let key = |key| egui::Event::Key {
            key,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: Modifiers::NONE,
        };
        render(&mut picker, vec![key(Key::ArrowDown)]);
        assert_eq!(
            render(&mut picker, vec![key(Key::Enter)]),
            Some("Clement of Rome".into())
        );
        assert!(!picker.open);
        picker.reset();
        assert!(picker.query.is_empty());
        assert_eq!(picker.matches(&authors).first().copied(), Some(""));
    }
}
