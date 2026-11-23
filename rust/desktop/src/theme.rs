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
        // Apply the chosen palette to its explicit egui theme. The first web
        // system-theme event must not swap it for an unstyled default palette.
        ctx.set_theme(if self == Self::Dark {
            egui::Theme::Dark
        } else {
            egui::Theme::Light
        });
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
fn font_definitions(
    custom: impl IntoIterator<Item = (&'static str, egui::FontData)>,
) -> egui::FontDefinitions {
    let mut fonts = egui::FontDefinitions::default();
    for (name, data) in custom {
        fonts.font_data.insert(name.into(), data.into());
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
    fonts
}

#[cfg(not(target_arch = "wasm32"))]
fn native_fonts() -> egui::FontDefinitions {
    font_definitions([
        (
            "serif",
            egui::FontData::from_static(include_bytes!("../fonts/SourceSerif4-Regular.ttf")),
        ),
        (
            "serif-bold",
            egui::FontData::from_static(include_bytes!("../fonts/SourceSerif4-Bold.ttf")),
        ),
        (
            "serif-semibold",
            egui::FontData::from_static(include_bytes!("../fonts/SourceSerif4-Semibold.ttf")),
        ),
        (
            "inter",
            egui::FontData::from_static(include_bytes!("../fonts/Inter.ttf")),
        ),
    ])
}

#[cfg(any(target_arch = "wasm32", test))]
fn downloaded_fonts(bytes: [Vec<u8>; 4]) -> anyhow::Result<egui::FontDefinitions> {
    // Validate with egui's parser before publishing any of the downloaded set.
    // Malformed responses must be recoverable startup errors, not font panics.
    let names = ["serif", "serif-semibold", "serif-bold", "inter"];
    let custom = names
        .into_iter()
        .zip(bytes)
        .map(|(name, bytes)| {
            ab_glyph::FontRef::try_from_slice(&bytes)
                .map_err(|_| anyhow::anyhow!("Invalid browser font: {name}"))?;
            Ok((name, egui::FontData::from_owned(bytes)))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(font_definitions(custom))
}

#[cfg(target_arch = "wasm32")]
static BROWSER_FONTS: std::sync::OnceLock<egui::FontDefinitions> = std::sync::OnceLock::new();

#[cfg(target_arch = "wasm32")]
pub(super) fn configure_browser_fonts(bytes: [Vec<u8>; 4]) -> anyhow::Result<()> {
    let fonts = downloaded_fonts(bytes)?;
    BROWSER_FONTS
        .set(fonts)
        .map_err(|_| anyhow::anyhow!("Browser fonts already configured"))
}

#[cfg(target_arch = "wasm32")]
pub(super) fn browser_fonts_ready() -> bool {
    BROWSER_FONTS.get().is_some()
}

pub fn fonts(ctx: &egui::Context) {
    #[cfg(not(target_arch = "wasm32"))]
    ctx.set_fonts(native_fonts());
    #[cfg(target_arch = "wasm32")]
    ctx.set_fonts(
        BROWSER_FONTS
            .get()
            .expect("Browser fonts checked before starting reader")
            .clone(),
    );
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn downloads() -> [Vec<u8>; 4] {
        let fonts = native_fonts();
        ["serif", "serif-semibold", "serif-bold", "inter"]
            .map(|name| fonts.font_data[name].font.to_vec())
    }

    #[test]
    fn downloaded_fonts_preserve_custom_bytes_and_native_fallbacks() {
        let native = native_fonts();
        let downloaded = downloaded_fonts(downloads()).unwrap();
        assert_eq!(native.families, downloaded.families);
        assert_eq!(native.font_data.len(), downloaded.font_data.len());
        for (name, data) in &native.font_data {
            assert_eq!(data.font, downloaded.font_data[name].font, "{name}");
        }
        let defaults = egui::FontDefinitions::default();
        assert_eq!(
            downloaded.families[&FontFamily::Monospace],
            defaults.families[&FontFamily::Monospace]
        );
        assert_eq!(
            &downloaded.families[&FontFamily::Proportional][1..],
            defaults.families[&FontFamily::Proportional]
        );
    }

    #[test]
    fn malformed_downloaded_fonts_are_rejected_without_partial_configuration() {
        for index in 0..4 {
            for invalid in [vec![], b"not a font".to_vec()] {
                let mut bytes = downloads();
                bytes[index] = invalid;
                assert!(downloaded_fonts(bytes).is_err());
                assert!(downloaded_fonts(downloads()).is_ok());
            }
        }
    }
}
