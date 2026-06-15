/**
 * Migration: legacy keyframe/pan-point zoom data → layered-zoom model.
 *
 * Older projects stored zoom as PropertyKeyframes on each segment, then as
 * region pan points. The layered model derives the camera from the region's
 * base zoom plus relative-delta layers. There is no automatic conversion of old
 * pan points into layers — that data is dropped. This migration:
 *   1. ensures every region has a `layers` array, and
 *   2. strips all zoom/focus keyframes from segments (the camera no longer reads them).
 */

import type { EditorUndoableState } from '@/components/video-editor/editorState';
import type { PropertyKeyframe } from '@/components/video-editor/types';

function isStrippableZoomKeyframe(kf: PropertyKeyframe): boolean {
  if (kf.source === 'zoom' || kf.source === 'zoom-auto') return true;
  if (kf.source === 'manual') return false;
  // Legacy untagged zoom/focus keyframes were zoom-driven.
  return kf.property === 'zoom' || kf.property === 'focusX' || kf.property === 'focusY';
}

export function migrateZoomKeyframesToRegions(state: EditorUndoableState): void {
  const { zoomRegions, videoSegments } = state;

  // Ensure the layered model invariant: every region has a layers array, and
  // any stale `panPoints` field from old saves is dropped.
  if (zoomRegions?.length) {
    for (const region of zoomRegions as Array<ZoomRegionLike>) {
      delete region.panPoints;
      if (!Array.isArray(region.layers)) region.layers = [];
    }
  }

  if (!videoSegments?.length) return;
  // Strip all zoom/focus keyframes from segments — the region owns the camera now.
  for (const seg of videoSegments) {
    if (!seg.keyframes) continue;
    seg.keyframes = seg.keyframes.filter((kf) => !isStrippableZoomKeyframe(kf));
  }
}

/** Loosened view of a region so we can scrub the obsolete `panPoints` field. */
type ZoomRegionLike = { panPoints?: unknown; layers?: unknown[] };
