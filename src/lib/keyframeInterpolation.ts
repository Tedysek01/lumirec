import type { PropertyKeyframe, TransformProperty, EasingType, SegmentTransform, SpotlightKeyframe, SpotlightAnimProperty } from '@/components/video-editor/types';
import { v4 as uuidv4 } from 'uuid';

// Cubic easing functions — Apple-style smooth curves.
// Upgraded from quadratic to cubic for buttery Keynote-like transitions.

function linear(t: number): number {
  return t;
}

// Gentle acceleration (cubic)
function easeIn(t: number): number {
  return t * t * t;
}

// Gentle deceleration (cubic)
function easeOut(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

// Smooth start and end — Apple system default curve
function easeInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const EASING_FUNCTIONS: Record<EasingType, (t: number) => number> = {
  'linear': linear,
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
};

/**
 * Generic interpolation over a sorted array of {timeMs, value, easing} entries.
 * Before first keyframe: use first value. After last: use last value. Between: interpolate with easing.
 * Returns `fallback` if the array is empty.
 */
export function interpolateValues(
  sorted: { timeMs: number; value: number; easing: EasingType }[],
  timeMs: number,
  fallback: number,
): number {
  if (sorted.length === 0) return fallback;

  if (timeMs <= sorted[0].timeMs) return sorted[0].value;
  if (timeMs >= sorted[sorted.length - 1].timeMs) return sorted[sorted.length - 1].value;

  // Binary search for bracket
  let low = 0;
  let high = sorted.length - 1;
  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid].timeMs <= timeMs) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const kfA = sorted[low];
  const kfB = sorted[high];
  const duration = kfB.timeMs - kfA.timeMs;
  if (duration <= 0) return kfA.value;

  const t = (timeMs - kfA.timeMs) / duration;
  const easingFn = EASING_FUNCTIONS[kfB.easing] || linear;
  const easedT = easingFn(t);

  return kfA.value + (kfB.value - kfA.value) * easedT;
}

/**
 * Interpolate the value of a property at a given time using keyframes.
 * If no keyframes exist for the property, returns the static transform value.
 */
export function interpolateKeyframes(
  keyframes: PropertyKeyframe[],
  timeMs: number,
  property: TransformProperty,
  staticTransform: SegmentTransform,
): number {
  const propKeyframes = keyframes
    .filter((kf) => kf.property === property)
    .sort((a, b) => a.timeMs - b.timeMs);

  return interpolateValues(propKeyframes, timeMs, staticTransform[property]);
}

/**
 * Resolve the full transform at a given time (relative to segment start).
 * Applies keyframe interpolation for each property.
 */
export function resolveTransformAtTime(
  keyframes: PropertyKeyframe[],
  timeMs: number,
  staticTransform: SegmentTransform,
): SegmentTransform {
  return {
    rotation: interpolateKeyframes(keyframes, timeMs, 'rotation', staticTransform),
    scaleX: interpolateKeyframes(keyframes, timeMs, 'scaleX', staticTransform),
    scaleY: interpolateKeyframes(keyframes, timeMs, 'scaleY', staticTransform),
    positionX: interpolateKeyframes(keyframes, timeMs, 'positionX', staticTransform),
    positionY: interpolateKeyframes(keyframes, timeMs, 'positionY', staticTransform),
    zoom: interpolateKeyframes(keyframes, timeMs, 'zoom', staticTransform),
    focusX: interpolateKeyframes(keyframes, timeMs, 'focusX', staticTransform),
    focusY: interpolateKeyframes(keyframes, timeMs, 'focusY', staticTransform),
  };
}

const DEFAULT_SNAP_THRESHOLD_MS = 5;
const ALL_TRANSFORM_PROPERTIES: TransformProperty[] = [
  'rotation', 'scaleX', 'scaleY', 'positionX', 'positionY', 'zoom', 'focusX', 'focusY',
];

/**
 * Get unique keyframe times for a segment (all properties merged, sorted ascending).
 */
export function getUniqueKeyframeTimes(keyframes: PropertyKeyframe[]): number[] {
  const times = new Set<number>();
  for (const kf of keyframes) times.add(kf.timeMs);
  return [...times].sort((a, b) => a - b);
}

/**
 * Find the nearest keyframe time to `timeMs` within `thresholdMs`.
 * Returns null if no keyframe is close enough.
 */
export function findNearestKeyframeTime(
  keyframes: PropertyKeyframe[],
  timeMs: number,
  thresholdMs: number = DEFAULT_SNAP_THRESHOLD_MS,
): number | null {
  let bestTime: number | null = null;
  let bestDist = Infinity;
  for (const kf of keyframes) {
    const dist = Math.abs(kf.timeMs - timeMs);
    if (dist <= thresholdMs && dist < bestDist) {
      bestDist = dist;
      bestTime = kf.timeMs;
    }
  }
  return bestTime;
}

