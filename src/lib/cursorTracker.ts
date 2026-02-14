/**
 * Cursor data types and utilities for cursor highlight feature.
 * Cursor positions are normalized to 0-1 relative to the recording source bounds.
 */

export interface CursorFrame {
  t: number; // timestamp in ms relative to recording start
  x: number; // normalized 0-1 horizontal position
  y: number; // normalized 0-1 vertical position
  s?: string; // cursor style — only stored when it changes from previous frame (run-length encoded)
}

import type { CursorSmoothingStrength } from './cursorSmoothing';

export type CursorType = 'none' | 'native' | 'default' | 'dot' | 'crosshair' | 'circle';

export interface CursorHighlightConfig {
  enabled: boolean;
  color: string;       // CSS color (default: yellow)
  opacity: number;     // 0-1 (default: 0.3)
  size: number;        // radius in px (default: 30)
  style: 'circle' | 'spotlight' | 'ring';
  smoothing: CursorSmoothingStrength;
  cursorType: CursorType; // overlay cursor style ('none' = use recorded cursor, 'native' = dynamic from tracked data)
  cursorScale: number; // cursor size multiplier (default: 1.0, range 0.5-3.0)
  cursorFree?: boolean; // true when recorded without native cursor (ScreenCaptureKit) — cursor pointer always renders
}

export const DEFAULT_CURSOR_HIGHLIGHT_CONFIG: CursorHighlightConfig = {
  enabled: false,
  color: '#FFDD00',
  opacity: 0.3,
  size: 30,
  style: 'circle',
  smoothing: 'none',
  cursorType: 'none',
  cursorScale: 1.0,
  cursorFree: false,
};

/**
 * Detect click-like pauses from cursor velocity drops.
 * Returns array of timestamps (ms) where clicks likely occurred.
 * Cached per frame array for performance.
 */
const clickCache = new WeakMap<CursorFrame[], number[]>();

export function detectClickTimes(frames: CursorFrame[]): number[] {
  const cached = clickCache.get(frames);
  if (cached) return cached;

  const clicks: number[] = [];
  const VELOCITY_THRESHOLD = 0.003; // normalized units per ms
  const MIN_PAUSE_MS = 30;
  const MAX_PAUSE_MS = 400;

  let pauseStart = -1;

  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].t - frames[i - 1].t;
    if (dt <= 0) continue;

    const dx = frames[i].x - frames[i - 1].x;
    const dy = frames[i].y - frames[i - 1].y;
    const velocity = Math.sqrt(dx * dx + dy * dy) / dt;

    if (velocity < VELOCITY_THRESHOLD) {
      if (pauseStart < 0) pauseStart = frames[i - 1].t;
    } else {
      if (pauseStart >= 0) {
        const pauseDuration = frames[i].t - pauseStart;
        if (pauseDuration >= MIN_PAUSE_MS && pauseDuration < MAX_PAUSE_MS) {
          clicks.push(pauseStart + pauseDuration / 2);
        }
        pauseStart = -1;
      }
    }
  }

  clickCache.set(frames, clicks);
  return clicks;
}

/**
 * Binary search for the closest cursor frame at a given time.
 * Returns the interpolated position between the two nearest frames.
 */
export function getCursorPositionAtTime(
  frames: CursorFrame[],
  timeMs: number,
): { x: number; y: number } | null {
  if (frames.length === 0) return null;

  // Before first frame
  if (timeMs <= frames[0].t) {
    return { x: frames[0].x, y: frames[0].y };
  }

  // After last frame
  if (timeMs >= frames[frames.length - 1].t) {
    const last = frames[frames.length - 1];
    return { x: last.x, y: last.y };
  }

  // Binary search for the bracket
  let lo = 0;
  let hi = frames.length - 1;

  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= timeMs) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = frames[lo];
  const b = frames[hi];

  // Interpolate between a and b
  const range = b.t - a.t;
  if (range === 0) return { x: a.x, y: a.y };

  const t = (timeMs - a.t) / range;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Resolve the cursor style at a given time from frame data.
 * Frames only store `s` when it changes (run-length encoded),
 * so we walk backward from the closest frame to find the last known style.
 * Returns 'default' if no style data exists.
 */
export function getCursorStyleAtTime(frames: CursorFrame[], timeMs: number): string {
  if (frames.length === 0) return 'default';

  // Binary search for the frame closest to timeMs
  let lo = 0;
  let hi = frames.length - 1;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= timeMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  // Walk backward from lo to find the last frame with an `s` value
  for (let i = lo; i >= 0; i--) {
    if (frames[i].s !== undefined) {
      return frames[i].s!;
    }
  }

  return 'default';
}
