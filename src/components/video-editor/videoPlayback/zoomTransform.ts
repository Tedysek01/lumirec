import { Container, BlurFilter } from 'pixi.js';
import type { SegmentTransform } from '../types';

interface TransformParams {
  cameraContainer: Container;
  blurFilter: BlurFilter | null;
  stageSize: { width: number; height: number };
  baseMask: { x: number; y: number; width: number; height: number };
  zoomScale: number;
  focusX: number;
  focusY: number;
  motionIntensity: number;
  isPlaying: boolean;
  motionBlurEnabled?: boolean;
  segmentTransform?: SegmentTransform;
}

export function applyZoomTransform({
  cameraContainer,
  blurFilter,
  stageSize,
  baseMask,
  zoomScale,
  focusX,
  focusY,
  motionIntensity,
  isPlaying,
  motionBlurEnabled = false,
  segmentTransform,
}: TransformParams) {
  if (
    stageSize.width <= 0 ||
    stageSize.height <= 0 ||
    baseMask.width <= 0 ||
    baseMask.height <= 0
  ) {
    return;
  }

  const finalScale = zoomScale;

  // The focus point in stage coordinates (where the user clicked/selected)
  const focusStagePxX = focusX * stageSize.width;
  const focusStagePxY = focusY * stageSize.height;

  // Stage center (where we want the focus to end up after zoom)
  const stageCenterX = stageSize.width / 2;
  const stageCenterY = stageSize.height / 2;

  // Apply zoom scale to camera container
  cameraContainer.scale.set(finalScale);

  // Calculate camera position to keep focus point centered
  // After scaling, the focus point moves to (focusX * zoomScale, focusY * zoomScale)
  // We want it at stage center, so offset = center - (focus * scale)
  let cameraX = stageCenterX - focusStagePxX * finalScale;
  let cameraY = stageCenterY - focusStagePxY * finalScale;

  cameraContainer.position.set(cameraX, cameraY);
  cameraContainer.alpha = 1;

  // Apply per-segment transform (rotation, additional scale, position offset)
  if (segmentTransform) {
    const { rotation, scaleX, scaleY, positionX, positionY } = segmentTransform;

    // Set pivot to stage center for rotation
    cameraContainer.pivot.set(stageCenterX, stageCenterY);
    // Compensate position for the pivot change
    cameraContainer.position.set(cameraX + stageCenterX, cameraY + stageCenterY);

    // Apply rotation (degrees to radians)
    cameraContainer.angle = rotation;

    // Apply additional scale
    cameraContainer.scale.set(finalScale * scaleX, finalScale * scaleY);

    // Apply position offset
    cameraContainer.position.x += positionX;
    cameraContainer.position.y += positionY;
  }

  if (blurFilter) {
    const shouldBlur = motionBlurEnabled && isPlaying && motionIntensity > 0.0005;
    const motionBlur = shouldBlur ? Math.min(6, motionIntensity * 120) : 0;
    blurFilter.blur = motionBlur;
  }
}