/**
 * Get all properties that have keyframes.
 */
export function propertiesWithKeyframes(keyframes: PropertyKeyframe[]): Set<TransformProperty> {
  const props = new Set<TransformProperty>();
  for (const kf of keyframes) props.add(kf.property);
  return props;
}

/**
 * Add or update a keyframe for a specific property at a specific time.
 * If a keyframe for the same property exists within snapThresholdMs, it is updated in place.
 * Otherwise, a new keyframe is created.
 * Returns a new array (immutable).
 */
export function upsertKeyframe(
  keyframes: PropertyKeyframe[],
  timeMs: number,
  property: TransformProperty,
  value: number,
  easing: EasingType = 'linear',
  snapThresholdMs: number = DEFAULT_SNAP_THRESHOLD_MS,
): PropertyKeyframe[] {
  const idx = keyframes.findIndex(
    (kf) => kf.property === property && Math.abs(kf.timeMs - timeMs) <= snapThresholdMs,
  );
  if (idx >= 0) {
    // Update existing keyframe value (and snap time)
    const updated = [...keyframes];
    updated[idx] = { ...updated[idx], timeMs, value, easing };
    return updated;
  }
  // Insert new keyframe
  return [...keyframes, { id: uuidv4(), timeMs, property, value, easing, source: 'manual' as const }];
}

/**
 * Add keyframes for ALL 8 transform properties at a given time,
 * using the provided transform values. Existing keyframes at that time are updated.
 */
export function upsertAllPropertiesAtTime(
  keyframes: PropertyKeyframe[],
  timeMs: number,
  transform: SegmentTransform,
  easing: EasingType = 'linear',
  snapThresholdMs: number = DEFAULT_SNAP_THRESHOLD_MS,
): PropertyKeyframe[] {
  let result = keyframes;
  for (const prop of ALL_TRANSFORM_PROPERTIES) {
    result = upsertKeyframe(result, timeMs, prop, transform[prop], easing, snapThresholdMs);
  }
  return result;
}

/**
 * Remove all keyframes at a specific time (within snap threshold).
 * Returns a new array (immutable).
 */
export function removeKeyframesAtTime(
  keyframes: PropertyKeyframe[],
  timeMs: number,
  snapThresholdMs: number = DEFAULT_SNAP_THRESHOLD_MS,
): PropertyKeyframe[] {
  return keyframes.filter((kf) => Math.abs(kf.timeMs - timeMs) > snapThresholdMs);
}

/**
 * Move all keyframes from one time to another (within snap threshold).
 * Returns a new array (immutable).
 */
export function moveKeyframesAtTime(
  keyframes: PropertyKeyframe[],
  oldTimeMs: number,
  newTimeMs: number,
  snapThresholdMs: number = DEFAULT_SNAP_THRESHOLD_MS,
): PropertyKeyframe[] {
  return keyframes.map((kf) =>
    Math.abs(kf.timeMs - oldTimeMs) <= snapThresholdMs
      ? { ...kf, timeMs: newTimeMs }
      : kf,
  );
}

/**
 * Returns true if a keyframe was generated by the zoom system
 * (auto-generated boundary OR user pan point, or legacy untagged zoom property).
 */
export function isZoomKeyframe(kf: PropertyKeyframe): boolean {
  if (kf.source === 'zoom' || kf.source === 'zoom-auto') return true;
  if (kf.source === 'manual') return false;
  // Legacy untagged: treat zoom/focusX/focusY as zoom-generated
  return kf.property === 'zoom' || kf.property === 'focusX' || kf.property === 'focusY';
}

/**
 * Returns true if a keyframe is a user-created pan point (not auto-generated boundary).
 */
export function isPanPointKeyframe(kf: PropertyKeyframe): boolean {
  return kf.source === 'zoom';
}

/**
 * Get unique keyframe times for ALL zoom-source keyframes (auto + pan points).
 */
