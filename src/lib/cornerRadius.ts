/**
 * Corner-rounding model for the video sprite.
 *
 * Historically the "Roundness" slider value was applied as an absolute number
 * of screen pixels. That had two problems:
 *   1. It collapsed on tight crops — the radius was clamped to half the smaller
 *      side of the cropped frame, so cropping to a thin strip shrank the
 *      rounding toward zero ("rounding disappears after crop").
 *   2. It was resolution-dependent — the same value looked different at preview
 *      vs export sizes, requiring an extra canvas-ratio fudge factor.
 *
 * The radius is now interpreted as a *fraction of the displayed frame's
 * shorter side*. This keeps the corner visually consistent regardless of crop,
 * zoom-to-fit scale, or export resolution. Both the live preview
 * (layoutUtils) and the exporter (frameRenderer) must use this single helper
 * so the output matches the editor exactly.
 */

/** Multiplier mapping the slider/stored roundness value to a frame fraction. */
export const ROUNDNESS_TO_FRACTION = 1 / 200;

/** Hard cap so corners never exceed a pill on the shorter side. */
export const MAX_ROUNDNESS_FRACTION = 0.5;

/** Sensible default rounding applied out of the box to new/loaded projects. */
export const DEFAULT_ROUNDNESS = 16;

/**
 * Resolve the corner radius (in the same pixel space as `displayWidth` /
 * `displayHeight`) for a given roundness value and displayed frame size.
 *
 * @param roundness     The "Roundness" value (slider/stored), 0..n.
 * @param displayWidth  Displayed width of the (cropped) frame, in target px.
 * @param displayHeight Displayed height of the (cropped) frame, in target px.
 */
export function resolveCornerRadius(
  roundness: number,
  displayWidth: number,
  displayHeight: number,
): number {
  if (!roundness || roundness <= 0) return 0;
  const minSide = Math.min(displayWidth, displayHeight);
  if (minSide <= 0) return 0;
  const fraction = Math.min(roundness * ROUNDNESS_TO_FRACTION, MAX_ROUNDNESS_FRACTION);
  // Final safety clamp to half the shorter side (prevents PixiJS artifacts).
  return Math.max(0, Math.min(fraction * minSide, minSide / 2));
}
