import { useCallback, useEffect, useRef, useState } from "react";
import { useTimelineContext } from "dnd-timeline";
import type { ZoomRegion, ZoomLayer, VideoSegment } from "../types";
import { sourceToDisplayTime, displayToSourceTime } from "@/lib/segmentUtils";

interface ZoomLayerLaneProps {
  region: ZoomRegion;
  videoSegments: VideoSegment[];
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  onMoveLayer: (regionId: string, layerId: string, newStartMs: number) => void;
  onResizeLayer: (regionId: string, layerId: string, startMs: number, endMs: number) => void;
  onDeleteLayer: (regionId: string, layerId: string) => void;
  timelineRef: React.RefObject<HTMLDivElement | null>;
}

type DragMode = 'move' | 'resize-l' | 'resize-r';
const EDGE_PX = 6;
const MIN_LAYER_MS = 50;

const KIND_COLOR: Record<ZoomLayer['kind'], string> = {
  zoom: '#22c55e',
  position: '#a855f7',
};

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

export default function ZoomLayerLane({
  region,
  videoSegments,
  selectedLayerId,
  onSelectLayer,
  onMoveLayer,
  onResizeLayer,
  onDeleteLayer,
  timelineRef,
}: ZoomLayerLaneProps) {
  const { sidebarWidth, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const [drag, setDrag] = useState<{ layerId: string; mode: DragMode; start: ZoomLayer; grabOffsetMs: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const relAtClientX = useCallback((clientX: number): number => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left - sidebarWidth;
    const displayMs = range.start + pixelsToValue(clickX);
    const sourceMs = videoSegments.length > 0 ? displayToSourceTime(videoSegments, displayMs) : displayMs;
    return Math.round(sourceMs - region.startMs);
  }, [timelineRef, sidebarWidth, range.start, pixelsToValue, videoSegments, region.startMs]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const relMs = relAtClientX(e.clientX);
      if (d.mode === 'move') {
        onMoveLayer(region.id, d.layerId, relMs - d.grabOffsetMs);
      } else if (d.mode === 'resize-l') {
        onResizeLayer(region.id, d.layerId, Math.min(relMs, d.start.endMs - MIN_LAYER_MS), d.start.endMs);
      } else {
        onResizeLayer(region.id, d.layerId, d.start.startMs, Math.max(relMs, d.start.startMs + MIN_LAYER_MS));
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
  }, [drag, region.id, relAtClientX, onMoveLayer, onResizeLayer]);

  const layers = region.layers ?? [];
  if (layers.length === 0) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
      {layers.map((layer, i) => {
        const left = relToOffset(region, layer.startMs, videoSegments, range.start, valueToPixels);
        const right = relToOffset(region, layer.endMs, videoSegments, range.start, valueToPixels);
        const width = Math.max(2, right - left);
        const color = KIND_COLOR[layer.kind];
        const isSelected = layer.id === selectedLayerId;
        const label = layer.kind === 'zoom'
          ? `${(layer.zoomDelta ?? 0) >= 0 ? '+' : ''}${(layer.zoomDelta ?? 0).toFixed(2)}×`
          : 'posun';
        return (
          <div
            key={layer.id}
            className="absolute"
            style={{
              left: `${left}px`,
              width: `${width}px`,
              top: `${4 + i * 22}px`,
              height: '18px',
              background: `${color}33`,
              border: `1px solid ${color}`,
              borderRadius: '5px',
              boxShadow: isSelected ? `0 0 0 1.5px white, 0 0 6px ${color}99` : 'none',
              pointerEvents: 'auto',
              cursor: 'grab',
              fontSize: '10px',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              const barRect = e.currentTarget.getBoundingClientRect();
              const localX = e.clientX - barRect.left;
              const mode: DragMode = localX < EDGE_PX ? 'resize-l' : localX > barRect.width - EDGE_PX ? 'resize-r' : 'move';
              onSelectLayer(layer.id);
              // grab offset: where inside the layer the user grabbed, so a move
              // translates the bar instead of snapping its left edge to the cursor
              const grabRel = relAtClientX(e.clientX);
              setDrag({ layerId: layer.id, mode, start: layer, grabOffsetMs: grabRel - layer.startMs });
              document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
              document.body.dataset.kfDragging = '1';
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteLayer(region.id, layer.id); }}
            title={`${layer.kind} layer (drag to move, edges to resize, right-click to delete)`}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}
