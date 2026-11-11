//! The iOS host supplies actual UIKit safe-area insets and sandbox paths.
//! Desktop previews use the same compact layout without requiring UIKit.
use super::*;

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
        }
        // SAFETY: render runs on UIKit's main thread; the host returns values,
        // not pointers, and matches this repr(C) structure exactly.
        unsafe { cross_canon_safe_area() }
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
