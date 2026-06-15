# Layered Zooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace zoom keyframes (pan points) with stacked relative-delta **layers** over a base zoom region — a zoom layer pushes the zoom in/out, a position layer shifts the focus, each with its own enter/exit ramp.

**Architecture:** A `ZoomRegion` keeps its base zoom (`depth`) and `focus`, and gains a `layers: ZoomLayer[]` array (replacing `panPoints`). The camera at any time is the base ramp plus the sum of every active layer's ramped delta. `resolveZoomCameraAtTime(region, t)` keeps its signature so `frameRenderer.ts`/`VideoPlayback.tsx` are untouched internally.

**Tech Stack:** TypeScript, React, Vitest, dnd-timeline. Run tests with `npm test` (vitest `--run`), types with `npx tsc --noEmit`, lint with `npm run lint`.

---

## File Structure

- `src/components/video-editor/types.ts` — remove `ZoomPanPoint`; add `ZoomLayerKind`, `ZoomLayer`; swap `ZoomRegion.panPoints` → `layers`.
- `src/lib/zoomCamera.ts` — rewrite engine: base ramp + per-layer weight + delta sum. Remove `getZoomAnchors`, `resolveHoldCameraAtRelTime`, `clampPanPointTime`, `MIN_PAN_OFFSET_MS`. Add `resolveBaseCameraAtTime`, `layerWeight`, `clampLayerToHold`.
- `src/lib/zoomCamera.test.ts` — rewrite around delta composition.
- `src/hooks/useZoomHandlers.ts` — remove pan-point handlers; add layer CRUD handlers; rework derived `selectedLayer`.
- `src/lib/migrateZoom.ts` — stop producing pan points; strip legacy zoom keyframes only.
- `src/components/video-editor/SettingsPanel.tsx` — replace pan-point/property block with layer controls.
- `src/components/video-editor/timeline/KeyframeTrack.tsx` — remove zoom pan-point diamonds.
- `src/components/video-editor/timeline/ZoomLayerLane.tsx` — **new** component rendering layer bars beneath the selected region.
- `src/components/video-editor/timeline/TimelineEditor.tsx` — render `ZoomLayerLane`, thread new props, drop pan-point props.
- `src/components/video-editor/VideoEditor.tsx` — wire layer handlers + `selectedZoomLayerId` state; drop pan-point wiring.

Implementation order: types → engine → tests → handlers → migration → UI (settings, lane, wiring) → verification. Phase 1 (Tasks 1–4) makes the renderer correct on its own; the UI phase makes layers authorable.

---

## Task 1: Types — ZoomLayer replaces ZoomPanPoint

**Files:**
- Modify: `src/components/video-editor/types.ts:20-48`

- [ ] **Step 1: Replace the `ZoomPanPoint` interface and `ZoomRegion.panPoints` field**

Replace lines 20-48 (the `ZoomPanPoint` doc-comment + interface and the `ZoomRegion` interface) with:

```ts
export type ZoomLayerKind = 'zoom' | 'position';

/**
 * A relative-delta layer stacked over a zoom region's base. A `zoom` layer adds
 * `zoomDelta` to the base zoom (negative = pull out); a `position` layer offsets
 * the focus by (`focusDx`, `focusDy`). Each layer ramps its delta from 0 to its
 * value over `enterMs` and back to 0 over `exitMs`. Times are relative to
 * `region.startMs` and clamped into the region's hold window. Layers replace the
 * old keyframe pan points — there is no per-keyframe interpolation.
 */
export interface ZoomLayer {
  id: string;
  kind: ZoomLayerKind;
  startMs: number;   // relative to region.startMs
  endMs: number;     // relative to region.startMs
  enterMs: number;   // ramp delta 0 -> value
  exitMs: number;    // ramp delta value -> 0
  zoomDelta?: number;   // kind 'zoom': additive on zoom scale, may be negative
  focusDx?: number;     // kind 'position': focus X offset (-1..1)
  focusDy?: number;     // kind 'position': focus Y offset (-1..1)
}

export interface ZoomRegion {
  id: string;
  startMs: number;
  endMs: number;
  depth: ZoomDepth;             // base/target zoom level
  focus: ZoomFocus;            // base focus
  enterTransition?: TransitionConfig;  // base zoom-in duration/easing
  exitTransition?: TransitionConfig;   // base zoom-out duration/easing
  /**
   * Relative-delta layers stacked over the base. Empty = a plain base zoom with
   * no extra motion. The region + its layers fully describe the camera path.
   */
  layers: ZoomLayer[];
}
```

- [ ] **Step 2: Verify types compile against the rest of the file**

Run: `npx tsc --noEmit 2>&1 | grep -c "ZoomPanPoint\|panPoints"`
Expected: Non-zero (other files still reference the old names — that is fine; we fix them in later tasks). The point of this step is only to confirm `types.ts` itself has no internal syntax error. If you see a parse error pointing inside `types.ts`, fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/components/video-editor/types.ts
git commit -m "Add ZoomLayer type, replace ZoomRegion.panPoints with layers"
```

---

## Task 2: Engine — base ramp + layer weight (TDD)

**Files:**
- Modify: `src/lib/zoomCamera.ts`
- Test: `src/lib/zoomCamera.test.ts`

- [ ] **Step 1: Write failing tests for the new engine**

Replace the entire contents of `src/lib/zoomCamera.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveZoomCameraAtTime,
  resolveBaseCameraAtTime,
  resolveTransitionWindow,
  layerWeight,
  clampLayerToHold,
  findActiveZoomRegion,
  IDENTITY_CAMERA,
} from './zoomCamera';
import type { ZoomRegion, ZoomLayer } from '@/components/video-editor/types';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';

