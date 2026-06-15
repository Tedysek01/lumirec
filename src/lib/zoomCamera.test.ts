import { describe, it, expect } from 'vitest';
import {
  resolveZoomCameraAtTime,
  resolveHoldCameraAtRelTime,
  resolveTransitionWindow,
  getZoomAnchors,
  clampPanPointTime,
  IDENTITY_CAMERA,
} from './zoomCamera';
import type { ZoomRegion } from '@/components/video-editor/types';
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
    ...overrides,
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
    // 400+400=800 > 600 → scale 0.75 → enter 300, exit 300
    expect(w.t2).toBeCloseTo(300, 0);
    expect(w.t3).toBeCloseTo(300, 0);
  });
});

describe('resolveZoomCameraAtTime', () => {
  it('is identity outside the region', () => {
    const r = makeRegion();
    expect(resolveZoomCameraAtTime(r, 500)).toEqual(IDENTITY_CAMERA);
    expect(resolveZoomCameraAtTime(r, 3500)).toEqual(IDENTITY_CAMERA);
  });

  it('reaches the depth target at the hold (no pan points)', () => {
    const r = makeRegion();
    const cam = resolveZoomCameraAtTime(r, 2000); // middle of hold
    expect(cam.zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3], 5);
    expect(cam.focusX).toBeCloseTo(0.5, 5);
  });

  it('starts ramping from identity at region start', () => {
    const r = makeRegion();
    const cam = resolveZoomCameraAtTime(r, 1001); // just after start
    expect(cam.zoom).toBeGreaterThan(1);
    expect(cam.zoom).toBeLessThan(ZOOM_DEPTH_SCALES[3]);
  });

  it('returns to identity by region end', () => {
    const r = makeRegion();
    const cam = resolveZoomCameraAtTime(r, 2999);
    expect(cam.zoom).toBeGreaterThan(1);
    expect(cam.zoom).toBeLessThan(ZOOM_DEPTH_SCALES[3]);
  });

  it('honors a single pan point focus during the hold', () => {
    const r = makeRegion({
      panPoints: [{ id: 'p1', timeMs: 1000, focusX: 0.8, focusY: 0.2, zoom: 2 }],
    });
    const cam = resolveZoomCameraAtTime(r, 2000);
    expect(cam.focusX).toBeCloseTo(0.8, 5);
    expect(cam.focusY).toBeCloseTo(0.2, 5);
    expect(cam.zoom).toBeCloseTo(2, 5);
  });

  it('interpolates between two pan points', () => {
    const r = makeRegion({
      panPoints: [
        { id: 'p1', timeMs: 600, focusX: 0.2, focusY: 0.5, zoom: 2 },
        { id: 'p2', timeMs: 1400, focusX: 0.8, focusY: 0.5, zoom: 2 },
      ],
    });
    // anchors clamped into hold window [400..1600]; midpoint between 600 and 1400 is rel 1000 → source 2000
    const cam = resolveZoomCameraAtTime(r, 2000);
    expect(cam.focusX).toBeGreaterThan(0.2);
    expect(cam.focusX).toBeLessThan(0.8);
  });

  it('moving a pan point in time does NOT change the zoom-in ramp duration', () => {
    const early = makeRegion({ panPoints: [{ id: 'p1', timeMs: 500, focusX: 0.7, focusY: 0.3, zoom: 2 }] });
    const late = makeRegion({ panPoints: [{ id: 'p1', timeMs: 1500, focusX: 0.7, focusY: 0.3, zoom: 2 }] });
    // At t2 (source 1400) the zoom-in has completed to the anchor zoom in BOTH cases.
    expect(resolveZoomCameraAtTime(early, 1400).zoom).toBeCloseTo(resolveZoomCameraAtTime(late, 1400).zoom, 5);
  });
});

describe('resolveHoldCameraAtRelTime', () => {
  it('returns the full hold zoom even at the hold start (never a ramp value)', () => {
    const r = makeRegion();
    // Hold window starts at rel 400 (+MIN_PAN_OFFSET); a pan point created while
    // the playhead sits in the enter ramp gets clamped to the hold start. Its
    // camera must carry the FULL depth zoom, not the half-ramped one.
    const relTime = clampPanPointTime(r, 0);
    const cam = resolveHoldCameraAtRelTime(r, relTime);
    expect(cam.zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3], 5);
    expect(cam.focusX).toBeCloseTo(0.5, 5);
  });

  it('returns full zoom at the region start boundary too', () => {
    const r = makeRegion();
    // resolveZoomCameraAtTime at startMs is identity (zoom 1); the hold camera
    // for a pan point must not be.
    expect(resolveZoomCameraAtTime(r, r.startMs).zoom).toBe(1);
    const cam = resolveHoldCameraAtRelTime(r, clampPanPointTime(r, 0));
    expect(cam.zoom).toBeGreaterThan(1.5);
  });

  it('interpolates between pan points by relative time', () => {
    const r = makeRegion({
      panPoints: [
        { id: 'p1', timeMs: 600, focusX: 0.2, focusY: 0.5, zoom: 2 },
        { id: 'p2', timeMs: 1400, focusX: 0.8, focusY: 0.5, zoom: 3 },
      ],
    });
    const cam = resolveHoldCameraAtRelTime(r, 1000); // midpoint
    expect(cam.focusX).toBeGreaterThan(0.2);
    expect(cam.focusX).toBeLessThan(0.8);
    expect(cam.zoom).toBeGreaterThan(2);
    expect(cam.zoom).toBeLessThan(3);
  });

  it('clamps to the first/last anchor outside the anchor span', () => {
    const r = makeRegion({
      panPoints: [{ id: 'p1', timeMs: 1000, focusX: 0.7, focusY: 0.3, zoom: 2.5 }],
    });
    expect(resolveHoldCameraAtRelTime(r, 0).zoom).toBeCloseTo(2.5, 5);
    expect(resolveHoldCameraAtRelTime(r, 99999).zoom).toBeCloseTo(2.5, 5);
  });
});

describe('getZoomAnchors', () => {
  it('synthesizes a single anchor from depth/focus when no pan points', () => {
    const anchors = getZoomAnchors(makeRegion());
    expect(anchors).toHaveLength(1);
    expect(anchors[0].cam.zoom).toBeCloseTo(ZOOM_DEPTH_SCALES[3], 5);
  });
});

describe('clampPanPointTime', () => {
  it('keeps pan points inside the hold window', () => {
    const r = makeRegion();
    // hold window rel ≈ [430..1570]
    expect(clampPanPointTime(r, 0)).toBeGreaterThanOrEqual(430);
    expect(clampPanPointTime(r, 5000)).toBeLessThanOrEqual(1570);
  });
});
