//! The iOS host supplies actual UIKit safe-area insets and sandbox paths.
//! Desktop previews use the same compact layout without requiring UIKit.
use super::*;

#[derive(Clone, Copy)]
#[repr(C)]
pub(crate) struct Activity {
    pub generation: u64,
    pub active: u32,
}

pub(crate) fn activity(ctx: &egui::Context) -> Activity {
    #[cfg(target_os = "ios")]
    {
        let _ = ctx;
        unsafe extern "C" {
            fn cross_canon_activity() -> Activity;
        }
        // SAFETY: UIKit's main thread returns this matching repr(C) value.
        unsafe { cross_canon_activity() }
    }
    #[cfg(not(target_os = "ios"))]
    Activity {
        generation: 0,
        active: u32::from(ctx.input(|i| i.focused)),
    }
}

#[derive(Clone, Copy, Default)]
#[repr(C)]
pub(crate) struct Insets {
    pub top: f32,
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
}

pub(crate) fn insets() -> Insets {
    #[cfg(target_os = "ios")]
    {
        unsafe extern "C" {
            fn cross_canon_safe_area() -> Insets;
            fn cross_canon_keyboard_height() -> f32;
        }
        // SAFETY: render runs on UIKit's main thread; the host returns values,
        // not pointers, and matches this repr(C) structure exactly.
        let mut insets = unsafe { cross_canon_safe_area() };
        // Dialog viewports end above the software keyboard. UIKit handles the
        // native reading surface and settings sheet independently.
        insets.bottom = insets.bottom.max(unsafe { cross_canon_keyboard_height() });
        insets
    }
    #[cfg(not(target_os = "ios"))]
    Insets::default()
}

impl Desktop {
    pub(crate) fn compact(ctx: &egui::Context) -> bool {
        cfg!(target_os = "ios")
            || ctx.screen_rect().width() < 600.0
            || ctx.screen_rect().height() < 500.0
    }
}

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn cross_canon_start() -> i32 {
    // Called once by main.m on the main thread. Winit owns UIApplicationMain.
    match std::panic::catch_unwind(run) {
        Ok(Ok(())) => 0,
        Ok(Err(error)) => {
            eprintln!("Cross Canon could not start: {error:#}");
            1
        }
        Err(_) => 1,
    }
}
