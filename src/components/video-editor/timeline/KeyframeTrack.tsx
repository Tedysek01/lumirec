import { useState, useEffect, useCallback, useRef } from "react";
import { useTimelineContext } from "dnd-timeline";
import type { VideoSegment, SpotlightRegion, ZoomRegion } from "../types";
import { getUniqueKeyframeTimes, getUniqueManualKeyframeTimes, getUniqueSpotlightPointTimes } from "@/lib/keyframeInterpolation";
import { sourceToDisplayTime, displayToSourceTime } from "@/lib/segmentUtils";

type KeyframeFilter = 'zoom' | 'manual' | 'spotlight' | 'all';

interface KeyframeTrackProps {
  segment: VideoSegment;
  selectedKeyframeTime: number | null;
  onSelectKeyframeTime: (timeMs: number | null) => void;
  onDeleteKeyframesAtTime?: (segmentId: string, timeMs: number) => void;
  onMoveKeyframesAtTime?: (segmentId: string, oldTimeMs: number, newTimeMs: number) => void;
  /** Seek the playhead to a source time in seconds. Called when a diamond is clicked. */
  onSeek?: (timeInSeconds: number) => void;
  videoDurationMs: number;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  filter?: KeyframeFilter;
  /** Spotlight regions — used when filter="spotlight" to render spotlight keyframe diamonds */
  spotlightRegions?: SpotlightRegion[];
  /** Zoom regions — used when filter="zoom" to render pan-point diamonds (single source of truth) */
  zoomRegions?: ZoomRegion[];
  /** Video segments — needed for source↔display time mapping in zoom/spotlight modes */
  videoSegments?: VideoSegment[];
  // --- Zoom pan-point editing (region-based) ---
  onMoveZoomPanPoint?: (regionId: string, oldRelTimeMs: number, newRelTimeMs: number) => void;
  onDeleteZoomPanPoint?: (regionId: string, relTimeMs: number) => void;
  clampZoomPanPointTime?: (regionId: string, relTimeMs: number) => number;
}

/**
 * Renders diamond markers on the timeline.
 *  - filter="manual"/"all": gold diamonds from a segment's manual keyframes.
 *  - filter="spotlight":    purple diamonds from spotlight keyframes.
 *  - filter="zoom":         cyan diamonds from zoom-region pan points (the
 *                           region is the single source of truth; there are no
 *                           zoom keyframes anymore).
 *
 * Wrapped in a pointer-events:none div so only the diamond hit-targets capture
 * mouse events, leaving timeline panning/seeking/DnD untouched.
 */
