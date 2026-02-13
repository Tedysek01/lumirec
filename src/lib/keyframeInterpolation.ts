import type { PropertyKeyframe, TransformProperty, EasingType, SegmentTransform } from '@/components/video-editor/types';

// Easing functions
function linear(t: number): number {
  return t;
}

function easeIn(t: number): number {
  return t * t;
}

function easeOut(t: number): number {
  return t * (2 - t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

const EASING_FUNCTIONS: Record<EasingType, (t: number) => number> = {
  'linear': linear,
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
};

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
  // Filter keyframes for this property, sorted by time
  const propKeyframes = keyframes
    .filter((kf) => kf.property === property)
    .sort((a, b) => a.timeMs - b.timeMs);

  if (propKeyframes.length === 0) {
    return staticTransform[property];
  }

  // Before first keyframe
  if (timeMs <= propKeyframes[0].timeMs) {
    return propKeyframes[0].value;
  }

  // After last keyframe
  if (timeMs >= propKeyframes[propKeyframes.length - 1].timeMs) {
    return propKeyframes[propKeyframes.length - 1].value;
  }

  // Find bracket keyframes using binary search
  let low = 0;
  let high = propKeyframes.length - 1;
  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (propKeyframes[mid].timeMs <= timeMs) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const kfA = propKeyframes[low];
  const kfB = propKeyframes[high];
  const duration = kfB.timeMs - kfA.timeMs;
  if (duration <= 0) return kfA.value;

  const t = (timeMs - kfA.timeMs) / duration;
  const easingFn = EASING_FUNCTIONS[kfB.easing] || linear;
  const easedT = easingFn(t);

  return kfA.value + (kfB.value - kfA.value) * easedT;
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
  };
}
