use super::*;

// Scripture is one continuous reading sequence in the selected Canon. Works
// keep their own chapter sequence; collection/catalog order is not reading order.
pub(super) fn sequence_key(book: &Book, canon: Canon) -> String {
    if book.corpus == Corpus::Scripture && canon.includes(&book.title) {
        format!("scripture:{canon:?}")
    } else {
        book.id.clone()
    }
}

pub(super) fn chapter_sequence<'a>(
    library: &'a Library,
    book: &'a Book,
    canon: Canon,
) -> Vec<(&'a Book, &'a cross_canon_core::Chapter)> {
    library
        .books
        .iter()
        .filter(|candidate| {
            if book.corpus == Corpus::Scripture && canon.includes(&book.title) {
                candidate.corpus == Corpus::Scripture && canon.includes(&candidate.title)
            } else {
                candidate.id == book.id
            }
        })
        .flat_map(|book| book.chapters.iter().map(move |chapter| (book, chapter)))
        .collect()
}

/// Exact measured geometry survives egui's per-frame text-cache eviction. Reuse
/// it for off-screen content so a drag doesn't lay out every page of a Work.
#[derive(Default)]
pub(super) struct ReaderLayout {
    key: Option<LayoutKey>,
    chapters: std::collections::HashMap<String, f32>,
    passages: std::collections::HashMap<String, f32>,
    selected: Option<String>,
    modernized_ranges: std::collections::HashMap<String, Vec<std::ops::Range<usize>>>,
    // Never measure an entire Work to discover its scroll height. Henry has
    // 1,189 chapters; keeping every first-frame galley exhausts phone memory.
    window: std::ops::Range<usize>,
    location_pending: bool,
}

#[derive(PartialEq)]
struct LayoutKey {
    sequence: String,
    width: f32,
    font_scale: f32,
    line_height: f32,
    pixels_per_point: f32,
    original: bool,
    translation: reading_translation::Translation,
    theme: Theme,
}

