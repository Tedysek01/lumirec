import type { ZoomRegion, TrimRegion, AnnotationRegion, CropRegion, VideoSegment } from "./types";
import { DEFAULT_CROP_REGION } from "./types";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { type CursorHighlightConfig, DEFAULT_CURSOR_HIGHLIGHT_CONFIG } from "@/lib/cursorTracker";

/**
 * State that is tracked by undo/redo.
 * Only includes values that represent user-editable project state.
 * Excludes transient state like isPlaying, currentTime, selectedIds, export settings.
 */
export interface EditorUndoableState {
  wallpaper: string;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled: boolean;
  borderRadius: number;
  padding: number;
  cropRegion: CropRegion;
  zoomRegions: ZoomRegion[];
  trimRegions: TrimRegion[];
  videoSegments: VideoSegment[];
  annotationRegions: AnnotationRegion[];
  aspectRatio: AspectRatio;
  cursorHighlight: CursorHighlightConfig;
}

export const DEFAULT_WALLPAPER = '/wallpapers/wallpaper1.jpg';

export function createInitialEditorState(wallpaper: string = DEFAULT_WALLPAPER): EditorUndoableState {
  return {
    wallpaper,
    shadowIntensity: 0,
    showBlur: false,
    motionBlurEnabled: false,
    borderRadius: 0,
    padding: 50,
    cropRegion: { ...DEFAULT_CROP_REGION },
    zoomRegions: [],
    trimRegions: [],
    videoSegments: [],
    annotationRegions: [],
    aspectRatio: '16:9',
    cursorHighlight: { ...DEFAULT_CURSOR_HIGHLIGHT_CONFIG },
  };
}
