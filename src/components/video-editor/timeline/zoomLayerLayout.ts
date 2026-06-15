import type { ZoomRegion } from "../types";

/** Height of the base-region band at the top of the zoom row. */
export const BASE_ZOOM_ROW_H = 44;
/** Height of each stacked layer sub-lane beneath the base band. */
export const LAYER_LANE_H = 26;

/** Largest layer count across all regions — drives the zoom row height. */
export function maxLayerRows(regions: ZoomRegion[]): number {
  return regions.reduce((m, r) => Math.max(m, r.layers?.length ?? 0), 0);
}

/** Total zoom-row height needed to always show every region's stacked layers. */
export function zoomRowHeight(regions: ZoomRegion[]): number {
  return BASE_ZOOM_ROW_H + maxLayerRows(regions) * LAYER_LANE_H;
}
