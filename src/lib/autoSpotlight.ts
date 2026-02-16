/**
 * Auto-spotlight: Analyze cursor data to generate spotlight regions automatically.
 *
 * Reuses detectCursorEvents() and mergeEvents() from autoZoom.ts for the
 * cursor analysis pipeline. Instead of generating zoom regions, generates
 * rectangular spotlight regions around cursor dwell centroids.
 */

import type { CursorFrame } from './cursorTracker';
import type { SpotlightRegion } from '@/components/video-editor/types';
import { DEFAULT_SPOTLIGHT_REGION } from '@/components/video-editor/types';
import {
  detectCursorEvents,
  mergeEvents,
  type AutoZoomSensitivity,
} from './autoZoom';

export interface AutoSpotlightConfig {
  sensitivity: AutoZoomSensitivity;
  minDurationMs: number;
  leadInMs: number;
  leadOutMs: number;
  mergeGapMs: number;
  // Spotlight region size as percentage of screen
  regionWidthPct: number;   // default 30
  regionHeightPct: number;  // default 25
}

export const DEFAULT_AUTO_SPOTLIGHT_CONFIG: AutoSpotlightConfig = {
  sensitivity: 'medium',
  minDurationMs: 800,
  leadInMs: 200,
  leadOutMs: 200,
  mergeGapMs: 300,
  regionWidthPct: 30,
  regionHeightPct: 25,
};

/**
 * Clamp a spotlight region to stay within 0-100% bounds.
 */
function clampRegion(
  cx: number,
  cy: number,
  widthPct: number,
  heightPct: number,
): { x: number; y: number; width: number; height: number } {
  const halfW = widthPct / 2;
  const halfH = heightPct / 2;

  // Convert normalized (0-1) focus to percentage (0-100)
  let x = cx * 100 - halfW;
  let y = cy * 100 - halfH;

  // Clamp to bounds
  x = Math.max(0, Math.min(100 - widthPct, x));
  y = Math.max(0, Math.min(100 - heightPct, y));

  return { x, y, width: widthPct, height: heightPct };
}

export function generateAutoSpotlightRegions(
  cursorData: CursorFrame[],
  existingRegions: SpotlightRegion[],
  config: AutoSpotlightConfig,
  nextIdStart: number,
): { regions: SpotlightRegion[]; nextId: number } {
  if (cursorData.length < 10) {
    return { regions: [], nextId: nextIdStart };
  }

  // Detect cursor events (pauses, clusters, transitions)
  const events = detectCursorEvents(cursorData, config.sensitivity);

  // Merge nearby events
  const merged = mergeEvents(events, config.mergeGapMs);

  const regions: SpotlightRegion[] = [];
  let nextId = nextIdStart;

  for (const event of merged) {
    // Create candidate region with lead-in/lead-out
    const startMs = Math.max(0, event.startMs - config.leadInMs);
    const rawEndMs = event.endMs + config.leadOutMs;
    const endMs = Math.max(rawEndMs, startMs + config.minDurationMs);

    // Check overlap with existing spotlight regions
    const overlapsExisting = existingRegions.some(r =>
      startMs < r.endMs && endMs > r.startMs
    );
    if (overlapsExisting) continue;

    // Check overlap with already-generated auto regions
    const overlapsGenerated = regions.some(r =>
      startMs < r.endMs && endMs > r.startMs
    );
    if (overlapsGenerated) continue;

    // Calculate spotlight rectangle centered on dwell point
    const rect = clampRegion(
      event.focusX,
      event.focusY,
      config.regionWidthPct,
      config.regionHeightPct,
    );

    regions.push({
      id: `spotlight-${nextId++}`,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      borderRadius: DEFAULT_SPOTLIGHT_REGION.borderRadius,
      dimOpacity: DEFAULT_SPOTLIGHT_REGION.dimOpacity,
    });
  }

  return { regions, nextId };
}
