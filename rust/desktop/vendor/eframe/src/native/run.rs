use std::time::Instant;

use winit::{
    application::ApplicationHandler,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    window::WindowId,
};

use ahash::HashMap;

use super::winit_integration::{UserEvent, WinitApp};
use crate::{
    epi,
    native::{event_loop_context, winit_integration::EventResult},
    Result,
};

// ----------------------------------------------------------------------------
fn create_event_loop(native_options: &mut epi::NativeOptions) -> Result<EventLoop<UserEvent>> {
    #[cfg(target_os = "android")]
    use winit::platform::android::EventLoopBuilderExtAndroid as _;

    profiling::function_scope!();
    let mut builder = winit::event_loop::EventLoop::with_user_event();

    #[cfg(target_os = "android")]
    let mut builder =
        builder.with_android_app(native_options.android_app.take().ok_or_else(|| {
            crate::Error::AppCreation(Box::from(
                "`NativeOptions` is missing required `android_app`",
            ))
        })?);

    if let Some(hook) = std::mem::take(&mut native_options.event_loop_builder) {
        hook(&mut builder);
    }

    profiling::scope!("EventLoopBuilder::build");
    Ok(builder.build()?)
}

/// Access a thread-local event loop.
///
/// We reuse the event-loop so we can support closing and opening an eframe window
/// multiple times. This is just a limitation of winit.
#[cfg(not(target_os = "ios"))]
fn with_event_loop<R>(
    mut native_options: epi::NativeOptions,
    f: impl FnOnce(&mut EventLoop<UserEvent>, epi::NativeOptions) -> R,
) -> Result<R> {
    thread_local!(static EVENT_LOOP: std::cell::RefCell<Option<EventLoop<UserEvent>>> = const { std::cell::RefCell::new(None) });

    EVENT_LOOP.with(|event_loop| {
        // Since we want to reference NativeOptions when creating the EventLoop we can't
        // do that as part of the lazy thread local storage initialization and so we instead
        // create the event loop lazily here
        let mut event_loop_lock = event_loop.borrow_mut();
        let event_loop = if let Some(event_loop) = &mut *event_loop_lock {
            event_loop
        } else {
            event_loop_lock.insert(create_event_loop(&mut native_options)?)
        };
        Ok(f(event_loop, native_options))
    })
}

/// Wraps a [`WinitApp`] to implement [`ApplicationHandler`]. This handles redrawing, exit states, and
/// some events, but otherwise forwards events to the [`WinitApp`].
struct WinitAppWrapper<T: WinitApp> {
    windows_next_repaint_times: HashMap<WindowId, Instant>,
    winit_app: T,
    return_result: Result<(), crate::Error>,
    run_and_return: bool,
}

impl<T: WinitApp> WinitAppWrapper<T> {
    fn new(winit_app: T, run_and_return: bool) -> Self {
        Self {
            windows_next_repaint_times: HashMap::default(),
            winit_app,
            return_result: Ok(()),
            run_and_return,
        }
    }

    fn handle_event_result(
        &mut self,
        event_loop: &ActiveEventLoop,
        event_result: Result<EventResult>,
    ) {
        let mut exit = false;
        let mut save = false;

        log::trace!("event_result: {event_result:?}");

        let combined_result = event_result.and_then(|event_result| {
            match event_result {
                EventResult::Wait => {
                    event_loop.set_control_flow(ControlFlow::Wait);
                    Ok(event_result)
                }
                EventResult::RepaintNow(window_id) => {
                    log::trace!("RepaintNow of {window_id:?}",);

                    if cfg!(target_os = "windows") {
                        // Fix flickering on Windows, see https://github.com/emilk/egui/pull/2280
                        self.winit_app.run_ui_and_paint(event_loop, window_id)
                    } else {
                        // Fix for https://github.com/emilk/egui/issues/2425
                        self.windows_next_repaint_times
                            .insert(window_id, Instant::now());
                        Ok(event_result)
                    }
                }
                EventResult::RepaintNext(window_id) => {
                    log::trace!("RepaintNext of {window_id:?}",);
                    self.windows_next_repaint_times
                        .insert(window_id, Instant::now());
                    Ok(event_result)
                }
                EventResult::RepaintAt(window_id, repaint_time) => {
                    self.windows_next_repaint_times.insert(
                        window_id,
                        self.windows_next_repaint_times
                            .get(&window_id)
                            .map_or(repaint_time, |last| (*last).min(repaint_time)),
                    );
                    Ok(event_result)
                }
                EventResult::Save => {
                    save = true;
                    Ok(event_result)
                }
                EventResult::Exit => {
                    exit = true;
                    Ok(event_result)
                }
            }
        });

        if let Err(err) = combined_result {
            log::error!("Exiting because of error: {err}");
            exit = true;
            self.return_result = Err(err);
        };

        if save {
            log::debug!("Received an EventResult::Save - saving app state");
            self.winit_app.save();
        }

        if exit {
            if self.run_and_return {
                log::debug!("Asking to exit event loop…");
                event_loop.exit();
            } else {
                log::debug!("Quitting - saving app state…");
                self.winit_app.save_and_destroy();

                log::debug!("Exiting with return code 0");

                #[allow(clippy::exit)]
                std::process::exit(0);
            }
        }

        self.check_redraw_requests(event_loop);
    }