impl Desktop {
    pub(super) fn toolbar(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let p = self.state.theme.palette();
        let (_, chapter) = self.library.chapter(&self.active_chapter_id).unwrap();
        let focused = self
            .library
            .passage(&chapter.passage_ids[0])
            .unwrap()
            .clone();
        let compact = Self::compact(ctx);
        let label = format!("Library · {} {} ⌄", focused.book, focused.chapter);
        // Reserve the same title width in both states. Tools float above the reader,
        // so toggling them cannot change title fitting or the reader's origin.
        let title_width = (ui.available_width() - 104.0).max(20.0);
        let fathers = focused.corpus != Corpus::Scripture;
        let base = if fathers {
            if compact {
                28.48
            } else {
                32.8
            }
        } else if compact {
            27.3
        } else {
            34.1
        };
        let measured = ui
            .fonts(|f| f.layout_no_wrap(label.clone(), heading(base), p.ink))
            .size()
            .x;
        let size = (base * ((title_width - 2.0) / measured).min(1.0)).max(if compact {
            18.0
        } else {
            20.0
        });
        // Long Work names may wrap, with actual text height determining the header.
        let galley = ui.fonts(|f| f.layout(label.clone(), heading(size), p.ink, title_width));
        let kicker = if fathers { 18.0 } else { 0.0 };
        let height = (galley.size().y + kicker + 18.0).max(if compact { 63.0 } else { 61.0 });
        let (rect, _) =
            ui.allocate_exact_size(egui::vec2(ui.available_width(), height), Sense::hover());
        self.jump_button_rect =
            Rect::from_min_max(rect.min, egui::pos2(rect.right() - 104.0, rect.bottom()));
        let header_response = ui.interact(
            self.jump_button_rect,
            Id::new("reader-library-title"),
            Sense::click(),
        );
        header_response
            .widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, &label));
        if header_response.on_hover_text("Open Library").clicked() {
            self.show_library();
        }
        let title_origin = rect.min + egui::vec2(0.0, 9.0);
        if fathers {
            ui.painter().text(
                title_origin,
                Align2::LEFT_TOP,
                collection_name(focused.corpus).to_uppercase(),
                FontId::proportional(10.5),
                p.accent,
            );
        }
        ui.painter()
            .galley(title_origin + egui::vec2(0.0, kicker), galley, p.ink);
        let search_rect = Rect::from_min_size(
            egui::pos2(rect.right() - 92.0, rect.top() + 9.0),
            egui::vec2(44.0, 44.0),
        );
        let mut search_ui = ui.new_child(egui::UiBuilder::new().max_rect(search_rect));
        if icons::button(
            &mut search_ui,
            icons::Icon::Search,
            "",
            egui::vec2(44.0, 44.0),
            false,
        )
        .on_hover_text("Search themes or keywords")
        .clicked()
        {
            self.tools = false;
            self.show_text_search();
        }
        let actions = Rect::from_min_size(
            egui::pos2(rect.right() - 44.0, rect.top() + 9.0),
            egui::vec2(44.0, 44.0),
        );
        {
            let mut actions_ui = ui.new_child(egui::UiBuilder::new().max_rect(actions));
            let ui = &mut actions_ui;
            let response = ui.add_sized(
                [44.0, if compact { 44.0 } else { 38.0 }],
                egui::Button::new("").corner_radius(8.0),
            );
            for offset in [-5.0, 0.0, 5.0] {
                ui.painter().circle_filled(
                    response.rect.center() + egui::vec2(0.0, offset),
                    1.3,
                    p.accent,
                );
            }
            response.widget_info(|| {
                egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Reader tools")
            });
            if response
                .on_hover_text(if self.tools {
                    "Close reader tools"
                } else {
                    "Open reader tools"
                })
                .clicked()
            {
                self.tools = !self.tools;
            }
        }
        ui.painter()
            .hline(rect.x_range(), rect.bottom(), Stroke::new(1.0_f32, p.line));
        self.toolbar_rect = rect;
        self.tools_rect = Rect::NOTHING;
        if self.tools && self.dialog.is_none() {
            let popup_width = rect.width().min(340.0);
            let popup = egui::Area::new(Id::new("reader-tools-popover"))
                .order(egui::Order::Foreground)
                .fixed_pos(egui::pos2(rect.right() - popup_width, rect.bottom() + 6.0))
                .show(ctx, |ui| {
                    egui::Frame::popup(ui.style())
                        .fill(p.paper)
                        .inner_margin(10.0)
                        .corner_radius(8.0)
                        .show(ui, |ui| {
                            ui.set_width(popup_width - 20.0);
                            ui.horizontal_wrapped(|ui| {
                                self.toolbar_controls(ui, &focused);
                            });
                        });
                });
            self.tools_rect = popup.response.rect;
            if self.dialog.is_some() {
                self.tools = false;
            }
        }
    }
    fn toolbar_controls(&mut self, ui: &mut egui::Ui, focused: &Passage) {
        let order = if Self::compact(ui.ctx()) {
            [0, 4, 2, 5]
        } else {
            [0, 2, 4, 5]
        };
        for action in order {
            match action {
                0 => {
                    if icons::button(ui, icons::Icon::Close, "", egui::vec2(44.0, 44.0), false)
                        .on_hover_text("Close tools")
                        .clicked()
                    {
                        self.tools = false;
                    }
                }
                2 => {
                    if control(ui, "Aa").on_hover_text("Reader settings").clicked() {
                        self.dialog = Some(Dialog::Settings);
                    }
                }
                5 => {
                    if icons::button(ui, icons::Icon::Account, "", egui::vec2(44.0, 44.0), false)
                        .on_hover_text("Account and reading progress")
                        .clicked()
                    {
                        self.dialog = Some(Dialog::Account);
                    }
                }
                _ => {
                    let available = self.library.audio(&focused.chapter_id);
                    if ui
                        .add_enabled_ui(available.is_some(), |ui| {
                            icons::button(
                                ui,
                                if self.playing
                                    && self.audio_chapter.as_deref() == Some(&focused.chapter_id)
                                {
                                    icons::Icon::Pause
                                } else {
                                    icons::Icon::Play
                                },
                                "",
                                egui::vec2(44.0, 44.0),
                                false,
                            )
                        })
                        .inner
                        .on_hover_text(if focused.corpus == Corpus::Scripture {
                            "Play or pause WEB chapter audio"
                        } else {
                            "Play or pause chapter audio"
                        })
                        .clicked()
                    {
                        self.play_audio(&focused.chapter_id);
                    }
                }
            }
        }
    }
    pub(super) fn reader(&mut self, ui: &mut egui::Ui) {
        let p = self.state.theme.palette();
        let library = self.library.clone();
        let reading_text = self.reading_text.clone();
        let book = library.book(&self.current_passage().book_id).unwrap();
        let sequence = sequence_key(book, self.state.canon);
        let chapters = chapter_sequence(&library, book, self.state.canon);
        let mut measured = std::mem::take(&mut self.reader_layout);
        let mut focused_visible = None;
        let mut scripture_target = None;
        let mut target = self.scroll_target.clone();
        let mut prepended_height = 0.0;
        let touch = self.reader_touch.frame(
            ui.ctx(),
            ui.available_rect_before_wrap(),
            self.last_scroll,
            self.reader_max_scroll,
            target.is_none() && self.dialog.is_none() && !self.tools,
        );
        let mut area = egui::ScrollArea::vertical()
            .id_salt(("reader", &sequence))
            // Explicit Reader Locations settle in one frame. Animated offsets
            // otherwise look like passive reading and overwrite the requested focus.
            .animated(false)
            .auto_shrink([false, false])
            .drag_to_scroll(!touch.controls_scrolling);
        if let Some(offset) = touch.offset {
            area = area.vertical_scroll_offset(offset);
        }
        let output = area.show_viewport(ui, |ui, viewport| {
            let content_width = ui.available_width();
            ui.set_width(content_width);
            ui.spacing_mut().item_spacing.y = 0.0;
            let key = LayoutKey {
                sequence: sequence.clone(),
                width: content_width,
                font_scale: self.state.font_scale,
                line_height: self.state.line_height,
                pixels_per_point: ui.ctx().pixels_per_point(),
                original: self.state.original,
                translation: self.state.scripture_translation,
                theme: self.state.theme,
            };
            let layout_changed = measured.key.as_ref() != Some(&key);
            if layout_changed {
                measured = ReaderLayout {
                    key: Some(key),
                    ..Default::default()
                };
                // Reflow restores the saved Passage, rather than interpreting
                // an offset measured with a different font or orientation.
                target.get_or_insert_with(|| self.state.location_passage_id.clone());
            }
            if target.is_some() || measured.window.is_empty() {
                let chapter_id = target
                    .as_deref()
                    .and_then(|id| library.passage(id))
                    .map(|p| p.chapter_id.as_str())
                    .unwrap_or(&self.active_chapter_id);
                let index = chapters
                    .iter()
                    .position(|(_, c)| c.id == chapter_id)
                    .unwrap_or(0);
                measured.window = index.saturating_sub(1)..(index + 2).min(chapters.len());
            }
            if measured.selected != self.selected {
                for id in measured.selected.iter().chain(self.selected.iter()) {
                    measured.passages.remove(id);
                    if let Some(passage) = library.passage(id) {
                        measured.chapters.remove(&passage.chapter_id);
                    }
                }
                measured.selected = self.selected.clone();
            }
            let target_chapter = target
                .as_deref()
                .and_then(|id| library.passage(id))
                .map(|p| &p.chapter_id);
            let near_viewport = ui.clip_rect().expand2(egui::vec2(0.0, viewport.height()));
            let previous_start = measured.window.start;
            if target.is_none() {
                if viewport.top() < viewport.height() && measured.window.start > 0 {
                    measured.window.start -= 1;
                }
                if viewport.top() > self.reader_max_scroll - viewport.height()
                    && measured.window.end < chapters.len()
                {
                    measured.window.end += 1;
                    ui.ctx().request_repaint();
                }
            }
            for (index, &(book, chapter)) in chapters
                .iter()
                .enumerate()
                .take(measured.window.end)
                .skip(measured.window.start)
            {
                let section_top = ui.cursor().top();
                if target_chapter != Some(&chapter.id) {
                    if let Some(&height) = measured.chapters.get(&chapter.id) {
                        let rect =
                            Rect::from_min_size(ui.cursor().min, egui::vec2(content_width, height));
                        if !rect.intersects(near_viewport) {
                            ui.advance_cursor_after_rect(rect);
                            if index < previous_start {
                                prepended_height += height;
                            }
                            continue;
                        }
                    }
                }
                if chapter.number == 1 {
                    self.book_heading(ui, book);
                } else {
                    ui.add_space(34.0);
                    let (r, _) =
                        ui.allocate_exact_size(egui::vec2(content_width, 1.0), Sense::hover());
                    ui.painter().hline(
                        r.x_range(),
                        r.top(),
                        Stroke::new(1.0_f32, p.line.gamma_multiply(0.42)),
                    );
                    ui.add_space(24.0);
                }
                let chapter_top = ui.cursor().min;
                let author_width = if book.corpus == Corpus::Scripture {
                    128.0
                } else if Self::compact(ui.ctx()) {
                    80.0
                } else {
                    132.0
                };
                let title_width = (content_width - author_width - 12.0).max(60.0);
                let title = ui.fonts(|f| {
                    f.layout(
                        format!("{} {}", book.title, chapter.number),
                        heading(if book.corpus != Corpus::Scripture {
                            13.12
                        } else {
                            15.2
                        }),
                        p.muted.gamma_multiply(0.62),
                        title_width,
                    )
                });
                let author = ui.fonts(|f| {
                    f.layout(
                        if book.corpus == Corpus::Scripture {
                            reading_text
                                .label(&book.title, self.state.scripture_translation)
                                .into()
                        } else {
                            book.author
                                .clone()
                                .unwrap_or_else(|| "Early Christian writings".into())
                        },
                        FontId::proportional(9.92),
                        p.muted.gamma_multiply(0.58),
                        author_width,
                    )
                });
                let (meta, _) = ui.allocate_exact_size(
                    egui::vec2(content_width, title.size().y.max(author.size().y)),
                    Sense::hover(),
                );
                ui.painter()
                    .galley(meta.min, title, p.muted.gamma_multiply(0.62));
                ui.painter().galley(
                    egui::pos2(meta.right() - author.size().x, meta.top()),
                    author,
                    p.muted.gamma_multiply(0.58),
                );
                ui.add_space(12.0);
                if book.corpus == Corpus::Scripture
                    && self.state.scripture_translation == reading_translation::Translation::Msb
                    && reading_text
                        .label(&book.title, self.state.scripture_translation)
                        .starts_with("WEB")
                {
                    ui.label(
                        RichText::new(
                            "MSB does not include this book. Showing World English Bible.",
                        )
                        .small()
                        .color(p.muted),
                    );
                }
                if book.corpus != Corpus::Scripture {
                    let title = ui.fonts(|f| {
                        f.layout(
                            chapter.title.clone(),
                            FontId::proportional(12.2),
                            p.muted,
                            content_width,
                        )
                    });
                    let (rect, _) = ui.allocate_exact_size(
                        egui::vec2(content_width, title.size().y),
                        Sense::hover(),
                    );
                    ui.painter().galley(rect.min, title, p.muted);
                    ui.add_space(12.0);
                }
                let groups = self.catalog.scripture_groups(&library, chapter);
                for (id, links) in groups.iter().flat_map(|group| {
                    group.passages.iter().map(move |id| {
                        (
                            id,
                            if Some(id) == group.passages.last() {
                                group.links.as_slice()
                            } else {
                                &[]
                            },
                        )
                    })
                }) {
                    let start = ui.cursor().min;
                    if target.as_deref() != Some(id) {
                        if let Some(&height) = measured.passages.get(id) {
                            let rect =
                                Rect::from_min_size(start, egui::vec2(content_width, height));
                            if !rect.intersects(near_viewport) {
                                ui.advance_cursor_after_rect(rect);
                                continue;
                            }
                        }
                    }
                    let passage = reading_text.passage(
                        library.passage(id).unwrap(),
                        self.state.scripture_translation,
                    );
                    let selected = self.selected.as_deref() == Some(id);
                    let mut text = egui::text::LayoutJob::default();
                    text.wrap.max_width = content_width - 20.0;
                    let size = 19.84 * self.state.font_scale;
                    let displayed = passage.reader_text(self.state.original);
                    let format = egui::TextFormat {
                        font_id: serif(size),
                        color: p.ink,
                        line_height: Some(size * self.state.line_height),
                        ..Default::default()
                    };
                    // Off-screen paragraphs only need measurement. Compute differences
                    // near the viewport and keep a bounded cache across frames.
                    let near = start.y <= near_viewport.bottom()
                        && start.y + 2000.0 >= near_viewport.top();
                    let ranges = if show_modernization_marks(
                        self.state.original,
                        passage.corpus,
                        &passage.original_text,
                        displayed,
                    ) && near
                    {
                        if measured.modernized_ranges.len() >= 256
                            && !measured.modernized_ranges.contains_key(id)
                        {
                            measured.modernized_ranges.clear();
                        }
                        Some(
                            measured
                                .modernized_ranges
                                .entry(id.clone())
                                .or_insert_with(|| {
                                    modernized_ranges(&passage.original_text, displayed)
                                })
                                .as_slice(),
                        )
                    } else {
                        None
                    };
                    let quotations = self.catalog.quotation_ranges(&library, passage, displayed);
                    let quotation_label = if quotations.is_empty() {
                        ""
                    } else {
                        "Scripture quotation\n"
                    };
                    text.append(
                        quotation_label,
                        0.0,
                        egui::TextFormat {
                            font_id: FontId::proportional(11.0),
                            color: p.muted,
                            ..Default::default()
                        },
                    );
                    let mut cursor = 0;
                    for quote in &quotations {
                        text.append(&displayed[cursor..quote.start], 0.0, format.clone());
                        let mut quoted = format.clone();
                        quoted.italics = true;
                        text.append(&displayed[quote.clone()], 0.0, quoted);
                        cursor = quote.end;
                    }
                    text.append(&displayed[cursor..], 0.0, format);
                    let galley = ui.fonts(|f| f.layout_job(text));
                    let height = galley.size().y + 8.0 + if selected { 25.0 } else { 0.0 };
                    let (rect, _) =
                        ui.allocate_exact_size(egui::vec2(content_width, height), Sense::hover());
                    let response =
                        ui.interact(rect, Id::new(("reader-passage", id)), Sense::click());
                    if ui.is_rect_visible(rect) {
                        response.widget_info(|| {
                            egui::WidgetInfo::labeled(
                                egui::WidgetType::Button,
                                true,
                                format!(
                                    "{}: {}",
                                    passage.reference,
                                    passage.reader_text(self.state.original)
                                ),
                            )
                        });
                    }
                    if let Some(color) = self.study.marks(passage) {
                        let color = match color.as_str() {
                            "green" => egui::Color32::from_rgba_unmultiplied(107, 167, 107, 45),
                            "blue" => egui::Color32::from_rgba_unmultiplied(91, 158, 211, 45),
                            _ => egui::Color32::from_rgba_unmultiplied(211, 184, 55, 45),
                        };
                        ui.painter().rect_filled(rect, 5.0, color);
                    }
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
                        let origin = rect.left_top()
                            + egui::vec2(10.0, 4.0 + if selected { 25.0 } else { 0.0 });
                        if let Some(ranges) = ranges {
                            let tint = modernization_tint(
                                p.paper,
                                p.accent,
                                self.state.theme == Theme::Dark,
                            );
                            let shifted: Vec<_> = ranges
                                .iter()
                                .map(|r| {
                                    r.start + quotation_label.len()..r.end + quotation_label.len()
                                })
                                .collect();
                            for mark in modernization_mark_rects(&galley, &shifted) {
                                ui.painter().rect_filled(
                                    mark.translate(origin.to_vec2()),
                                    size * 0.18,
                                    tint,
                                );
                            }
                        }
                        let quoted: Vec<_> = quotations
                            .iter()
                            .map(|r| r.start + quotation_label.len()..r.end + quotation_label.len())
                            .collect();
                        for mark in modernization_mark_rects(&galley, &quoted) {
                            let mark = mark.translate(origin.to_vec2());
                            ui.painter().vline(
                                rect.left() + 3.0,
                                mark.y_range(),
                                Stroke::new(2.0_f32, p.muted),
                            );
                        }
                        ui.painter().galley(origin, galley, p.ink);
                    }
                    if response.clicked() && !touch.suppress_click {
                        self.selected = if selected { None } else { Some(id.clone()) };
                        self.remember_location(id.clone());
                        self.active_chapter_id = passage.chapter_id.clone();
                    }
                    if target.as_deref() == Some(id) {
                        ui.scroll_to_rect(
                            Rect::from_min_size(
                                if chapter.passage_ids.first() == Some(id) {
                                    chapter_top
                                } else {
                                    start - egui::vec2(0.0, 48.0)
                                },
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
                    if !links.is_empty() {
                        ui.horizontal_wrapped(|ui| {
                            for link in links {
                                if ui
                                    .add(
                                        egui::Button::new(
                                            RichText::new(&link.reference)
                                                .size(12.0)
                                                .color(p.accent)
                                                .underline(),
                                        )
                                        .frame(false)
                                        .min_size(egui::vec2(44.0, 32.0)),
                                    )
                                    .on_hover_text(format!("Read {} in Scripture", link.reference))
                                    .clicked()
                                    && !touch.suppress_click
                                {
                                    scripture_target = Some(link.id.clone());
                                }
                            }
                        });
                        ui.add_space(12.0);
                    }
                    if selected {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 6.0;
                            for (kind, icon, label, edit_label) in [
                                (
                                    "highlight",
                                    icons::Icon::Highlight,
                                    "Highlight passage",
                                    "Edit highlight",
                                ),
                                (
                                    "note",
                                    icons::Icon::Note,
                                    "Write a note",
                                    "Open passage notes",
                                ),
                            ] {
                                let active = self.study.item_at(kind, passage).is_some();
                                if icons::action_button(
                                    ui,
                                    icon,
                                    if active { edit_label } else { label },
                                    active,
                                )
                                .clicked()
                                    && !touch.suppress_click
                                {
                                    match self.study.direct_action(
                                        kind,
                                        passage,
                                        self.state.original,
                                    ) {
                                        Ok(edit) => {
                                            if edit {
                                                self.dialog = Some(Dialog::Study);
                                            }
                                            self.account.persist_now = true;
                                        }
                                        Err(error) => {
                                            self.study.status =
                                                format!("Could not save study: {error}")
                                        }
                                    }
                                }
                            }
                            if passage.corpus == Corpus::Scripture {
                                if icons::action_button(
                                    ui,
                                    icons::Icon::Commentary,
                                    "View commentaries",
                                    false,
                                )
                                .clicked()
                                    && !touch.suppress_click
                                {
                                    self.show_commentaries(&passage);
                                }
                            } else {
                                let more = icons::action_button(
                                    ui,
                                    icons::Icon::More,
                                    "More passage actions",
                                    false,
                                );
                                let popup = ui.make_persistent_id(("passage-copy", id));
                                if more.clicked() && !touch.suppress_click {
                                    ui.memory_mut(|m| m.toggle_popup(popup));
                                }
                                if self.screenshot.is_some()
                                    && !self.screenshot_sent
                                    && std::env::var_os("CROSS_CANON_FRESH").is_some()
                                    && std::env::var("CROSS_CANON_PREVIEW").as_deref()
                                        == Ok("passage-copy-menu")
                                {
                                    ui.memory_mut(|memory| memory.open_popup(popup));
                                }
                                // A popup inherits the anchor's width by default. The
                                // 44-point icon is a hit target, not a menu column.
                                let below = ui.ctx().screen_rect().bottom() - more.rect.bottom();
                                egui::popup_above_or_below_widget(
                                    ui,
                                    popup,
                                    &more,
                                    if below
                                        < 128.0 + mobile::insets().bottom + READER_FOOTER_HEIGHT
                                    {
                                        egui::AboveOrBelow::Above
                                    } else {
                                        egui::AboveOrBelow::Below
                                    },
                                    egui::PopupCloseBehavior::CloseOnClickOutside,
                                    |ui| {
                                        ui.set_width(176.0);
                                        ui.spacing_mut().item_spacing.y = 4.0;
                                        for (label, text) in [
                                            ("Copy link", navigation::reader_link(passage)),
                                            (
                                                "Copy text",
                                                format!(
                                                    "{}\n{}",
                                                    passage.reference,
                                                    passage.reader_text(self.state.original)
                                                ),
                                            ),
                                        ] {
                                            if ui
                                                .add_sized(
                                                    [176.0, 44.0],
                                                    egui::Button::new(label)
                                                        .wrap_mode(egui::TextWrapMode::Extend)
                                                        .frame(false),
                                                )
                                                .clicked()
                                                && !touch.suppress_click
                                            {
                                                ui.ctx().copy_text(text);
                                                ui.memory_mut(|m| m.close_popup());
                                            }
                                        }
                                    },
                                );
                            }
                            ui.add_space((ui.available_width() - 44.0).max(0.0));
                            if ui
                                .add_enabled_ui(!self.busy, |ui| {
                                    icons::action_button(
                                        ui,
                                        icons::Icon::Similar,
                                        "Similar passages",
                                        false,
                                    )
                                })
                                .inner
                                .clicked()
                                && !touch.suppress_click
                            {
                                self.dialog = Some(Dialog::Search);
                                self.query.clear();
                                if self.search_corpus != Some(passage.corpus) {
                                    self.search_books.clear();
                                    self.search_authors.clear();
                                    self.author_filter.clear();
                                }
                                self.search_corpus = Some(passage.corpus);
                                self.search(ui.ctx(), Some(id.clone()));
                            }
                        });
                        if let Some(error) = self.study.storage_error() {
                            ui.colored_label(p.accent, error);
                        }
                        if self.study.status.starts_with("Could not save") {
                            ui.colored_label(p.accent, &self.study.status);
                        }
                        ui.add_space(10.0);
                    }
                    measured
                        .passages
                        .insert(id.clone(), ui.cursor().top() - start.y);
                }
                let height = ui.cursor().top() - section_top;
                measured.chapters.insert(chapter.id.clone(), height);
                if index < previous_start {
                    prepended_height += height;
                }
            }
            ui.add_space(70.0);
        });
        self.reader_layout = measured;
        self.reader_max_scroll = (output.content_size.y - output.inner_rect.height()).max(0.0);
        if prepended_height > 0.0 {
            // Retain the exact viewport when inserting an earlier chapter.
            // Discard this layout pass so its temporary displaced text is never painted.
            let mut state = output.state;
            state.offset.y += prepended_height;
            state.store(ui.ctx(), output.id);
            self.last_scroll = state.offset.y;
            self.reader_layout.location_pending = true;
            ui.ctx()
                .request_discard("Preserve reader viewport after prepending a chapter");
            ui.ctx().request_repaint();
        } else if target.is_some() {
            self.scroll_target = None;
        } else if self.reader_layout.location_pending
            || (output.state.offset.y - self.last_scroll).abs() > 1.0
        {
            self.reader_layout.location_pending = false;
            if let Some(id) = focused_visible {
                let chapter_before = self.active_chapter_id.clone();
                self.remember_location(id);
                if self.active_chapter_id != chapter_before {
                    // The toolbar is drawn before the reader. Refresh it even
                    // when this was the final frame of a drag or a flick.
                    ui.ctx().request_repaint();
                }
            }
        }
        if prepended_height == 0.0 {
            self.last_scroll = output.state.offset.y;
        }
        if let Some(id) = scripture_target {
            self.open(id);
        }
    }
    pub(super) fn book_heading(&self, ui: &mut egui::Ui, book: &Book) {
        let p = self.state.theme.palette();
        let width = ui.available_width();
        let compact = Self::compact(ui.ctx());
        ui.add_space(if compact { 24.0 } else { 46.0 });
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
        ui.add_space(if compact { 30.0 } else { 58.0 });
        ui.label(
            RichText::new("B O O K")
                .size(11.52)
                .strong()
                .color(p.accent),
        );
        ui.add_space(10.0);
        let size = 89.6_f32.min(width * if compact { 0.15 } else { 0.12 });
        ui.add(egui::Label::new(RichText::new(&book.title).font(heading(size))).wrap());
        ui.add_space(10.0);
        ui.label(
            RichText::new(if book.corpus == Corpus::Scripture {
                self.reading_text
                    .label(&book.title, self.state.scripture_translation)
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
                        self.reading_text
                            .label(&book.title, self.state.scripture_translation)
                            .into()
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

#[cfg(test)]
mod window_tests {
    use super::*;

    fn frame(app: &mut Desktop, ctx: &egui::Context, mut offset: Option<f32>) {
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(393.0, 852.0),
                )),
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    if let Some(offset) = offset.take() {
                        let id = ui.make_persistent_id(Id::new((
                            "reader",
                            sequence_key(
                                app.library.book(&app.current_passage().book_id).unwrap(),
                                app.state.canon,
                            ),
                        )));
                        let mut state = egui::scroll_area::State::load(ctx, id).unwrap();
                        state.offset.y = offset;
                        state.store(ctx, id);
                    }
                    app.reader(ui);
                });
            },
        );
    }

    #[test]
    fn scrolling_past_genesis_continues_into_exodus() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        app.open(library.chapter("Genesis:50").unwrap().1.passage_ids[0].clone());
        for _ in 0..3 {
            frame(&mut app, &ctx, None);
        }
        for _ in 0..4 {
            let bottom = app.reader_max_scroll;
            frame(&mut app, &ctx, Some(bottom));
        }
        assert_eq!(app.current_passage().book_id, "Exodus");
        let offset = app.last_scroll;
        frame(&mut app, &ctx, None);
        assert!(
            (app.last_scroll - offset).abs() < 1.0,
            "Crossing books must not reset layout"
        );

        app.open(library.chapter("Exodus:1").unwrap().1.passage_ids[0].clone());
        for _ in 0..3 {
            frame(&mut app, &ctx, None);
        }
        frame(&mut app, &ctx, Some(0.0));
        assert_eq!(app.current_passage().book_id, "Genesis");
        let offset = app.last_scroll;
        frame(&mut app, &ctx, None);
        assert!(
            (app.last_scroll - offset).abs() < 1.0,
            "Returning to Genesis must retain the viewport"
        );
    }

    #[test]
    fn growing_henry_window_preserves_viewport_and_reading_location() {
        let library = Arc::new(
            Library::load(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap(),
        );
        let ctx = egui::Context::default();
        let mut app = Desktop::initialize(&ctx, None, library.clone());
        let book = library.book("classics:henry").unwrap();
        app.open(book.chapters[5].passage_ids[0].clone());
        for _ in 0..3 {
            frame(&mut app, &ctx, None);
        }
        assert_eq!(app.reader_layout.window, 4..7);
        frame(&mut app, &ctx, Some(100.0));
        assert_eq!(app.reader_layout.window.start, 3);
        let inserted = app.reader_layout.chapters[&book.chapters[3].id];
        assert!(
            (app.last_scroll - 100.0 - inserted).abs() < 1.0,
            "Prepending must compensate by the exact chapter height"
        );
        assert_eq!(app.current_passage().chapter_id, book.chapters[4].id);
        let offset = app.last_scroll;
        frame(&mut app, &ctx, None);
        assert!(
            (app.last_scroll - offset).abs() < 1.0,
            "The following frame must not jump"
        );
        let end = app.reader_layout.window.end;
        let max_scroll = app.reader_max_scroll;
        frame(&mut app, &ctx, Some(max_scroll - 100.0));
        assert_eq!(app.reader_layout.window.end, end + 1);
        assert!(
            (app.last_scroll - (max_scroll - 100.0)).abs() < 1.0,
            "Appending must retain the current viewport"
        );
    }
}

