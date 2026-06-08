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
 * Get unique keyframe times for manual (non-zoom) keyframes only.
 */
export function getUniqueManualKeyframeTimes(keyframes: PropertyKeyframe[]): number[] {
  const times = new Set<number>();
  for (const kf of keyframes) {
    if (!isZoomKeyframe(kf)) times.add(kf.timeMs);
  }
  return [...times].sort((a, b) => a - b);
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