export function getUniqueZoomKeyframeTimes(keyframes: PropertyKeyframe[]): number[] {
  const times = new Set<number>();
  for (const kf of keyframes) {
    if (isZoomKeyframe(kf)) times.add(kf.timeMs);
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * Get unique keyframe times for user-created pan points only (not auto-generated).
 */
export function getUniquePanPointTimes(keyframes: PropertyKeyframe[]): number[] {
  const times = new Set<number>();
  for (const kf of keyframes) {
    if (isPanPointKeyframe(kf)) times.add(kf.timeMs);
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * Get the focus values from the last (latest-time) pan point.
 * Returns null if no pan points exist.
 */
export function getLastPanPointFocus(keyframes: PropertyKeyframe[]): { focusX: number; focusY: number } | null {
  const panPoints = keyframes.filter(kf => kf.source === 'zoom');
  if (panPoints.length === 0) return null;
  const maxTime = Math.max(...panPoints.map(kf => kf.timeMs));
  const atMax = panPoints.filter(kf => Math.abs(kf.timeMs - maxTime) < 5);
  const fx = atMax.find(kf => kf.property === 'focusX');
  const fy = atMax.find(kf => kf.property === 'focusY');
  return {
    focusX: fx?.value ?? 0.5,
    focusY: fy?.value ?? 0.5,
  };
}

/**
 * Get the focus values from the first (earliest-time) pan point.
 * Returns null if no pan points exist.
 */
export function getFirstPanPointFocus(keyframes: PropertyKeyframe[]): { focusX: number; focusY: number } | null {
  const panPoints = keyframes.filter(kf => kf.source === 'zoom');
  if (panPoints.length === 0) return null;
  const minTime = Math.min(...panPoints.map(kf => kf.timeMs));
  const atMin = panPoints.filter(kf => Math.abs(kf.timeMs - minTime) < 5);
  const fx = atMin.find(kf => kf.property === 'focusX');
  const fy = atMin.find(kf => kf.property === 'focusY');
  return {
    focusX: fx?.value ?? 0.5,
    focusY: fy?.value ?? 0.5,
  };
}

/**
 * Get unique keyframe times for manual (non-zoom) keyframes only.
 */
export function getUniqueManualKeyframeTimes(keyframes: PropertyKeyframe[]): number[] {
  const times = new Set<number>();
  for (const kf of keyframes) {
    if (!isZoomKeyframe(kf)) times.add(kf.timeMs);
  }
  return [...times].sort((a, b) => a - b);
}

// --- Zoom boundary protection ---

/** Minimum distance (ms) between a pan point and a zoom region boundary (t1/t4). */
export const MIN_PAN_OFFSET_MS = 30;

/**
 * Clamp a time value so it stays at least MIN_PAN_OFFSET_MS away from
 * the zoom region boundaries. Prevents pan points from snapping to
 * and corrupting t1/t4 boundary keyframes.
 */
export function clampToPanRange(
  relTime: number,
  regionRelStart: number,
  regionRelEnd: number,
): number {
  const minTime = regionRelStart + MIN_PAN_OFFSET_MS;
  const maxTime = regionRelEnd - MIN_PAN_OFFSET_MS;
  if (minTime >= maxTime) {
    // Region too short for safe pan points — use midpoint
    return Math.round((regionRelStart + regionRelEnd) / 2);
  }
  return Math.max(minTime, Math.min(maxTime, Math.round(relTime)));
}

/**
 * Ensure zoom boundary keyframes (t1 at regionStart, t4 at regionEnd)
 * have correct values: zoom=1, focusX=0.5, focusY=0.5, source='zoom-auto'.
 * Fixes corruption from pan point operations that accidentally snap to boundaries.
 */
export function ensureZoomBoundaries(
  keyframes: PropertyKeyframe[],
  regionRelStart: number,
  regionRelEnd: number,
): PropertyKeyframe[] {
  const SNAP = 5;
  return keyframes.map(kf => {
    const isAtStart = Math.abs(kf.timeMs - regionRelStart) <= SNAP;
    const isAtEnd = Math.abs(kf.timeMs - regionRelEnd) <= SNAP;
    if (!isAtStart && !isAtEnd) return kf;

    if (kf.property === 'zoom') {
      return { ...kf, value: 1, source: 'zoom-auto' as const };
    }
    if (kf.property === 'focusX' || kf.property === 'focusY') {
      return { ...kf, value: 0.5, source: 'zoom-auto' as const };
    }
    return kf;
  });
}

/**
 * Sync t2/t3 auto-boundary keyframes to first/last pan point values,
 * then ensure t1/t4 boundaries are correct. Call after any pan point modification.
 *
 * regionRelStart/regionRelEnd are relative to the segment's sourceStartMs.
 */
export function syncZoomBoundaries(
  keyframes: PropertyKeyframe[],
  regionRelStart: number,
  regionRelEnd: number,
): PropertyKeyframe[] {
  const regionMid = (regionRelStart + regionRelEnd) / 2;

  // Find pan points within this region
  const panPointKfs = keyframes.filter(kf =>
    kf.source === 'zoom' &&
    kf.timeMs >= regionRelStart - 5 &&
    kf.timeMs <= regionRelEnd + 5
  );

  const firstPan = getFirstPanPointFocus(panPointKfs);
  const lastPan = getLastPanPointFocus(panPointKfs);

  const panTimes = [...new Set(panPointKfs.map(kf => kf.timeMs))].sort((a, b) => a - b);
  const firstPanZoom = panTimes.length > 0
    ? panPointKfs.find(kf => Math.abs(kf.timeMs - panTimes[0]) < 5 && kf.property === 'zoom')?.value
    : undefined;
  const lastPanZoom = panTimes.length > 0
    ? panPointKfs.find(kf => Math.abs(kf.timeMs - panTimes[panTimes.length - 1]) < 5 && kf.property === 'zoom')?.value
    : undefined;

  // Sync t2 (first half) and t3 (second half) auto boundaries to pan point values
  let result = keyframes.map(kf => {
    if (kf.source !== 'zoom-auto') return kf;
    // t2: first half of region (after t1, before midpoint)
    if (kf.timeMs > regionRelStart + 5 && kf.timeMs < regionMid) {
      if (firstPan && kf.property === 'focusX') return { ...kf, value: firstPan.focusX };
      if (firstPan && kf.property === 'focusY') return { ...kf, value: firstPan.focusY };
      if (firstPanZoom !== undefined && kf.property === 'zoom') return { ...kf, value: firstPanZoom };
    }
    // t3: second half of region (after midpoint, before t4)
    if (kf.timeMs > regionMid && kf.timeMs < regionRelEnd - 5) {
      if (lastPan && kf.property === 'focusX') return { ...kf, value: lastPan.focusX };
      if (lastPan && kf.property === 'focusY') return { ...kf, value: lastPan.focusY };
      if (lastPanZoom !== undefined && kf.property === 'zoom') return { ...kf, value: lastPanZoom };
    }
    return kf;
  });

  // Ensure t1/t4 boundary keyframes have correct values
  result = ensureZoomBoundaries(result, regionRelStart, regionRelEnd);

  return result;
}

// --- Spotlight keyframe helpers ---

const SPOTLIGHT_ANIM_PROPERTIES: SpotlightAnimProperty[] = ['x', 'y', 'width', 'height'];

/**
 * Resolve the animated spotlight position/size at a given time (relative to spotlight startMs).
 * Falls back to static values when no keyframes exist for a property.
 */
export function resolveSpotlightAtTime(
  keyframes: SpotlightKeyframe[] | undefined,
  timeMs: number,
  staticSpot: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (!keyframes || keyframes.length === 0) return { ...staticSpot };

  const result = { ...staticSpot };
  for (const prop of SPOTLIGHT_ANIM_PROPERTIES) {
    const propKfs = keyframes
      .filter(kf => kf.property === prop)
      .sort((a, b) => a.timeMs - b.timeMs);
    result[prop] = interpolateValues(propKfs, timeMs, staticSpot[prop]);
  }
  return result;
}

/**
 * Get unique keyframe times for user-created spotlight points only (source === 'spotlight').
 */
export function getUniqueSpotlightPointTimes(keyframes: SpotlightKeyframe[] | undefined): number[] {
  if (!keyframes) return [];
  const times = new Set<number>();
  for (const kf of keyframes) {
    if (kf.source === 'spotlight') times.add(kf.timeMs);
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * Returns true if a spotlight keyframe is a user-created point (not auto-generated).
 */
export function isSpotlightPoint(kf: SpotlightKeyframe): boolean {
  return kf.source === 'spotlight';
}

/**
 * Upsert a spotlight keyframe for a given property at a given time.
 * Returns a new array (immutable).
 */
export function upsertSpotlightKeyframe(
  keyframes: SpotlightKeyframe[],
  timeMs: number,
  property: SpotlightAnimProperty,
  value: number,
  easing: EasingType = 'ease-in-out',
  source: 'spotlight' | 'spotlight-auto' = 'spotlight',
  snapThresholdMs: number = 50,
): SpotlightKeyframe[] {
  const idx = keyframes.findIndex(
    kf => kf.property === property && Math.abs(kf.timeMs - timeMs) <= snapThresholdMs,
  );
  if (idx >= 0) {
    const updated = [...keyframes];
    updated[idx] = { ...updated[idx], timeMs, value, easing, source };
    return updated;
  }
  return [...keyframes, { id: uuidv4(), timeMs, property, value, easing, source }];
}

/**
 * Upsert all 4 spotlight properties at a given time.
 */
export function upsertAllSpotlightPropertiesAtTime(
  keyframes: SpotlightKeyframe[],
  timeMs: number,
  values: { x: number; y: number; width: number; height: number },
  easing: EasingType = 'ease-in-out',
  source: 'spotlight' | 'spotlight-auto' = 'spotlight',
  snapThresholdMs: number = 50,
): SpotlightKeyframe[] {
  let result = keyframes;
  for (const prop of SPOTLIGHT_ANIM_PROPERTIES) {
    result = upsertSpotlightKeyframe(result, timeMs, prop, values[prop], easing, source, snapThresholdMs);
  }
  return result;
}
