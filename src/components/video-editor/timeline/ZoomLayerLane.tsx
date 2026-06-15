import { useCallback, useEffect, useRef, useState } from "react";
import { useTimelineContext } from "dnd-timeline";
import { ZoomIn, Move } from "lucide-react";
import type { ZoomRegion, ZoomLayer, VideoSegment } from "../types";
import { sourceToDisplayTime, displayToSourceTime } from "@/lib/segmentUtils";
import { BASE_ZOOM_ROW_H, LAYER_LANE_H } from "./zoomLayerLayout";

interface ZoomLayerLaneProps {
  regions: ZoomRegion[];
  videoSegments: VideoSegment[];
  selectedLayerId: string | null;
  onSelectLayer: (regionId: string, layerId: string) => void;
  onMoveLayer: (regionId: string, layerId: string, newStartMs: number) => void;
  onResizeLayer: (regionId: string, layerId: string, startMs: number, endMs: number) => void;
  onDeleteLayer: (regionId: string, layerId: string) => void;
  timelineRef: React.RefObject<HTMLDivElement | null>;
}

type DragMode = 'move' | 'resize-l' | 'resize-r';
const EDGE_PX = 8;
const MIN_LAYER_MS = 50;
const BAR_H = 18;
const GROUP_COLOR = '#3b82f6';

const KIND_COLOR: Record<ZoomLayer['kind'], string> = {
  zoom: '#22c55e',
  position: '#a855f7',
};

function layerLabel(layer: ZoomLayer): string {
  if (layer.kind === 'zoom') {
    const d = layer.zoomDelta ?? 0;
    return `${d >= 0 ? '+' : ''}${d.toFixed(2)}×`;
  }
  const dx = Math.round((layer.focusDx ?? 0) * 100);
  const dy = Math.round((layer.focusDy ?? 0) * 100);
  return `${dx >= 0 ? '+' : ''}${dx} / ${dy >= 0 ? '+' : ''}${dy}`;
}

/** A region-relative time -> absolute display X offset (px from range start). */
function relToOffset(
  region: ZoomRegion,
  relMs: number,
  videoSegments: VideoSegment[],
  rangeStart: number,
  valueToPixels: (v: number) => number,
): number {
  const sourceMs = region.startMs + relMs;
  const displayMs = videoSegments.length > 0 ? sourceToDisplayTime(videoSegments, sourceMs) : sourceMs;
  return valueToPixels(displayMs - rangeStart);
}

/**
 * Always-visible stacked sub-lanes for every zoom region's layers. Each layer
 * is an independently draggable / resizable bar living in its region's x-span,
 * stacked beneath the base band. No selection gate — all layers are always
 * visible, the way the Video/Trim tracks are.
 */
