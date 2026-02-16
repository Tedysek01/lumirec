import type { SpotlightRegion, AnnotationRegion } from '@/components/video-editor/types';
import type { EditorUndoableState } from '@/components/video-editor/editorState';
import type { AspectRatio } from '@/utils/aspectRatioUtils';
import { getAspectRatioValue } from '@/utils/aspectRatioUtils';

// ---------------------------------------------------------------------------
// Video content bounds within a container
// ---------------------------------------------------------------------------

export interface VideoContentBounds {
  /** Fraction of container width occupied by video (0-1) */
  widthFraction: number;
  /** Fraction of container height occupied by video (0-1) */
  heightFraction: number;
  /** Left edge of video as fraction of container (0-1) */
  leftFraction: number;
  /** Top edge of video as fraction of container (0-1) */
  topFraction: number;
}

/**
 * Compute where the video content sits within the container as fractions.
 * Mirrors the layout math in layoutUtils.ts (paddingScale, fit logic).
 */
export function computeVideoContentBounds(
  containerAR: number,
  videoAR: number,
  padding: number,
): VideoContentBounds {
  const paddingScale = 1.0 - (padding / 100) * 0.4;

  let widthFraction: number;
  let heightFraction: number;

  if (videoAR > containerAR) {
    // Letterboxed — video wider than container, fills width
    widthFraction = paddingScale;
    heightFraction = paddingScale * containerAR / videoAR;
  } else {
    // Pillarboxed — video taller than container, fills height
    heightFraction = paddingScale;
    widthFraction = paddingScale * videoAR / containerAR;
  }

  return {
    widthFraction,
    heightFraction,
    leftFraction: (1 - widthFraction) / 2,
    topFraction: (1 - heightFraction) / 2,
  };
}

// ---------------------------------------------------------------------------
// Position and size remapping
// ---------------------------------------------------------------------------

/** Remap a position (0-100 container%) from old to new video content bounds. */
export function remapPosition(
  oldX: number,
  oldY: number,
  oldBounds: VideoContentBounds,
  newBounds: VideoContentBounds,
): { x: number; y: number } {
  // Container% → video-relative (unbounded)
  const videoRelX = (oldX / 100 - oldBounds.leftFraction) / oldBounds.widthFraction;
  const videoRelY = (oldY / 100 - oldBounds.topFraction) / oldBounds.heightFraction;
  // Video-relative → new container%
  return {
    x: (videoRelX * newBounds.widthFraction + newBounds.leftFraction) * 100,
    y: (videoRelY * newBounds.heightFraction + newBounds.topFraction) * 100,
  };
}

/** Remap a size (0-100 container%) proportionally between old and new bounds. */
export function remapSize(
  oldWidth: number,
  oldHeight: number,
  oldBounds: VideoContentBounds,
  newBounds: VideoContentBounds,
): { width: number; height: number } {
  return {
    width: oldWidth * (newBounds.widthFraction / oldBounds.widthFraction),
    height: oldHeight * (newBounds.heightFraction / oldBounds.heightFraction),
  };
}

// ---------------------------------------------------------------------------
// Single-axis remap helpers (for individual keyframe values)
// ---------------------------------------------------------------------------

function remapX(value: number, oldBounds: VideoContentBounds, newBounds: VideoContentBounds): number {
  const rel = (value / 100 - oldBounds.leftFraction) / oldBounds.widthFraction;
  return (rel * newBounds.widthFraction + newBounds.leftFraction) * 100;
}

function remapY(value: number, oldBounds: VideoContentBounds, newBounds: VideoContentBounds): number {
  const rel = (value / 100 - oldBounds.topFraction) / oldBounds.heightFraction;
  return (rel * newBounds.heightFraction + newBounds.topFraction) * 100;
}

function remapWidth(value: number, oldBounds: VideoContentBounds, newBounds: VideoContentBounds): number {
  return value * (newBounds.widthFraction / oldBounds.widthFraction);
}

function remapHeight(value: number, oldBounds: VideoContentBounds, newBounds: VideoContentBounds): number {
  return value * (newBounds.heightFraction / oldBounds.heightFraction);
}

// ---------------------------------------------------------------------------
// Region remapping
// ---------------------------------------------------------------------------

/** Remap a SpotlightRegion's position, size, and all keyframe values. */
export function remapSpotlightRegion(
  spot: SpotlightRegion,
  oldBounds: VideoContentBounds,
  newBounds: VideoContentBounds,
): SpotlightRegion {
  const pos = remapPosition(spot.x, spot.y, oldBounds, newBounds);
  const size = remapSize(spot.width, spot.height, oldBounds, newBounds);

  const keyframes = spot.keyframes?.map(kf => {
    let value = kf.value;
    switch (kf.property) {
      case 'x':      value = remapX(value, oldBounds, newBounds); break;
      case 'y':      value = remapY(value, oldBounds, newBounds); break;
      case 'width':  value = remapWidth(value, oldBounds, newBounds); break;
      case 'height': value = remapHeight(value, oldBounds, newBounds); break;
    }
    return { ...kf, value };
  });

  return {
    ...spot,
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    ...(keyframes ? { keyframes } : {}),
  };
}

/** Remap an AnnotationRegion's position and size. */
export function remapAnnotationRegion(
  annotation: AnnotationRegion,
  oldBounds: VideoContentBounds,
  newBounds: VideoContentBounds,
): AnnotationRegion {
  const pos = remapPosition(
    annotation.position.x, annotation.position.y,
    oldBounds, newBounds,
  );
  const size = remapSize(
    annotation.size.width, annotation.size.height,
    oldBounds, newBounds,
  );

  return {
    ...annotation,
    position: { x: pos.x, y: pos.y },
    size: { width: size.width, height: size.height },
  };
}

// ---------------------------------------------------------------------------
// Orchestrator — remap entire editor state for a new aspect ratio
// ---------------------------------------------------------------------------

/**
 * Remap all container-relative positions in the editor state so elements
 * maintain their visual relationship to the video content after an
 * aspect ratio change. Returns a new state with the updated aspect ratio
 * and remapped positions.
 */
export function remapEditorStateForAspectRatio(
  state: EditorUndoableState,
  newAspectRatio: AspectRatio,
  videoNativeWidth: number,
  videoNativeHeight: number,
): EditorUndoableState {
  const oldContainerAR = getAspectRatioValue(state.aspectRatio);
  const newContainerAR = getAspectRatioValue(newAspectRatio);

  // Same aspect ratio — just update the value, no remapping needed
  if (oldContainerAR === newContainerAR) {
    return { ...state, aspectRatio: newAspectRatio };
  }

  // Compute cropped video aspect ratio
  const crop = state.cropRegion;
  const croppedVideoWidth = videoNativeWidth * crop.width;
  const croppedVideoHeight = videoNativeHeight * crop.height;
  const croppedVideoAR = croppedVideoWidth / croppedVideoHeight;

  const oldBounds = computeVideoContentBounds(oldContainerAR, croppedVideoAR, state.padding);
  const newBounds = computeVideoContentBounds(newContainerAR, croppedVideoAR, state.padding);

  return {
    ...state,
    aspectRatio: newAspectRatio,
    spotlightRegions: state.spotlightRegions.map(s =>
      remapSpotlightRegion(s, oldBounds, newBounds),
    ),
    annotationRegions: state.annotationRegions.map(a =>
      remapAnnotationRegion(a, oldBounds, newBounds),
    ),
  };
}
