//! Touch scrolling keeps its own release velocity. The native input adapter
//! sends PointerGone at finger-up, which clears egui's pointer velocity before
//! ScrollArea can use it for a flick.
use eframe::egui::{self, Rect, TouchDeviceId, TouchId, TouchPhase};

#[derive(Clone, Default)]
pub(super) struct TouchScroll {
    contact: Option<Contact>,
    velocity: f32,
    last_frame: Option<f64>,
}

#[derive(Clone)]
struct Contact {
    device: TouchDeviceId,
    id: TouchId,
    start_y: f32,
    last_y: f32,
    last_move: f64,
    dragging: bool,
    stopping: bool,
    samples: std::collections::VecDeque<(f64, f32)>,
}

#[derive(Default)]
pub(super) struct TouchFrame {
    pub offset: Option<f32>,
    pub suppress_click: bool,
    pub controls_scrolling: bool,
}

impl TouchScroll {
    pub fn cancel(&mut self) {
        *self = Self::default();
    }

    pub fn frame(
        &mut self,
        ctx: &egui::Context,
        bounds: Rect,
        offset: f32,
        max_offset: f32,
        enabled: bool,
    ) -> TouchFrame {
        if !enabled {
            self.cancel();
            return TouchFrame::default();
        }
        let (now, events) = ctx.input(|i| (i.time, i.events.clone()));
        let dt = self
            .last_frame
            .map_or(0.0, |last| (now - last).clamp(0.0, 0.05)) as f32;
        self.last_frame = Some(now);
        let mut next = offset;
        let mut result = TouchFrame {
            controls_scrolling: self.contact.is_some() || self.velocity != 0.0,
            ..Default::default()
        };
        let mut touched = false;
        // Native backends may batch several moves into one frame. Keep the
        // final position for each timestamp in the recent-motion history.
        for event in events {
            let egui::Event::Touch {
                device_id,
                id,
                phase,
                pos,
                ..
            } = event
            else {
                continue;
            };
            match phase {
                TouchPhase::Start if self.contact.is_none() && bounds.contains(pos) => {
                    self.contact = Some(Contact {
                        device: device_id,
                        id,
                        start_y: pos.y,
                        last_y: pos.y,
                        last_move: now,
                        dragging: false,
                        stopping: self.velocity.abs() > 5.0,
                        samples: [(now, pos.y)].into(),
                    });
                    self.velocity = 0.0;
                    touched = true;
                }
                TouchPhase::Move | TouchPhase::End | TouchPhase::Cancel => {
                    let Some(contact) = self.contact.as_mut() else {
                        continue;
                    };
                    if contact.device != device_id || contact.id != id {
                        continue;
                    }
                    touched = true;
                    let delta = contact.last_y - pos.y;
                    if phase != TouchPhase::Cancel && delta != 0.0 {
                        // Estimate release speed over recent motion, rather than
                        // replacing it with one noisy finger-up/coalesced sample.
                        if contact.samples.back().is_some_and(|(time, _)| *time == now) {
                            contact.samples.pop_back();
                        }
                        contact.samples.push_back((now, pos.y));
                        while contact.samples.len() > 2
                            && contact
                                .samples
                                .get(1)
                                .is_some_and(|(time, _)| now - time > 0.08)
                        {
                            contact.samples.pop_front();
                        }
                        if let Some(&(sample_time, sample_y)) = contact.samples.front() {
                            let elapsed = (now - sample_time).max(1.0 / 240.0) as f32;
                            self.velocity = ((sample_y - pos.y) / elapsed).clamp(-6000.0, 6000.0);
                        }
                        let was_dragging = contact.dragging;
                        contact.dragging |= (contact.start_y - pos.y).abs() > 6.0;
                        if contact.dragging {
                            next += if was_dragging {
                                delta
                            } else {
                                contact.start_y - pos.y
                            };
                        }
                        contact.last_y = pos.y;
                        contact.last_move = now;
                    }
                    result.suppress_click |= contact.dragging || contact.stopping;
                    if phase == TouchPhase::End || phase == TouchPhase::Cancel {
                        // A held finger or cancellation must not launch a stale flick.
                        if phase == TouchPhase::Cancel
                            || !contact.dragging
                            || now - contact.last_move > 0.08
                        {
                            self.velocity = 0.0;
                        }
                        self.contact = None;
                    }
                }
                _ => {}
            }
        }
        if let Some(contact) = &self.contact {
            result.suppress_click |= contact.dragging || contact.stopping;
        } else if !touched && self.velocity != 0.0 {
            // Frame-rate-independent exponential deceleration, integrated over
            // the frame rather than approximated with a fixed per-frame step.
            let rate = -1000.0 * 0.998_f32.ln();
            let decay = (-rate * dt).exp();
            next += self.velocity * (1.0 - decay) / rate;
            self.velocity *= decay;
            if self.velocity.abs() < 5.0 {
                self.velocity = 0.0;
            }
        }
        if next < 0.0 || next > max_offset {
            self.velocity = 0.0;
        }
        result.controls_scrolling |= touched || self.contact.is_some() || self.velocity != 0.0;
        if result.controls_scrolling {
            result.offset = Some(next.clamp(0.0, max_offset.max(0.0)));
        }
        if self.contact.is_none() && self.velocity != 0.0 {
            ctx.request_repaint();
        }
        result
    }
}