export default function KeyframeTrack({
  segment,
  selectedKeyframeTime,
  onSelectKeyframeTime,
  onDeleteKeyframesAtTime,
  onMoveKeyframesAtTime,
  onSeek,
  videoDurationMs: _videoDurationMs,
  timelineRef,
  filter = 'all',
  spotlightRegions,
  zoomRegions,
  videoSegments,
  onMoveZoomPanPoint,
  onDeleteZoomPanPoint,
  clampZoomPanPointTime,
}: KeyframeTrackProps) {
  const { sidebarWidth, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const [draggingTime, setDraggingTime] = useState<number | null>(null);
  // Zoom pan-point drag state: which region + the current (region-relative) time.
  const [draggingPan, setDraggingPan] = useState<{ regionId: string; relTimeMs: number } | null>(null);
  // Track where the mouse went down so we can require real movement before
  // treating the gesture as a drag (avoids click jitter shifting keyframes).
  const dragStartRef = useRef<{ x: number; active: boolean } | null>(null);
  const DRAG_THRESHOLD_PX = 4;

  const isSpotlightMode = filter === 'spotlight';
  const isZoomMode = filter === 'zoom';

  // Build spotlight keyframe display entries.
  const spotlightEntries = isSpotlightMode && spotlightRegions
    ? spotlightRegions.flatMap(spot => {
        const pointTimes = getUniqueSpotlightPointTimes(spot.keyframes);
        return pointTimes.map(relTime => {
          const sourceTimeMs = spot.startMs + relTime;
          const displayTimeMs = videoSegments && videoSegments.length > 0
            ? sourceToDisplayTime(videoSegments, sourceTimeMs)
            : sourceTimeMs;
          return { displayTimeMs, spotlightId: spot.id, relTimeMs: relTime, sourceTimeMs };
        });
      })
    : [];

  // Build zoom pan-point display entries from regions (single source of truth).
  const zoomEntries = isZoomMode && zoomRegions
    ? zoomRegions.flatMap(region =>
        (region.panPoints ?? []).map(p => {
          const sourceTimeMs = region.startMs + p.timeMs;
          const displayTimeMs = videoSegments && videoSegments.length > 0
            ? sourceToDisplayTime(videoSegments, sourceTimeMs)
            : sourceTimeMs;
          return { displayTimeMs, regionId: region.id, relTimeMs: p.timeMs, panId: p.id, sourceTimeMs };
        }),
      )
    : [];

  const keyframes = segment.keyframes ?? [];
  const uniqueTimes = isSpotlightMode || isZoomMode
    ? []
    : filter === 'manual'
      ? getUniqueManualKeyframeTimes(keyframes)
      : getUniqueKeyframeTimes(keyframes);

  const diamondColor = isSpotlightMode ? '#8B5CF6' : isZoomMode ? '#06b6d4' : '#ffe100';
  const segmentDurationMs = segment.sourceEndMs - segment.sourceStartMs;

  // --- Manual/all drag-to-move (segment-relative) ---
  useEffect(() => {
    if (draggingTime === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !onMoveKeyframesAtTime) return;
      const startInfo = dragStartRef.current;
      if (startInfo && !startInfo.active) {
        if (Math.abs(e.clientX - startInfo.x) < DRAG_THRESHOLD_PX) return;
        startInfo.active = true;
        document.body.style.cursor = 'ew-resize';
      }
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;
      const absoluteMs = range.start + pixelsToValue(clickX);
      const relativeToSegment = absoluteMs - segment.timelineStartMs;
      const clampedRelative = Math.round(Math.max(0, Math.min(relativeToSegment, segmentDurationMs)));
      onMoveKeyframesAtTime(segment.id, draggingTime, clampedRelative);
      setDraggingTime(clampedRelative);
    };
    const handleMouseUp = () => {
      setDraggingTime(null);
      dragStartRef.current = null;
      document.body.style.cursor = '';
      delete document.body.dataset.kfDragging;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [draggingTime, onMoveKeyframesAtTime, timelineRef, sidebarWidth, range.start, segment.id, segment.timelineStartMs, segmentDurationMs, pixelsToValue]);

  // --- Zoom pan-point drag-to-move (region-relative) ---
  useEffect(() => {
    if (draggingPan === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !onMoveZoomPanPoint || !zoomRegions) return;
      const region = zoomRegions.find(r => r.id === draggingPan.regionId);
      if (!region) return;
      const startInfo = dragStartRef.current;
      if (startInfo && !startInfo.active) {
        if (Math.abs(e.clientX - startInfo.x) < DRAG_THRESHOLD_PX) return;
        startInfo.active = true;
        document.body.style.cursor = 'ew-resize';
      }
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;
      const displayMs = range.start + pixelsToValue(clickX);
      // display → source → region-relative
      const sourceMs = videoSegments && videoSegments.length > 0
        ? displayToSourceTime(videoSegments, displayMs)
        : displayMs;
      const rawRel = sourceMs - region.startMs;
      const finalRel = clampZoomPanPointTime
        ? Math.round(clampZoomPanPointTime(region.id, Math.round(rawRel)))
        : Math.round(rawRel);
      onMoveZoomPanPoint(region.id, draggingPan.relTimeMs, finalRel);
      setDraggingPan({ regionId: region.id, relTimeMs: finalRel });
    };
    const handleMouseUp = () => {
      setDraggingPan(null);
      dragStartRef.current = null;
      document.body.style.cursor = '';
      delete document.body.dataset.kfDragging;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [draggingPan, onMoveZoomPanPoint, clampZoomPanPointTime, zoomRegions, videoSegments, timelineRef, sidebarWidth, range.start, pixelsToValue]);

  const handleContextMenu = useCallback((e: React.MouseEvent, timeMs: number) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteKeyframesAtTime?.(segment.id, timeMs);
  }, [segment.id, onDeleteKeyframesAtTime]);

  const isEmpty = isSpotlightMode
    ? spotlightEntries.length === 0
    : isZoomMode
      ? zoomEntries.length === 0
      : uniqueTimes.length === 0;
  if (isEmpty) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
      {isSpotlightMode && spotlightEntries.map((entry) => {
        const { displayTimeMs, spotlightId, sourceTimeMs } = entry;
        if (displayTimeMs < range.start || displayTimeMs > range.end) return null;
        const offset = valueToPixels(displayTimeMs - range.start);
        return (
          <div
            key={`kf-spot-${spotlightId}-${entry.relTimeMs}`}
            className="absolute cursor-pointer"
            style={{ left: `${offset - 5}px`, top: '50%', transform: 'translateY(-50%)', zIndex: 40, pointerEvents: 'auto' }}
            onMouseDown={(e) => { e.stopPropagation(); if (onSeek) onSeek(sourceTimeMs / 1000); }}
            onClick={(e) => e.stopPropagation()}
            title={`Spotlight point @ ${Math.round(entry.relTimeMs)}ms`}
          >
            <div style={{ width: '10px', height: '10px', background: diamondColor, transform: 'rotate(45deg)', opacity: 0.85, transition: 'opacity 0.15s' }} />
          </div>
        );
      })}

      {isZoomMode && zoomEntries.map((entry) => {
        const { displayTimeMs, regionId, relTimeMs, panId, sourceTimeMs } = entry;
        if (displayTimeMs < range.start || displayTimeMs > range.end) return null;
        const offset = valueToPixels(displayTimeMs - range.start);
        const isDragging = draggingPan !== null && draggingPan.regionId === regionId && Math.abs(draggingPan.relTimeMs - relTimeMs) < 1;
        return (
          <div
            key={`kf-pan-${panId}`}
            className="absolute cursor-grab active:cursor-grabbing"
            style={{
              left: `${offset - 5}px`,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 40,
              pointerEvents: 'auto',
              transition: isDragging ? 'none' : 'left 0.1s ease-out',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (onSeek) onSeek(sourceTimeMs / 1000);
              dragStartRef.current = { x: e.clientX, active: false };
              setDraggingPan({ regionId, relTimeMs });
              // Lock timeline wheel-pan/zoom during the drag (see TimelineWrapper).
              document.body.dataset.kfDragging = '1';
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteZoomPanPoint?.(regionId, relTimeMs); }}
            title={`Pan point @ ${Math.round(relTimeMs)}ms (drag to move, right-click to remove)`}
          >
            <div style={{ width: '10px', height: '10px', background: diamondColor, transform: 'rotate(45deg)', opacity: 0.8, transition: 'opacity 0.15s' }} />
          </div>
        );
      })}

      {!isSpotlightMode && !isZoomMode && uniqueTimes.map((timeMs) => {
        const displayTimeMs = segment.timelineStartMs + timeMs;
        if (displayTimeMs < range.start || displayTimeMs > range.end) return null;
        const offset = valueToPixels(displayTimeMs - range.start);
        const isSelected = selectedKeyframeTime !== null && Math.abs(selectedKeyframeTime - timeMs) < 1;
        const isDragging = draggingTime !== null && Math.abs(draggingTime - timeMs) < 1;
        return (
          <div
            key={`kf-${segment.id}-${timeMs}`}
            className="absolute cursor-grab active:cursor-grabbing"
            style={{
              left: `${offset - 5}px`,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: isSelected ? 50 : 40,
              pointerEvents: 'auto',
              transition: isDragging ? 'none' : 'left 0.1s ease-out',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onSelectKeyframeTime(timeMs);
              if (onSeek) onSeek((segment.sourceStartMs + timeMs) / 1000);
              dragStartRef.current = { x: e.clientX, active: false };
              setDraggingTime(timeMs);
              document.body.dataset.kfDragging = '1';
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => handleContextMenu(e, timeMs)}
            title={`Keyframe @ ${Math.round(timeMs)}ms (drag to move, Delete to remove)`}
          >
            <div
              style={{
                width: '10px',
                height: '10px',
                background: diamondColor,
                transform: 'rotate(45deg)',
                border: isSelected ? '1.5px solid white' : 'none',
                boxShadow: isSelected ? `0 0 6px ${diamondColor}99` : 'none',
                opacity: isSelected ? 1 : 0.7,
                transition: 'opacity 0.15s, box-shadow 0.15s',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