function makeRegion(overrides: Partial<ZoomRegion> = {}): ZoomRegion {
  return {
    id: 'z1',
    startMs: 1000,
    endMs: 3000,
    depth: 3,
    focus: { cx: 0.5, cy: 0.5 },
    enterTransition: { type: 'none', durationMs: 400 },
    exitTransition: { type: 'none', durationMs: 400 },
    layers: [],
    ...overrides,
  };
}

function zoomLayer(overrides: Partial<ZoomLayer> = {}): ZoomLayer {
  return {
    id: 'l1', kind: 'zoom', startMs: 500, endMs: 1500,
    enterMs: 200, exitMs: 200, zoomDelta: 0.8, ...overrides,
  };
}

describe('resolveTransitionWindow', () => {
  it('places t2/t3 at the enter/exit offsets', () => {
    const w = resolveTransitionWindow(makeRegion());
    expect(w.t1).toBe(1000);
    expect(w.t2).toBe(1400);
    expect(w.t3).toBe(2600);
    expect(w.t4).toBe(3000);
  });

  it('scales enter+exit down when they exceed the region duration', () => {
    const w = resolveTransitionWindow(
      makeRegion({ startMs: 0, endMs: 600, enterTransition: { type: 'none', durationMs: 400 }, exitTransition: { type: 'none', durationMs: 400 } }),
    );
    expect(w.t2).toBeCloseTo(300, 0);
    expect(w.t3).toBeCloseTo(300, 0);
  });
});

describe('resolveBaseCameraAtTime', () => {
  it('is identity outside the region', () => {
    const r = makeRegion();
    expect(resolveBaseCameraAtTime(r, 500)).toEqual(IDENTITY_CAMERA);
    expect(resolveBaseCameraAtTime(r, 3500)).toEqual(IDENTITY_CAMERA);
  });

  it('reaches the depth target during the hold', () => {
    const cam = resolveBaseCameraAtTime(makeRegion(), 2000);
    expect(cam.zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3], 5);
    expect(cam.focusX).toBeCloseTo(0.5, 5);
  });

  it('ramps up from identity after start and down before end', () => {
    const r = makeRegion();
    expect(resolveBaseCameraAtTime(r, 1001).zoom).toBeGreaterThan(1);
    expect(resolveBaseCameraAtTime(r, 1001).zoom).toBeLessThan(ZOOM_DEPTH_SCALES[3]);
    expect(resolveBaseCameraAtTime(r, 2999).zoom).toBeLessThan(ZOOM_DEPTH_SCALES[3]);
  });
});

describe('layerWeight', () => {
  it('is 0 outside the layer span and 1 in the hold', () => {
    const l = zoomLayer();
    expect(layerWeight(l, 400)).toBe(0);
    expect(layerWeight(l, 1600)).toBe(0);
    expect(layerWeight(l, 1000)).toBeCloseTo(1, 5);
  });

  it('ramps between 0 and 1 inside the enter window', () => {
    const l = zoomLayer();
    const w = layerWeight(l, 600); // 100ms into a 200ms enter
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
  });

  it('scales enter+exit down when they exceed the layer duration', () => {
    const l = zoomLayer({ startMs: 0, endMs: 200, enterMs: 200, exitMs: 200 });
    expect(layerWeight(l, 100)).toBeCloseTo(1, 1); // peak near the middle, not 0
  });
});

describe('resolveZoomCameraAtTime', () => {
  it('is identity outside the region', () => {
    const r = makeRegion();
    expect(resolveZoomCameraAtTime(r, 500)).toEqual(IDENTITY_CAMERA);
  });

  it('a base-only region matches the base camera', () => {
    const r = makeRegion();
    expect(resolveZoomCameraAtTime(r, 2000).zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3], 5);
  });

  it('adds a zoom layer delta on top of the base during its hold', () => {
    const r = makeRegion({ layers: [zoomLayer()] }); // hold rel ~1000 -> source 2000
    expect(resolveZoomCameraAtTime(r, 2000).zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3] + 0.8, 5);
  });

  it('sums two overlapping zoom layers', () => {
    const r = makeRegion({
      layers: [zoomLayer({ id: 'a', zoomDelta: 0.5 }), zoomLayer({ id: 'b', zoomDelta: 0.3 })],
    });
    expect(resolveZoomCameraAtTime(r, 2000).zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3] + 0.8, 5);
  });

  it('clamps a negative zoom layer so zoom never drops below 1', () => {
    const r = makeRegion({ depth: 1, layers: [zoomLayer({ zoomDelta: -5 })] }); // base 1.25
    expect(resolveZoomCameraAtTime(r, 2000).zoom).toBeGreaterThanOrEqual(1);
  });

  it('offsets focus with a position layer, clamped to [0,1]', () => {
    const r = makeRegion({
      layers: [zoomLayer({ kind: 'position', zoomDelta: undefined, focusDx: -0.3, focusDy: -0.2 })],
    });
    const cam = resolveZoomCameraAtTime(r, 2000);
    expect(cam.focusX).toBeCloseTo(0.2, 5);
    expect(cam.focusY).toBeCloseTo(0.3, 5);
    expect(cam.zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3], 5); // position layer leaves zoom alone
  });

  it('ignores a layer whose weight is 0 at the sampled time', () => {
    const r = makeRegion({ layers: [zoomLayer({ startMs: 500, endMs: 700 })] });
    expect(resolveZoomCameraAtTime(r, 2000).zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3], 5);
  });
});