fn modernization_tint(paper: egui::Color32, accent: egui::Color32, dark: bool) -> egui::Color32 {
    let weight = if dark { 0.10 } else { 0.07 };
    let mix = |background: u8, foreground: u8| {
        (background as f32 * (1.0 - weight) + foreground as f32 * weight).round() as u8
    };
    egui::Color32::from_rgb(
        mix(paper.r(), accent.r()),
        mix(paper.g(), accent.g()),
        mix(paper.b(), accent.b()),
    )
}

/// Word boxes use font height, not the reader's expanded line height.
fn modernization_mark_rects(galley: &egui::Galley, ranges: &[std::ops::Range<usize>]) -> Vec<Rect> {
    let mut result = Vec::new();
    let mut byte = 0;
    let mut range_index = 0;
    for row in &galley.rows {
        let mut current: Option<Rect> = None;
        for glyph in &row.glyphs {
            while range_index < ranges.len() && ranges[range_index].end <= byte {
                range_index += 1;
            }
            let marked = range_index < ranges.len() && ranges[range_index].contains(&byte);
            if marked {
                let glyph_rect = Rect::from_min_size(
                    glyph.pos - egui::vec2(0.0, glyph.font_ascent),
                    egui::vec2(glyph.advance_width, glyph.font_height),
                );
                current = Some(current.map_or(glyph_rect, |rect| rect.union(glyph_rect)));
            } else if let Some(rect) = current.take() {
                result.push(rect);
            }
            byte += glyph.chr.len_utf8();
        }
        if let Some(rect) = current.take() {
            result.push(rect);
        }
        if row.ends_with_newline {
            byte += 1;
        }
    }
    result
}

