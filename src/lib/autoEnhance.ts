import type { CursorFrame } from './cursorTracker';
import type { EditorUndoableState } from '@/components/video-editor/editorState';
import { generateAutoZoomRegions, DEFAULT_AUTO_ZOOM_CONFIG } from './autoZoom';

export interface AutoEnhanceInput {
  cursorFrames: CursorFrame[];
  videoDurationMs: number;
}

/**
 * Compute smart default enhancements for a freshly loaded recording.
 * Returns a Partial<EditorUndoableState> to be merged into existing state.
 * Safe to call even when cursorFrames is empty — returns just visual defaults.
 */
export function deriveInitialEnhancements(
  input: AutoEnhanceInput,
): Partial<EditorUndoableState> {
  const { cursorFrames, videoDurationMs } = input;
  // 1. Visual polish — subtle defaults. shadowIntensity is 0-1 in the UI
  // (not 0-100), padding 50 was the original default and 80 was too much.
  const visual = {
    padding: 50,
    borderRadius: 16,
    shadowIntensity: 0.3,
  };
  // 2. Auto-zooms from cursor data (if available)
  let zoomRegions: Partial<EditorUndoableState>['zoomRegions'];
  if (cursorFrames.length >= 10 && videoDurationMs > 0) {
    const result = generateAutoZoomRegions(cursorFrames, [], DEFAULT_AUTO_ZOOM_CONFIG, 1);
    zoomRegions = result.regions;
  }
  return zoomRegions ? { ...visual, zoomRegions } : visual;
}