    fn check_redraw_requests(&mut self, event_loop: &ActiveEventLoop) {
        let flow = schedule_redraws(
            &mut self.windows_next_repaint_times,
            Instant::now(),
            |window_id| {
                if let Some(window) = self.winit_app.window(window_id) {
                    window.request_redraw();
                }
            },
        );
        event_loop.set_control_flow(flow);
    }
}

// Keep the actual scheduling policy testable when iOS withholds redraw events
// for a background window. request_redraw may not produce another event.
fn schedule_redraws(
    pending: &mut HashMap<WindowId, Instant>,
    now: Instant,
    mut request_redraw: impl FnMut(WindowId),
) -> ControlFlow {
    pending.retain(|window_id, repaint_time| {
        if now < *repaint_time {
            return true;
        }
        request_redraw(*window_id);
        false
    });
    // request_redraw already schedules presentation. iOS may withhold the
    // redraw event in the background: polling until it arrives burns a core.
    // Always reset the loop to a sleeping policy, including an empty queue.
    match pending.values().min().copied() {
        Some(next) => ControlFlow::WaitUntil(next),
        None => ControlFlow::Wait,
    }
}

#[cfg(test)]
mod repaint_tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn withheld_redraw_does_not_leave_the_loop_polling() {
        let id = WindowId::from(1_u64);
        let now = Instant::now();
        let mut pending = HashMap::from_iter([(id, now)]);
        let mut requests = Vec::new();
        let flow = schedule_redraws(&mut pending, now, |id| requests.push(id));
        assert_eq!(requests, vec![id]);
        assert!(pending.is_empty());
        assert_eq!(
            flow,
            ControlFlow::Wait,
            "a hidden window may never deliver RedrawRequested"
        );
        let next = schedule_redraws(&mut pending, now, |_| panic!("no repeated redraw request"));
        assert_eq!(next, ControlFlow::Wait);
    }

    #[test]
    fn due_requests_preserve_the_next_future_deadline() {
        let now = Instant::now();
        let first = WindowId::from(1_u64);
        let second = WindowId::from(2_u64);
        let third = WindowId::from(3_u64);
        let later = now + Duration::from_secs(30);
        let earliest = now + Duration::from_secs(2);
        let mut pending = HashMap::from_iter([(first, now), (second, later), (third, earliest)]);
        let mut requests = Vec::new();
        assert_eq!(
            schedule_redraws(&mut pending, now, |id| requests.push(id)),
            ControlFlow::WaitUntil(earliest)
        );
        assert_eq!(requests, vec![first]);
        assert_eq!(pending.len(), 2);
        assert_eq!(
            schedule_redraws(&mut pending, later, |_| {}),
            ControlFlow::Wait
        );
    }
}

impl<T: WinitApp> ApplicationHandler<UserEvent> for WinitAppWrapper<T> {
    fn suspended(&mut self, event_loop: &ActiveEventLoop) {
        profiling::scope!("Event::Suspended");

        event_loop_context::with_event_loop_context(event_loop, move || {
            let event_result = self.winit_app.suspended(event_loop);
            self.handle_event_result(event_loop, event_result);
        });
    }

    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        profiling::scope!("Event::Resumed");

