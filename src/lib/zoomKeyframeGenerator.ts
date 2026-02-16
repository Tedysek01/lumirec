/**
 * Generates zoom keyframes for a segment.
 *
 * When the user adds a "zoom element", this creates a 4-keyframe pattern:
 *   [kf1]────[kf2]════════[kf3]────[kf4]
 *    1.0x     target       target    1.0x
 *   ease-in              ease-out
 *
 * kf1: zoom=1.0 at start (before state)
 * kf2: zoom=target at start + transitionMs (zoomed in, ease-in)
 * kf3: zoom=target at end - transitionMs (still zoomed, holding)
 * kf4: zoom=1.0 at end (zoomed out, ease-out)
 *
 * Plus matching focusX/focusY keyframes at each point.
 */

import { v4 as uuidv4 } from 'uuid';
import type { PropertyKeyframe, EasingType } from '@/components/video-editor/types';

export interface ZoomKeyframeConfig {
  /** Start time relative to segment start (ms) */
  startRelativeMs: number;
  /** End time relative to segment start (ms) */
  endRelativeMs: number;
  /** Target zoom scale (e.g. 1.8 for 1.8x) */
  targetZoom: number;
  /** Normalized focus point X (0-1) */
  focusX: number;
  /** Normalized focus point Y (0-1) */
  focusY: number;
  /** Duration of zoom-in/zoom-out transition (ms). Used as fallback if enter/exit not set. */
  transitionMs?: number;
  /** Duration of zoom-in transition (ms). Overrides transitionMs for enter. */
  enterTransitionMs?: number;
  /** Duration of zoom-out transition (ms). Overrides transitionMs for exit. */
  exitTransitionMs?: number;
  /** Easing for zoom-in */
  enterEasing?: EasingType;
  /** Easing for zoom-out */
  exitEasing?: EasingType;
  /** Focus at the hold-end (t3). If set, t3 uses this instead of focusX/focusY. */
  exitFocusX?: number;
  exitFocusY?: number;
  /** Zoom at the hold-end (t3). If set, t3 uses this instead of targetZoom. */
  exitZoom?: number;
}

const DEFAULT_TRANSITION_MS = 400;

export function generateZoomKeyframes(config: ZoomKeyframeConfig): PropertyKeyframe[] {
  const {
    startRelativeMs,
    endRelativeMs,
    targetZoom,
    focusX,
    focusY,
    transitionMs = DEFAULT_TRANSITION_MS,
    enterTransitionMs,
    exitTransitionMs,
    enterEasing = 'ease-in-out',
    exitEasing = 'ease-in-out',
    exitFocusX,
    exitFocusY,
    exitZoom,
  } = config;

  const duration = endRelativeMs - startRelativeMs;
  const enterMs = enterTransitionMs ?? transitionMs;
  const exitMs = exitTransitionMs ?? transitionMs;
  // Clamp so enter + exit don't exceed total duration
  const maxTotal = duration;
  const scale = (enterMs + exitMs) > maxTotal ? maxTotal / (enterMs + exitMs) : 1;
  const clampedEnter = enterMs * scale;
  const clampedExit = exitMs * scale;

  const t1 = startRelativeMs;
  const t2 = startRelativeMs + clampedEnter;
  const t3 = endRelativeMs - clampedExit;
  const t4 = endRelativeMs;

  const keyframes: PropertyKeyframe[] = [];

  // Helper to create a keyframe
  const kf = (timeMs: number, property: PropertyKeyframe['property'], value: number, easing: EasingType): PropertyKeyframe => ({
    id: uuidv4(),
    timeMs: Math.round(timeMs),
    property,
    value,
    easing,
    source: 'zoom-auto',
  });

  // Zoom keyframes: 1.0 → target → exitTarget → 1.0
  const t3Zoom = exitZoom ?? targetZoom;
  keyframes.push(kf(t1, 'zoom', 1, 'linear'));
  keyframes.push(kf(t2, 'zoom', targetZoom, enterEasing));
  keyframes.push(kf(t3, 'zoom', t3Zoom, 'linear'));
  keyframes.push(kf(t4, 'zoom', 1, exitEasing));

  // FocusX keyframes: 0.5 → target → exitTarget → 0.5
  // t3 uses exitFocusX if provided (last pan point's position), otherwise same as entry
  const t3FocusX = exitFocusX ?? focusX;
  const t3FocusY = exitFocusY ?? focusY;
  keyframes.push(kf(t1, 'focusX', 0.5, 'linear'));
  keyframes.push(kf(t2, 'focusX', focusX, enterEasing));
  keyframes.push(kf(t3, 'focusX', t3FocusX, 'linear'));
  keyframes.push(kf(t4, 'focusX', 0.5, exitEasing));

  // FocusY keyframes: 0.5 → target → exitTarget → 0.5
  keyframes.push(kf(t1, 'focusY', 0.5, 'linear'));
  keyframes.push(kf(t2, 'focusY', focusY, enterEasing));
  keyframes.push(kf(t3, 'focusY', t3FocusY, 'linear'));
  keyframes.push(kf(t4, 'focusY', 0.5, exitEasing));

  return keyframes;
}

/**
 * Convert a ZoomRegion (legacy) into keyframes relative to the segment start.
 */
export function zoomRegionToKeyframes(
  regionStartMs: number,
  regionEndMs: number,
  depth: number,
  focusCx: number,
  focusCy: number,
  segmentTimelineStartMs: number,
): PropertyKeyframe[] {
  // Map from ZOOM_DEPTH_SCALES
  const DEPTH_SCALES: Record<number, number> = {
    1: 1.25, 2: 1.5, 3: 1.8, 4: 2.2, 5: 3.5, 6: 5.0,
  };
  const targetZoom = DEPTH_SCALES[depth] ?? 1.8;

  return generateZoomKeyframes({
    startRelativeMs: regionStartMs - segmentTimelineStartMs,
    endRelativeMs: regionEndMs - segmentTimelineStartMs,
    targetZoom,
    focusX: focusCx,
    focusY: focusCy,
  });
}
