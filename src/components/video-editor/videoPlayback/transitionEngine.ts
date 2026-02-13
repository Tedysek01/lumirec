import type { ZoomRegion, TransitionConfig } from '../types';
import { smoothStep } from './mathUtils';

/**
 * Computed transition state applied as modifications to the camera transform.
 * All values represent the current frame state, not targets.
 */
export interface TransitionState {
  /** 0-1 opacity for the entire camera container (1 = fully visible) */
  opacity: number;
  /** Additional X offset in normalized 0-1 stage units (for slide transitions) */
  offsetX: number;
  /** Additional Y offset in normalized 0-1 stage units */
  offsetY: number;
  /** Scale multiplier (1 = no change, <1 = smaller, >1 = bigger) */
  scaleMul: number;
}

const IDENTITY_STATE: TransitionState = {
  opacity: 1,
  offsetX: 0,
  offsetY: 0,
  scaleMul: 1,
};

/**
 * Compute the TransitionState for a single transition config.
 * @param progress - 0 (start of transition) to 1 (end of transition)
 *                   For enter: 0 = just entered, 1 = fully in
 *                   For exit: 0 = start exiting, 1 = fully out
 * @param config - The transition configuration
 * @param isExit - Whether this is an exit transition
 */
function computeTransitionForProgress(
  progress: number,
  config: TransitionConfig,
  isExit: boolean,
): TransitionState {
  if (config.type === 'none') return { ...IDENTITY_STATE };

  // For enter: progress 0→1 means transition completing (becoming visible)
  // For exit: progress 0→1 means transition starting (becoming invisible)
  // We want p to represent "how much of the effect to apply" (1 = max effect, 0 = no effect)
  const p = isExit ? smoothStep(progress) : smoothStep(1 - progress);

  switch (config.type) {
    case 'fade':
      return { opacity: 1 - p, offsetX: 0, offsetY: 0, scaleMul: 1 };

    case 'slide-left':
      // Slide from left: offset starts negative (off-screen left) → 0
      return { opacity: 1, offsetX: -p * 0.5, offsetY: 0, scaleMul: 1 };

    case 'slide-right':
      // Slide from right: offset starts positive (off-screen right) → 0
      return { opacity: 1, offsetX: p * 0.5, offsetY: 0, scaleMul: 1 };

    case 'zoom-in':
      // Start small, grow to normal
      return { opacity: 1, offsetX: 0, offsetY: 0, scaleMul: 1 - p * 0.3 };

    case 'zoom-out':
      // Start big, shrink to normal
      return { opacity: 1, offsetX: 0, offsetY: 0, scaleMul: 1 + p * 0.3 };

    default:
      return { ...IDENTITY_STATE };
  }
}

/**
 * Compute the combined transition state for a zoom region at a given time.
 * Returns IDENTITY_STATE if no transitions are active.
 */
export function computeTransitionState(
  region: ZoomRegion,
  timeMs: number,
): TransitionState {
  const enter = region.enterTransition;
  const exit = region.exitTransition;

  // Check enter transition
  if (enter && enter.type !== 'none') {
    const enterEnd = region.startMs + enter.durationMs;
    if (timeMs >= region.startMs && timeMs < enterEnd) {
      const progress = (timeMs - region.startMs) / enter.durationMs;
      return computeTransitionForProgress(progress, enter, false);
    }
  }

  // Check exit transition
  if (exit && exit.type !== 'none') {
    const exitStart = region.endMs - exit.durationMs;
    if (timeMs >= exitStart && timeMs <= region.endMs) {
      const progress = (timeMs - exitStart) / exit.durationMs;
      return computeTransitionForProgress(progress, exit, true);
    }
  }

  return { ...IDENTITY_STATE };
}