fn show_modernization_marks(original: bool, corpus: Corpus, source: &str, displayed: &str) -> bool {
    !original && corpus != Corpus::Scripture && source != displayed
}

/// Byte ranges in the displayed text, using the web reader's LCS tie-breaking.
pub(super) fn modernized_ranges(original: &str, displayed: &str) -> Vec<std::ops::Range<usize>> {
    fn tokens(text: &str) -> Vec<(std::ops::Range<usize>, String)> {
        let mut result = Vec::new();
        let mut start = None;
        for (index, ch) in text
            .char_indices()
            .chain(std::iter::once((text.len(), ' ')))
        {
            if ch.is_whitespace() {
                if let Some(begin) = start.take() {
                    let token = &text[begin..index];
                    let lowered = token.to_lowercase();
                    let comparable = lowered.trim_matches(|c: char| !c.is_ascii_alphanumeric());
                    // Punctuation alone is not a changed word.
                    if !comparable.is_empty() {
                        result.push((begin..index, comparable.to_owned()));
                    }
                }
            } else if start.is_none() {
                start = Some(index);
            }
        }
        result
    }
    let old = tokens(original);
    let new = tokens(displayed);
    let columns = new.len() + 1;
    let mut scores = vec![0usize; (old.len() + 1) * columns];
    for i in 1..=old.len() {
        for j in 1..=new.len() {
            scores[i * columns + j] = if old[i - 1].1 == new[j - 1].1 {
                scores[(i - 1) * columns + j - 1] + 1
            } else {
                scores[(i - 1) * columns + j].max(scores[i * columns + j - 1])
            };
        }
    }
    let mut matched = vec![false; new.len()];
    let (mut i, mut j) = (old.len(), new.len());
    while i > 0 && j > 0 {
        if old[i - 1].1 == new[j - 1].1 {
            matched[j - 1] = true;
            i -= 1;
            j -= 1;
        } else if scores[(i - 1) * columns + j] >= scores[i * columns + j - 1] {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    new.into_iter()
        .zip(matched)
        .filter_map(|((range, _), matched)| (!matched).then_some(range))
        .collect()
}

#[cfg(test)]
mod passage_menu_tests {
    use super::*;

    fn frame(
        app: &mut Desktop,
        ctx: &egui::Context,
        width: f32,
        events: Vec<egui::Event>,
    ) -> egui::FullOutput {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(width, 852.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| app.render(ctx),
        )
    }

    #[test]
    fn copy_menu_labels_stay_on_one_line_and_actions_work() {
        let library = Arc::new(
            Library::load_artifacts(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
                .unwrap(),
        );
        for width in [320.0, 393.0, 1000.0] {
            let ctx = egui::Context::default();
            ctx.enable_accesskit();
            let mut app = Desktop::initialize(&ctx, None, library.clone());
            let id = library.book("classics:imitation").unwrap().chapters[2].passage_ids[0].clone();
            app.open(id.clone());
            app.selected = Some(id.clone());
            for _ in 0..3 {
                frame(&mut app, &ctx, width, vec![]);
            }
            let output = frame(&mut app, &ctx, width, vec![]);
            let footer = output
                .platform_output
                .accesskit_update
                .as_ref()
                .unwrap()
                .nodes
                .iter()
                .find(|(_, node)| node.label() == Some("Choose collection"))
                .unwrap()
                .1
                .bounds()
                .unwrap();
            assert!(
                footer.x0 >= 0.0 && footer.x1 <= width as f64 - 15.0,
                "Collection control must fit inside the screen at {width}px: {footer:?}"
            );
            for shape in &output.shapes {
                if let egui::Shape::Text(text) = &shape.shape {
                    if text.galley.job.text
                        == library
                            .passage(&id)
                            .unwrap()
                            .reader_text(app.state.original)
                    {
                        assert!(
                            shape.clip_rect.bottom() <= footer.y0 as f32,
                            "Reading text must be clipped above bottom controls"
                        );
                    }
                }
            }
            let bounds = output
                .platform_output
                .accesskit_update
                .unwrap()
                .nodes
                .into_iter()
                .find(|(_, node)| node.label() == Some("More passage actions"))
                .unwrap()
                .1
                .bounds()
                .unwrap();
            let pos = egui::pos2(
                (bounds.x0 + bounds.x1) as f32 / 2.0,
                (bounds.y0 + bounds.y1) as f32 / 2.0,
            );
            for pressed in [true, false] {
                frame(
                    &mut app,
                    &ctx,
                    width,
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
            let output = frame(&mut app, &ctx, width, vec![]);
            for label in ["Copy link", "Copy text"] {
                let text = output
                    .shapes
                    .iter()
                    .find_map(|shape| match &shape.shape {
                        egui::Shape::Text(text) if text.galley.job.text == label => Some(text),
                        _ => None,
                    })
                    .expect("Menu label must be visible");
                assert_eq!(text.galley.rows.len(), 1, "{label} wraps at {width}px");
                let rect = Rect::from_min_size(text.pos, text.galley.size());
                assert!(
                    ctx.screen_rect().contains_rect(rect),
                    "{label} leaves the screen at {width}px"
                );
            }
            let bounds = output
                .platform_output
                .accesskit_update
                .unwrap()
                .nodes
                .into_iter()
                .find(|(_, node)| node.label() == Some("Copy text"))
                .unwrap()
                .1
                .bounds()
                .unwrap();
            assert!(bounds.width() >= 140.0 && bounds.height() >= 44.0);
            let pos = egui::pos2(
                (bounds.x0 + bounds.x1) as f32 / 2.0,
                (bounds.y0 + bounds.y1) as f32 / 2.0,
            );
            let mut copied = false;
            for pressed in [true, false] {
                let output = frame(
                    &mut app,
                    &ctx,
                    width,
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
                copied |= output.platform_output.commands.iter().any(|command| matches!(command,
                    egui::OutputCommand::CopyText(text) if text.contains(&library.passage(&id).unwrap().reference)));
            }
            assert!(copied, "Copy text must still work at {width}px");
            assert!(!ctx.memory(|memory| memory.any_popup_open()));
        }
    }
}

#[cfg(test)]
mod modernization_tests {
    use super::{
        modernization_mark_rects, modernization_tint, modernized_ranges, show_modernization_marks,
    };
    use cross_canon_core::Corpus;
    use eframe::egui;

    #[test]
    fn tint_composites_accent_over_paper_in_srgb() {
        let paper = super::Theme::Paper.palette();
        let dark = super::Theme::Dark.palette();
        assert_eq!(
            modernization_tint(paper.paper, paper.accent, false),
            egui::Color32::from_rgb(243, 236, 232)
        );
        assert_eq!(
            modernization_tint(dark.paper, dark.accent, true),
            egui::Color32::from_rgb(45, 39, 35)
        );
    }

    #[test]
    fn mark_boxes_follow_wrapped_words_and_exclude_extra_leading() {
        let ctx = egui::Context::default();
        let _ = ctx.run(egui::RawInput::default(), |ctx| {
            let mut job = egui::text::LayoutJob::default();
            job.wrap.max_width = 75.0;
            job.append(
                "écho word\nsecond word",
                0.0,
                egui::TextFormat {
                    font_id: egui::FontId::proportional(16.0),
                    line_height: Some(32.0),
                    ..Default::default()
                },
            );
            let galley = ctx.fonts(|f| f.layout_job(job));
            let first = modernization_mark_rects(&galley, &[0..5]);
            let last_start = "écho word\nsecond ".len();
            let last = modernization_mark_rects(&galley, &[last_start..last_start + 4]);
            assert_eq!(first.len(), 1);
            assert_eq!(last.len(), 1);
            assert!(first[0].height() < 32.0);
            assert!(last[0].top() > first[0].top());
            assert!(last[0].width() > 0.0);
        });
    }

    #[test]
    fn original_and_plain_passages_have_no_marks() {
        assert!(!show_modernization_marks(
            true,
            Corpus::EarlyChristian,
            "old",
            "new"
        ));
        assert!(!show_modernization_marks(
            false,
            Corpus::EarlyChristian,
            "same",
            "same"
        ));
        assert!(!show_modernization_marks(
            false,
            Corpus::Scripture,
            "old",
            "new"
        ));
    }

    #[test]
    fn marks_only_changed_words_and_preserves_exact_text() {
        let displayed = "  The\tquick,  fox!\n";
        let ranges = modernized_ranges("the slow fox.", displayed);
        assert_eq!(
            ranges
                .iter()
                .map(|r| &displayed[r.clone()])
                .collect::<Vec<_>>(),
            vec!["quick,"]
        );
        let mut rebuilt = String::new();
        let mut cursor = 0;
        for range in ranges {
            rebuilt.push_str(&displayed[cursor..range.start]);
            rebuilt.push_str(&displayed[range.clone()]);
            cursor = range.end;
        }
        rebuilt.push_str(&displayed[cursor..]);
        assert_eq!(rebuilt, displayed);
        assert!(modernized_ranges("Hello, world!", "hello WORLD? ...").is_empty());
    }

    #[test]
    fn repeated_words_follow_web_lcs_tie_breaking() {
        let displayed = "one two one";
        let ranges = modernized_ranges("one one", displayed);
        assert_eq!(
            ranges
                .iter()
                .map(|r| &displayed[r.clone()])
                .collect::<Vec<_>>(),
            vec!["two"]
        );
        assert!(modernized_ranges("same same", "same same").is_empty());
    }
}
