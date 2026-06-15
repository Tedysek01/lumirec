/**
 * Auto-zoom: Analyze cursor data to generate zoom regions automatically.
 *
 * 3-pass algorithm:
 * 1. Velocity computation
 * 2. Event detection (pause/dwell, click cluster, area transition)
 * 3. Merge + deduplicate → region generation
 */

import type { CursorFrame } from './cursorTracker';
import type { ZoomRegion, ZoomDepth } from '@/components/video-editor/types';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';

export type AutoZoomSensitivity = 'low' | 'medium' | 'high';

export interface AutoZoomConfig {
  sensitivity: AutoZoomSensitivity;
  zoomDepth: ZoomDepth | 'auto';
  minDurationMs: number;
  leadInMs: number;
  leadOutMs: number;
  mergeGapMs: number;
}

export const DEFAULT_AUTO_ZOOM_CONFIG: AutoZoomConfig = {
  sensitivity: 'medium',
  zoomDepth: 'auto',
  minDurationMs: 800,
  leadInMs: 200,
  leadOutMs: 200,
  mergeGapMs: 300,
};

interface SensitivityParams {
  pauseRadius: number;
  minPauseDuration: number;
  clusterRadius: number;
  clusterWindow: number;
  transitionThreshold: number;
}

const SENSITIVITY_PARAMS: Record<AutoZoomSensitivity, SensitivityParams> = {
  low:    { pauseRadius: 0.03, minPauseDuration: 800, clusterRadius: 0.05, clusterWindow: 2000, transitionThreshold: 0.15 },
  medium: { pauseRadius: 0.02, minPauseDuration: 500, clusterRadius: 0.05, clusterWindow: 2000, transitionThreshold: 0.15 },
  high:   { pauseRadius: 0.015, minPauseDuration: 300, clusterRadius: 0.05, clusterWindow: 2000, transitionThreshold: 0.15 },
};

interface CursorEvent {
  type: 'pause' | 'cluster' | 'transition';
  startMs: number;
  endMs: number;
  focusX: number;
  focusY: number;
  confidence: number; // 0-1
}

// --- Event detection (state machine) ---

export function detectCursorEvents(
  frames: CursorFrame[],
  sensitivity: AutoZoomSensitivity,
): CursorEvent[] {
  if (frames.length < 2) return [];

  const params = SENSITIVITY_PARAMS[sensitivity];
  const events: CursorEvent[] = [];

  // Detect pauses/dwells
  let pauseStartIdx = 0;
  let pauseAnchorX = frames[0].x;
  let pauseAnchorY = frames[0].y;

  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i].x - pauseAnchorX;
    const dy = frames[i].y - pauseAnchorY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > params.pauseRadius) {
      // Check if the pause was long enough
      const pauseDuration = frames[i - 1].t - frames[pauseStartIdx].t;
      if (pauseDuration >= params.minPauseDuration) {
        // Compute centroid of dwell area
        let sumX = 0, sumY = 0, count = 0;
        for (let j = pauseStartIdx; j < i; j++) {
          sumX += frames[j].x;
          sumY += frames[j].y;
          count++;
        }
        const confidence = Math.min(1, pauseDuration / 2000);
        events.push({
          type: 'pause',
          startMs: frames[pauseStartIdx].t,
          endMs: frames[i - 1].t,
          focusX: sumX / count,
          focusY: sumY / count,
          confidence,
        });
      }
      // Reset pause tracking
      pauseStartIdx = i;
      pauseAnchorX = frames[i].x;
      pauseAnchorY = frames[i].y;
    }
  }

  // Check final segment
  const lastPauseDuration = frames[frames.length - 1].t - frames[pauseStartIdx].t;
  if (lastPauseDuration >= params.minPauseDuration) {
    let sumX = 0, sumY = 0, count = 0;
    for (let j = pauseStartIdx; j < frames.length; j++) {
      sumX += frames[j].x;
      sumY += frames[j].y;
      count++;
    }
    const confidence = Math.min(1, lastPauseDuration / 2000);
    events.push({
      type: 'pause',
      startMs: frames[pauseStartIdx].t,
      endMs: frames[frames.length - 1].t,
      focusX: sumX / count,
      focusY: sumY / count,
      confidence,
    });
  }

  // Detect click clusters (multiple pauses close together)
  const pauseEvents = events.filter(e => e.type === 'pause');
  for (let i = 0; i < pauseEvents.length; i++) {
    const cluster = [pauseEvents[i]];
    for (let j = i + 1; j < pauseEvents.length; j++) {
      const dx = pauseEvents[j].focusX - pauseEvents[i].focusX;
      const dy = pauseEvents[j].focusY - pauseEvents[i].focusY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const timeDiff = pauseEvents[j].startMs - pauseEvents[i].endMs;

      if (dist < params.clusterRadius && timeDiff < params.clusterWindow) {
        cluster.push(pauseEvents[j]);
      }
    }

    if (cluster.length >= 2) {
      let sumX = 0, sumY = 0;
      for (const e of cluster) { sumX += e.focusX; sumY += e.focusY; }
      events.push({
        type: 'cluster',
        startMs: cluster[0].startMs,
        endMs: cluster[cluster.length - 1].endMs,
        focusX: sumX / cluster.length,
        focusY: sumY / cluster.length,
        confidence: Math.min(1, cluster.length * 0.3),
      });
    }
  }

  // Detect area transitions (large jumps between pauses)
  for (let i = 1; i < pauseEvents.length; i++) {
    const prev = pauseEvents[i - 1];
    const curr = pauseEvents[i];
    const dx = curr.focusX - prev.focusX;
    const dy = curr.focusY - prev.focusY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const timeBetween = curr.startMs - prev.endMs;

    if (dist > params.transitionThreshold && timeBetween < 300) {
      events.push({
        type: 'transition',
        startMs: prev.endMs,
        endMs: curr.startMs,
        focusX: curr.focusX,
        focusY: curr.focusY,
        confidence: Math.min(1, dist / 0.3),
      });
    }
  }

  return events.sort((a, b) => a.startMs - b.startMs);
}