describe('clampLayerToHold', () => {
  it('clamps layer start/end into the hold window [t2..t3] (rel)', () => {
    const r = makeRegion(); // hold rel window [400..1600]
    const clamped = clampLayerToHold(r, zoomLayer({ startMs: -100, endMs: 5000 }));
    expect(clamped.startMs).toBeGreaterThanOrEqual(400);
    expect(clamped.endMs).toBeLessThanOrEqual(1600);
    expect(clamped.endMs).toBeGreaterThan(clamped.startMs);
  });
});

describe('findActiveZoomRegion', () => {
  it('finds the region covering a time', () => {
    const r = makeRegion();
    expect(findActiveZoomRegion([r], 2000)?.id).toBe('z1');
    expect(findActiveZoomRegion([r], 4000)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- zoomCamera 2>&1 | tail -20`
Expected: FAIL — `resolveBaseCameraAtTime`, `layerWeight`, `clampLayerToHold` are not exported yet (and the old exports the test no longer imports still exist).

- [ ] **Step 3: Rewrite `zoomCamera.ts`**

Replace the entire contents of `src/lib/zoomCamera.ts` with:

```ts
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
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- zoomCamera 2>&1 | tail -20`
Expected: PASS — all `zoomCamera.test.ts` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zoomCamera.ts src/lib/zoomCamera.test.ts
git commit -m "Rewrite zoom camera engine as base ramp plus summed layer deltas"
```

---

## Task 3: Migration — stop emitting pan points

**Files:**
- Modify: `src/lib/migrateZoom.ts`

The new model discards old pan-point data. This migration only needs to strip legacy zoom/focus keyframes off segments and ensure every region has a `layers` array.

- [ ] **Step 1: Rewrite `migrateZoom.ts`**

Replace the entire contents of `src/lib/migrateZoom.ts` with:

```ts
/**
 * Migration: legacy keyframe/pan-point zoom data → layered-zoom model.
 *
 * Older projects stored zoom as PropertyKeyframes on each segment, then as
 * region pan points. The layered model derives the camera from the region's
 * base zoom plus relative-delta layers. There is no automatic conversion of old
 * pan points into layers — that data is dropped. This migration:
 *   1. ensures every region has a `layers` array, and
 *   2. strips all zoom/focus keyframes from segments (the camera no longer reads them).
 */

import type { EditorUndoableState } from '@/components/video-editor/editorState';
import type { PropertyKeyframe } from '@/components/video-editor/types';

function isStrippableZoomKeyframe(kf: PropertyKeyframe): boolean {
  if (kf.source === 'zoom' || kf.source === 'zoom-auto') return true;
  if (kf.source === 'manual') return false;
  // Legacy untagged zoom/focus keyframes were zoom-driven.
  return kf.property === 'zoom' || kf.property === 'focusX' || kf.property === 'focusY';
}

export function migrateZoomKeyframesToRegions(state: EditorUndoableState): void {
  const { zoomRegions, videoSegments } = state;

  // Ensure the layered model invariant: every region has a layers array, and
  // any stale `panPoints` field from old saves is dropped.
  if (zoomRegions?.length) {
    for (const region of zoomRegions as Array<ZoomRegionLike>) {
      delete region.panPoints;
      if (!Array.isArray(region.layers)) region.layers = [];
    }
  }

  if (!videoSegments?.length) return;
  // Strip all zoom/focus keyframes from segments — the region owns the camera now.
  for (const seg of videoSegments) {
    if (!seg.keyframes) continue;
    seg.keyframes = seg.keyframes.filter((kf) => !isStrippableZoomKeyframe(kf));
  }
}

/** Loosened view of a region so we can scrub the obsolete `panPoints` field. */
type ZoomRegionLike = { panPoints?: unknown; layers?: unknown[] };
```

- [ ] **Step 2: Confirm it type-checks in isolation**

Run: `npx tsc --noEmit 2>&1 | grep "migrateZoom"`
Expected: No output (no errors originating in `migrateZoom.ts`). Errors elsewhere are expected until later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/lib/migrateZoom.ts
git commit -m "Drop pan-point migration; ensure regions carry a layers array"
```

---

## Task 4: Handlers — layer CRUD in useZoomHandlers

**Files:**
- Modify: `src/hooks/useZoomHandlers.ts`

This replaces the pan-point handlers with layer handlers and exposes a `selectedLayer` for the settings panel. The hook gains a `selectedZoomLayerId` arg (new UI state added in Task 7).

- [ ] **Step 1: Replace the imports and constants block (lines 1-24)**

Replace lines 1-24 with:

```ts
import { useCallback, useMemo } from "react";
import type { Span } from "dnd-timeline";
import { v4 as uuidv4 } from "uuid";

import {
  DEFAULT_TRANSITION_CONFIG,
  ZOOM_DEPTH_SCALES,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type ZoomLayer,
  type ZoomLayerKind,
  type VideoSegment,
} from "@/components/video-editor/types";
import { resolveTransitionWindow, clampLayerToHold } from "@/lib/zoomCamera";
import type { EditorStateSetter } from "./editorHandlerTypes";

const DEFAULT_ENTER_MS = 400;
const DEFAULT_EXIT_MS = 400;
/** Default ramp for a freshly added layer. */
const DEFAULT_LAYER_RAMP_MS = 200;
/** Default delta values for a freshly added layer. */
const DEFAULT_ZOOM_DELTA = 0.5;
```

- [ ] **Step 2: Replace the `upsertPanPoint` helper (lines 39-55) with a layer factory**

Replace the `upsertPanPoint` function with:

```ts
/** Build a new layer spanning the region's hold window with sensible defaults. */
function makeLayer(region: ZoomRegion, kind: ZoomLayerKind): ZoomLayer {
  const { t2, t3 } = resolveTransitionWindow(region);
  const holdStart = t2 - region.startMs;
  const holdEnd = t3 - region.startMs;
  const base: ZoomLayer = {
    id: uuidv4(),
    kind,
    startMs: holdStart,
    endMs: holdEnd,
    enterMs: DEFAULT_LAYER_RAMP_MS,
    exitMs: DEFAULT_LAYER_RAMP_MS,
    ...(kind === 'zoom' ? { zoomDelta: DEFAULT_ZOOM_DELTA } : { focusDx: 0, focusDy: 0 }),
  };
  return clampLayerToHold(region, base);
}
```

- [ ] **Step 3: Update the hook args interface (lines 26-37)**

Replace the `UseZoomHandlersArgs` interface with:

```ts
interface UseZoomHandlersArgs {
  setEditorState: EditorStateSetter;
  setEditorStateDebounced: EditorStateSetter;
  videoSegments: VideoSegment[];
  zoomRegions: ZoomRegion[];
  sourceTimeMs: number;
  selectedZoomId: string | null;
  selectedZoomLayerId: string | null;
  nextZoomIdRef: React.MutableRefObject<number>;
  setSelectedZoomId: (id: string | null) => void;
  setSelectedZoomLayerId: (id: string | null) => void;
  setSelectedTrimId: (id: string | null) => void;
  setSelectedAnnotationId: (id: string | null) => void;
}
```

- [ ] **Step 4: Update the destructured params and `handleZoomAdded` to seed `layers`**

In the `useZoomHandlers({ ... })` destructure (currently lines 57-67), add `selectedZoomLayerId`, `setSelectedZoomLayerId` to the destructured names. Then in `handleZoomAdded`, change the `panPoints: []` field of `newRegion` to `layers: []`, and in its body set `setSelectedZoomLayerId(null)` alongside `setSelectedZoomId(id)`.

The new `handleZoomAdded` reads:

```ts
  const handleZoomAdded = useCallback((span: Span) => {
    const id = `zoom-${nextZoomIdRef.current++}`;
    const newRegion: ZoomRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      depth: 3,
      focus: { cx: 0.5, cy: 0.5 },
      enterTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: DEFAULT_ENTER_MS },
      exitTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: DEFAULT_EXIT_MS },
      layers: [],
    };
    setEditorState((prev) => ({ ...prev, zoomRegions: [...prev.zoomRegions, newRegion] }));
    setSelectedZoomId(id);
    setSelectedZoomLayerId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [nextZoomIdRef, setEditorState, setSelectedZoomId, setSelectedZoomLayerId, setSelectedTrimId, setSelectedAnnotationId]);
```

- [ ] **Step 5: Re-clamp layers (not pan points) on span/transition change**

In `handleZoomSpanChange`, replace the `panPoints` re-clamp block with:

```ts
        const updated: ZoomRegion = { ...r, startMs, endMs };
        const layers = (r.layers ?? []).map((l) => clampLayerToHold(updated, l));
        return { ...updated, layers };
```

In `handleZoomTransitionChange`, replace its `panPoints` re-clamp block with:

```ts
        const layers = (r.layers ?? []).map((l) => clampLayerToHold(updated, l));
        return { ...updated, layers };
```

In `handleZoomDepthChange`, remove the pan-point retargeting entirely — depth now only sets the base. The body becomes:

```ts
  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => (r.id === selectedZoomId ? { ...r, depth } : r)),
    }));
  }, [selectedZoomId, setEditorState]);
