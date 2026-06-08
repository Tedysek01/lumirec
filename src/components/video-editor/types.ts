export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;

export interface ZoomFocus {
  cx: number; // normalized horizontal center (0-1)
  cy: number; // normalized vertical center (0-1)
}

export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out';

export interface TransitionConfig {
  type: TransitionType;
  durationMs: number; // 100-1000ms
}

export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  type: 'none',
  durationMs: 300,
};

/**
 * A user-authored camera anchor inside a zoom region's "hold" phase.
 * Pan points are the ONLY way the camera position/zoom is steered between the
 * zoom-in and zoom-out transitions. They live on the ZoomRegion itself — the
 * region is the single source of truth for everything about a zoom.
 */
export interface ZoomPanPoint {
  id: string;
  timeMs: number;   // relative to region.startMs
  focusX: number;   // 0-1
  focusY: number;   // 0-1
  zoom: number;     // target zoom multiplier at this anchor
}

export interface ZoomRegion {
  id: string;
  startMs: number;
  endMs: number;
  depth: ZoomDepth;             // default/base target zoom (used when no pan points)
  focus: ZoomFocus;            // default/base focus (used when no pan points)
  enterTransition?: TransitionConfig;  // zoom-in duration/easing
  exitTransition?: TransitionConfig;   // zoom-out duration/easing
  /**
   * User camera anchors during the hold. Empty = a single implicit anchor at
   * (focus, ZOOM_DEPTH_SCALES[depth]). The region + these points fully describe
   * the camera path; no derived keyframes are stored anywhere.
   */
  panPoints?: ZoomPanPoint[];
}

export interface TrimRegion {
  id: string;
  startMs: number;
  endMs: number;
}

// --- NLE Video Segment types ---

export interface SegmentTransform {
  rotation: number;    // degrees
  scaleX: number;      // 1.0 = 100%
  scaleY: number;
  positionX: number;   // px offset from center
  positionY: number;
  zoom: number;        // camera zoom multiplier (1.0 = no zoom)
  focusX: number;      // normalized horizontal look-at point (0-1)
  focusY: number;      // normalized vertical look-at point (0-1)
}

export const DEFAULT_SEGMENT_TRANSFORM: SegmentTransform = {
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  positionX: 0,
  positionY: 0,
  zoom: 1,
  focusX: 0.5,
  focusY: 0.5,
};

export type TransformProperty = 'rotation' | 'scaleX' | 'scaleY' | 'positionX' | 'positionY' | 'zoom' | 'focusX' | 'focusY';
export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface PropertyKeyframe {
  id: string;
  timeMs: number;      // relative to segment start
  property: TransformProperty;
  value: number;
  easing: EasingType;
  source?: 'zoom' | 'zoom-auto' | 'manual';  // 'zoom' = user pan point, 'zoom-auto' = auto-generated boundary
}

export interface VideoSegment {
  id: string;
  sourceStartMs: number;  // where in the original recording this segment starts
  sourceEndMs: number;    // where in the original recording this segment ends
  timelineStartMs: number; // position on the output timeline
  transform: SegmentTransform;
  keyframes: PropertyKeyframe[];
}

export type AnnotationType = 'text' | 'image' | 'figure';

export type ArrowDirection = 'up' | 'down' | 'left' | 'right' | 'up-right' | 'up-left' | 'down-right' | 'down-left';

export interface FigureData {
  arrowDirection: ArrowDirection;
  color: string;
  strokeWidth: number;
}

export interface AnnotationPosition {
  x: number;
  y: number;
}

export interface AnnotationSize {
  width: number;
  height: number;
}

export interface AnnotationTextStyle {
  color: string;
  backgroundColor: string;
  fontSize: number; // pixels
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline';
  textAlign: 'left' | 'center' | 'right';
}

export interface AnnotationRegion {
  id: string;
  startMs: number;
  endMs: number;
  type: AnnotationType;
  content: string; // Legacy - still used for current type
  textContent?: string; // Separate storage for text
  imageContent?: string; // Separate storage for image data URL
  position: AnnotationPosition;
  size: AnnotationSize;
  style: AnnotationTextStyle;
  zIndex: number;
  figureData?: FigureData;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
  x: 50,
  y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
  width: 30,
  height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
  color: '#ffffff',
  backgroundColor: 'transparent',
  fontSize: 32,
  fontFamily: 'Inter',
  fontWeight: 'bold',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'center',
};

export const DEFAULT_FIGURE_DATA: FigureData = {
  arrowDirection: 'right',
  color: '#3B82F6',
  strokeWidth: 4,
};



export interface CropRegion {
  x: number; 
  y: number; 
  width: number; 
  height: number; 
}

export const DEFAULT_CROP_REGION: CropRegion = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export type SpotlightAnimProperty = 'x' | 'y' | 'width' | 'height';

export interface SpotlightKeyframe {
  id: string;
  timeMs: number;      // relative to spotlight startMs
  property: SpotlightAnimProperty;
  value: number;
  easing: EasingType;
  source: 'spotlight' | 'spotlight-auto';
}

export interface SpotlightRegion {
  id: string;
  startMs: number;
  endMs: number;
  // Position & size as percentages (0-100) of video dimensions
  x: number;       // left edge %
  y: number;       // top edge %
  width: number;   // width %
  height: number;  // height %
  borderRadius: number;  // px
  dimOpacity: number;    // 0-1, how dark the outside area is
  keyframes?: SpotlightKeyframe[];
}

export const DEFAULT_SPOTLIGHT_REGION: Omit<SpotlightRegion, 'id' | 'startMs' | 'endMs'> = {
  x: 25,
  y: 25,
  width: 50,
  height: 50,
  borderRadius: 8,
  dimOpacity: 0.6,
};

/** Duration in ms for spotlight dim fade-in/fade-out */
export const SPOTLIGHT_FADE_MS = 200;

/** Compute the effective dim opacity at a given time, with smooth fade in/out at edges */
export function getSpotlightFadeOpacity(spot: SpotlightRegion, timeMs: number, fadeDurationMs = SPOTLIGHT_FADE_MS): number {
  if (timeMs < spot.startMs || timeMs > spot.endMs) return 0;
  const fadeIn = Math.min(1, (timeMs - spot.startMs) / fadeDurationMs);
  const fadeOut = Math.min(1, (spot.endMs - timeMs) / fadeDurationMs);
  return spot.dimOpacity * Math.min(fadeIn, fadeOut);
}

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
  1: 1.25,
  2: 1.5,
  3: 1.8,
  4: 2.2,
  5: 3.5,
  6: 5.0,
};

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;

export function clampFocusToDepth(focus: ZoomFocus, _depth: ZoomDepth): ZoomFocus {
  return {
    cx: clamp(focus.cx, 0, 1),
    cy: clamp(focus.cy, 0, 1),
  };
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}
