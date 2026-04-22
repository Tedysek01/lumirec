import { useState, useEffect, useCallback, useRef } from "react";
import { useTimelineContext } from "dnd-timeline";
import type { VideoSegment, SpotlightRegion } from "../types";
import { getUniqueKeyframeTimes, getUniquePanPointTimes, getUniqueManualKeyframeTimes, getUniqueSpotlightPointTimes } from "@/lib/keyframeInterpolation";
import { sourceToDisplayTime } from "@/lib/segmentUtils";

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
  /** Video segments — needed for source-to-display time mapping in spotlight mode */
  videoSegments?: VideoSegment[];
}

/**
 * Renders gold diamond markers grouped by unique time within a video segment's timeline region.
 * Supports click-to-select, drag-to-move, and right-click-to-delete.
 *
 * Wrapped in a div with pointer-events:none so that only the individual
 * diamond hit-targets capture mouse events — preventing interference
 * with timeline panning, seeking, and DnD.
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
  // treating the gesture as a drag. Without this, any pixel of jitter during
  // a plain click moves the keyframe and the user never gets a clean selection.
  const dragStartRef = useRef<{ x: number; active: boolean } | null>(null);
  const DRAG_THRESHOLD_PX = 4;

  // --- Spotlight mode: render diamonds for spotlight keyframes ---
  const isSpotlightMode = filter === 'spotlight';

  // Build spotlight keyframe display entries: [{displayTimeMs, spotlightId, relTimeMs}]
  const spotlightEntries = isSpotlightMode && spotlightRegions
    ? spotlightRegions.flatMap(spot => {
        const pointTimes = getUniqueSpotlightPointTimes(spot.keyframes);
        return pointTimes.map(relTime => {
          // Convert spotlight-relative time to source time, then to display time
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
    ? [] // Spotlight mode uses spotlightEntries instead
    : filter === 'zoom'
      ? getUniquePanPointTimes(keyframes)
      : filter === 'manual'
        ? getUniqueManualKeyframeTimes(keyframes)
        : getUniqueKeyframeTimes(keyframes);

  // Diamond color: purple for spotlight, cyan for zoom, gold for manual/all
  const diamondColor = isSpotlightMode ? '#8B5CF6' : filter === 'zoom' ? '#06b6d4' : '#ffe100';
  const segmentDurationMs = segment.sourceEndMs - segment.sourceStartMs;

  // Drag-to-move handler
  useEffect(() => {
    if (draggingTime === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !onMoveKeyframesAtTime) return;

      // Don't move the keyframe until the mouse has traveled past the drag
      // threshold. Plain clicks produce 1-3px of natural jitter — without
      // this guard every click silently shifts the keyframe a few ms.
      const startInfo = dragStartRef.current;
      if (startInfo && !startInfo.active) {
        if (Math.abs(e.clientX - startInfo.x) < DRAG_THRESHOLD_PX) return;
        startInfo.active = true;
        document.body.style.cursor = 'ew-resize';
      }

      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;
      const relativeMs = pixelsToValue(clickX);
      const absoluteMs = range.start + relativeMs;

      // Convert display time to segment-relative time
      const relativeToSegment = absoluteMs - segment.timelineStartMs;
      const clampedRelative = Math.max(0, Math.min(relativeToSegment, segmentDurationMs));

      onMoveKeyframesAtTime(segment.id, draggingTime, Math.round(clampedRelative));
      setDraggingTime(Math.round(clampedRelative));
    };

    const handleMouseUp = () => {
      setDraggingTime(null);
      dragStartRef.current = null;
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    // Cursor only becomes ew-resize once the drag threshold is crossed,
    // so a plain click keeps the normal cursor.

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

  // Spotlight mode renders from spotlightEntries, regular mode from uniqueTimes
  if (isSpotlightMode ? spotlightEntries.length === 0 : uniqueTimes.length === 0) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
      {isSpotlightMode
        ? spotlightEntries.map((entry) => {
            const { displayTimeMs, spotlightId, sourceTimeMs } = entry;
            if (displayTimeMs < range.start || displayTimeMs > range.end) return null;

            const offset = valueToPixels(displayTimeMs - range.start);

            return (
              <div
                key={`kf-spot-${spotlightId}-${entry.relTimeMs}`}
                className="absolute cursor-pointer"
                style={{
                  left: `${offset - 5}px`,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 40,
                  pointerEvents: 'auto',
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  // Snap playhead to spotlight keyframe's source time
                  if (onSeek) {
                    onSeek(sourceTimeMs / 1000);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                title={`Spotlight point @ ${Math.round(entry.relTimeMs)}ms`}
              >
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    background: diamondColor,
                    transform: 'rotate(45deg)',
                    opacity: 0.85,
                    transition: 'opacity 0.15s',
                  }}
                />
              </div>
            );
          })
        : uniqueTimes.map((timeMs) => {
            // Convert segment-relative time to display timeline time
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
                  // Always snap the playhead to the keyframe's exact source time
                  // on mousedown. Previously this only fired on re-select, so a
                  // click that stayed selected left the playhead on the click-X
                  // pixel a few ms off the keyframe.
                  if (onSeek) {
                    const sourceTimeSec = (segment.sourceStartMs + timeMs) / 1000;
                    onSeek(sourceTimeSec);
                  }
                  dragStartRef.current = { x: e.clientX, active: false };
                  setDraggingTime(timeMs);
                }}
                // Swallow the click event so it doesn't bubble up and hit the
                // Timeline's handleTimelineClick, which would clear selection
                // and re-seek to the pixel the click landed on.
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
