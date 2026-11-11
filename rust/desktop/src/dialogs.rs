use super::*;

impl Desktop {
    pub(super) fn dialogs(&mut self, ctx: &egui::Context) {
        let Some(dialog) = self.dialog else {
            self.search_touch.cancel();
            return;
        };
        if dialog != Dialog::Search {
            self.search_touch.cancel();
        }
        let p = self.state.theme.palette();
        let compact = Self::compact(ctx);
        let phone_dialog = compact && dialog != Dialog::Settings;
        let insets = mobile::insets();
        let width = (ctx.screen_rect().width()
            - if phone_dialog {
                40.0
            } else if compact {
                64.0
            } else {
                104.0
            }
            - insets.left
            - insets.right)
            .clamp(
                220.0,
                if dialog == Dialog::Settings {
                    280.0
                } else {
                    912.0
                },
            );
        let height = if dialog == Dialog::Settings {
            (ctx.screen_rect().bottom()
                - insets.bottom
                - (self.toolbar_rect.bottom() + 8.0)
                - 100.0)
                .clamp(80.0, 420.0)
        } else {
            (ctx.screen_rect().height() - insets.top - insets.bottom - 180.0).max(120.0)
        };
        let mut modal = egui::Modal::new(Id::new("reader-dialog"));
        if phone_dialog {
            modal = modal.area(
                egui::Modal::default_area(Id::new("reader-dialog"))
                    .anchor(Align2::LEFT_TOP, [insets.left + 8.0, insets.top + 8.0]),
            );
        } else if dialog != Dialog::Settings {
            modal = modal.area(
                egui::Modal::default_area(Id::new("reader-dialog"))
                    .anchor(Align2::CENTER_TOP, [0.0, insets.top + 24.0]),
            );
        } else if dialog == Dialog::Settings {
            modal = modal.backdrop_color(egui::Color32::TRANSPARENT).area(
                egui::Modal::default_area(Id::new("reader-dialog")).anchor(
                    Align2::RIGHT_TOP,
                    [
                        -(ctx.screen_rect().right() - self.toolbar_rect.right()).max(12.0),
                        (self.toolbar_rect.bottom() + 8.0).min(insets.top + 100.0),
                    ],
                ),
            );
        }
        let response = modal
            .frame(
                egui::Frame::window(&ctx.style())
                    .fill(if dialog == Dialog::Settings {
                        p.panel
                    } else {
                        p.paper
                    })
                    .inner_margin(if phone_dialog { 12.0 } else { 20.0 })
                    .corner_radius(8.0)
                    .stroke(Stroke::new(1.0_f32, p.line)),
            )
            .show(ctx, |ui| {
                ui.set_width(width);
                ui.horizontal(|ui| {
                    if dialog != Dialog::Settings {
                        ui.vertical(|ui| {
                            ui.label(
                                RichText::new(match dialog {
                                    Dialog::Jump => "JUMP",
                                    Dialog::Downloads => "LISTEN",
                                    _ => "SEARCH",
                                })
                                .size(10.0)
                                .strong()
                                .color(p.accent),
                            );
                            ui.label(
                                RichText::new(if dialog == Dialog::Jump {
                                    if self.jump_corpus == Corpus::Scripture {
                                        "Choose a passage"
                                    } else {
                                        "Choose a work"
                                    }
                                } else {
                                    if dialog == Dialog::Downloads {
                                        "Offline audio"
                                    } else {
                                        "Find passages"
                                    }
                                })
                                .font(if dialog == Dialog::Jump {
                                    FontId::proportional(16.0)
                                } else {
                                    heading(if compact { 23.0 } else { 29.6 })
                                })
                                .strong(),
                            );
                        });
                    } else {
                        ui.label(
                            RichText::new(match dialog {
                                Dialog::Jump => "Jump to a passage",
                                Dialog::Search => "Search",
                                Dialog::Settings => "Reader settings",
                                Dialog::Downloads => "Offline audio",
                            })
                            .font(heading(
                                if dialog == Dialog::Settings {
                                    17.0
                                } else if compact {
                                    23.0
                                } else {
                                    29.6
                                },
                            )),
                        );
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if control(
                            ui,
                            if dialog != Dialog::Settings {
                                "Close"
                            } else {
                                "×"
                            },
                        )
                        .clicked()
                        {
                            self.dialog = None;
                        }
                    });
                });
                ui.add_space(if phone_dialog { 2.0 } else { 12.0 });
                ui.separator();
                ui.add_space(if phone_dialog { 4.0 } else { 14.0 });
                if dialog == Dialog::Search {
                    let body_height = (ctx.screen_rect().bottom()
                        - insets.bottom
                        - if compact { 22.0 } else { 40.0 }
                        - ui.cursor().top())
                    .max(48.0);
                    let touch = self.search_touch.frame(
                        ctx,
                        ui.available_rect_before_wrap(),
                        self.search_scroll,
                        self.search_max_scroll,
                        !self.filters_open,
                    );
                    let mut area = egui::ScrollArea::vertical()
                        .id_salt("search-dialog-body")
                        .animated(false)
                        .max_height(body_height)
                        .min_scrolled_height(body_height)
                        .auto_shrink([false, false])
                        .drag_to_scroll(!touch.controls_scrolling);
                    if let Some(offset) = touch.offset {
                        area = area.vertical_scroll_offset(offset);
                    }
                    let output =
                        area.show(ui, |ui| self.search_dialog(ui, ctx, touch.suppress_click));
                    self.search_scroll = output.state.offset.y;
                    self.search_max_scroll =
                        (output.content_size.y - output.inner_rect.height()).max(0.0);
                } else {
                    let body_height = if dialog != Dialog::Settings {
                        (ctx.screen_rect().bottom()
                            - insets.bottom
                            - if compact { 22.0 } else { 40.0 }
                            - ui.cursor().top())
                        .max(48.0)
                    } else {
                        height
                    };
                    touch_scroll::vertical(
                        ui,
                        match dialog {
                            Dialog::Jump => "jump-body",
                            Dialog::Downloads => "audio-downloads-body",
                            _ => "settings-body",
                        },
                        body_height,
                        dialog == Dialog::Jump || dialog == Dialog::Downloads,
                        |ui, suppress_click| match dialog {
                            Dialog::Jump => self.jump_dialog(ui, suppress_click),
                            Dialog::Settings => self.settings_dialog(ui),
                            Dialog::Search => self.search_dialog(ui, ctx, suppress_click),
                            Dialog::Downloads => self.audio_downloads(ui, suppress_click),
                        },
                    );
                }
            });
        if response.should_close() {
            self.dialog = None;
        }
        if dialog == Dialog::Search && self.dialog.is_some() && self.filters_open {
            self.search_filter_modal(ctx);
        }
    }
    pub(super) fn jump_dialog(&mut self, ui: &mut egui::Ui, suppress_click: bool) {
        let library = self.library.clone();
        let p = self.state.theme.palette();
        let compact = Self::compact(ui.ctx());
        // Reader history and copied links belong to reader actions. Keep the
        // picker focused on the same Book / Chapter / Verse flow as mobile web.
        if !compact {
            ui.horizontal_wrapped(|ui| {
                let previous = self.jump_corpus;
                ui.selectable_value(&mut self.jump_corpus, Corpus::Scripture, "Bible");
                ui.selectable_value(
                    &mut self.jump_corpus,
                    Corpus::EarlyChristian,
                    "Early Christian works",
                );
                if previous != self.jump_corpus {
                    self.jump_filter.clear();
                    self.jump_author.clear();
                    if let Some(b) = self
                        .library
                        .books
                        .iter()
                        .find(|b| b.corpus == self.jump_corpus)
                    {
                        self.jump_book = b.id.clone();
                        self.jump_chapter = 1;
                    }
                }
            });
            ui.add_space(8.0);
        }
        if self.jump_corpus == Corpus::Scripture {
            ui.label(RichText::new("Canon").strong().color(p.muted));
            let mut canon = self.state.canon;
            ui.scope(|ui| {
                ui.spacing_mut().interact_size.y = 38.0;
                egui::ComboBox::from_id_salt("jump-canon")
                    .width(ui.available_width() - 8.0)
                    .selected_text(format!("{canon:?}"))
                    .show_ui(ui, |ui| {
                        for (canon_choice, name) in [
                            (Canon::Protestant, "Protestant"),
                            (Canon::Catholic, "Catholic"),
                            (Canon::Orthodox, "Orthodox"),
                        ] {
                            ui.selectable_value(&mut canon, canon_choice, name);
                        }
                    });
            });
            self.update_canon(canon);
        } else {
            ui.label(RichText::new("Find work").strong().color(p.muted));
            ui.add(
                egui::TextEdit::singleline(&mut self.jump_filter)
                    .hint_text("City of God")
                    .char_limit(2000)
                    .margin(egui::vec2(10.0, 10.0))
                    .desired_width(f32::INFINITY),
            );
            ui.add_space(10.0);
            ui.label(RichText::new("Author").strong().color(p.muted));
            let mut authors = self
                .library
                .books
                .iter()
                .filter(|b| b.corpus == Corpus::EarlyChristian)
                .filter_map(|b| b.author.clone())
                .collect::<Vec<_>>();
            authors.sort();
            authors.dedup();
            let mut choices = vec![(String::new(), "All authors".to_owned())];
            choices.extend(authors.into_iter().map(|author| (author.clone(), author)));
            if let Some(author) = jump_picker(ui, "jump-author", &self.jump_author, &choices) {
                self.jump_author = author;
            }
        }
        let query = self.jump_filter.to_lowercase();
        let mut books = library
            .books
            .iter()
            .filter(|b| {
                b.corpus == self.jump_corpus
                    && (b.corpus != Corpus::Scripture || self.state.canon.includes(&b.title))
                    && (b.corpus == Corpus::Scripture
                        || self.jump_author.is_empty()
                        || b.author.as_deref() == Some(&self.jump_author))
                    && (query.is_empty()
                        || format!("{} {}", b.title, b.author.as_deref().unwrap_or(""))
                            .to_lowercase()
                            .contains(&query))
            })
            .collect::<Vec<_>>();
        if self.jump_corpus == Corpus::EarlyChristian {
            books.sort_by_key(|b| {
                (
                    !self.state.favorite_books.contains(&b.id),
                    b.id != self.jump_book,
                )
            });
            books.truncate(if query.is_empty() { 12 } else { 24 });
        }
        if !books.iter().any(|b| b.id == self.jump_book) {
            if let Some(b) = books.first() {
                self.jump_book = b.id.clone();
                self.jump_chapter = 1;
            }
        }
        ui.add_space(8.0);
        if self.jump_corpus == Corpus::Scripture {
            ui.label(RichText::new("Book").strong().color(p.muted));
            ui.spacing_mut().interact_size.y = 38.0;
            let choices = books
                .iter()
                .map(|book| (book.id.clone(), book.title.clone()))
                .collect::<Vec<_>>();
            if let Some(book) = jump_picker(ui, "jump-book", &self.jump_book, &choices) {
                self.jump_book = book;
                self.jump_chapter = 1;
            }
        } else {
            touch_scroll::vertical(
                ui,
                "jump-works",
                (ui.ctx().screen_rect().height() * 0.23)
                    .clamp(120.0, if compact { 174.0 } else { 260.0 }),
                false,
                |ui, inner_suppress| {
                    for book in &books {
                        let width = (ui.available_width() - 60.0).max(100.0);
                        ui.horizontal(|ui| {
                            let (rect, response) =
                                ui.allocate_exact_size(egui::vec2(width, 56.0), Sense::click());
                            response.widget_info(|| {
                                egui::WidgetInfo::labeled(
                                    egui::WidgetType::Button,
                                    ui.is_enabled(),
                                    format!(
                                        "{} · {}",
                                        book.title,
                                        book.author
                                            .as_deref()
                                            .unwrap_or("Early Christian writings")
                                    ),
                                )
                            });
                            let selected = self.jump_book == book.id;
                            ui.painter().rect(
                                rect,
                                4.0,
                                if selected {
                                    p.accent.gamma_multiply(0.10)
                                } else {
                                    p.panel
                                },
                                Stroke::new(1.0_f32, p.line),
                                egui::StrokeKind::Inside,
                            );
                            for (row, text) in [
                                book.title.as_str(),
                                book.author.as_deref().unwrap_or("Early Christian writings"),
                            ]
                            .iter()
                            .enumerate()
                            {
                                let mut job = egui::text::LayoutJob::simple(
                                    (*text).into(),
                                    FontId::proportional(if row == 0 { 13.0 } else { 11.0 }),
                                    if row == 0 { p.ink } else { p.muted },
                                    width - 20.0,
                                );
                                job.wrap.max_rows = 1;
                                job.wrap.break_anywhere = true;
                                let galley = ui.fonts(|fonts| fonts.layout_job(job));
                                ui.painter().galley(
                                    rect.min + egui::vec2(10.0, 9.0 + row as f32 * 20.0),
                                    galley,
                                    p.ink,
                                );
                            }
                            if response.clicked() && !suppress_click && !inner_suppress {
                                self.jump_book = book.id.clone();
                                self.jump_chapter = 1;
                            }
                            let favorite = self.state.favorite_books.contains(&book.id);
                            if icons::button(
                                ui,
                                icons::Icon::Star,
                                "",
                                egui::vec2(42.0, 56.0),
                                favorite,
                            )
                            .on_hover_text(if favorite {
                                "Remove favorite"
                            } else {
                                "Favorite work"
                            })
                            .clicked()
                                && !suppress_click
                                && !inner_suppress
                            {
                                self.toggle_favorite(&book.id);
                            }
                        });
                    }
                    if books.is_empty() {
                        ui.label("No matches");
                    }
                },
            );
        }
        ui.add_space(12.0);
        ui.spacing_mut().item_spacing = egui::vec2(8.0, 8.0);
        if let Some(book) = library
            .book(&self.jump_book)
            .filter(|b| books.iter().any(|visible| visible.id == b.id))
        {
            ui.label(RichText::new("Chapter").strong().color(p.muted));
            ui.horizontal_wrapped(|ui| {
                for chapter in &book.chapters {
                    if ui
                        .add_sized(
                            [42.0, 40.0],
                            egui::Button::new(
                                RichText::new(chapter.number.to_string())
                                    .strong()
                                    .color(p.accent),
                            )
                            .selected(self.jump_chapter == chapter.number)
                            .corner_radius(8.0),
                        )
                        .on_hover_text(&chapter.title)
                        .clicked()
                        && !suppress_click
                    {
                        self.jump_chapter = chapter.number;
                        if book.corpus == Corpus::EarlyChristian {
                            if let Some(id) = chapter.passage_ids.first() {
                                self.open(id.clone());
                            }
                        }
                    }
                }
            });
            if book.corpus == Corpus::Scripture {
                if let Some(chapter) = book.chapters.iter().find(|c| c.number == self.jump_chapter)
                {
                    let verses = chapter
                        .passage_ids
                        .iter()
                        .filter_map(|id| self.library.passage(id))
                        .flat_map(|p| p.verses.iter().map(|v| (v.number, p.id.clone())))
                        .collect::<Vec<_>>();
                    ui.add_space(12.0);
                    ui.label(RichText::new("Verse").strong().color(p.muted));
                    ui.horizontal_wrapped(|ui| {
                        for (number, id) in verses {
                            if ui
                                .add_sized(
                                    [42.0, 40.0],
                                    egui::Button::new(
                                        RichText::new(number.to_string()).strong().color(p.accent),
                                    )
                                    .corner_radius(8.0),
                                )
                                .clicked()
                                && !suppress_click
                            {
                                self.open(id.clone());
                                self.selected = Some(id);
                            }
                        }
                    });
                }
            }
        }
    }
    pub(super) fn search_dialog(
        &mut self,
        ui: &mut egui::Ui,
        ctx: &egui::Context,
        suppress_click: bool,
    ) {
        let p = self.state.theme.palette();
        let compact = Self::compact(ctx);
        ui.add_enabled_ui(!self.busy, |ui| {
            if icons::button(
                ui,
                icons::Icon::Jump,
                "Jump to specific passage",
                egui::vec2(ui.available_width(), 44.0),
                false,
            )
            .clicked()
                && !suppress_click
            {
                self.show_jump();
            }
            ui.add_space(6.0);
            ui.horizontal_wrapped(|ui| {
                if compact {
                    ui.spacing_mut().button_padding.x = 5.0;
                }
                if ui
                    .selectable_label(
                        self.semantic || self.search_source.is_some(),
                        "Search Index (Online)",
                    )
                    .clicked()
                    && !suppress_click
                {
                    if !self.semantic {
                        self.results.clear();
                        self.message.clear();
                    }
                    self.semantic = true;
                }
                if ui
                    .selectable_label(
                        !self.semantic && self.search_source.is_none(),
                        "Search Keywords",
                    )
                    .clicked()
                    && !suppress_click
                {
                    if self.semantic || self.search_source.is_some() {
                        self.results.clear();
                        self.message.clear();
                    }
                    self.semantic = false;
                    self.search_source = None;
                }
            });
            ui.add_space(if compact { 2.0 } else { 8.0 });
            let previous_target = self.search_corpus;
            ui.label(RichText::new("SEARCH").size(11.0).strong().color(p.muted));
            egui::Frame::NONE
                .fill(p.panel)
                .stroke(Stroke::new(1.0_f32, p.line))
                .corner_radius(8.0)
                .inner_margin(4.0)
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        let width = ((ui.available_width().min(252.0) - 8.0) / 2.0).max(60.0);
                        for (corpus, label) in [
                            (Corpus::Scripture, "BIBLE"),
                            (Corpus::EarlyChristian, "FATHERS"),
                        ] {
                            if ui
                                .add_sized(
                                    [width, 40.0],
                                    egui::RadioButton::new(
                                        self.search_corpus == Some(corpus),
                                        RichText::new(label).strong(),
                                    ),
                                )
                                .clicked()
                                && !suppress_click
                            {
                                self.search_corpus = Some(corpus);
                            }
                        }
                    });
                });
            if self.search_corpus != previous_target {
                self.results.clear();
                self.message.clear();
            }
            ui.add_space(if compact { 4.0 } else { 12.0 });
            if let Some(source) = self.search_source.clone() {
                egui::Frame::NONE
                    .fill(p.panel)
                    .stroke(Stroke::new(1.0_f32, p.line))
                    .inner_margin(if compact { 6.0 } else { 14.0 })
                    .corner_radius(6.0)
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.add_sized(
                                [(ui.available_width() - 52.0).max(40.0), 44.0],
                                egui::Label::new(
                                    RichText::new(&source.reference).font(heading(20.0)),
                                )
                                .wrap(),
                            );
                            if control(ui, "×")
                                .on_hover_text("Clear similar passage")
                                .clicked()
                                && !suppress_click
                            {
                                self.search_source = None;
                            }
                        });
                        ui.label(RichText::new(&source.text).font(serif(18.0)));
                    });
            } else {
                ui.label(
                    RichText::new(if self.search_corpus == Some(Corpus::Scripture) {
                        "SEARCH BIBLE FOR…"
                    } else {
                        "SEARCH EARLY CHRISTIAN WORKS FOR…"
                    })
                    .size(11.0)
                    .strong()
                    .color(p.muted),
                );
                ui.add_space(4.0);
                ui.add(
                    egui::TextEdit::multiline(&mut self.query)
                        .desired_rows(4)
                        .id(Id::new("search-query"))
                        .hint_text(if compact {
                            "Search by theme or words…"
                        } else {
                            "Hope after death, greed and money problems, anxiety…"
                        })
                        .font(FontId::proportional(16.0))
                        .min_size(egui::vec2(0.0, if compact { 132.0 } else { 110.0 }))
                        .char_limit(500)
                        .margin(if compact {
                            egui::vec2(10.0, 10.0)
                        } else {
                            egui::vec2(14.0, 12.0)
                        })
                        .desired_width(f32::INFINITY),
                );
            }
            ui.add_space(if compact { 4.0 } else { 10.0 });
            let action_layout = if compact {
                Layout::top_down(Align::Min)
            } else {
                Layout::left_to_right(Align::Center)
            };
            // A horizontal row must not consume the remaining search viewport.
            ui.allocate_ui_with_layout(
                egui::vec2(ui.available_width(), 50.0),
                action_layout,
                |ui| {
                    let count = if self.search_corpus == Some(Corpus::Scripture) {
                        self.search_books
                            .iter()
                            .filter(|b| self.state.canon.includes(b))
                            .count()
                    } else {
                        self.search_authors.len()
                    } + usize::from(self.match_count != 10);
                    let label = if count == 0 {
                        "Filters".into()
                    } else {
                        format!("Filters ({count})")
                    };
                    let filter_width = if compact { ui.available_width() } else { 100.0 };
                    if icons::button(
                        ui,
                        icons::Icon::Filters,
                        &label,
                        egui::vec2(filter_width, 44.0),
                        false,
                    )
                    .clicked()
                        && !suppress_click
                    {
                        self.filters_open = !self.filters_open;
                    }
                    let ready =
                        self.search_source.is_some() || self.query.trim().chars().count() >= 3;
                    let target = if self.search_corpus == Some(Corpus::Scripture) {
                        "Bible"
                    } else {
                        "Fathers"
                    };
                    let button_width = if compact { ui.available_width() } else { 132.0 };
                    if ui
                        .add_enabled_ui(ready, |ui| {
                            icons::button(
                                ui,
                                icons::Icon::Search,
                                &format!(
                                    "{} {target}",
                                    if self.search_source.is_some() {
                                        "Find"
                                    } else {
                                        "Search"
                                    }
                                ),
                                egui::vec2(button_width, 50.0),
                                true,
                            )
                        })
                        .inner
                        .clicked()
                        && !suppress_click
                    {
                        ctx.memory_mut(|m| m.surrender_focus(Id::new("search-query")));
                        self.search(ctx, None);
                    }
                },
            );
        });
        if !self.semantic && self.search_source.is_none() {
            ui.add_space(8.0);
            ui.label(
                RichText::new("Keyword search matches every word in your query. Works offline.")
                    .size(11.0)
                    .color(p.muted),
            );
        }
        ui.add_space(if compact { 4.0 } else { 12.0 });
        ui.separator();
        ui.add_space(if compact { 2.0 } else { 10.0 });
        if self.busy {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label("Finding passages…");
            });
        } else if !self.message.is_empty() {
            ui.label(RichText::new(&self.message).color(p.muted));
        } else if self.results.is_empty() {
            ui.label(
                RichText::new("Search by theme or choose a passage to find similar texts.")
                    .color(p.muted),
            );
        }
        let results = self.results.clone();
        ui.scope(|ui| {
            for (index, hit) in results.into_iter().enumerate() {
                ui.add_space(12.0);
                let selected = self.selected_result.as_deref() == Some(&hit.source_id);
                let frame = egui::Frame::NONE
                    .fill(if selected {
                        p.accent.gamma_multiply(0.07)
                    } else {
                        p.paper
                    })
                    .corner_radius(6.0)
                    .inner_margin(if compact { 10.0 } else { 16.0 })
                    .show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        let body_top = ui.cursor().min;
                        ui.horizontal_wrapped(|ui| {
                            ui.label(
                                RichText::new(hit.reference.to_uppercase())
                                    .size(11.0)
                                    .strong()
                                    .color(p.accent),
                            );
                            let passage = self.library.passage(&hit.id).unwrap();
                            ui.label(
                                RichText::new(if hit.corpus == Corpus::Scripture {
                                    "WEB · WORLD ENGLISH BIBLE".to_owned()
                                } else {
                                    passage.author.clone().unwrap_or_default()
                                })
                                .size(10.5)
                                .color(p.muted),
                            );
                        });
                        if self.results_semantic {
                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new("MATCH STRENGTH")
                                        .size(10.5)
                                        .strong()
                                        .color(p.muted),
                                );
                                let (dots, response) =
                                    ui.allocate_exact_size(egui::vec2(44.0, 16.0), Sense::hover());
                                for level in 0..4 {
                                    let center = egui::pos2(
                                        dots.left() + 4.0 + level as f32 * 10.0,
                                        dots.center().y,
                                    );
                                    ui.painter().circle_stroke(
                                        center,
                                        3.0,
                                        Stroke::new(1.0_f32, p.accent.gamma_multiply(0.45)),
                                    );
                                    if level < hit.strength() {
                                        ui.painter().circle_filled(center, 3.0, p.accent);
                                    }
                                }
                                response.on_hover_text(format!(
                                    "{} of 4 match strength",
                                    hit.strength()
                                ));
                            });
                        }
                        ui.add_space(8.0);
                        let passage = self.library.passage(&hit.id).unwrap();
                        let mut job = egui::text::LayoutJob::default();
                        if hit.corpus == Corpus::Scripture {
                            for (i, verse) in passage.verses.iter().enumerate() {
                                if i > 0 {
                                    job.append(
                                        " ",
                                        0.0,
                                        egui::TextFormat {
                                            font_id: serif(18.0),
                                            color: p.ink,
                                            line_height: Some(18.0 * 1.62),
                                            ..Default::default()
                                        },
                                    );
                                }
                                job.append(
                                    &verse.text,
                                    0.0,
                                    egui::TextFormat {
                                        font_id: serif(18.0),
                                        color: p.ink,
                                        line_height: Some(18.0 * 1.62),
                                        background: if hit.highlight_verse == Some(verse.number) {
                                            p.accent.gamma_multiply(0.12)
                                        } else {
                                            egui::Color32::TRANSPARENT
                                        },
                                        ..Default::default()
                                    },
                                );
                            }
                        } else {
                            job.append(
                                &hit.text,
                                0.0,
                                egui::TextFormat {
                                    font_id: serif(18.0),
                                    color: p.ink,
                                    line_height: Some(18.0 * 1.62),
                                    ..Default::default()
                                },
                            );
                        }
                        job.wrap.max_width = ui.available_width();
                        let galley = ui.fonts(|f| f.layout_job(job));
                        ui.add(egui::Label::new(galley));
                        let body_rect = Rect::from_min_max(
                            body_top,
                            egui::pos2(ui.max_rect().right(), ui.cursor().top()),
                        );
                        if ui
                            .interact(
                                body_rect,
                                Id::new(("search-result", &hit.source_id)),
                                Sense::click(),
                            )
                            .clicked()
                            && !suppress_click
                        {
                            self.selected_result = if selected {
                                None
                            } else {
                                Some(hit.source_id.clone())
                            };
                        }
                        if selected {
                            ui.add_space(10.0);
                            ui.horizontal_wrapped(|ui| {
                                if control(ui, "View in context").clicked() && !suppress_click {
                                    self.open(hit.id.clone());
                                }
                                ui.add_enabled_ui(!self.busy, |ui| {
                                    if control(ui, "Similar passages").clicked() && !suppress_click
                                    {
                                        self.search_corpus = Some(hit.corpus);
                                        self.search(ctx, Some(hit.source_id.clone()));
                                    }
                                    if control(
                                        ui,
                                        if hit.corpus == Corpus::Scripture {
                                            "Find Fathers"
                                        } else {
                                            "Find Bible"
                                        },
                                    )
                                    .clicked()
                                        && !suppress_click
                                    {
                                        self.search_corpus =
                                            Some(if hit.corpus == Corpus::Scripture {
                                                Corpus::EarlyChristian
                                            } else {
                                                Corpus::Scripture
                                            });
                                        self.search(ctx, Some(hit.source_id.clone()));
                                    }
                                });
                                if control(ui, "Copy").clicked() && !suppress_click {
                                    ctx.copy_text(format!("{}\n{}", hit.reference, hit.text));
                                }
                            });
                        }
                    });
                // Capture the scrolled results state without changing normal
                // search behavior. The reference web app leaves scrolling to the reader.
                if index == 0
                    && self.screenshot.is_some()
                    && !self.screenshot_sent
                    && std::env::var("CROSS_CANON_PREVIEW").as_deref() == Ok("search-results")
                {
                    ui.scroll_to_rect(frame.response.rect, Some(Align::TOP));
                }
                let strength = if self.results_semantic {
                    hit.strength()
                } else {
                    1
                };
                ui.painter().vline(
                    frame.response.rect.left() + 1.5,
                    frame.response.rect.y_range(),
                    Stroke::new(
                        2.0_f32,
                        p.accent.gamma_multiply(0.2 + strength as f32 * 0.18),
                    ),
                );
                ui.add_space(16.0);
                ui.separator();
            }
        });
    }
    fn search_filter_modal(&mut self, ctx: &egui::Context) {
        let p = self.state.theme.palette();
        let insets = mobile::insets();
        let width =
            (ctx.screen_rect().width() - insets.left - insets.right - 48.0).clamp(220.0, 560.0);
        let response = egui::Modal::new(Id::new("search-filter-dialog"))
            .frame(
                egui::Frame::window(&ctx.style())
                    .fill(p.paper)
                    .inner_margin(12.0)
                    .corner_radius(8.0)
                    .stroke(Stroke::new(1.0_f32, p.line)),
            )
            .show(ctx, |ui| {
                ui.set_width(width);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Filters").strong().size(16.0));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if control(ui, "Close").clicked() {
                            self.filters_open = false;
                        }
                    });
                });
                ui.separator();
                let height = (ctx.screen_rect().height() - insets.top - insets.bottom - 180.0)
                    .clamp(64.0, 600.0);
                touch_scroll::vertical(ui, "search-filter-body", height, false, |ui, _| {
                    self.search_filters(ui)
                });
                ui.separator();
                ui.horizontal(|ui| {
                    let half = (ui.available_width() - 8.0) / 2.0;
                    if ui
                        .add_sized([half, 44.0], egui::Button::new("Clear all"))
                        .clicked()
                    {
                        self.match_count = 10;
                        self.search_books.clear();
                        self.search_authors.clear();
                    }
                    if ui
                        .add_sized(
                            [half, 44.0],
                            egui::Button::new(RichText::new("Done").color(p.paper)).fill(p.accent),
                        )
                        .clicked()
                    {
                        self.filters_open = false;
                    }
                });
            });
        if response.should_close() {
            self.filters_open = false;
        }
    }
    fn search_filters(&mut self, ui: &mut egui::Ui) {
        ui.add_space(12.0);
        let p = self.state.theme.palette();
        egui::Frame::NONE
            .fill(p.panel)
            .stroke(Stroke::new(1.0_f32, p.line))
            .corner_radius(6.0)
            .inner_margin(14.0)
            .show(ui, |ui| {
                ui.label("Matches");
                ui.add(egui::DragValue::new(&mut self.match_count).range(5..=40));
                ui.add_space(8.0);
                if self.search_corpus == Some(Corpus::Scripture) {
                    ui.label("Canon");
                    let mut canon = self.state.canon;
                    egui::ComboBox::from_id_salt("search-canon")
                        .width(ui.available_width() - 12.0)
                        .selected_text(format!("{canon:?}"))
                        .show_ui(ui, |ui| {
                            for choice in [Canon::Protestant, Canon::Catholic, Canon::Orthodox] {
                                ui.selectable_value(&mut canon, choice, format!("{choice:?}"));
                            }
                        });
                    self.update_canon(canon);
                    ui.add_space(8.0);
                    ui.label("Books · leave blank to search every book in this canon");
                    let books: Vec<_> = self
                        .library
                        .books
                        .iter()
                        .filter(|b| {
                            b.corpus == Corpus::Scripture && self.state.canon.includes(&b.title)
                        })
                        .map(|b| b.id.clone())
                        .collect();
                    let columns = if Self::compact(ui.ctx()) { 1 } else { 3 };
                    touch_scroll::vertical(
                        ui,
                        "search-books",
                        if Self::compact(ui.ctx()) {
                            360.0
                        } else {
                            240.0
                        },
                        false,
                        |ui, suppress_click| {
                            egui::Grid::new("search-book-grid")
                                .num_columns(columns)
                                .show(ui, |ui| {
                                    for (i, id) in books.iter().enumerate() {
                                        let mut selected = self.search_books.contains(id);
                                        if ui.checkbox(&mut selected, id).changed()
                                            && !suppress_click
                                        {
                                            if selected {
                                                self.search_books.push(id.clone());
                                            } else {
                                                self.search_books.retain(|b| b != id);
                                            }
                                        }
                                        if (i + 1) % columns == 0 {
                                            ui.end_row();
                                        }
                                    }
                                });
                        },
                    );
                } else {
                    ui.label("Fathers authors · choose up to 3, or leave blank for all");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.author_filter)
                            .hint_text("Find author…")
                            .desired_width(f32::INFINITY),
                    );
                    let authors: std::collections::BTreeSet<_> = self
                        .library
                        .books
                        .iter()
                        .filter_map(|b| b.author.clone())
                        .collect();
                    touch_scroll::vertical(
                        ui,
                        "search-authors",
                        180.0,
                        false,
                        |ui, suppress_click| {
                            for author in authors {
                                let mut selected = self.search_authors.contains(&author);
                                if !selected
                                    && !author
                                        .to_lowercase()
                                        .contains(&self.author_filter.to_lowercase())
                                {
                                    continue;
                                }
                                if ui
                                    .add_enabled(
                                        selected || self.search_authors.len() < 3,
                                        egui::Checkbox::new(&mut selected, &author),
                                    )
                                    .changed()
                                    && !suppress_click
                                {
                                    if selected {
                                        self.search_authors.push(author);
                                    } else {
                                        self.search_authors.retain(|a| a != &author);
                                    }
                                }
                            }
                        },
                    );
                }
            });
    }
    pub(super) fn settings_dialog(&mut self, ui: &mut egui::Ui) {
        ui.horizontal_wrapped(|ui| {
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
        ui.horizontal_wrapped(|ui| {
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
        let mut canon = self.state.canon;
        ui.horizontal_wrapped(|ui| {
            for choice in [Canon::Protestant, Canon::Catholic, Canon::Orthodox] {
                ui.selectable_value(&mut canon, choice, format!("{choice:?}"));
            }
        });
        self.update_canon(canon);
        ui.checkbox(&mut self.state.original, "Original Early Christian text");
        ui.add_space(12.0);
        if control(ui, "Offline audio…").clicked() {
            self.dialog = Some(Dialog::Downloads);
        }
        ui.add_space(18.0);
        ui.collapsing("Connection", |ui| {
            ui.label("Search service");
            ui.add(
                egui::TextEdit::singleline(&mut self.state.api_url).desired_width(f32::INFINITY),
            );
        });
        ui.label(
            RichText::new(format!(
                "{} books · {} passages · all texts stored locally",
                self.library.books.len(),
                self.library.passages.len()
            ))
            .size(11.0),
        );
    }

    fn audio_downloads(&mut self, ui: &mut egui::Ui, suppress_click: bool) {
        let downloads = self
            .downloads
            .get_or_insert_with(|| downloads::Downloads::new(&self.library));
        ui.label("All Bible and Early Christian texts are included offline. Audio streams until you choose to download it.");
        ui.label(
            RichText::new(
                "Keep the app open while downloading. Completed tracks are kept if interrupted.",
            )
            .size(12.0),
        );
        let mut start = None;
        let mut remove = None;
        let mut pause = false;
        let mut row = |ui: &mut egui::Ui, work: &downloads::Work| {
            ui.add_space(12.0);
            ui.label(RichText::new(&work.title).strong());
            ui.label(
                RichText::new(format!(
                    "Audio for {} of {} chapters",
                    work.chapters, work.total_chapters
                ))
                .size(11.0),
            );
            if let Some(active) = downloads.active.as_ref().filter(|a| a.id == work.id) {
                ui.add(
                    egui::ProgressBar::new(active.done as f32 / active.total.max(1) as f32).text(
                        format!(
                            "{} / {} tracks · {:.1} MB",
                            active.done,
                            active.total,
                            active.bytes as f64 / 1e6
                        ),
                    ),
                );
                if control(ui, "Pause download").clicked() && !suppress_click {
                    pause = true;
                }
            } else {
                if work.downloaded == work.urls.len() {
                    ui.label(format!("Ready offline · {:.1} MB", work.bytes as f64 / 1e6));
                } else if work.downloaded > 0 {
                    ui.label(format!(
                        "{} / {} tracks downloaded",
                        work.downloaded,
                        work.urls.len()
                    ));
                }
                ui.add_enabled_ui(downloads.active.is_none(), |ui| {
                    ui.horizontal_wrapped(|ui| {
                        if work.downloaded < work.urls.len()
                            && control(
                                ui,
                                if work.downloaded > 0 {
                                    "Resume"
                                } else {
                                    "Download audio"
                                },
                            )
                            .clicked()
                            && !suppress_click
                        {
                            start = Some(work.id.clone());
                        }
                        if work.downloaded > 0
                            && control(ui, "Remove audio").clicked()
                            && !suppress_click
                        {
                            remove = Some(work.id.clone());
                        }
                    });
                });
            }
        };
        ui.add_space(12.0);
        ui.heading("Bible audio");
        let size = if self
            .library
            .audio("Genesis:1")
            .is_some_and(|a| a.url.starts_with("/audio/WEBD_AT/"))
        {
            "1.4"
        } else {
            "2.2"
        };
        ui.label(RichText::new(format!("66 recorded books. The full download uses about {size} GB; individual books use less.")).size(12.0));
        if let Some(all) = downloads
            .works
            .iter()
            .find(|w| w.id == downloads::ALL_BIBLE)
        {
            row(ui, all);
        }
        egui::CollapsingHeader::new("Choose individual Bible books").show(ui, |ui| {
            for work in downloads
                .works
                .iter()
                .filter(|w| w.corpus == Corpus::Scripture && w.id != downloads::ALL_BIBLE)
            {
                row(ui, work);
            }
        });
        ui.add_space(16.0);
        ui.heading("Early Christian audio");
        for work in downloads
            .works
            .iter()
            .filter(|w| w.corpus == Corpus::EarlyChristian)
        {
            row(ui, work);
        }
        ui.add_space(8.0);
        ui.label(
            RichText::new("Other works have no chapter-aligned recordings available.").size(11.0),
        );
        if !downloads.message.is_empty() {
            ui.label(&downloads.message);
        }
        if let Some(id) = start {
            downloads.start(&id, ui.ctx());
        }
        if let Some(id) = remove {
            downloads.remove(&id);
        }
        if pause {
            downloads.pause();
        }
    }
}

fn jump_picker(
    ui: &mut egui::Ui,
    id: &'static str,
    selected: &str,
    choices: &[(String, String)],
) -> Option<String> {
    let mut next = None;
    let label = choices
        .iter()
        .find(|(value, _)| value == selected)
        .map(|(_, label)| label.as_str())
        .unwrap_or("Choose a book");
    let height = (ui.ctx().screen_rect().height() * 0.4).clamp(120.0, 260.0);
    ui.spacing_mut().interact_size.y = 38.0;
    egui::ComboBox::from_id_salt(id)
        .width(ui.available_width() - 16.0)
        .height(height + 10.0)
        .selected_text(label)
        .show_ui(ui, |ui| {
            touch_scroll::vertical(ui, id, height, false, |ui, suppress_click| {
                for (value, label) in choices {
                    if ui.selectable_label(value == selected, label).clicked() && !suppress_click {
                        next = Some(value.clone());
                        ui.close_menu();
                    }
                }
            });
        });
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phone_jump_keeps_picker_visible_and_navigates_both_corpora() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        for width in [320.0, 393.0, 1000.0] {
            for corpus in [Corpus::Scripture, Corpus::EarlyChristian] {
                let ctx = egui::Context::default();
                let mut app = Desktop::initialize(&ctx, None, library.clone());
                let passage = library
                    .passages
                    .iter()
                    .find(|p| p.corpus == corpus && p.chapter == 1)
                    .unwrap();
                app.open(passage.id.clone());
                app.show_jump();
                let render = |app: &mut Desktop, events| {
                    ctx.run(
                        egui::RawInput {
                            screen_rect: Some(Rect::from_min_size(
                                egui::Pos2::ZERO,
                                egui::vec2(width, 700.0),
                            )),
                            events,
                            ..Default::default()
                        },
                        |ctx| app.render(ctx),
                    )
                };
                for _ in 0..3 {
                    render(&mut app, vec![]);
                }
                let output = render(&mut app, vec![]);
                let texts: Vec<_> = output
                    .shapes
                    .iter()
                    .filter_map(|shape| {
                        if let egui::Shape::Text(text) = &shape.shape {
                            shape.clip_rect.contains(text.pos).then_some(text)
                        } else {
                            None
                        }
                    })
                    .collect();
                let title = if corpus == Corpus::Scripture {
                    "Choose a passage"
                } else {
                    "Choose a work"
                };
                assert!(
                    texts.iter().any(|t| t.galley.job.text == title),
                    "Jump title must fit at {width}"
                );
                let chapter = texts
                    .iter()
                    .find(|t| t.galley.job.text == "Chapter")
                    .unwrap_or_else(|| panic!("Chapter picker must be visible at width {width}, corpus {corpus:?}; visible labels: {:?}", texts.iter().map(|t| &t.galley.job.text).collect::<Vec<_>>()));
                for text in texts
                    .iter()
                    .filter(|t| t.pos.y > chapter.pos.y && t.galley.job.text.parse::<u32>().is_ok())
                {
                    assert!(
                        text.pos.x >= 8.0 && text.pos.x + text.galley.size().x <= width - 8.0,
                        "Chapter numbers must fit screen at {width}: {:?}",
                        text.pos
                    );
                }
                let two = texts
                    .iter()
                    .find(|t| t.galley.job.text == "2" && t.pos.y > chapter.pos.y)
                    .expect("Chapter 2 must be visible");
                let pos = two.pos + two.galley.size() / 2.0;
                for pressed in [true, false] {
                    render(
                        &mut app,
                        vec![
                            egui::Event::PointerMoved(pos),
                            egui::Event::PointerButton {
                                pos,
                                button: egui::PointerButton::Primary,
                                pressed,
                                modifiers: egui::Modifiers::NONE,
                            },
                        ],
                    );
                }
                assert_eq!(app.jump_chapter, 2);
                if corpus == Corpus::EarlyChristian {
                    assert!(
                        app.dialog.is_none(),
                        "Choosing a work chapter opens it immediately"
                    );
                    assert_eq!(app.current_passage().chapter, 2);
                } else {
                    assert!(
                        app.dialog == Some(Dialog::Jump),
                        "Bible chapter selection keeps Verse choices open"
                    );
                }
            }
        }
    }
}