```

(`ZOOM_DEPTH_SCALES` is still imported for `makeLayer`/derived use; keep the import.)

- [ ] **Step 6: Delete the pan-point handlers and add layer handlers**

Delete `handleZoomFocusChange`, `handleAddZoomPanPoint`, `handleHoldPanPoint`, `handleZoomPropertyChange`, `clampZoomPanPointTime`, `handleMoveZoomPanPoint`, `handleDeleteZoomPanPoint` (lines ~167-298). Replace that whole block with:

```ts
  // --- Layer CRUD ---

  const handleAddZoomLayer = useCallback((regionId: string, kind: ZoomLayerKind) => {
    setEditorState((prev) => {
      let newId: string | null = null;
      const zoomRegions = prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layer = makeLayer(r, kind);
        newId = layer.id;
        return { ...r, layers: [...(r.layers ?? []), layer] };
      });
      if (newId) setSelectedZoomLayerId(newId);
      return { ...prev, zoomRegions };
    });
  }, [setEditorState, setSelectedZoomLayerId]);

  const handleUpdateZoomLayer = useCallback((regionId: string, layerId: string, patch: Partial<ZoomLayer>) => {
    setEditorStateDebounced((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layers = (r.layers ?? []).map((l) => (l.id === layerId ? { ...l, ...patch } : l));
        return { ...r, layers };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleResizeZoomLayer = useCallback((regionId: string, layerId: string, startMs: number, endMs: number) => {
    setEditorStateDebounced((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layers = (r.layers ?? []).map((l) =>
          l.id === layerId ? clampLayerToHold(r, { ...l, startMs, endMs }) : l,
        );
        return { ...r, layers };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleMoveZoomLayer = useCallback((regionId: string, layerId: string, newStartMs: number) => {
    setEditorStateDebounced((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layers = (r.layers ?? []).map((l) => {
          if (l.id !== layerId) return l;
          const dur = l.endMs - l.startMs;
          return clampLayerToHold(r, { ...l, startMs: newStartMs, endMs: newStartMs + dur });
        });
        return { ...r, layers };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleDeleteZoomLayer = useCallback((regionId: string, layerId: string) => {
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) =>
        r.id === regionId ? { ...r, layers: (r.layers ?? []).filter((l) => l.id !== layerId) } : r,
      ),
    }));
    if (selectedZoomLayerId === layerId) setSelectedZoomLayerId(null);
  }, [setEditorState, selectedZoomLayerId, setSelectedZoomLayerId]);
```

- [ ] **Step 7: Rework derived state and the return object (lines 300-335)**

Replace the derived-state + return block with:

```ts
  // --- Derived state for SettingsPanel ---

  const selectedRegion = useMemo(
    () => (selectedZoomId ? zoomRegions.find((r) => r.id === selectedZoomId) ?? null : null),
    [selectedZoomId, zoomRegions],
  );

  const playheadInsideSelectedZoom = useMemo(() => {
    if (!selectedRegion) return false;
    return sourceTimeMs >= selectedRegion.startMs && sourceTimeMs <= selectedRegion.endMs;
  }, [selectedRegion, sourceTimeMs]);

  const selectedLayer = useMemo(() => {
    if (!selectedRegion || !selectedZoomLayerId) return null;
    return (selectedRegion.layers ?? []).find((l) => l.id === selectedZoomLayerId) ?? null;
  }, [selectedRegion, selectedZoomLayerId]);

  return {
    handleZoomAdded,
    handleZoomSpanChange,
    handleZoomDepthChange,
    handleZoomTransitionChange,
    handleZoomDelete,
    handleAutoZoomApply,
    handleAddZoomLayer,
    handleUpdateZoomLayer,
    handleResizeZoomLayer,
    handleMoveZoomLayer,
    handleDeleteZoomLayer,
    playheadInsideSelectedZoom,
    selectedLayer,
  };
}
```

- [ ] **Step 8: Type-check the hook**

Run: `npx tsc --noEmit 2>&1 | grep "useZoomHandlers"`
Expected: No errors from `useZoomHandlers.ts` itself. (VideoEditor still references removed handlers — fixed in Task 8.)

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useZoomHandlers.ts
git commit -m "Replace pan-point handlers with zoom-layer CRUD handlers"
```

---

## Task 5: KeyframeTrack — remove zoom pan-point diamonds

**Files:**
- Modify: `src/components/video-editor/timeline/KeyframeTrack.tsx`

Layers are spans rendered by a dedicated lane (Task 6), not diamonds. Strip all zoom pan-point handling from `KeyframeTrack` so it only handles manual + spotlight markers.

- [ ] **Step 1: Remove zoom props from the interface**

In `KeyframeTrackProps` (lines 19-30), delete `zoomRegions`, `onMoveZoomPanPoint`, `onDeleteZoomPanPoint`, `clampZoomPanPointTime` and the `'zoom'` member of `KeyframeFilter` (line 7 becomes `type KeyframeFilter = 'manual' | 'spotlight' | 'all';`).

- [ ] **Step 2: Remove zoom logic from the component body**

Delete: the `zoomRegions`, `onMoveZoomPanPoint`, `onDeleteZoomPanPoint`, `clampZoomPanPointTime` destructured params; the `isZoomMode` const; the `draggingPan` state; the `zoomEntries` block (lines ~86-97); the entire "Zoom pan-point drag-to-move" `useEffect` (lines ~144-185); and the `isZoomMode && zoomEntries.map(...)` render block (lines ~220-252). Update `uniqueTimes`, `diamondColor`, and `isEmpty` to drop their `isZoomMode` branches:

```ts
  const isSpotlightMode = filter === 'spotlight';

  // (no zoom mode — layers render in ZoomLayerLane)

  const keyframes = segment.keyframes ?? [];
  const uniqueTimes = isSpotlightMode
    ? []
    : filter === 'manual'
      ? getUniqueManualKeyframeTimes(keyframes)
      : getUniqueKeyframeTimes(keyframes);

  const diamondColor = isSpotlightMode ? '#8B5CF6' : '#ffe100';
```

```ts
  const isEmpty = isSpotlightMode ? spotlightEntries.length === 0 : uniqueTimes.length === 0;
  if (isEmpty) return null;
```

Also update the render guards `{!isSpotlightMode && !isZoomMode && uniqueTimes.map(...)}` → `{!isSpotlightMode && uniqueTimes.map(...)}`.

- [ ] **Step 3: Type-check this file**

Run: `npx tsc --noEmit 2>&1 | grep "KeyframeTrack"`
Expected: No errors originating in `KeyframeTrack.tsx`. (TimelineEditor still passes the now-removed props — fixed in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add src/components/video-editor/timeline/KeyframeTrack.tsx
git commit -m "Remove zoom pan-point diamonds from KeyframeTrack"
```

---

## Task 6: ZoomLayerLane — new component for layer bars

**Files:**
- Create: `src/components/video-editor/timeline/ZoomLayerLane.tsx`

Renders one horizontal sub-lane per layer beneath the selected region, positioned in display time. Drag the bar body to move, drag the left/right edges to resize. Right-click deletes.

- [ ] **Step 1: Create the component**

Create `src/components/video-editor/timeline/ZoomLayerLane.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import { useTimelineContext } from "dnd-timeline";
import type { ZoomRegion, ZoomLayer, VideoSegment } from "../types";
import { sourceToDisplayTime, displayToSourceTime } from "@/lib/segmentUtils";

interface ZoomLayerLaneProps {
  region: ZoomRegion;
  videoSegments: VideoSegment[];
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  onMoveLayer: (regionId: string, layerId: string, newStartMs: number) => void;
  onResizeLayer: (regionId: string, layerId: string, startMs: number, endMs: number) => void;
  onDeleteLayer: (regionId: string, layerId: string) => void;
  timelineRef: React.RefObject<HTMLDivElement | null>;
}

type DragMode = 'move' | 'resize-l' | 'resize-r';
const EDGE_PX = 6;
const MIN_LAYER_MS = 50;

const KIND_COLOR: Record<ZoomLayer['kind'], string> = {
  zoom: '#22c55e',
  position: '#a855f7',
};

/** A region-relative time → absolute display X offset (px from range start). */
function relToOffset(
  region: ZoomRegion,
  relMs: number,
  videoSegments: VideoSegment[],
  rangeStart: number,
  valueToPixels: (v: number) => number,
): number {
  const sourceMs = region.startMs + relMs;
  const displayMs = videoSegments.length > 0 ? sourceToDisplayTime(videoSegments, sourceMs) : sourceMs;
  return valueToPixels(displayMs - rangeStart);
}

export default function ZoomLayerLane({
  region,
  videoSegments,
  selectedLayerId,
  onSelectLayer,
  onMoveLayer,
  onResizeLayer,
  onDeleteLayer,
  timelineRef,
}: ZoomLayerLaneProps) {
  const { sidebarWidth, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const [drag, setDrag] = useState<{ layerId: string; mode: DragMode; start: ZoomLayer } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const d = dragRef.current;
      if (!d) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;
      const displayMs = range.start + pixelsToValue(clickX);
      const sourceMs = videoSegments.length > 0 ? displayToSourceTime(videoSegments, displayMs) : displayMs;
      const relMs = Math.round(sourceMs - region.startMs);
      if (d.mode === 'move') {
        onMoveLayer(region.id, d.layerId, relMs);
      } else if (d.mode === 'resize-l') {
        onResizeLayer(region.id, d.layerId, Math.min(relMs, d.start.endMs - MIN_LAYER_MS), d.start.endMs);
      } else {
        onResizeLayer(region.id, d.layerId, d.start.startMs, Math.max(relMs, d.start.startMs + MIN_LAYER_MS));
      }
    };
    const onUp = () => {
      setDrag(null);
      document.body.style.cursor = '';
      delete document.body.dataset.kfDragging;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, region.id, region.startMs, videoSegments, sidebarWidth, range.start, pixelsToValue, onMoveLayer, onResizeLayer, timelineRef]);

  const layers = region.layers ?? [];
  if (layers.length === 0) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
      {layers.map((layer, i) => {
        const left = relToOffset(region, layer.startMs, videoSegments, range.start, valueToPixels);
        const right = relToOffset(region, layer.endMs, videoSegments, range.start, valueToPixels);
        const width = Math.max(2, right - left);
        const color = KIND_COLOR[layer.kind];
        const isSelected = layer.id === selectedLayerId;
        const label = layer.kind === 'zoom'
          ? `${(layer.zoomDelta ?? 0) >= 0 ? '+' : ''}${(layer.zoomDelta ?? 0).toFixed(2)}×`
          : 'posun';
        return (
          <div
            key={layer.id}
            className="absolute"
            style={{
              left: `${left}px`,
              width: `${width}px`,
              top: `${4 + i * 22}px`,
              height: '18px',
              background: `${color}33`,
              border: `1px solid ${color}`,
              borderRadius: '5px',
              boxShadow: isSelected ? `0 0 0 1.5px white, 0 0 6px ${color}99` : 'none',
              pointerEvents: 'auto',
              cursor: 'grab',
              fontSize: '10px',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              const localX = e.nativeEvent.offsetX;
              const mode: DragMode = localX < EDGE_PX ? 'resize-l' : localX > width - EDGE_PX ? 'resize-r' : 'move';
              onSelectLayer(layer.id);
              setDrag({ layerId: layer.id, mode, start: layer });
              document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
              document.body.dataset.kfDragging = '1';
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteLayer(region.id, layer.id); }}
            title={`${layer.kind} layer (drag to move, edges to resize, right-click to delete)`}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check this file**

Run: `npx tsc --noEmit 2>&1 | grep "ZoomLayerLane"`
Expected: No output (compiles cleanly; it is not imported yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/video-editor/timeline/ZoomLayerLane.tsx
git commit -m "Add ZoomLayerLane component for draggable layer bars"
```

---

## Task 7: SettingsPanel — layer controls

**Files:**
- Modify: `src/components/video-editor/SettingsPanel.tsx`

Replace the pan-point/property block (lines ~436-513) with: two add buttons (zoom / position layer) and, when a layer is selected, sliders for its delta and ramps.

- [ ] **Step 1: Update the zoom-related props in the panel's props interface**

In the props interface (around lines 58-122), remove `activeZoomTransform`, `onAddZoomPanPoint`, `onHoldPanPoint`, and `onZoomPropertyChange`. Add:

```ts
  selectedZoomLayer?: import('./types').ZoomLayer | null;
  onAddZoomLayer?: (regionId: string, kind: import('./types').ZoomLayerKind) => void;
  onUpdateZoomLayer?: (regionId: string, layerId: string, patch: Partial<import('./types').ZoomLayer>) => void;
  onDeleteZoomLayer?: (regionId: string, layerId: string) => void;
```

Update the destructured params (around line 201) to match: remove `activeZoomTransform`, `onAddZoomPanPoint`, `onHoldPanPoint`, `onZoomPropertyChange`; add `selectedZoomLayer`, `onAddZoomLayer`, `onUpdateZoomLayer`, `onDeleteZoomLayer`.

- [ ] **Step 2: Replace the pan-point/property JSX block (lines ~436-513)**

Replace that block with:

```tsx
              {/* Zoom Layers */}
              {selectedZoomId && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Button
                      onClick={() => onAddZoomLayer?.(selectedZoomId, 'zoom')}
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all h-8 text-xs"
                    >
                      + Zoom vrstva
                    </Button>
                    <Button
                      onClick={() => onAddZoomLayer?.(selectedZoomId, 'position')}
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20 hover:border-purple-500/50 transition-all h-8 text-xs"
                    >
                      + Posun vrstva
                    </Button>
                  </div>

                  {selectedZoomLayer && selectedZoomLayer.kind === 'zoom' && (
                    <div className="p-2 rounded-lg bg-secondary border border-border/30">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] font-medium text-foreground/80">Zoom delta</div>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {(selectedZoomLayer.zoomDelta ?? 0) >= 0 ? '+' : ''}{(selectedZoomLayer.zoomDelta ?? 0).toFixed(2)}×
                        </span>
                      </div>
                      <Slider
                        value={[selectedZoomLayer.zoomDelta ?? 0]}
                        onValueChange={(v) => onUpdateZoomLayer?.(selectedZoomId, selectedZoomLayer.id, { zoomDelta: v[0] })}
                        min={-3} max={3} step={0.05}
                        className="w-full [&_[role=slider]]:bg-emerald-400 [&_[role=slider]]:border-emerald-400 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                      />
                    </div>
                  )}

                  {selectedZoomLayer && selectedZoomLayer.kind === 'position' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg bg-secondary border border-border/30">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] font-medium text-foreground/80">Posun X</div>
                          <span className="text-[10px] text-muted-foreground font-mono">{Math.round((selectedZoomLayer.focusDx ?? 0) * 100)}%</span>
                        </div>
                        <Slider
                          value={[selectedZoomLayer.focusDx ?? 0]}
                          onValueChange={(v) => onUpdateZoomLayer?.(selectedZoomId, selectedZoomLayer.id, { focusDx: v[0] })}
                          min={-1} max={1} step={0.01}
                          className="w-full [&_[role=slider]]:bg-purple-400 [&_[role=slider]]:border-purple-400 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                      <div className="p-2 rounded-lg bg-secondary border border-border/30">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] font-medium text-foreground/80">Posun Y</div>
                          <span className="text-[10px] text-muted-foreground font-mono">{Math.round((selectedZoomLayer.focusDy ?? 0) * 100)}%</span>
                        </div>
                        <Slider
                          value={[selectedZoomLayer.focusDy ?? 0]}
                          onValueChange={(v) => onUpdateZoomLayer?.(selectedZoomId, selectedZoomLayer.id, { focusDy: v[0] })}
                          min={-1} max={1} step={0.01}
                          className="w-full [&_[role=slider]]:bg-purple-400 [&_[role=slider]]:border-purple-400 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                    </div>
                  )}

                  {selectedZoomLayer && (
                    <Button
                      onClick={() => onDeleteZoomLayer?.(selectedZoomId, selectedZoomLayer.id)}
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/15 h-7 text-xs"
                    >
                      <Trash2 className="w-3 h-3" /> Smazat vrstvu
                    </Button>
                  )}
                </div>
              )}
```

(`Diamond` and `Pause` icon imports become unused — remove them from the lucide-react import if present to keep `npm run lint` clean.)

- [ ] **Step 3: Type-check this file**

Run: `npx tsc --noEmit 2>&1 | grep "SettingsPanel"`
Expected: No errors from `SettingsPanel.tsx` itself. (VideoEditor still passes removed props — fixed in Task 8.)

- [ ] **Step 4: Commit**

```bash
git add src/components/video-editor/SettingsPanel.tsx
git commit -m "Replace zoom pan-point controls with layer controls in SettingsPanel"
```

---

## Task 8: Wire it together — TimelineEditor + VideoEditor

**Files:**
- Modify: `src/components/video-editor/timeline/TimelineEditor.tsx`
- Modify: `src/components/video-editor/VideoEditor.tsx`

- [ ] **Step 1: TimelineEditor — swap pan-point props for layer props**

In the `TimelineEditor` props interface (around lines 56-105), remove `onMoveZoomPanPoint`, `onDeleteZoomPanPoint`, `clampZoomPanPointTime`. Add:

```ts
  selectedZoomLayerId: string | null;
  onSelectZoomLayer: (layerId: string | null) => void;
  onMoveZoomLayer: (regionId: string, layerId: string, newStartMs: number) => void;
  onResizeZoomLayer: (regionId: string, layerId: string, startMs: number, endMs: number) => void;
  onDeleteZoomLayer: (regionId: string, layerId: string) => void;
```

Thread these through the inner component's destructure (around lines 728-774) the same way `onZoomDelete` is, removing the three pan-point names.

- [ ] **Step 2: TimelineEditor — replace the zoom `KeyframeTrack` with `ZoomLayerLane`**

Add the import near the `KeyframeTrack` import (line 11):

```ts
import ZoomLayerLane from "./ZoomLayerLane";
```

Replace the `filter="zoom"` `KeyframeTrack` block (lines ~1414-1426) with a lane for the selected region:

```tsx
            {(() => {
              const selected = zoomRegions.find((r) => r.id === selectedZoomId);
              if (!selected) return null;
              return (
                <ZoomLayerLane
                  region={selected}
                  videoSegments={videoSegments}
                  selectedLayerId={selectedZoomLayerId}
                  onSelectLayer={onSelectZoomLayer}
                  onMoveLayer={onMoveZoomLayer}
                  onResizeLayer={onResizeZoomLayer}
                  onDeleteLayer={onDeleteZoomLayer}
                  timelineRef={timelineRef}
                />
              );
            })()}
```

(Use the same `timelineRef` the sibling `KeyframeTrack` uses; if the zoom `KeyframeTrack` referenced a specific ref prop, reuse it.)

- [ ] **Step 3: VideoEditor — add `selectedZoomLayerId` state**

Find where `selectedZoomId` state is declared in `VideoEditor.tsx` and add alongside it:

```ts
  const [selectedZoomLayerId, setSelectedZoomLayerId] = useState<string | null>(null);
```

- [ ] **Step 4: VideoEditor — update the `useZoomHandlers` call and destructure (lines 386-401, 401+)**

Update the destructured names to match the hook's new return (Task 4 Step 7): remove `handleZoomFocusChange`, `handleAddZoomPanPoint`, `handleHoldPanPoint`, `handleZoomPropertyChange`, `handleMoveZoomPanPoint`, `handleDeleteZoomPanPoint`, `clampZoomPanPointTime`, `activeZoomTransform`; add `handleAddZoomLayer`, `handleUpdateZoomLayer`, `handleResizeZoomLayer`, `handleMoveZoomLayer`, `handleDeleteZoomLayer`, `selectedLayer`. In the `useZoomHandlers({ ... })` args, add `selectedZoomLayerId`, `setSelectedZoomLayerId`.

- [ ] **Step 5: VideoEditor — update the prop wiring**

- Remove the `onZoomFocusChange={handleZoomFocusChange}` prop (line ~1117) from whatever child consumed it (the preview focus handler). If a focus-drag in the preview is still desired, point it at a position-layer update instead; otherwise drop it for now (focus is now authored via layers).
- In the `<TimelineEditor ... />` props (lines ~1182-1227): remove `onMoveZoomPanPoint`, `onDeleteZoomPanPoint`, `clampZoomPanPointTime`; add:

```tsx
              selectedZoomLayerId={selectedZoomLayerId}
              onSelectZoomLayer={setSelectedZoomLayerId}
              onMoveZoomLayer={handleMoveZoomLayer}
              onResizeZoomLayer={handleResizeZoomLayer}
              onDeleteZoomLayer={handleDeleteZoomLayer}
```

- In the `<SettingsPanel ... />` props (lines ~1310-1314): remove `activeZoomTransform`, `onAddZoomPanPoint`, `onHoldPanPoint`, `onZoomPropertyChange`; add:

```tsx
          selectedZoomLayer={selectedLayer}
          onAddZoomLayer={handleAddZoomLayer}
          onUpdateZoomLayer={handleUpdateZoomLayer}
          onDeleteZoomLayer={handleDeleteZoomLayer}
```

- Clear the layer selection when the region selection changes: wherever `setSelectedZoomId(null)` is called on deselect, also call `setSelectedZoomLayerId(null)`.

- [ ] **Step 6: Full type-check**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: No errors. If any remain, they will name a leftover reference to a removed pan-point symbol — fix the reference and re-run.

- [ ] **Step 7: Lint**

Run: `npm run lint 2>&1 | tail -20`
Expected: No errors (fix any unused-import warnings flagged for `Diamond`, `Pause`, `resolveZoomCameraAtTime`, etc.).

- [ ] **Step 8: Commit**

```bash
git add src/components/video-editor/timeline/TimelineEditor.tsx src/components/video-editor/VideoEditor.tsx
git commit -m "Wire zoom layers through TimelineEditor and VideoEditor"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test 2>&1 | tail -25`
Expected: PASS — all suites green, especially `zoomCamera.test.ts`.

- [ ] **Step 2: Type-check + lint clean**

Run: `npx tsc --noEmit && npm run lint`
Expected: Both exit 0.

- [ ] **Step 3: Manual smoke test (use the `run` skill or `npm run dev`)**

Verify in the editor:
1. Add a zoom region → it zooms to its depth, holds, returns to identity.
2. Select it → "+ Zoom vrstva" adds a green bar in the sub-lane; the preview pushes further in over that bar's span.
3. Drag the bar / its edges → the push window moves/resizes; the zoom delta slider changes the amount; negative delta pulls out.
4. "+ Posun vrstva" adds a purple bar; its X/Y sliders shift the framing during its span only.
5. Move/trim the base region → layers stay inside the hold window.
6. Export a clip with a layered region → the rendered video matches the preview (renderer uses the same `resolveZoomCameraAtTime`).

- [ ] **Step 4: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "Polish layered-zoom interactions after manual verification"
```

---

## Self-Review Notes

- **Spec coverage:** relative-delta composition (Task 2 `resolveZoomCameraAtTime` sums deltas); separate layer kinds (Task 1 `ZoomLayerKind`); pan points fully removed (Tasks 1,3,4,5); base owns layers, clamped to hold, follows move/trim (Task 2 `clampLayerToHold`, Task 4 span/transition re-clamp); per-layer ramp, no inner keyframes (Task 2 `layerWeight`); additive zoom delta (Task 2). Timeline/interaction (Tasks 6,8); settings controls (Task 7). Tests (Task 2). All spec sections map to a task.
- **Type consistency:** handler names are identical across hook return (Task 4), TimelineEditor props (Task 8), SettingsPanel props (Task 7), and VideoEditor wiring (Task 8): `handleAddZoomLayer`, `handleUpdateZoomLayer`, `handleResizeZoomLayer`, `handleMoveZoomLayer`, `handleDeleteZoomLayer`, plus `selectedLayer`/`selectedZoomLayer`. `ZoomLayer`/`ZoomLayerKind` used consistently.
- **Known iteration risk:** Task 6/8 timeline sub-lane geometry (`top` offset stacking, edge hit-zones, which `timelineRef` to reuse) is the part most likely to need a visual tweak during execution — the math is correct but the exact pixel placement should be eyeballed in Step 3 of Task 9.
