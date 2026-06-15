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

  it('is 1 everywhere inside when enterMs and exitMs are 0', () => {
    const l = zoomLayer({ enterMs: 0, exitMs: 0 });
    expect(layerWeight(l, 700)).toBe(1);
    expect(layerWeight(l, 1499)).toBe(1);
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

  it('applies a partial position offset during the layer enter ramp', () => {
    // layer spans rel [500..1500], enter 200ms; at rel 600 the weight is ~0.5
    const r = makeRegion({
      layers: [zoomLayer({ kind: 'position', zoomDelta: undefined, focusDx: -0.4, focusDy: 0, enterMs: 200, exitMs: 200 })],
    });
    const cam = resolveZoomCameraAtTime(r, 1600); // source 1600 -> rel 600
    // full offset would put focusX at 0.1; at ~half weight it should sit between 0.1 and 0.5
    expect(cam.focusX).toBeGreaterThan(0.1);
    expect(cam.focusX).toBeLessThan(0.5);
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