/// One owner for both touch momentum and egui's wheel/scrollbar state. Use this
/// for dialog viewports too: PointerGone also clears egui velocity there.
#[derive(Clone, Default)]
struct Viewport {
    touch: TouchScroll,
    offset: f32,
    max_offset: f32,
    last_seen: u64,
}

#[derive(Clone, Default)]
struct Regions(Vec<(egui::Id, egui::LayerId, u64, Rect)>);

pub(super) fn vertical<R>(
    ui: &mut egui::Ui,
    id: &'static str,
    height: f32,
    fill: bool,
    content: impl FnOnce(&mut egui::Ui, bool) -> R,
) -> egui::scroll_area::ScrollAreaOutput<R> {
    let memory_id = ui.make_persistent_id((id, "touch"));
    let mut viewport = ui
        .ctx()
        .data_mut(|data| data.get_temp::<Viewport>(memory_id))
        .unwrap_or_default();
    let bounds = Rect::from_min_size(ui.cursor().min, egui::vec2(ui.available_width(), height));
    let frame = ui.ctx().cumulative_pass_nr();
    if viewport.last_seen + 1 < frame {
        viewport.touch.cancel();
        viewport.offset = 0.0;
    }
    viewport.last_seen = frame;
    let regions_id = egui::Id::new("touch-scroll-regions");
    let (start, has_touch) = ui.input(|i| {
        (
            i.events.iter().find_map(|e| match e {
                egui::Event::Touch {
                    phase: TouchPhase::Start,
                    pos,
                    ..
                } => Some(*pos),
                _ => None,
            }),
            i.events
                .iter()
                .any(|e| matches!(e, egui::Event::Touch { .. })),
        )
    });
    // A gesture belongs to the innermost viewport under its starting point.
    // Both the works list and its containing modal must not move together.
    let owner = start.and_then(|pos| {
        ui.ctx().data_mut(|data| {
            data.get_temp::<Regions>(regions_id)
                .unwrap_or_default()
                .0
                .into_iter()
                .filter(|(_, layer, seen, rect)| {
                    *layer == ui.layer_id() && *seen + 1 >= frame && rect.contains(pos)
                })
                .min_by(|a, b| a.3.area().total_cmp(&b.3.area()))
                .map(|r| r.0)
        })
    });
    let front_layer = start.and_then(|pos| ui.ctx().layer_id_at(pos));
    let touch = viewport.touch.frame(
        ui.ctx(),
        bounds,
        viewport.offset,
        viewport.max_offset,
        owner.is_none_or(|id| id == memory_id)
            && front_layer.is_none_or(|layer| layer == ui.layer_id()),
    );
    let mut area = egui::ScrollArea::vertical()
        .id_salt(id)
        .animated(false)
        .max_height(height)
        .auto_shrink([false, true])
        .drag_to_scroll(!has_touch && !touch.controls_scrolling);
    if fill {
        area = area.min_scrolled_height(height).auto_shrink([false, false]);
    }
    if let Some(offset) = touch.offset {
        area = area.vertical_scroll_offset(offset);
    }
    let output = area.show(ui, |ui| content(ui, touch.suppress_click));
    viewport.offset = output.state.offset.y;
    viewport.max_offset = (output.content_size.y - output.inner_rect.height()).max(0.0);
    ui.ctx().data_mut(|data| {
        data.insert_temp(memory_id, viewport);
        let mut regions = data.get_temp::<Regions>(regions_id).unwrap_or_default();
        regions
            .0
            .retain(|(id, _, seen, _)| *id != memory_id && *seen + 1 >= frame);
        regions
            .0
            .push((memory_id, ui.layer_id(), frame, output.inner_rect));
        data.insert_temp(regions_id, regions);
    });
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_dialog_flick_moves_only_the_touched_viewport_and_coasts() {
        for nested in [false, true] {
            let ctx = egui::Context::default();
            let mut tick = 0;
            let mut render = |phase: Option<TouchPhase>, y: f32| {
                tick += 1;
                let pos = egui::pos2(100.0, y);
                let mut events = vec![];
                if let Some(phase) = phase {
                    events.push(egui::Event::Touch {
                        device_id: TouchDeviceId(0),
                        id: TouchId(0),
                        phase,
                        pos,
                        force: None,
                    });
                    match phase {
                        TouchPhase::Start | TouchPhase::End => {
                            events.push(egui::Event::PointerMoved(pos));
                            events.push(egui::Event::PointerButton {
                                pos,
                                button: egui::PointerButton::Primary,
                                pressed: phase == TouchPhase::Start,
                                modifiers: egui::Modifiers::NONE,
                            });
                            if phase == TouchPhase::End {
                                events.push(egui::Event::PointerGone);
                            }
                        }
                        _ => events.push(egui::Event::PointerMoved(pos)),
                    }
                }
                let mut offsets = (0.0, 0.0);
                let _ = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(Rect::from_min_size(
                            egui::Pos2::ZERO,
                            egui::vec2(393.0, 700.0),
                        )),
                        time: Some(tick as f64 / 60.0),
                        events,
                        ..Default::default()
                    },
                    |ctx| {
                        egui::CentralPanel::default().show(ctx, |ui| {
                            ui.heading("Choose a work");
                            let output = vertical(ui, "modal", 550.0, true, |ui, _| {
                                let inner = vertical(ui, "works", 180.0, false, |ui, _| {
                                    for i in 0..50 {
                                        ui.label(format!("Work {i}"));
                                    }
                                });
                                offsets.1 = inner.state.offset.y;
                                for i in 0..80 {
                                    ui.label(format!("Chapter {i}"));
                                }
                            });
                            offsets.0 = output.state.offset.y;
                        });
                    },
                );
                offsets
            };
            for _ in 0..3 {
                render(None, 0.0);
            }
            let start = if nested { 200.0 } else { 520.0 };
            render(Some(TouchPhase::Start), start);
            let mut dragged = (0.0, 0.0);
            for step in 1..=8 {
                dragged = render(Some(TouchPhase::Move), start - step as f32 * 12.0);
            }
            let released = render(Some(TouchPhase::End), start - 96.0);
            let mut coasted = released;
            for _ in 0..12 {
                coasted = render(None, 0.0);
            }
            let (moved, coast, stationary) = if nested {
                (dragged.1, coasted.1 - released.1, coasted.0)
            } else {
                (dragged.0, coasted.0 - released.0, coasted.1)
            };
            assert!(
                moved > 80.0,
                "Dialog must follow finger: nested={nested}, {dragged:?}"
            );
            assert!(
                coast > 80.0,
                "Dialog must coast after PointerGone: nested={nested}, {coasted:?}"
            );
            assert!(
                stationary < 1.0,
                "Only the touched viewport may move: nested={nested}, {coasted:?}"
            );
        }
    }

    #[test]
    fn lifting_a_finger_does_not_abruptly_brake_a_flick() {
        let ctx = egui::Context::default();
        let mut scroll = TouchScroll::default();
        let mut offset = 1000.0;
        step(
            &mut scroll,
            &ctx,
            0.0,
            offset,
            &[(0, TouchPhase::Start, 500.0)],
        );
        for frame in 1..=8 {
            offset = step(
                &mut scroll,
                &ctx,
                frame as f64 / 60.0,
                offset,
                &[(0, TouchPhase::Move, 500.0 - frame as f32 * 20.0)],
            )
            .offset
            .unwrap();
        }
        // UIKit can deliver a final, very short movement as the finger lifts.
        offset = step(
            &mut scroll,
            &ctx,
            9.0 / 60.0,
            offset,
            &[(0, TouchPhase::End, 338.0)],
        )
        .offset
        .unwrap();
        let released = offset;
        for frame in 10..=21 {
            offset = step(&mut scroll, &ctx, frame as f64 / 60.0, offset, &[])
                .offset
                .unwrap_or(offset);
        }
        assert!(
            offset - released > 130.0,
            "A 1200 pt/s flick must not brake to the tiny finger-up delta: coasted {} points",
            offset - released
        );
    }

    fn step(
        scroll: &mut TouchScroll,
        ctx: &egui::Context,
        time: f64,
        offset: f32,
        touches: &[(u64, TouchPhase, f32)],
    ) -> TouchFrame {
        let mut result = TouchFrame::default();
        let _ = ctx.run(
            egui::RawInput {
                time: Some(time),
                events: touches
                    .iter()
                    .map(|&(id, phase, y)| egui::Event::Touch {
                        device_id: TouchDeviceId(0),
                        id: TouchId(id),
                        phase,
                        pos: egui::pos2(100.0, y),
                        force: None,
                    })
                    .collect(),
                ..Default::default()
            },
            |ctx| {
                result = scroll.frame(
                    ctx,
                    Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(393.0, 700.0)),
                    offset,
                    10000.0,
                    true,
                );
            },
        );
        result
    }

    #[test]
    fn flick_distance_is_consistent_at_60_and_120_hz() {
        let mut distances = vec![];
        for hz in [60, 120] {
            let ctx = egui::Context::default();
            let mut scroll = TouchScroll::default();
            let mut offset = 1000.0;
            step(
                &mut scroll,
                &ctx,
                0.0,
                offset,
                &[(0, TouchPhase::Start, 500.0)],
            );
            offset = step(
                &mut scroll,
                &ctx,
                0.1,
                offset,
                &[(0, TouchPhase::Move, 400.0)],
            )
            .offset
            .unwrap();
            step(
                &mut scroll,
                &ctx,
                0.11,
                offset,
                &[(0, TouchPhase::End, 400.0)],
            );
            for frame in 1..=hz {
                offset = step(
                    &mut scroll,
                    &ctx,
                    0.11 + frame as f64 / hz as f64,
                    offset,
                    &[],
                )
                .offset
                .unwrap_or(offset);
            }
            distances.push(offset);
        }
        assert!(
            (distances[0] - distances[1]).abs() < 0.5,
            "Refresh rate must not change momentum distance: {distances:?}"
        );
    }

    #[test]
    fn held_release_cancel_and_other_fingers_do_not_launch_a_flick() {
        for phase in [TouchPhase::End, TouchPhase::Cancel] {
            let ctx = egui::Context::default();
            let mut scroll = TouchScroll::default();
            step(
                &mut scroll,
                &ctx,
                0.0,
                1000.0,
                &[(0, TouchPhase::Start, 500.0)],
            );
            let offset = step(
                &mut scroll,
                &ctx,
                0.1,
                1000.0,
                &[(0, TouchPhase::Move, 400.0)],
            )
            .offset
            .unwrap();
            let other = step(
                &mut scroll,
                &ctx,
                0.12,
                offset,
                &[(1, TouchPhase::Move, 100.0), (1, TouchPhase::End, 100.0)],
            );
            assert_eq!(
                other.offset,
                Some(offset),
                "A second finger must not move the reader"
            );
            step(&mut scroll, &ctx, 0.3, offset, &[(0, phase, 400.0)]);
            let idle = step(&mut scroll, &ctx, 0.32, offset, &[]);
            assert!(
                !idle.controls_scrolling,
                "A held or cancelled gesture must stop"
            );
        }
    }
}
