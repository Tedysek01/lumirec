import type { ZoomRegion, TrimRegion, AnnotationRegion, CropRegion, VideoSegment, SpotlightRegion } from "./types";
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
  /**
   * Corner radius (in px) applied to the video sprite itself via a PixiJS
   * Graphics mask. Distinct from `borderRadius`, which is reserved for the
   * outer container / wallpaper framing. Screen Studio parity feature.
   */
  videoBorderRadius: number;
  padding: number;
  cropRegion: CropRegion;
  zoomRegions: ZoomRegion[];
  trimRegions: TrimRegion[];
  videoSegments: VideoSegment[];
  annotationRegions: AnnotationRegion[];
  spotlightRegions: SpotlightRegion[];
  aspectRatio: AspectRatio;
  cursorHighlight: CursorHighlightConfig;
  // True once auto-enhance has run (or when a saved project was loaded).
  // Prevents re-application across re-renders / undo-redo.
  enhancementsApplied: boolean;
}

export const DEFAULT_WALLPAPER = '/wallpapers/wallpaper1.jpg';

export function createInitialEditorState(wallpaper: string = DEFAULT_WALLPAPER): EditorUndoableState {
  return {
    wallpaper,
    shadowIntensity: 0,
    showBlur: false,
    motionBlurEnabled: false,
    borderRadius: 0,
    videoBorderRadius: 16,
    padding: 50,
    cropRegion: { ...DEFAULT_CROP_REGION },
    zoomRegions: [],
    trimRegions: [],
    videoSegments: [],
    annotationRegions: [],
    spotlightRegions: [],
    aspectRatio: '16:9',
    cursorHighlight: { ...DEFAULT_CURSOR_HIGHLIGHT_CONFIG },
    enhancementsApplied: false,
  };
}
