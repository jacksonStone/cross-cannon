use super::*;

/// Exact measured geometry survives egui's per-frame text-cache eviction. Reuse
/// it for off-screen content so a drag doesn't lay out every page of a Work.
#[derive(Default)]
pub(super) struct ReaderLayout {
    key: Option<LayoutKey>,
    chapters: std::collections::HashMap<String, f32>,
    passages: std::collections::HashMap<String, f32>,
    selected: Option<String>,
    modernized_ranges: std::collections::HashMap<String, Vec<std::ops::Range<usize>>>,
}

#[derive(PartialEq)]
struct LayoutKey {
    book: String,
    width: f32,
    font_scale: f32,
    line_height: f32,
    pixels_per_point: f32,
    original: bool,
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
        let label = format!("{} {}", focused.book, focused.chapter);
        // Reserve the same title width in both states. Tools float above the reader,
        // so toggling them cannot change title fitting or the reader's origin.
        let title_width = (ui.available_width() - 56.0).max(20.0);
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
        let (rect, header_response) =
            ui.allocate_exact_size(egui::vec2(ui.available_width(), height), Sense::hover());
        header_response
            .widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Label, true, &label));
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
                            if !self.back.is_empty() || !self.forward.is_empty() {
                                ui.horizontal(|ui| {
                                    if ui
                                        .add_enabled(
                                            !self.back.is_empty(),
                                            egui::Button::new("Back")
                                                .min_size(egui::vec2(70.0, 44.0)),
                                        )
                                        .clicked()
                                    {
                                        self.go_back();
                                    }
                                    if ui
                                        .add_enabled(
                                            !self.forward.is_empty(),
                                            egui::Button::new("Forward")
                                                .min_size(egui::vec2(70.0, 44.0)),
                                        )
                                        .clicked()
                                    {
                                        self.go_forward();
                                    }
                                });
                            }
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
            [0, 4, 3, 2, 1]
        } else {
            [0, 1, 2, 3, 4]
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
                1 => {
                    let response = control(ui, "Jump");
                    self.jump_button_rect = response.rect;
                    if response.clicked() {
                        self.show_jump();
                    }
                }
                2 => {
                    if control(ui, "Aa").on_hover_text("Reader settings").clicked() {
                        self.dialog = Some(Dialog::Settings);
                    }
                }
                3 => {
                    if icons::button(ui, icons::Icon::Search, "", egui::vec2(44.0, 44.0), false)
                        .on_hover_text("Search")
                        .clicked()
                    {
                        self.dialog = Some(Dialog::Search);
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
                        .on_hover_text("Play or pause chapter audio")
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
        let book = library.book(&self.current_passage().book_id).unwrap();
        let mut measured = std::mem::take(&mut self.reader_layout);
        let mut focused_visible = None;
        let target = self.scroll_target.clone();
        let touch = self.reader_touch.frame(
            ui.ctx(),
            ui.available_rect_before_wrap(),
            self.last_scroll,
            self.reader_max_scroll,
            target.is_none() && self.dialog.is_none() && !self.tools,
        );
        let mut area = egui::ScrollArea::vertical()
            .id_salt(("reader", &book.id))
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
                book: book.id.clone(),
                width: content_width,
                font_scale: self.state.font_scale,
                line_height: self.state.line_height,
                pixels_per_point: ui.ctx().pixels_per_point(),
                original: self.state.original,
                theme: self.state.theme,
            };
            if measured.key.as_ref() != Some(&key) {
                measured = ReaderLayout {
                    key: Some(key),
                    ..Default::default()
                };
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
            for chapter in &book.chapters {
                let section_top = ui.cursor().top();
                if target_chapter != Some(&chapter.id) {
                    if let Some(&height) = measured.chapters.get(&chapter.id) {
                        let rect =
                            Rect::from_min_size(ui.cursor().min, egui::vec2(content_width, height));
                        if !rect.intersects(near_viewport) {
                            ui.advance_cursor_after_rect(rect);
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
                            "WEB · World English Bible".into()
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
                for id in &chapter.passage_ids {
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
                    let passage = library.passage(id).unwrap();
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
                    text.append(displayed, 0.0, format);
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
                            for mark in modernization_mark_rects(&galley, ranges) {
                                ui.painter().rect_filled(
                                    mark.translate(origin.to_vec2()),
                                    size * 0.18,
                                    tint,
                                );
                            }
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
                    if selected {
                        ui.horizontal(|ui| {
                            if control(ui, "Similar passages").clicked() {
                                self.dialog = Some(Dialog::Search);
                                self.query.clear();
                                self.search_corpus = Some(passage.corpus);
                                self.search(ui.ctx(), Some(id.clone()));
                            }
                            if control(ui, "Copy link").clicked() {
                                ui.ctx().copy_text(navigation::reader_link(passage));
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
                    measured
                        .passages
                        .insert(id.clone(), ui.cursor().top() - start.y);
                }
                measured
                    .chapters
                    .insert(chapter.id.clone(), ui.cursor().top() - section_top);
            }
            ui.add_space(70.0);
        });
        self.reader_layout = measured;
        self.reader_max_scroll = (output.content_size.y - output.inner_rect.height()).max(0.0);
        if self.scroll_target.is_some() {
            self.scroll_target = None;
        } else if (output.state.offset.y - self.last_scroll).abs() > 1.0 {
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
        self.last_scroll = output.state.offset.y;
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
fn modernized_ranges(original: &str, displayed: &str) -> Vec<std::ops::Range<usize>> {
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
