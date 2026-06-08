/**
 * Migration: legacy keyframe-based zoom → region-based single source of truth.
 *
 * Older projects stored zoom as PropertyKeyframes on each segment:
 *   - source 'zoom-auto' : generated t1/t2/t3/t4 boundary keyframes
 *   - source 'zoom'      : user pan points
 *   - legacy untagged    : zoom/focusX/focusY keyframes
 *
 * The new model keeps everything on the ZoomRegion itself (depth, focus,
 * transitions, panPoints) and derives the camera at render time. This migration
 * lifts user pan points off the segments into region.panPoints and strips all
 * zoom/focus keyframes from the segments (the camera no longer reads them).
 */

import { v4 as uuidv4 } from 'uuid';
import type { EditorUndoableState } from '@/components/video-editor/editorState';
import type { PropertyKeyframe, ZoomPanPoint } from '@/components/video-editor/types';

function isStrippableZoomKeyframe(kf: PropertyKeyframe): boolean {
  if (kf.source === 'zoom' || kf.source === 'zoom-auto') return true;
  if (kf.source === 'manual') return false;
  // Legacy untagged zoom/focus keyframes were zoom-driven.
  return kf.property === 'zoom' || kf.property === 'focusX' || kf.property === 'focusY';
}

export function migrateZoomKeyframesToRegions(state: EditorUndoableState): void {
  const { zoomRegions, videoSegments } = state;
  if (!zoomRegions?.length || !videoSegments?.length) return;

  for (const region of zoomRegions) {
    // Already migrated (has explicit pan points) — leave alone.
    if (region.panPoints && region.panPoints.length > 0) continue;

    const panPoints: ZoomPanPoint[] = [];

    for (const seg of videoSegments) {
      // Does this region overlap the segment's source range?
      if (region.startMs >= seg.sourceEndMs || region.endMs <= seg.sourceStartMs) continue;

      // Collect user pan-point keyframes (source 'zoom') grouped by time.
      const panKfs = (seg.keyframes ?? []).filter((kf) => kf.source === 'zoom');
      const times = [...new Set(panKfs.map((kf) => kf.timeMs))].sort((a, b) => a - b);
      for (const t of times) {
        const at = panKfs.filter((kf) => Math.abs(kf.timeMs - t) < 5);
        const focusX = at.find((kf) => kf.property === 'focusX')?.value ?? region.focus.cx;
        const focusY = at.find((kf) => kf.property === 'focusY')?.value ?? region.focus.cy;
        const zoom = at.find((kf) => kf.property === 'zoom')?.value;
        // Region-relative time: keyframe is segment-relative.
        const sourceMs = seg.sourceStartMs + t;
        const relTime = sourceMs - region.startMs;
        panPoints.push({
          id: uuidv4(),
          timeMs: Math.round(relTime),
          focusX,
          focusY,
          zoom: zoom ?? 1.8,
        });
      }
    }

    region.panPoints = panPoints;
  }

  // Strip all zoom/focus keyframes from segments — the region owns them now.
  for (const seg of videoSegments) {
    if (!seg.keyframes) continue;
    seg.keyframes = seg.keyframes.filter((kf) => !isStrippableZoomKeyframe(kf));
  }
}
