/**
 * Single-source-of-truth camera derivation for zoom regions.
 *
 * A ZoomRegion describes a base zoom (depth + focus) that ramps in/out via its
 * enter/exit transitions. Stacked on top are relative-delta `layers`: a `zoom`
 * layer adds to the base zoom, a `position` layer offsets the focus. The camera
 * at any time is the base ramp plus the sum of every active layer's ramped
 * delta. There are no stored keyframes — nothing to keep in sync.
 *
 *   start ─ramp in─ t2 ════════ hold (base + layer deltas) ════════ t3 ─ramp out─ end
 *    1.0x            depth                                          depth          1.0x
 *
 * Outside the region the camera is identity (zoom 1, focus centered).
 */

import type { ZoomRegion, ZoomLayer } from '@/components/video-editor/types';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';

export interface ZoomCamera {
  zoom: number;
  focusX: number;
  focusY: number;
}

export const IDENTITY_CAMERA: ZoomCamera = { zoom: 1, focusX: 0.5, focusY: 0.5 };

const DEFAULT_TRANSITION_MS = 400;

/** Apple-style smooth cubic ease-in-out. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Resolve the enter/exit transition durations, clamped so they fit the region. */
export function resolveTransitionWindow(region: ZoomRegion): { t1: number; t2: number; t3: number; t4: number } {
  const duration = Math.max(0, region.endMs - region.startMs);
  const enterMs = region.enterTransition?.durationMs ?? DEFAULT_TRANSITION_MS;
  const exitMs = region.exitTransition?.durationMs ?? DEFAULT_TRANSITION_MS;
  const total = enterMs + exitMs;
  const scale = total > duration && total > 0 ? duration / total : 1;
  return {
    t1: region.startMs,
    t2: region.startMs + enterMs * scale,
    t3: region.endMs - exitMs * scale,
    t4: region.endMs,
  };
}

/**
 * The base camera (no layers) at an absolute source time: identity → depth over
 * the enter ramp, hold at depth, depth → identity over the exit ramp.
 */
export function resolveBaseCameraAtTime(region: ZoomRegion, sourceTimeMs: number): ZoomCamera {
  if (sourceTimeMs <= region.startMs || sourceTimeMs >= region.endMs) {
    return IDENTITY_CAMERA;
  }
  const { t2, t3 } = resolveTransitionWindow(region);
  const target: ZoomCamera = {
    zoom: ZOOM_DEPTH_SCALES[region.depth] ?? 1.8,
    focusX: region.focus.cx,
    focusY: region.focus.cy,
  };

  if (sourceTimeMs <= t2) {
    const span = Math.max(1, t2 - region.startMs);
    const e = easeInOut(clamp((sourceTimeMs - region.startMs) / span, 0, 1));
    return {
      zoom: 1 + (target.zoom - 1) * e,
      focusX: 0.5 + (target.focusX - 0.5) * e,
      focusY: 0.5 + (target.focusY - 0.5) * e,
    };
  }
  if (sourceTimeMs >= t3) {
    const span = Math.max(1, region.endMs - t3);
    const e = easeInOut(clamp((sourceTimeMs - t3) / span, 0, 1));
    return {
      zoom: target.zoom + (1 - target.zoom) * e,
      focusX: target.focusX + (0.5 - target.focusX) * e,
      focusY: target.focusY + (0.5 - target.focusY) * e,
    };
  }
  return target;
}

/**
 * A layer's 0..1 contribution weight at a region-relative time: ramps 0→1 over
 * `enterMs` at the layer start, holds at 1, ramps 1→0 over `exitMs` before the
 * end. Enter+exit are scaled down to fit when they exceed the layer duration.
 */
export function layerWeight(layer: ZoomLayer, relTimeMs: number): number {
  if (relTimeMs <= layer.startMs || relTimeMs >= layer.endMs) return 0;
  const dur = Math.max(1, layer.endMs - layer.startMs);
  let enter = Math.max(0, layer.enterMs);
  let exit = Math.max(0, layer.exitMs);
  const total = enter + exit;
  if (total > dur && total > 0) {
    const s = dur / total;
    enter *= s;
    exit *= s;
  }
  const inEnd = layer.startMs + enter;
  const outStart = layer.endMs - exit;
  if (enter > 0 && relTimeMs < inEnd) {
    return easeInOut(clamp((relTimeMs - layer.startMs) / enter, 0, 1));
  }
  if (exit > 0 && relTimeMs > outStart) {
    return easeInOut(clamp((layer.endMs - relTimeMs) / exit, 0, 1));
  }
  return 1;
}

/**
 * Resolve the camera (zoom + focus) for a region at an absolute source time:
 * the base ramp plus the sum of every active layer's ramped delta. Identity
 * outside the region.
 */
export function resolveZoomCameraAtTime(region: ZoomRegion, sourceTimeMs: number): ZoomCamera {
  if (sourceTimeMs <= region.startMs || sourceTimeMs >= region.endMs) {
    return IDENTITY_CAMERA;
  }
  const cam = resolveBaseCameraAtTime(region, sourceTimeMs);
  const relTime = sourceTimeMs - region.startMs;
  for (const layer of region.layers ?? []) {
    const w = layerWeight(layer, relTime);
    if (w <= 0) continue;
    if (layer.kind === 'zoom') {
      cam.zoom += (layer.zoomDelta ?? 0) * w;
    } else {
      cam.focusX += (layer.focusDx ?? 0) * w;
      cam.focusY += (layer.focusDy ?? 0) * w;
    }
  }
  cam.zoom = Math.max(1, cam.zoom);
  cam.focusX = clamp(cam.focusX, 0, 1);
  cam.focusY = clamp(cam.focusY, 0, 1);
  return cam;
}

/** Find the zoom region active at a given source time, if any. */
export function findActiveZoomRegion(regions: ZoomRegion[], sourceTimeMs: number): ZoomRegion | undefined {
  return regions.find((r) => sourceTimeMs >= r.startMs && sourceTimeMs <= r.endMs);
}

/** Clamp a layer's start/end into the region's hold window (region-relative). */
export function clampLayerToHold(region: ZoomRegion, layer: ZoomLayer): ZoomLayer {
  const { t2, t3 } = resolveTransitionWindow(region);
  const holdStart = t2 - region.startMs;
  const holdEnd = t3 - region.startMs;
  let startMs = clamp(layer.startMs, holdStart, holdEnd);
  let endMs = clamp(layer.endMs, holdStart, holdEnd);
  if (endMs <= startMs) {
    endMs = Math.min(holdEnd, startMs + 1);
    if (endMs <= startMs) startMs = Math.max(holdStart, endMs - 1);
  }
  return { ...layer, startMs: Math.round(startMs), endMs: Math.round(endMs) };
}