// --- Pass 3: Merge + region generation ---

export function mergeEvents(events: CursorEvent[], mergeGapMs: number): CursorEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  const merged: CursorEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.startMs - prev.endMs <= mergeGapMs) {
      // Merge: extend previous, average focus
      const totalDuration = (prev.endMs - prev.startMs) + (curr.endMs - curr.startMs);
      const prevWeight = (prev.endMs - prev.startMs) / totalDuration;
      const currWeight = (curr.endMs - curr.startMs) / totalDuration;

      prev.endMs = Math.max(prev.endMs, curr.endMs);
      prev.focusX = prev.focusX * prevWeight + curr.focusX * currWeight;
      prev.focusY = prev.focusY * prevWeight + curr.focusY * currWeight;
      prev.confidence = Math.max(prev.confidence, curr.confidence);
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

/**
 * Clamp focus point so the zoom viewport stays within bounds.
 */
function clampFocus(cx: number, cy: number, depth: ZoomDepth): { cx: number; cy: number } {
  const scale = ZOOM_DEPTH_SCALES[depth];
  const halfViewport = 0.5 / scale;
  return {
    cx: Math.max(halfViewport, Math.min(1 - halfViewport, cx)),
    cy: Math.max(halfViewport, Math.min(1 - halfViewport, cy)),
  };
}

function confidenceToDepth(confidence: number): ZoomDepth {
  if (confidence >= 0.8) return 4 as ZoomDepth;
  if (confidence >= 0.5) return 3 as ZoomDepth;
  return 2 as ZoomDepth;
}

export function generateZoomRegions(
  events: CursorEvent[],
  existingRegions: ZoomRegion[],
  config: AutoZoomConfig,
  nextIdStart: number,
): { regions: ZoomRegion[]; nextId: number } {
  const regions: ZoomRegion[] = [];
  let nextId = nextIdStart;

  for (const event of events) {
    // Create candidate region with lead-in/lead-out
    const startMs = Math.max(0, event.startMs - config.leadInMs);
    const rawEndMs = event.endMs + config.leadOutMs;
    const endMs = Math.max(rawEndMs, startMs + config.minDurationMs);

    // Determine depth
    const depth: ZoomDepth = config.zoomDepth === 'auto'
      ? confidenceToDepth(event.confidence)
      : config.zoomDepth;

    // Clamp focus
    const focus = clampFocus(event.focusX, event.focusY, depth);

    // Check overlap with existing manual zoom regions
    const overlapsExisting = existingRegions.some(r =>
      startMs < r.endMs && endMs > r.startMs
    );
    if (overlapsExisting) continue;

    // Check overlap with already-generated auto regions
    const overlapsGenerated = regions.some(r =>
      startMs < r.endMs && endMs > r.startMs
    );
    if (overlapsGenerated) continue;

    regions.push({
      id: `zoom-${nextId++}`,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      depth,
      focus: { cx: focus.cx, cy: focus.cy },
      layers: [],
    });
  }

  return { regions, nextId };
}

/**
 * Main entry point: analyze cursor data and generate auto-zoom regions.
 */
export function generateAutoZoomRegions(
  cursorData: CursorFrame[],
  existingRegions: ZoomRegion[],
  config: AutoZoomConfig,
  nextIdStart: number,
): { regions: ZoomRegion[]; nextId: number } {
  if (cursorData.length < 10) {
    return { regions: [], nextId: nextIdStart };
  }

  // Detect cursor events (pauses, clusters, transitions)
  const events = detectCursorEvents(cursorData, config.sensitivity);

  // Merge nearby events
  const merged = mergeEvents(events, config.mergeGapMs);

  // Generate regions with overlap avoidance
  return generateZoomRegions(merged, existingRegions, config, nextIdStart);
}
