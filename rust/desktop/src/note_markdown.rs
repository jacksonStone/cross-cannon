//! One Markdown styling path for the editable source and the rendered note.
use super::{egui, theme, Theme};
use egui::{text::LayoutJob, FontFamily, FontId, Stroke, TextFormat};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::ops::Range;

struct Link {
    range: Range<usize>,
    url: String,
}

fn format(p: theme::Palette) -> TextFormat {
    TextFormat {
        font_id: FontId::new(17.0, FontFamily::Name("serif".into())),
        color: p.ink,
        ..Default::default()
    }
}

fn layout(source: &str, p: theme::Palette, editing: bool) -> (LayoutJob, Vec<Link>) {
    let base = format(p);
    let syntax = TextFormat {
        color: p.muted,
        ..base.clone()
    };
    let mut job = LayoutJob::default();
    let mut current = base.clone();
    let mut stack = Vec::new();
    let mut lists = Vec::new();
    let mut links = Vec::new();
    let mut link_start = None;
    let mut offset = 0;
    let mut images = 0;
    for (event, range) in Parser::new_ext(source, Options::ENABLE_STRIKETHROUGH).into_offset_iter()
    {
        match event {
            Event::Start(tag) => {
                stack.push(current.clone());
                match tag {
                    Tag::Strong => current.font_id.family = FontFamily::Name("serif-bold".into()),
                    Tag::Emphasis => current.italics = true,
                    Tag::Strikethrough => current.strikethrough = Stroke::new(1.0_f32, p.ink),
                    Tag::Heading { level, .. } => {
                        current.font_id.family = FontFamily::Name("serif-bold".into());
                        current.font_id.size = match level as u8 {
                            1 => 26.0,
                            2 => 23.0,
                            _ => 20.0,
                        };
                    }
                    Tag::CodeBlock(_) => {
                        current.font_id = FontId::monospace(15.0);
                        current.background = p.panel;
                    }
                    Tag::Link { dest_url, .. } => {
                        current.color = p.accent;
                        current.underline = Stroke::new(1.0_f32, p.accent);
                        link_start = Some((job.text.len(), dest_url.to_string()));
                    }
                    Tag::Image { .. } => images += 1,
                    Tag::List(start) => lists.push(start),
                    Tag::Item if !editing => {
                        let marker = match lists.last_mut() {
                            Some(Some(n)) => {
                                let s = format!("{n}. ");
                                *n += 1;
                                s
                            }
                            _ => "• ".into(),
                        };
                        job.append(
                            &format!("{}{marker}", "  ".repeat(lists.len().saturating_sub(1))),
                            0.0,
                            current.clone(),
                        );
                    }
                    Tag::BlockQuote(_) if !editing => {
                        job.append("│ ", 0.0, syntax.clone());
                    }
                    _ => {}
                }
            }
            Event::End(tag) => {
                if matches!(tag, TagEnd::Image) {
                    images -= 1;
                }
                if matches!(tag, TagEnd::List(_)) {
                    lists.pop();
                }
                if matches!(tag, TagEnd::Link) {
                    if let Some((start, url)) = link_start.take() {
                        links.push(Link {
                            range: start..job.text.len(),
                            url,
                        });
                    }
                }
                if !editing {
                    match tag {
                        TagEnd::Paragraph
                        | TagEnd::Heading(_)
                        | TagEnd::CodeBlock
                        | TagEnd::BlockQuote(_)
                        | TagEnd::List(_) => {
                            if !job.text.ends_with("\n\n") {
                                job.append(
                                    if job.text.ends_with('\n') {
                                        "\n"
                                    } else {
                                        "\n\n"
                                    },
                                    0.0,
                                    base.clone(),
                                );
                            }
                        }
                        TagEnd::Item if !job.text.ends_with('\n') => {
                            job.append("\n", 0.0, base.clone())
                        }
                        _ => {}
                    }
                }
                current = stack.pop().unwrap_or_else(|| base.clone());
            }
            Event::Text(text) | Event::Code(text) => {
                let mut style = current.clone();
                // Inline code is a literal, including any Markdown punctuation.
                if matches!(source.as_bytes().get(range.start), Some(b'`')) {
                    style.font_id = FontId::monospace(15.0);
                    style.background = p.panel;
                }
                if editing {
                    if offset < range.start {
                        job.append(&source[offset..range.start], 0.0, syntax.clone());
                    }
                    job.append(&source[range.clone()], 0.0, style);
                    offset = range.end;
                } else if images == 0 {
                    job.append(&text, 0.0, style);
                }
            }
            Event::SoftBreak | Event::HardBreak if !editing => {
                job.append("\n", 0.0, current.clone())
            }
            Event::Rule if !editing => job.append("────\n", 0.0, syntax.clone()),
            _ => {}
        }
    }
    if editing && offset < source.len() {
        job.append(&source[offset..], 0.0, syntax);
    }
    if !editing {
        let end = job.text.trim_end_matches('\n').len();
        job.text.truncate(end);
        job.sections.retain_mut(|section| {
            section.byte_range.end = section.byte_range.end.min(end);
            section.byte_range.start < section.byte_range.end
        });
    }
    (job, links)
}

