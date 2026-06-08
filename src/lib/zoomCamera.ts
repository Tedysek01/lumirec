/**
 * Single-source-of-truth camera derivation for zoom regions.
 *
 * The ZoomRegion (start/end, depth, focus, enter/exit transitions, pan points)
 * fully describes the camera path. This module derives the zoom/focus at any
 * time directly from the region — there are NO stored keyframes for zoom/focus
 * and therefore nothing to keep in sync.
 *
 * Path shape across a region [start..end]:
 *
 *   start ─ramp in─ t2 ═════ hold (pan points) ═════ t3 ─ramp out─ end
 *    1.0x            firstAnchor      ...       lastAnchor          1.0x
 *
 * Outside the region the camera is identity (zoom 1, focus centered).
 */

import type { ZoomRegion, ZoomPanPoint } from '@/components/video-editor/types';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';

export interface ZoomCamera {
  zoom: number;
  focusX: number;
  focusY: number;
}

export const IDENTITY_CAMERA: ZoomCamera = { zoom: 1, focusX: 0.5, focusY: 0.5 };

const DEFAULT_TRANSITION_MS = 400;

/** Apple-style smooth cubic ease-in-out, matching the old keyframe easing. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpCamera(a: ZoomCamera, b: ZoomCamera, t: number, ease = true): ZoomCamera {
  const e = ease ? easeInOut(t) : t;
  return {
    zoom: a.zoom + (b.zoom - a.zoom) * e,
    focusX: a.focusX + (b.focusX - a.focusX) * e,
    focusY: a.focusY + (b.focusY - a.focusY) * e,
  };
}

/** Resolve the enter/exit transition durations, clamped so they fit the region. */
export function resolveTransitionWindow(region: ZoomRegion): { t1: number; t2: number; t3: number; t4: number } {
  const duration = Math.max(0, region.endMs - region.startMs);
  const enterMs = region.enterTransition?.durationMs ?? DEFAULT_TRANSITION_MS;
  const exitMs = region.exitTransition?.durationMs ?? DEFAULT_TRANSITION_MS;
  const total = enterMs + exitMs;
  const scale = total > duration && total > 0 ? duration / total : 1;
  const clampedEnter = enterMs * scale;
  const clampedExit = exitMs * scale;
  return {
    t1: region.startMs,
    t2: region.startMs + clampedEnter,
    t3: region.endMs - clampedExit,
    t4: region.endMs,
  };
}

/**
 * The ordered list of hold anchors for a region. If the region has explicit
 * pan points they define the path; otherwise a single implicit anchor at the
 * region's base focus + depth is used. Pan point times are clamped into the
 * hold window [t2..t3] so changing the transition durations never corrupts
 * stored anchor data.
 */
export function getZoomAnchors(region: ZoomRegion): { timeMs: number; cam: ZoomCamera }[] {
  const { t2, t3 } = resolveTransitionWindow(region);
  const holdStart = region.startMs + (t2 - region.startMs);
  const holdEnd = region.startMs + (t3 - region.startMs);

  const points: ZoomPanPoint[] = region.panPoints ?? [];
  if (points.length === 0) {
    const baseZoom = ZOOM_DEPTH_SCALES[region.depth] ?? 1.8;
    const mid = (t2 + t3) / 2 - region.startMs;
    return [{
      timeMs: mid,
      cam: { zoom: baseZoom, focusX: region.focus.cx, focusY: region.focus.cy },
    }];
  }

  const holdStartRel = holdStart - region.startMs;
  const holdEndRel = holdEnd - region.startMs;
  return [...points]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((p) => ({
      timeMs: Math.max(holdStartRel, Math.min(holdEndRel, p.timeMs)),
      cam: { zoom: p.zoom, focusX: p.focusX, focusY: p.focusY },
    }));
}

/**
 * Resolve the camera (zoom + focus) for a region at an absolute source time.
 * Returns identity when the time is outside the region.
 */
export function resolveZoomCameraAtTime(region: ZoomRegion, sourceTimeMs: number): ZoomCamera {
  if (sourceTimeMs <= region.startMs || sourceTimeMs >= region.endMs) {
    return IDENTITY_CAMERA;
  }

  const { t2, t3 } = resolveTransitionWindow(region);
  const anchors = getZoomAnchors(region);
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const rel = sourceTimeMs - region.startMs;
  const t2Rel = t2 - region.startMs;
  const t3Rel = t3 - region.startMs;

  // Ramp in: identity → first anchor.
  if (sourceTimeMs <= t2) {
    const span = Math.max(1, t2 - region.startMs);
    const t = (sourceTimeMs - region.startMs) / span;
    return lerpCamera(IDENTITY_CAMERA, first.cam, Math.max(0, Math.min(1, t)));
  }

  // Ramp out: last anchor → identity.
  if (sourceTimeMs >= t3) {
    const span = Math.max(1, region.endMs - t3);
    const t = (sourceTimeMs - t3) / span;
    return lerpCamera(last.cam, IDENTITY_CAMERA, Math.max(0, Math.min(1, t)));
  }

  // Hold: interpolate across pan anchors by their time.
  if (rel <= first.timeMs) return first.cam;
  if (rel >= last.timeMs) return last.cam;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (rel >= a.timeMs && rel <= b.timeMs) {
      const span = Math.max(1, b.timeMs - a.timeMs);
      const t = (rel - a.timeMs) / span;
      return lerpCamera(a.cam, b.cam, Math.max(0, Math.min(1, t)));
    }
  }
  // Fallback (shouldn't hit): clamp within hold window.
  void t2Rel; void t3Rel;
  return last.cam;
}

/**
 * Find the zoom region active at a given source time, if any.
 */
export function findActiveZoomRegion(regions: ZoomRegion[], sourceTimeMs: number): ZoomRegion | undefined {
  return regions.find((r) => sourceTimeMs >= r.startMs && sourceTimeMs <= r.endMs);
}

/**
 * Minimum gap (ms) a pan point must keep from the transition boundaries so it
 * never lands inside the zoom-in/zoom-out ramps.
 */
export const MIN_PAN_OFFSET_MS = 30;

/** Clamp a pan-point time (relative to region start) into the safe hold window. */
export function clampPanPointTime(region: ZoomRegion, relTimeMs: number): number {
  const { t2, t3 } = resolveTransitionWindow(region);
  const minRel = (t2 - region.startMs) + MIN_PAN_OFFSET_MS;
  const maxRel = (t3 - region.startMs) - MIN_PAN_OFFSET_MS;
  if (minRel >= maxRel) {
    return Math.round((t2 + t3) / 2 - region.startMs);
  }
  return Math.max(minRel, Math.min(maxRel, Math.round(relTimeMs)));
}
