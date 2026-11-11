use eframe::egui::{self, Color32, FontFamily, FontId};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Theme {
    #[default]
    Paper,
    Sepia,
    Dark,
    Contrast,
}
#[derive(Clone, Copy)]
pub struct Palette {
    pub paper: Color32,
    pub ink: Color32,
    pub muted: Color32,
    pub line: Color32,
    pub panel: Color32,
    pub accent: Color32,
}
fn rgb(n: u32) -> Color32 {
    Color32::from_rgb((n >> 16) as u8, (n >> 8) as u8, n as u8)
}
impl Theme {
    pub fn palette(self) -> Palette {
        let (paper, ink, muted, line, panel, accent) = match self {
            Self::Paper => (0xfbfaf7, 0x24211d, 0x686058, 0xddd6cc, 0xffffff, 0x8f3526),
            Self::Sepia => (0xf4ecd9, 0x2e2419, 0x71624f, 0xd8c7a8, 0xfff8e8, 0x8f3526),
            Self::Dark => (0x171717, 0xeee9de, 0xbbb1a2, 0x3a352e, 0x222222, 0xf1b38c),
            Self::Contrast => (0xffffff, 0x000000, 0x333333, 0x111111, 0xffffff, 0x000000),
        };
        Palette {
            paper: rgb(paper),
            ink: rgb(ink),
            muted: rgb(muted),
            line: rgb(line),
            panel: rgb(panel),
            accent: rgb(accent),
        }
    }
    pub fn apply(self, ctx: &egui::Context) {
        let p = self.palette();
        let mut style = (*ctx.style()).clone();
        style.visuals = if self == Self::Dark {
            egui::Visuals::dark()
        } else {
            egui::Visuals::light()
        };
        style.visuals.override_text_color = Some(p.ink);
        style.visuals.panel_fill = p.paper;
        style.visuals.window_fill = p.paper;
        style.visuals.extreme_bg_color = p.panel;
        style.visuals.widgets.inactive.bg_fill = p.panel;
        style.visuals.widgets.inactive.weak_bg_fill = p.panel;
        style.visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0_f32, p.line);
        style.visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0_f32, p.accent);
        style.visuals.widgets.hovered.bg_fill = p.ink.gamma_multiply(0.06);
        style.visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0_f32, p.accent);
        style.visuals.selection.bg_fill = p.accent.gamma_multiply(0.15);
        style.visuals.selection.stroke = egui::Stroke::new(1.0_f32, p.accent);
        style.spacing.button_padding = egui::vec2(11.0, 8.0);
        style.spacing.item_spacing = egui::vec2(8.0, 6.0);
        for id in style.text_styles.values_mut() {
            *id = FontId::proportional(13.0)
        }
        ctx.set_style(style);
    }
}
pub fn serif(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("serif-semibold".into()))
}
pub fn heading(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("serif-semibold".into()))
}
pub fn fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    for (name, bytes) in [
        (
            "serif",
            include_bytes!("../fonts/SourceSerif4-Regular.ttf").as_slice(),
        ),
        (
            "serif-bold",
            include_bytes!("../fonts/SourceSerif4-Bold.ttf").as_slice(),
        ),
        (
            "serif-semibold",
            include_bytes!("../fonts/SourceSerif4-Semibold.ttf").as_slice(),
        ),
        ("inter", include_bytes!("../fonts/Inter.ttf").as_slice()),
    ] {
        fonts
            .font_data
            .insert(name.into(), egui::FontData::from_static(bytes).into());
        if name == "inter" {
            fonts
                .families
                .get_mut(&FontFamily::Proportional)
                .unwrap()
                .insert(0, name.into());
        } else {
            fonts
                .families
                .insert(FontFamily::Name(name.into()), vec![name.into()]);
        }
    }
    ctx.set_fonts(fonts);
}