pub(super) fn editor_layout(
    ui: &egui::Ui,
    source: &str,
    width: f32,
    theme: Theme,
) -> std::sync::Arc<egui::Galley> {
    let (mut job, _) = layout(source, theme.palette(), true);
    job.wrap.max_width = width;
    ui.fonts(|fonts| fonts.layout_job(job))
}

pub(super) fn show(ui: &mut egui::Ui, source: &str, theme: Theme) {
    let (mut job, links) = layout(source, theme.palette(), false);
    job.wrap.max_width = ui.available_width();
    let galley = ui.fonts(|fonts| fonts.layout_job(job));
    let response = ui.add(egui::Label::new(galley.clone()).sense(egui::Sense::click()));
    if let Some(pos) = response.hover_pos() {
        // Locate a link using the actual wrapped text geometry, including Unicode.
        let index = galley
            .cursor_from_pos(pos - response.rect.min)
            .ccursor
            .index;
        let byte = galley
            .job
            .text
            .char_indices()
            .nth(index)
            .map(|(i, _)| i)
            .unwrap_or(galley.job.text.len());
        if let Some(link) = links.iter().find(|link| link.range.contains(&byte)) {
            if ["https://", "http://", "mailto:"]
                .iter()
                .any(|scheme| link.url.starts_with(scheme))
            {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                if response.clicked() {
                    ui.ctx().open_url(egui::OpenUrl::new_tab(&link.url));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editing_preserves_source_and_styles_nested_unicode_markdown() {
        let source = "## A thought\n**Café *καλός*** and `**literal**`\n\n- A gift";
        let (job, _) = layout(source, Theme::Dark.palette(), true);
        assert_eq!(
            job.text, source,
            "Caret and selection offsets must use the unchanged source"
        );
        let section = job
            .sections
            .iter()
            .find(|s| job.text[s.byte_range.clone()].contains("καλός"))
            .unwrap();
        assert_eq!(
            section.format.font_id.family,
            FontFamily::Name("serif-bold".into())
        );
        assert!(section.format.italics);
        let code = job
            .sections
            .iter()
            .find(|s| job.text[s.byte_range.clone()].contains("literal"))
            .unwrap();
        assert_eq!(code.format.font_id.family, FontFamily::Monospace);
    }
    #[test]
    fn viewing_renders_formatting_lists_and_links_without_source_markers() {
        let (job, links) = layout(
            "**exampletext**\n\n- *A gift*\n\n[Read](https://example.com)",
            Theme::Dark.palette(),
            false,
        );
        assert!(job.text.contains("exampletext"));
        assert!(!job.text.contains("**"));
        assert!(
            !job.text.ends_with('\n'),
            "Rendered notes must not add empty rows after the body"
        );
        assert!(job.text.contains("• A gift"));
        assert_eq!(&job.text[links[0].range.clone()], "Read");
        assert_eq!(links[0].url, "https://example.com");
    }
}