export default function ZoomLayerLane({
  regions,
  videoSegments,
  selectedLayerId,
  onSelectLayer,
  onMoveLayer,
  onResizeLayer,
  onDeleteLayer,
  timelineRef,
}: ZoomLayerLaneProps) {
  const { sidebarWidth, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const [drag, setDrag] = useState<{ regionId: string; layerId: string; mode: DragMode; start: ZoomLayer; grabOffsetMs: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const relAtClientX = useCallback((clientX: number, regionStartMs: number): number => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left - sidebarWidth;
    const displayMs = range.start + pixelsToValue(clickX);
    const sourceMs = videoSegments.length > 0 ? displayToSourceTime(videoSegments, displayMs) : displayMs;
    return Math.round(sourceMs - regionStartMs);
  }, [timelineRef, sidebarWidth, range.start, pixelsToValue, videoSegments]);

  useEffect(() => {
    if (!drag) return;
    const region = regions.find((r) => r.id === drag.regionId);
    if (!region) return;
    const regionStart = region.startMs;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const relMs = relAtClientX(e.clientX, regionStart);
      if (d.mode === 'move') {
        onMoveLayer(d.regionId, d.layerId, relMs - d.grabOffsetMs);
      } else if (d.mode === 'resize-l') {
        onResizeLayer(d.regionId, d.layerId, Math.min(relMs, d.start.endMs - MIN_LAYER_MS), d.start.endMs);
      } else {
        onResizeLayer(d.regionId, d.layerId, d.start.startMs, Math.max(relMs, d.start.startMs + MIN_LAYER_MS));
      }
    };
    const onUp = () => {
      setDrag(null);
      document.body.style.cursor = '';
      delete document.body.dataset.kfDragging;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, regions, relAtClientX, onMoveLayer, onResizeLayer]);

  const anyLayers = regions.some((r) => (r.layers?.length ?? 0) > 0);
  if (!anyLayers) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {regions.flatMap((region) => {
        const layers = region.layers ?? [];
        if (layers.length === 0) return [];

        const groupLeft = relToOffset(region, 0, videoSegments, range.start, valueToPixels);
        const groupRight = relToOffset(region, region.endMs - region.startMs, videoSegments, range.start, valueToPixels);
        const groupWidth = Math.max(2, groupRight - groupLeft);

        const nodes: React.ReactNode[] = [];
        // grouping frame ties a region's layers to it visually
        nodes.push(
          <div
            key={`grp-${region.id}`}
            style={{
              position: 'absolute',
              left: `${groupLeft}px`,
              width: `${groupWidth}px`,
              top: `${BASE_ZOOM_ROW_H - 2}px`,
              height: `${layers.length * LAYER_LANE_H + 2}px`,
              border: `1px dashed ${GROUP_COLOR}44`,
              borderTop: 'none',
              borderRadius: '0 0 8px 8px',
              background: `${GROUP_COLOR}08`,
            }}
          />,
        );

        layers.forEach((layer, i) => {
          const left = relToOffset(region, layer.startMs, videoSegments, range.start, valueToPixels);
          const right = relToOffset(region, layer.endMs, videoSegments, range.start, valueToPixels);
          const width = Math.max(10, right - left);
          const color = KIND_COLOR[layer.kind];
          const isSelected = layer.id === selectedLayerId;
          const barTop = BASE_ZOOM_ROW_H + i * LAYER_LANE_H + (LAYER_LANE_H - BAR_H) / 2;
          nodes.push(
            <div
              key={layer.id}
              className="group absolute"
              style={{
                left: `${left}px`,
                width: `${width}px`,
                top: `${barTop}px`,
                height: `${BAR_H}px`,
                background: `linear-gradient(${color}3a, ${color}24)`,
                border: `1px solid ${isSelected ? color : `${color}cc`}`,
                borderRadius: '6px',
                boxShadow: isSelected ? `0 0 0 1.5px #fff, 0 2px 8px ${color}66` : '0 1px 3px rgba(0,0,0,0.35)',
                pointerEvents: 'auto',
                cursor: 'grab',
                color: '#fff',
                userSelect: 'none',
                overflow: 'hidden',
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                const barRect = e.currentTarget.getBoundingClientRect();
                const localX = e.clientX - barRect.left;
                const mode: DragMode = localX < EDGE_PX ? 'resize-l' : localX > barRect.width - EDGE_PX ? 'resize-r' : 'move';
                onSelectLayer(region.id, layer.id);
                const grabRel = relAtClientX(e.clientX, region.startMs);
                setDrag({ regionId: region.id, layerId: layer.id, mode, start: layer, grabOffsetMs: grabRel - layer.startMs });
                document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
                document.body.dataset.kfDragging = '1';
              }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteLayer(region.id, layer.id); }}
              title={`${layer.kind === 'zoom' ? 'Zoom' : 'Posun'} vrstva — táhni = posun, okraje = délka, pravý klik = smazat`}
            >
              <div
                className="absolute left-0 top-0 h-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ width: EDGE_PX, background: color, pointerEvents: 'none' }}
              />
              <div
                className="absolute right-0 top-0 h-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ width: EDGE_PX, background: color, pointerEvents: 'none' }}
              />
              <div className="flex items-center gap-1 h-full px-1.5" style={{ pointerEvents: 'none' }}>
                {layer.kind === 'zoom'
                  ? <ZoomIn className="w-3 h-3 flex-shrink-0 opacity-90" />
                  : <Move className="w-3 h-3 flex-shrink-0 opacity-90" />}
                <span className="text-[10px] font-semibold tracking-tight truncate">{layerLabel(layer)}</span>
              </div>
            </div>,
          );
        });
        return nodes;
      })}
    </div>
  );
}
