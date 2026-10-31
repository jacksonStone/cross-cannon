use super::*;

impl Desktop {
    pub(super) fn toolbar(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let p = self.state.theme.palette();
        let (_, active_chapter) = self.library.chapter(&self.active_chapter_id).unwrap();
        let focused = self
            .library
            .passage(&active_chapter.passage_ids[0])
            .unwrap()
            .clone();
        let label = if focused.corpus == Corpus::Scripture {
            format!("{} {}", focused.book, focused.chapter)
        } else {
            focused.book.clone()
        };
        let (rect, _) =
            ui.allocate_exact_size(Vec2::new(ui.available_width(), 59.0), Sense::hover());
        ui.painter().text(
            rect.left_top() + egui::vec2(0.0, 3.0),
            Align2::LEFT_TOP,
            label,
            heading(36.0_f32.min(rect.width() * 0.055)),
            p.ink,
        );
        ui.painter()
            .hline(rect.x_range(), rect.bottom(), Stroke::new(1.0_f32, p.line));
        ui.scope_builder(
            egui::UiBuilder::new()
                .max_rect(rect.shrink2(egui::vec2(0.0, 10.0)))
                .layout(Layout::right_to_left(Align::Center)),
            |ui| {
                if self.tools {
                    if control(ui, "×").on_hover_text("Close tools").clicked() {
                        self.tools = false
                    }
                    if control(ui, "Jump").clicked() {
                        self.jump_book = focused.book_id.clone();
                        self.dialog = Some(Dialog::Jump)
                    }
                    if control(ui, "Aa").on_hover_text("Reader settings").clicked() {
                        self.dialog = Some(Dialog::Settings)
                    }
                    if control(ui, "⌕").on_hover_text("Search").clicked() {
                        self.dialog = Some(Dialog::Search)
                    }
                    let available = self.library.audio(&focused.chapter_id);
                    if ui
                        .add_enabled(
                            available.is_some(),
                            egui::Button::new(if self.playing { "Ⅱ" } else { "▷" })
                                .min_size(egui::vec2(38.0, 36.0)),
                        )
                        .on_hover_text("Play chapter audio")
                        .clicked()
                    {
                        if self.audio_chapter.as_deref() == Some(&focused.chapter_id) {
                            let _ = self.audio_tx.send(audio::Command::Toggle);
                        } else if let Some(audio) = available {
                            let _ = self.audio_tx.send(audio::Command::Play(audio));
                            self.audio_chapter = Some(focused.chapter_id.clone());
                            self.message = "Loading audio…".into();
                        }
                    }
                } else {
                    let response =
                        ui.add_sized([42.0, 34.0], egui::Button::new("").corner_radius(8.0));
                    for offset in [-4.0, 0.0, 4.0] {
                        ui.painter().circle_filled(
                            response.rect.center() + egui::vec2(0.0, offset),
                            0.9,
                            p.accent,
                        );
                    }
                    if response.on_hover_text("Reader tools").clicked() {
                        self.tools = true
                    }
                }
            },
        );
        let _ = ctx;
    }
    pub(super) fn reader(&mut self, ui: &mut egui::Ui) {
        let p = self.state.theme.palette();
        let book = self
            .library
            .book(&self.current_passage().book_id)
            .unwrap()
            .clone();
        let mut focused_visible = None;
        let target = self.scroll_target.clone();
        let output = egui::ScrollArea::vertical()
            .id_salt(("reader", &book.id))
            .auto_shrink([false, false])
            .show_viewport(ui, |ui, viewport| {
                ui.set_width(ui.available_width());
                ui.spacing_mut().item_spacing.y = 0.0;
                for chapter in &book.chapters {
                    if chapter.number == 1 {
                        self.book_heading(ui, &book);
                    } else {
                        ui.add_space(34.0);
                        let (r, _) = ui.allocate_exact_size(
                            egui::vec2(ui.available_width(), 1.0),
                            Sense::hover(),
                        );
                        ui.painter().hline(
                            r.x_range(),
                            r.top(),
                            Stroke::new(1.0_f32, p.line.gamma_multiply(0.42)),
                        );
                        ui.add_space(24.0);
                    }
                    ui.horizontal(|ui| {
                        ui.label(
                            RichText::new(if book.corpus == Corpus::Scripture {
                                format!("{} {}", book.title, chapter.number)
                            } else {
                                format!("Chapter {}", chapter.number)
                            })
                            .font(heading(15.2))
                            .color(p.muted.gamma_multiply(0.62)),
                        );
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            ui.label(
                                RichText::new(if book.corpus == Corpus::Scripture {
                                    "WEB · World English Bible"
                                } else {
                                    book.author.as_deref().unwrap_or("Early Christian writings")
                                })
                                .size(9.92)
                                .color(p.muted.gamma_multiply(0.58)),
                            );
                        });
                    });
                    ui.add_space(12.0);
                    if book.corpus == Corpus::EarlyChristian {
                        ui.label(RichText::new(&chapter.title).size(12.2).color(p.muted));
                        ui.add_space(12.0);
                    }
                    for id in &chapter.passage_ids {
                        let passage = self.library.passage(id).unwrap().clone();
                        let selected = self.selected.as_deref() == Some(id);
                        let start = ui.cursor().min;
                        let mut text = egui::text::LayoutJob::default();
                        text.wrap.max_width = ui.available_width() - 20.0;
                        let size = 19.84 * self.state.font_scale;
                        text.append(
                            passage.reader_text(self.state.original),
                            0.0,
                            egui::TextFormat {
                                font_id: serif(size),
                                color: p.ink,
                                line_height: Some(size * self.state.line_height),
                                ..Default::default()
                            },
                        );
                        let galley = ui.fonts(|f| f.layout_job(text));
                        let height = galley.size().y + 8.0 + if selected { 25.0 } else { 0.0 };
                        let (rect, response) = ui.allocate_exact_size(
                            egui::vec2(ui.available_width(), height),
                            Sense::click(),
                        );
                        if selected {
                            ui.painter()
                                .rect_filled(rect, 8.0, p.accent.gamma_multiply(0.05));
                            ui.painter().vline(
                                rect.left(),
                                rect.y_range().shrink(8.0),
                                Stroke::new(2.0_f32, p.accent.gamma_multiply(0.46)),
                            );
                            ui.painter().text(
                                rect.left_top() + egui::vec2(10.0, 4.0),
                                Align2::LEFT_TOP,
                                passage.reference.to_uppercase(),
                                FontId::proportional(10.24),
                                p.accent,
                            );
                        }
                        if ui.is_rect_visible(rect) {
                            ui.painter().galley(
                                rect.left_top()
                                    + egui::vec2(10.0, 4.0 + if selected { 25.0 } else { 0.0 }),
                                galley,
                                p.ink,
                            );
                        }
                        if response.clicked() {
                            self.selected = if selected { None } else { Some(id.clone()) };
                            self.state.location_passage_id = id.clone();
                            self.active_chapter_id = passage.chapter_id.clone();
                        }
                        if target.as_deref() == Some(id) {
                            ui.scroll_to_rect(
                                Rect::from_min_size(
                                    start - egui::vec2(0.0, 48.0),
                                    egui::vec2(1.0, height + 48.0),
                                ),
                                Some(Align::TOP),
                            );
                        }
                        let screen_top = ui.max_rect().top() + viewport.top();
                        if focused_visible.is_none() && rect.bottom() > screen_top + 2.0 {
                            focused_visible = Some(id.clone());
                        }
                        ui.add_space(2.0);
                        if selected {
                            ui.horizontal(|ui| {
                                if control(ui, "Similar passages").clicked() {
                                    self.dialog = Some(Dialog::Search);
                                    self.query.clear();
                                    self.search(ui.ctx(), Some(id.clone()));
                                }
                                if control(ui, "Copy").clicked() {
                                    ui.ctx().copy_text(format!(
                                        "{}\n{}",
                                        passage.reference,
                                        passage.reader_text(self.state.original)
                                    ));
                                }
                            });
                            ui.add_space(10.0);
                        }
                    }
                }
                ui.add_space(70.0);
            });
        if self.scroll_target.is_some() {
            self.scroll_target = None;
        } else if (output.state.offset.y - self.last_scroll).abs() > 1.0 {
            if let Some(id) = focused_visible {
                self.state.location_passage_id = id;
            }
        }
        self.last_scroll = output.state.offset.y;
    }
    pub(super) fn book_heading(&self, ui: &mut egui::Ui, book: &Book) {
        let p = self.state.theme.palette();
        let width = ui.available_width();
        ui.add_space(46.0);
        let (top, _) = ui.allocate_exact_size(egui::vec2(width, 3.0), Sense::hover());
        ui.painter().hline(
            top.x_range(),
            top.top(),
            Stroke::new(1.0_f32, p.accent.gamma_multiply(0.28)),
        );
        ui.painter().line_segment(
            [
                top.left_top(),
                top.left_top() + egui::vec2(180.0_f32.min(width * 0.42), 0.0),
            ],
            Stroke::new(3.0_f32, p.accent),
        );
        ui.add_space(58.0);
        ui.label(
            RichText::new("B O O K")
                .size(11.52)
                .strong()
                .color(p.accent),
        );
        ui.add_space(10.0);
        let size = 89.6_f32.min(width * 0.12);
        ui.add(egui::Label::new(RichText::new(&book.title).font(heading(size))).wrap());
        ui.add_space(10.0);
        ui.label(
            RichText::new(if book.corpus == Corpus::Scripture {
                "WEB · World English Bible"
            } else {
                book.author.as_deref().unwrap_or("Early Christian writings")
            })
            .size(20.0)
            .strong()
            .color(p.muted),
        );
        ui.add_space(26.0);
        ui.separator();
        ui.add_space(16.0);
        ui.columns(3, |columns| {
            for (column, label, value) in [
                (
                    0,
                    "TEXT",
                    if book.corpus == Corpus::Scripture {
                        "Scripture".into()
                    } else {
                        "Early Christian".into()
                    },
                ),
                (
                    1,
                    if book.corpus == Corpus::Scripture {
                        "TRANSLATION"
                    } else {
                        "AUTHOR"
                    },
                    if book.corpus == Corpus::Scripture {
                        "WEB · World English Bible".into()
                    } else {
                        book.author.clone().unwrap_or_default()
                    },
                ),
                (2, "CHAPTERS", format!("{} chapters", book.chapters.len())),
            ] {
                columns[column].label(
                    RichText::new(label)
                        .size(10.24)
                        .strong()
                        .color(p.muted.gamma_multiply(0.72)),
                );
                columns[column].add_space(4.0);
                columns[column].label(RichText::new(value).size(13.12).strong());
            }
        });
        ui.add_space(46.0);
        ui.separator();
        ui.add_space(38.0);
    }
}