        // Nb: Make sure this guard is dropped after this function returns.
        event_loop_context::with_event_loop_context(event_loop, move || {
            let event_result = self.winit_app.resumed(event_loop);
            self.handle_event_result(event_loop, event_result);
        });
    }

    fn exiting(&mut self, event_loop: &ActiveEventLoop) {
        // On Mac, Cmd-Q we get here and then `run_app_on_demand` doesn't return (despite its name),
        // so we need to save state now:
        log::debug!("Received Event::LoopExiting - saving app state…");
        event_loop_context::with_event_loop_context(event_loop, move || {
            self.winit_app.save_and_destroy();
        });
    }

    fn device_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        device_id: winit::event::DeviceId,
        event: winit::event::DeviceEvent,
    ) {
        profiling::function_scope!(egui_winit::short_device_event_description(&event));

        // Nb: Make sure this guard is dropped after this function returns.
        event_loop_context::with_event_loop_context(event_loop, move || {
            let event_result = self.winit_app.device_event(event_loop, device_id, event);
            self.handle_event_result(event_loop, event_result);
        });
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        profiling::function_scope!(match &event {
            UserEvent::RequestRepaint { .. } => "UserEvent::RequestRepaint",
            #[cfg(feature = "accesskit")]
            UserEvent::AccessKitActionRequest(_) => "UserEvent::AccessKitActionRequest",
        });

        event_loop_context::with_event_loop_context(event_loop, move || {
            let event_result = match event {
                UserEvent::RequestRepaint {
                    when,
                    cumulative_pass_nr,
                    viewport_id,
                } => {
                    let current_pass_nr = self
                        .winit_app
                        .egui_ctx()
                        .map_or(0, |ctx| ctx.cumulative_pass_nr_for(viewport_id));
                    if current_pass_nr == cumulative_pass_nr
                        || current_pass_nr == cumulative_pass_nr + 1
                    {
                        log::trace!("UserEvent::RequestRepaint scheduling repaint at {when:?}");
                        if let Some(window_id) =
                            self.winit_app.window_id_from_viewport_id(viewport_id)
                        {
                            Ok(EventResult::RepaintAt(window_id, when))
                        } else {
                            Ok(EventResult::Wait)
                        }
                    } else {
                        log::trace!("Got outdated UserEvent::RequestRepaint");
                        Ok(EventResult::Wait) // old request - we've already repainted
                    }
                }
                #[cfg(feature = "accesskit")]
                UserEvent::AccessKitActionRequest(request) => {
                    self.winit_app.on_accesskit_event(request)
                }
            };
            self.handle_event_result(event_loop, event_result);
        });
    }

    fn new_events(&mut self, event_loop: &ActiveEventLoop, cause: winit::event::StartCause) {
        if let winit::event::StartCause::ResumeTimeReached { .. } = cause {
            log::trace!("Woke up to check next_repaint_time");
        }

        self.check_redraw_requests(event_loop);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: winit::event::WindowEvent,
    ) {
        profiling::function_scope!(egui_winit::short_window_event_description(&event));

        // Nb: Make sure this guard is dropped after this function returns.
        event_loop_context::with_event_loop_context(event_loop, move || {
            let event_result = match event {
                winit::event::WindowEvent::RedrawRequested => {
                    self.winit_app.run_ui_and_paint(event_loop, window_id)
                }
                _ => self.winit_app.window_event(event_loop, window_id, event),
            };

            self.handle_event_result(event_loop, event_result);
        });
    }
}

#[cfg(not(target_os = "ios"))]
fn run_and_return(event_loop: &mut EventLoop<UserEvent>, winit_app: impl WinitApp) -> Result {
    use winit::platform::run_on_demand::EventLoopExtRunOnDemand;

    log::trace!("Entering the winit event loop (run_app_on_demand)…");

    let mut app = WinitAppWrapper::new(winit_app, true);
    event_loop.run_app_on_demand(&mut app)?;
    log::debug!("eframe window closed");
    app.return_result
}

fn run_and_exit(event_loop: EventLoop<UserEvent>, winit_app: impl WinitApp) -> Result {
    log::trace!("Entering the winit event loop (run_app)…");

    // When to repaint what window
    let mut app = WinitAppWrapper::new(winit_app, false);
    event_loop.run_app(&mut app)?;

    log::debug!("winit event loop unexpectedly returned");
    Ok(())
}

// ----------------------------------------------------------------------------

#[cfg(feature = "glow")]
pub fn run_glow(
    app_name: &str,
    mut native_options: epi::NativeOptions,
    app_creator: epi::AppCreator<'_>,
) -> Result {
    #![allow(clippy::needless_return_with_question_mark)] // False positive

    use super::glow_integration::GlowWinitApp;

    #[cfg(not(target_os = "ios"))]
    if native_options.run_and_return {
        return with_event_loop(native_options, |event_loop, native_options| {
            let glow_eframe = GlowWinitApp::new(event_loop, app_name, native_options, app_creator);
            run_and_return(event_loop, glow_eframe)
        })?;
    }

    let event_loop = create_event_loop(&mut native_options)?;
    let glow_eframe = GlowWinitApp::new(&event_loop, app_name, native_options, app_creator);
    run_and_exit(event_loop, glow_eframe)
}

// ----------------------------------------------------------------------------

#[cfg(feature = "wgpu")]
pub fn run_wgpu(
    app_name: &str,
    mut native_options: epi::NativeOptions,
    app_creator: epi::AppCreator<'_>,
) -> Result {
    #![allow(clippy::needless_return_with_question_mark)] // False positive

    use super::wgpu_integration::WgpuWinitApp;

    #[cfg(not(target_os = "ios"))]
    if native_options.run_and_return {
        return with_event_loop(native_options, |event_loop, native_options| {
            let wgpu_eframe = WgpuWinitApp::new(event_loop, app_name, native_options, app_creator);
            run_and_return(event_loop, wgpu_eframe)
        })?;
    }

    let event_loop = create_event_loop(&mut native_options)?;
    let wgpu_eframe = WgpuWinitApp::new(&event_loop, app_name, native_options, app_creator);
    run_and_exit(event_loop, wgpu_eframe)
}
