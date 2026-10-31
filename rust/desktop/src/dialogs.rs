use super::*;

impl Desktop {
    pub(super) fn dialogs(&mut self, ctx: &egui::Context) {
        let Some(dialog) = self.dialog else { return };
        let p = self.state.theme.palette();
        let width = (ctx.screen_rect().width() - 64.0).clamp(260.0, 850.0);
        let response = egui::Modal::new(Id::new("reader-dialog"))
            .frame(
                egui::Frame::window(&ctx.style())
                    .fill(p.paper)
                    .inner_margin(20.0)
                    .corner_radius(8.0)
                    .stroke(Stroke::new(1.0_f32, p.line)),
            )
            .show(ctx, |ui| {
                ui.set_width(width);
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new(match dialog {
                            Dialog::Jump => "Jump to a passage",
                            Dialog::Search => "Search",
                            Dialog::Settings => "Reader settings",
                        })
                        .font(heading(29.6)),
                    );
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if control(ui, "×").clicked() {
                            self.dialog = None;
                        }
                    });
                });
                ui.add_space(12.0);
                ui.separator();
                ui.add_space(14.0);
                match dialog {
                    Dialog::Jump => self.jump_dialog(ui),
                    Dialog::Search => self.search_dialog(ui, ctx),
                    Dialog::Settings => self.settings_dialog(ui),
                }
            });
        if response.should_close() {
            self.dialog = None;
        }
    }
    pub(super) fn jump_dialog(&mut self, ui: &mut egui::Ui) {
        ui.add(
            egui::TextEdit::singleline(&mut self.jump_filter)
                .hint_text("Find a book or author…")
                .desired_width(f32::INFINITY),
        );
        ui.add_space(10.0);
        let books = self
            .library
            .books
            .iter()
            .filter(|b| {
                if b.corpus == Corpus::Scripture && !self.state.canon.includes(&b.title) {
                    return false;
                }
                let q = self.jump_filter.to_lowercase();
                q.is_empty()
                    || b.title.to_lowercase().contains(&q)
                    || b.author
                        .as_ref()
                        .is_some_and(|a| a.to_lowercase().contains(&q))
            })
            .cloned()
            .collect::<Vec<_>>();
        ui.columns(2, |cols| {
            egui::ScrollArea::vertical()
                .id_salt("book-list")
                .max_height(420.0)
                .show(&mut cols[0], |ui| {
                    for corpus in [Corpus::Scripture, Corpus::EarlyChristian] {
                        ui.label(
                            RichText::new(if corpus == Corpus::Scripture {
                                "SCRIPTURE"
                            } else {
                                "EARLY CHRISTIAN WRITINGS"
                            })
                            .size(10.5)
                            .strong(),
                        );
                        ui.add_space(5.0);
                        for book in books.iter().filter(|b| b.corpus == corpus) {
                            if ui
                                .selectable_label(
                                    self.jump_book == book.id,
                                    format!(
                                        "{}{}",
                                        book.title,
                                        book.author
                                            .as_ref()
                                            .map(|a| format!(" · {a}"))
                                            .unwrap_or_default()
                                    ),
                                )
                                .clicked()
                            {
                                self.jump_book = book.id.clone();
                            }
                        }
                        ui.add_space(14.0);
                    }
                });
            if let Some(book) = self.library.book(&self.jump_book).cloned() {
                cols[1].label(RichText::new(&book.title).font(heading(23.0)));
                cols[1].add_space(8.0);
                egui::ScrollArea::vertical()
                    .id_salt("chapter-list")
                    .max_height(420.0)
                    .show(&mut cols[1], |ui| {
                        ui.horizontal_wrapped(|ui| {
                            for chapter in &book.chapters {
                                if ui
                                    .add_sized(
                                        [43.0, 36.0],
                                        egui::Button::new(chapter.number.to_string()),
                                    )
                                    .on_hover_text(&chapter.title)
                                    .clicked()
                                {
                                    if let Some(id) = chapter.passage_ids.first() {
                                        self.open(id.clone())
                                    }
                                }
                            }
                        });
                    });
            }
        });
    }
    pub(super) fn search_dialog(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let edit = ui.add(
            egui::TextEdit::singleline(&mut self.query)
                .hint_text("Search the texts…")
                .desired_width(f32::INFINITY),
        );
        let enter = edit.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
        ui.horizontal_wrapped(|ui| {
            ui.selectable_value(
                &mut self.search_corpus,
                Some(Corpus::Scripture),
                "Scripture",
            );
            ui.selectable_value(
                &mut self.search_corpus,
                Some(Corpus::EarlyChristian),
                "Early Christian",
            );
            ui.selectable_value(&mut self.search_corpus, None, "Both");
            ui.separator();
            ui.checkbox(&mut self.semantic, "Semantic · online");
            if ui
                .add_enabled(
                    !self.busy && !self.query.trim().is_empty(),
                    egui::Button::new("Search"),
                )
                .clicked()
                || enter
            {
                self.search(ctx, None)
            }
        });
        ui.add_space(8.0);
        ui.label(
            RichText::new(if self.semantic {
                "Semantic search uses R Cross Cannon. Passage text stays local."
            } else {
                "Keyword search · all texts on this device · works offline"
            })
            .size(11.0)
            .color(self.state.theme.palette().muted),
        );
        if self.busy {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label("Searching…");
            });
        }
        if !self.message.is_empty() {
            ui.label(&self.message);
        }
        ui.add_space(12.0);
        ui.separator();
        let results = self.results.clone();
        egui::ScrollArea::vertical()
            .id_salt("results")
            .max_height(440.0)
            .show(ui, |ui| {
                for hit in results {
                    if let Some(passage) = self.library.passage(&hit.id).cloned() {
                        ui.add_space(14.0);
                        if ui
                            .link(RichText::new(&passage.reference).strong())
                            .clicked()
                        {
                            self.open(hit.id.clone());
                        }
                        ui.add(
                            egui::Label::new(
                                RichText::new(passage.text.chars().take(650).collect::<String>())
                                    .font(serif(18.0)),
                            )
                            .wrap(),
                        );
                        ui.add_space(8.0);
                        ui.separator();
                    }
                }
            });
    }
    pub(super) fn settings_dialog(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            for theme in [Theme::Paper, Theme::Sepia, Theme::Dark, Theme::Contrast] {
                if ui
                    .selectable_value(&mut self.state.theme, theme, format!("{theme:?}"))
                    .changed()
                {
                    self.state.theme.apply(ui.ctx());
                }
            }
        });
        ui.add_space(16.0);
        ui.horizontal(|ui| {
            for (label, scale, height, width) in [
                ("Default", 1.0, 1.72, 820.0),
                ("Compact", 0.94, 1.54, 880.0),
                ("Open", 1.07, 1.86, 760.0),
                ("Relaxed", 1.14, 1.96, 700.0),
            ] {
                if control(ui, label).clicked() {
                    self.state.font_scale = scale;
                    self.state.line_height = height;
                    self.state.width = width;
                    self.scroll_target = Some(self.state.location_passage_id.clone());
                }
            }
        });
        for (label, value, range) in [
            ("Text size", &mut self.state.font_scale, 0.86..=1.35),
            ("Line spacing", &mut self.state.line_height, 1.42..=2.08),
            ("Column width", &mut self.state.width, 620.0..=880.0),
        ] {
            if ui
                .add(egui::Slider::new(value, range).text(label))
                .changed()
            {
                self.scroll_target = Some(self.state.location_passage_id.clone());
            }
        }
        ui.add_space(12.0);
        ui.label("Scripture canon");
        ui.horizontal(|ui| {
            for canon in [Canon::Protestant, Canon::Catholic, Canon::Orthodox] {
                ui.selectable_value(&mut self.state.canon, canon, format!("{canon:?}"));
            }
        });
        ui.checkbox(&mut self.state.original, "Original Early Christian text");
        ui.add_space(18.0);
        ui.separator();
        ui.add_space(12.0);
        ui.label("R Cross Cannon API");
        ui.add(egui::TextEdit::singleline(&mut self.state.api_url).desired_width(f32::INFINITY));
        ui.label(
            RichText::new(format!(
                "{} books · {} passages · all texts stored locally",
                self.library.books.len(),
                self.library.passages.len()
            ))
            .size(11.0),
        );
    }
}
