# Layered Zooms — Design

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Problem

Camera movement inside a zoom region is currently authored with **pan points** —
keyframes carrying `timeMs`, `focusX`, `focusY`, `zoom`, interpolated across the
region's hold phase (`ZoomPanPoint` in `types.ts`, machinery in `zoomCamera.ts`
and `useZoomHandlers.ts`). Keyframing is fiddly and is the thing we want to get
rid of.

## Idea

Replace keyframes with **layered zooms**. A base zoom region (e.g. 2.5×) holds
across a chunk. On top of it you stack independent **layers** that each contribute
a relative delta over their own span: a zoom layer to push in further (or a
negative one to pull out), and a position layer to shift the focus. The effective
camera at any time is the base plus the sum of all active layer deltas.

## Decisions

1. **Relative delta composition.** A layer is a contribution added on top of what
   is below it, not an absolute target. `+0.8×` over a 2.5× base = 3.3×. Negative
   delta = zoom out. After the layer ends the camera returns to the base. Changing
   the base zoom keeps the layer's relative effect.
2. **Separate layer kinds.** Each layer does one thing: `zoom` (±delta) or
   `position` (focus offset). To push in *and* move at once, stack two layers over
   the same span.
3. **Fully replace pan points.** Layers are the only way to steer the camera.
   `ZoomPanPoint` and all its machinery are removed. Existing pan-point data is
   discarded on migration (no real production data to preserve).
4. **Base owns its layers.** A base `ZoomRegion` owns its layers; layer times are
   relative to the region and clamped into its hold window. Moving / trimming /
   deleting the base takes its layers with it. Under the hood it is still a flat
   sum of deltas.
5. **Per-layer enter/exit ramp, no inner keyframes.** Each layer ramps its delta
   from 0 to its value and back. One layer = one constant value + ramp. More
   motion = more layers.
6. **Additive zoom delta** in zoom-scale units (`+0.8×`), can be negative.
   (Multiplicative `×1.3` was considered and rejected — harder to sum.)

## Data Model

```ts
type ZoomLayerKind = 'zoom' | 'position';

interface ZoomLayer {
  id: string;
  kind: ZoomLayerKind;
  startMs: number;   // relative to parent region start, clamped into hold window
  endMs: number;     // relative to parent region start
  enterMs: number;   // ramp delta 0 -> value
  exitMs: number;    // ramp delta value -> 0
  zoomDelta?: number;   // kind 'zoom': additive, may be negative
  focusDx?: number;     // kind 'position': focus offset (-1..1)
  focusDy?: number;
}

interface ZoomRegion {
  id: string;
  startMs: number;
  endMs: number;
  depth: ZoomDepth;                    // base zoom (unchanged)
  focus: ZoomFocus;                    // base focus (unchanged)
  enterTransition?: TransitionConfig;  // base zoom-in ramp (unchanged)
  exitTransition?: TransitionConfig;   // base zoom-out ramp (unchanged)
  layers: ZoomLayer[];                 // replaces panPoints
}
```

## Camera Resolution

`resolveZoomCameraAtTime(region, t)` keeps its signature; internals become:

1. Outside `[startMs, endMs]` → `IDENTITY_CAMERA`.
2. `base` = identity→`ZOOM_DEPTH_SCALES[depth]` over enter, hold, →identity over
   exit (today's behaviour minus pan points).
3. For each layer compute weight `w ∈ [0,1]` (0→1 over `enterMs` at layer start,
   hold at 1, 1→0 over `exitMs` before layer end; ramps clamped to fit the span):
   - `zoom`: `cam.zoom += zoomDelta * w`
   - `position`: `cam.focusX += focusDx * w; cam.focusY += focusDy * w`
4. Clamp zoom to a sane floor (≥1) and focus to `[0,1]`.

No interpolation between keyframes — a pure sum of ramped deltas.

## Timeline & Interaction

- A selected base region can be **expanded** into sub-lanes shown beneath it.
- `+ zoom vrstva` / `+ posun vrstva` buttons add a layer bar to a sub-lane.
- Drag the bar to move its span; drag its edges to set the span; the enter/exit
  ramps are edited per layer (handles or settings panel).
- Layer value (±zoom, dx/dy) is set in the settings panel or by dragging in the
  preview.
- Moving / trimming / deleting the base region carries its layers and re-clamps
  them into the new hold window.

## Removal & Compatibility

- **Removed:** `ZoomPanPoint`, `getZoomAnchors`, `resolveHoldCameraAtRelTime`,
  `clampPanPointTime`, `upsertPanPoint`, and the pan-point handlers in
  `useZoomHandlers` (`handleAddZoomPanPoint`, `handleHoldPanPoint`,
  `handleMoveZoomPanPoint`, `handleDeleteZoomPanPoint`, pan-point branch of
  `handleZoomFocusChange` / `handleZoomPropertyChange`).
- **Stable API:** `resolveZoomCameraAtTime(region, t)` and
  `findActiveZoomRegion(regions, t)` keep their signatures, so
  `frameRenderer.ts` and other consumers are unaffected.
- **New handlers:** add/update/move/delete a layer; toggle layer expansion.

## Testing

Rewrite `zoomCamera.test.ts` around delta composition:

- single zoom layer pushes base to base+delta at hold
- two overlapping zoom layers sum
- negative zoom layer pulls below base (clamped ≥1)
- position layer offsets focus, clamped to [0,1]
- layer ramp weight at enter/exit boundaries
- layers clamped into the region hold window
- camera is identity outside the region; base-only region matches old behaviour
