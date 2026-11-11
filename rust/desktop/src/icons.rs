//! Small vector controls avoid missing emoji/font glyphs on iOS.
use eframe::egui::{self, Color32, Pos2, Rect, Response, Sense, Stroke, Vec2};

#[derive(Clone, Copy)]
pub(super) enum Icon {
    Search,
    Filters,
    Jump,
    Play,
    Pause,
    Close,
    Star,
}

pub(super) fn button(
    ui: &mut egui::Ui,
    icon: Icon,
    label: &str,
    minimum: Vec2,
    primary: bool,
) -> Response {
    let galley = ui.painter().layout_no_wrap(
        label.into(),
        egui::FontId::proportional(13.0),
        ui.visuals().text_color(),
    );
    let width = if label.is_empty() {
        44.0
    } else {
        galley.size().x + 52.0
    };
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(width.max(minimum.x), minimum.y.max(36.0)),
        Sense::click(),
    );
    response.widget_info(|| {
        egui::WidgetInfo::labeled(
            egui::WidgetType::Button,
            ui.is_enabled(),
            if label.is_empty() {
                match icon {
                    Icon::Search => "Search",
                    Icon::Filters => "Filters",
                    Icon::Jump => "Jump",
                    Icon::Play => "Play chapter audio",
                    Icon::Pause => "Pause chapter audio",
                    Icon::Close => "Close tools",
                    Icon::Star => "Favorite work",
                }
            } else {
                label
            },
        )
    });
    if ui.is_rect_visible(rect) {
        let visuals = ui.style().interact(&response);
        let fill = if primary {
            ui.visuals().selection.stroke.color
        } else {
            visuals.weak_bg_fill
        };
        let color = if primary {
            Color32::WHITE
        } else {
            visuals.text_color()
        };
        ui.painter()
            .rect(rect, 6.0, fill, visuals.bg_stroke, egui::StrokeKind::Inside);
        let total = if label.is_empty() {
            18.0
        } else {
            18.0 + 8.0 + galley.size().x
        };
        let left = rect.center().x - total / 2.0;
        paint(
            ui.painter(),
            icon,
            egui::pos2(left + 9.0, rect.center().y),
            color,
        );
        if !label.is_empty() {
            ui.painter().galley_with_override_text_color(
                egui::pos2(left + 26.0, rect.center().y - galley.size().y / 2.0),
                galley,
                color,
            );
        }
    }
    response
}

pub(super) fn paint(painter: &egui::Painter, icon: Icon, center: Pos2, color: Color32) {
    let stroke = Stroke::new(1.7_f32, color);
    let at = |x, y| center + egui::vec2(x, y);
    let line = |a: (f32, f32), b: (f32, f32)| {
        painter.line_segment([at(a.0, a.1), at(b.0, b.1)], stroke);
    };
    match icon {
        Icon::Search => {
            painter.circle_stroke(at(-2.0, -2.0), 5.5, stroke);
            line((2.0, 2.0), (7.0, 7.0));
        }
        Icon::Filters => {
            for (y, x) in [(-5.0, 3.0), (0.0, -3.0), (5.0, 1.0)] {
                line((-8.0, y), (8.0, y));
                painter.circle_filled(at(x, y), 2.5, painter.ctx().style().visuals.panel_fill);
                painter.circle_stroke(at(x, y), 2.5, stroke);
            }
        }
        Icon::Jump => {
            line((-7.0, -6.0), (-7.0, 3.0));
            line((-7.0, 3.0), (6.0, 3.0));
            line((2.0, -1.0), (6.0, 3.0));
            line((6.0, 3.0), (2.0, 7.0));
        }
        Icon::Close => {
            line((-5.0, -5.0), (5.0, 5.0));
            line((5.0, -5.0), (-5.0, 5.0));
        }
        Icon::Play => {
            painter.add(egui::Shape::convex_polygon(
                vec![at(-4.0, -7.0), at(7.0, 0.0), at(-4.0, 7.0)],
                color,
                Stroke::NONE,
            ));
        }
        Icon::Pause => {
            for x in [-4.0, 4.0] {
                painter.rect_filled(
                    Rect::from_center_size(at(x, 0.0), egui::vec2(3.0, 14.0)),
                    0.0,
                    color,
                );
            }
        }
        Icon::Star => {
            let points = (0..10)
                .map(|i| {
                    let angle = i as f32 * std::f32::consts::PI / 5.0 - std::f32::consts::FRAC_PI_2;
                    let radius = if i % 2 == 0 { 8.0 } else { 3.5 };
                    at(angle.cos() * radius, angle.sin() * radius)
                })
                .collect();
            painter.add(egui::Shape::closed_line(points, stroke));
        }
    }
}
