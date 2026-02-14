/**
 * Cursor smoothing via Gaussian-weighted time window averaging.
 *
 * Screen Studio-style smoothing: the cursor "glides" instead of snapping
 * between positions. Works by averaging positions in a time window around
 * the target time, weighted by a Gaussian curve centered on that time.
 *
 * This produces:
 * - Jitter removal (high-frequency noise filtered out)
 * - Smooth "inertia" feel (cursor seems to have mass)
 * - Natural ease-in/ease-out at movement start/stop
 * - Deterministic: same result on seek and sequential playback
 */

import type { CursorFrame } from './cursorTracker';

export type CursorSmoothingStrength = 'none' | 'light' | 'medium' | 'heavy';

// Half-window size in ms — total window is 2x this.
// Sigma = windowMs / 2.5 so ~98% of weight falls within the window.
const SMOOTHING_WINDOW: Record<Exclude<CursorSmoothingStrength, 'none'>, number> = {
  light:  80,
  medium: 180,
  heavy:  350,
};

// Index cache: stores the last lookup index per (frames, strength) pair to speed up
// sequential playback (avoid binary search when time advances linearly).
const indexCache = new WeakMap<CursorFrame[], Map<string, number>>();

/**
 * Binary search: find the index of the last frame with t <= targetTime.
 */
function findFrameIndex(frames: CursorFrame[], targetTime: number, hint: number = 0): number {
  // Fast path: check hint and neighbors first (sequential playback)
  if (hint >= 0 && hint < frames.length) {
    if (frames[hint].t <= targetTime) {
      if (hint + 1 >= frames.length || frames[hint + 1].t > targetTime) {
        return hint;
      }
      // Check a few forward steps before falling back to binary search
      for (let i = hint + 1; i < Math.min(hint + 8, frames.length); i++) {
        if (frames[i].t > targetTime) return i - 1;
      }
    }
  }

  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= targetTime) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Get smoothed cursor position at a given time using Gaussian-weighted averaging.
 *
 * For each query time, we:
 * 1. Find all frames within [time - window, time + window]
 * 2. Weight each by a Gaussian centered on the query time
 * 3. Return the weighted average position
 *
 * This creates the "glide" effect: fast movements are softened,
 * jitter is eliminated, and stops/starts feel natural.
 */
export function getSmoothedCursorPositionAtTime(
  frames: CursorFrame[],
  timeMs: number,
  strength: CursorSmoothingStrength,
): { x: number; y: number } | null {
  if (frames.length === 0) return null;
  if (strength === 'none') return null;

  const windowMs = SMOOTHING_WINDOW[strength];
  const sigma = windowMs / 2.5;
  const sigmaSquared2 = 2 * sigma * sigma;

  const startTime = timeMs - windowMs;
  const endTime = timeMs + windowMs;

  // Get or create index cache for this frames array
  let cacheMap = indexCache.get(frames);
  if (!cacheMap) {
    cacheMap = new Map();
    indexCache.set(frames, cacheMap);
  }
  const lastIdx = cacheMap.get(strength) ?? 0;

  // Find the start of our window
  const startIdx = findFrameIndex(frames, startTime, lastIdx);

  let sumX = 0;
  let sumY = 0;
  let sumW = 0;

  for (let i = startIdx; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.t > endTime) break;
    if (frame.t < startTime) continue;

    const dt = frame.t - timeMs;
    const weight = Math.exp(-(dt * dt) / sigmaSquared2);

    sumX += frame.x * weight;
    sumY += frame.y * weight;
    sumW += weight;
  }

  // Cache the index for next sequential lookup
  cacheMap.set(strength, startIdx);

  if (sumW === 0) return null;

  return {
    x: Math.max(0, Math.min(1, sumX / sumW)),
    y: Math.max(0, Math.min(1, sumY / sumW)),
  };
}

// Keep exports for backwards compatibility (tests, etc.)
export { SMOOTHING_WINDOW };
