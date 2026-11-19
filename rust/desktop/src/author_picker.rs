//! Searchable author and Bible book selection shared by the browser and native Library.
use eframe::egui::{self, Id, Key, Modifiers, RichText};

#[derive(Default)]
struct CompletionPicker {
    query: String,
    selected: String,
    open: bool,
    active: usize,
}

#[derive(Default)]
pub(super) struct AuthorPicker(CompletionPicker);

#[derive(Default)]
pub(super) struct BookPicker(CompletionPicker);

struct Labels {
    id: &'static str,
    suggestions_id: &'static str,
    hint: &'static str,
    accessible: &'static str,
    empty: &'static str,
}

impl AuthorPicker {
    pub(super) fn reset(&mut self) {
        self.0 = CompletionPicker::default();
    }

    pub(super) fn show(
        &mut self,
        ui: &mut egui::Ui,
        selected: &str,
        authors: &[String],
        suppress_click: bool,
    ) -> Option<String> {
        let choices = std::iter::once((String::new(), "All authors".into()))
            .chain(
                authors
                    .iter()
                    .map(|author| (author.clone(), author.clone())),
            )
            .collect::<Vec<_>>();
        self.0.show(
            ui,
            selected,
            &choices,
            suppress_click,
            Labels {
                id: "library-author-query",
                suggestions_id: "library-author-suggestions",
                hint: "All authors · type to find",
                accessible: "Find a Library author",
                empty: "No matching authors",
            },
        )
    }
}

impl BookPicker {
    pub(super) fn reset(&mut self) {
        self.0 = CompletionPicker::default();
    }

    pub(super) fn show(
        &mut self,
        ui: &mut egui::Ui,
        selected: &str,
        choices: &[(String, String)],
        suppress_click: bool,
    ) -> Option<String> {
        self.0.show(
            ui,
            selected,
            choices,
            suppress_click,
            Labels {
                id: "library-book-query",
                suggestions_id: "library-book-suggestions",
                hint: "Type to find a book",
                accessible: "Find a Bible book",
                empty: "No matching books",
            },
        )
    }
}

impl CompletionPicker {
    fn matches<'a>(&self, choices: &'a [(String, String)]) -> Vec<&'a (String, String)> {
        let query = if self.query == self.selected {
            String::new()
        } else {
            self.query.trim().to_lowercase()
        };
        choices
            .iter()
            .filter(|(_, label)| label.to_lowercase().contains(&query))
            .collect()
    }

    fn choose(&mut self, value: &str, label: &str) -> String {
        self.selected = if value.is_empty() {
            String::new()
        } else {
            label.to_owned()
        };
        self.query = self.selected.clone();
        self.open = false;
        value.to_owned()
    }

    pub(super) fn show(
        &mut self,
        ui: &mut egui::Ui,
        selected: &str,
        choices: &[(String, String)],
        suppress_click: bool,
        labels: Labels,
    ) -> Option<String> {
        let selected = choices
            .iter()
            .find(|(value, _)| !value.is_empty() && value == selected)
            .map(|(_, label)| label.as_str())
            .unwrap_or("");
        if selected != self.selected {
            self.selected = selected.to_owned();
            self.query = selected.to_owned();
            self.open = false;
        }
        let id = Id::new(labels.id);
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
                .hint_text(labels.hint)
                .char_limit(200)
                .margin(egui::vec2(10.0, 10.0))
                .desired_width(f32::INFINITY),
        );
        field.widget_info(|| {
            egui::WidgetInfo::labeled(
                egui::WidgetType::TextEdit,
                ui.is_enabled(),
                labels.accessible,
            )
        });
        if field.gained_focus() && !field.changed() && self.query == self.selected {
            let mut state = egui::TextEdit::load_state(ui.ctx(), id).unwrap_or_default();
            state
                .cursor
                .set_char_range(Some(egui::text::CCursorRange::two(
                    egui::text::CCursor::new(0),
                    egui::text::CCursor::new(self.query.chars().count()),
                )));
            state.store(ui.ctx(), id);
        }
        if field.changed() || field.clicked() || field.gained_focus() {
            self.open = true;
            self.active = 0;
        }
        if escape {
            self.query = self.selected.clone();
            self.open = false;
        }
        if !self.open {
            return None;
        }
        let matches = self.matches(choices);
        self.active = self.active.min(matches.len().saturating_sub(1));
        if down {
            self.active = (self.active + 1).min(matches.len().saturating_sub(1));
        }
        if up {
            self.active = self.active.saturating_sub(1);
        }
        if enter {
            if let Some((value, label)) = matches.get(self.active) {
                field.surrender_focus();
                return Some(self.choose(value, label));
            }
        }
        let mut chosen = None;
        let suggestions = egui::Frame::NONE
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
                    labels.suggestions_id,
                    132.0,
                    false,
                    |ui, dragging| {
                        if matches.is_empty() {
                            ui.label(labels.empty);
                        }
                        for (index, (value, label)) in matches.iter().enumerate() {
                            let response = ui.add_sized(
                                [ui.available_width(), 36.0],
                                egui::Button::new(label.as_str()).selected(index == self.active),
                            );
                            if (down || up) && index == self.active {
                                response.scroll_to_me(Some(egui::Align::Center));
                            }
                            if response.clicked() && !suppress_click && !dragging {
                                chosen = Some((value.to_string(), label.to_string()));
                            }
                        }
                    },
                );
            });
        if let Some((value, label)) = chosen {
            field.surrender_focus();
            return Some(self.choose(&value, &label));
        }
        if ui.input(|input| {
            input.pointer.any_click()
                && input.pointer.interact_pos().is_some_and(|pos| {
                    !field.rect.contains(pos) && !suggestions.response.rect.contains(pos)
                })
        }) {
            self.query = self.selected.clone();
            self.open = false;
        }
        None
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
        let choices = authors
            .iter()
            .map(|author| (author.clone(), author.clone()))
            .collect::<Vec<_>>();
        let suggestions = picker
            .0
            .matches(&choices)
            .iter()
            .map(|(_, label)| label.as_str())
            .collect::<Vec<_>>();
        assert_eq!(suggestions, ["Clement of Alexandria", "Clement of Rome"]);
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
        assert!(!picker.0.open);
        picker.reset();
        assert!(picker.0.query.is_empty());
        assert!(picker.0.selected.is_empty());
    }
}
