import { useState, useEffect, useCallback, useRef } from "react";
import { useTimelineContext } from "dnd-timeline";
import type { VideoSegment, SpotlightRegion } from "../types";
import { getUniqueKeyframeTimes, getUniqueManualKeyframeTimes, getUniqueSpotlightPointTimes } from "@/lib/keyframeInterpolation";
import { sourceToDisplayTime } from "@/lib/segmentUtils";

type KeyframeFilter = 'manual' | 'spotlight' | 'all';

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
  /** Video segments — needed for source↔display time mapping in spotlight mode */
  videoSegments?: VideoSegment[];
}

/**
 * Renders diamond markers on the timeline.
 *  - filter="manual"/"all": gold diamonds from a segment's manual keyframes.
 *  - filter="spotlight":    purple diamonds from spotlight keyframes.
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
  videoSegments,
}: KeyframeTrackProps) {
  const { sidebarWidth, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const [draggingTime, setDraggingTime] = useState<number | null>(null);
  // Track where the mouse went down so we can require real movement before
  // treating the gesture as a drag (avoids click jitter shifting keyframes).
  const dragStartRef = useRef<{ x: number; active: boolean } | null>(null);
  const DRAG_THRESHOLD_PX = 4;

  const isSpotlightMode = filter === 'spotlight';

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

  const keyframes = segment.keyframes ?? [];
  const uniqueTimes = isSpotlightMode
    ? []
    : filter === 'manual'
      ? getUniqueManualKeyframeTimes(keyframes)
      : getUniqueKeyframeTimes(keyframes);

  const diamondColor = isSpotlightMode ? '#8B5CF6' : '#ffe100';
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

  const handleContextMenu = useCallback((e: React.MouseEvent, timeMs: number) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteKeyframesAtTime?.(segment.id, timeMs);
  }, [segment.id, onDeleteKeyframesAtTime]);

  const isEmpty = isSpotlightMode ? spotlightEntries.length === 0 : uniqueTimes.length === 0;
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

      {!isSpotlightMode && uniqueTimes.map((timeMs) => {
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
