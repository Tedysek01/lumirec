import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTimelineContext } from "dnd-timeline";
import { Button } from "@/components/ui/button";
import { Plus, Scissors, ZoomIn, MessageSquare, Lightbulb, ChevronDown, Check, MousePointer2, Film, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import TimelineWrapper from "./TimelineWrapper";
import Row from "./Row";
import Item from "./Item";
import VideoSegmentItem from "./VideoSegmentItem";
import KeyframeTrack from "./KeyframeTrack";
import ZoomLayerLane from "./ZoomLayerLane";
import TrackLabel from "./TrackLabel";
import WaveformRow from "./WaveformRow";
import type { Range, Span } from "dnd-timeline";
import type { ZoomRegion, TrimRegion, AnnotationRegion, VideoSegment, SpotlightRegion } from "../types";
import { extractThumbnails, type ThumbnailFrame } from "@/lib/thumbnailExtractor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AspectRatio, getAspectRatioLabel, ASPECT_RATIOS } from "@/utils/aspectRatioUtils";
import { formatShortcut } from "@/utils/platformUtils";
import { TutorialHelp } from "../TutorialHelp";
import { AutoZoomPopover } from "../AutoZoomPopover";
import { AutoSpotlightPopover } from "../AutoSpotlightPopover";
import type { CursorFrame } from "@/lib/cursorTracker";
import { getTotalTimelineDuration, sourceToDisplayTime, displayToSourceTime } from "@/lib/segmentUtils";
import { isEditableTarget } from "@/lib/isEditableTarget";

const VIDEO_ROW_ID = "row-video";
const ZOOM_ROW_ID = "row-zoom";
const TRIM_ROW_ID = "row-trim";
const ANNOTATION_ROW_ID = "row-annotation";
const SPOTLIGHT_ROW_ID = "row-spotlight";
const AUDIO_ROW_ID = "row-audio";
const TRACK_LABEL_WIDTH = 120;

const TRACK_HEIGHTS: Record<string, number> = {
  [VIDEO_ROW_ID]: 52,
  [ZOOM_ROW_ID]: 44,
  [SPOTLIGHT_ROW_ID]: 44,
  [TRIM_ROW_ID]: 44,
  [ANNOTATION_ROW_ID]: 44,
  [AUDIO_ROW_ID]: 36,
};

const FALLBACK_RANGE_MS = 1000;
const TARGET_MARKER_COUNT = 12;

interface TimelineEditorProps {
  videoDuration: number;
  currentTime: number;
  onSeek?: (time: number) => void;
  zoomRegions: ZoomRegion[];
  onZoomAdded: (span: Span) => void;
  onZoomSpanChange: (id: string, span: Span) => void;
  onZoomDelete: (id: string) => void;
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  trimRegions?: TrimRegion[];
  onTrimAdded?: (span: Span) => void;
  onTrimSpanChange?: (id: string, span: Span) => void;
  onTrimDelete?: (id: string) => void;
  selectedTrimId?: string | null;
  onSelectTrim?: (id: string | null) => void;
  annotationRegions?: AnnotationRegion[];
  onAnnotationAdded?: (span: Span) => void;
  onAnnotationSpanChange?: (id: string, span: Span) => void;
  onAnnotationDelete?: (id: string) => void;
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  videoSegments?: VideoSegment[];
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string | null) => void;
  onSplitSegment?: (segmentId: string, sourceTimeMs: number) => void;
  onDeleteSegment?: (segmentId: string) => void;
  onSegmentSpanChange?: (segmentId: string, newSourceStart: number, newSourceEnd: number) => void;
  razorToolActive?: boolean;
  onRazorToolChange?: (active: boolean) => void;
  onRazorAtPlayhead?: () => void;
  videoPath?: string | null;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
  cursorData?: CursorFrame[];
  onAutoZoomApply?: (newRegions: ZoomRegion[], nextId: number) => void;
  nextZoomId?: number;
  spotlightRegions?: SpotlightRegion[];
  onSpotlightAdded?: (span: Span) => void;
  onSpotlightSpanChange?: (id: string, span: Span) => void;
  onSpotlightDelete?: (id: string) => void;
  selectedSpotlightId?: string | null;
  onSelectSpotlight?: (id: string | null) => void;
  onAutoSpotlightApply?: (newRegions: SpotlightRegion[], nextId: number) => void;
  nextSpotlightId?: number;
  onAddKeyframeAtPlayhead?: (segmentId: string, relativeTimeMs: number) => void;
  onDeleteKeyframesAtTime?: (segmentId: string, timeMs: number) => void;
  onMoveKeyframesAtTime?: (segmentId: string, oldTimeMs: number, newTimeMs: number) => void;
  selectedZoomLayerId: string | null;
  onSelectZoomLayer: (layerId: string | null) => void;
  onMoveZoomLayer: (regionId: string, layerId: string, newStartMs: number) => void;
  onResizeZoomLayer: (regionId: string, layerId: string, startMs: number, endMs: number) => void;
  onDeleteZoomLayer: (regionId: string, layerId: string) => void;
}

interface TimelineScaleConfig {
  intervalMs: number;
  gridMs: number;
  minItemDurationMs: number;
  defaultItemDurationMs: number;
  minVisibleRangeMs: number;
}

interface TimelineRenderItem {
  id: string;
  rowId: string;
  span: Span;
  label: string;
  zoomDepth?: number;
  variant: 'zoom' | 'trim' | 'annotation' | 'spotlight' | 'video';
}

const SCALE_CANDIDATES = [
  { intervalSeconds: 0.25, gridSeconds: 0.05 },
  { intervalSeconds: 0.5, gridSeconds: 0.1 },
  { intervalSeconds: 1, gridSeconds: 0.25 },
  { intervalSeconds: 2, gridSeconds: 0.5 },
  { intervalSeconds: 5, gridSeconds: 1 },
  { intervalSeconds: 10, gridSeconds: 2 },
  { intervalSeconds: 15, gridSeconds: 3 },
  { intervalSeconds: 30, gridSeconds: 5 },
  { intervalSeconds: 60, gridSeconds: 10 },
  { intervalSeconds: 120, gridSeconds: 20 },
  { intervalSeconds: 300, gridSeconds: 30 },
  { intervalSeconds: 600, gridSeconds: 60 },
  { intervalSeconds: 900, gridSeconds: 120 },
  { intervalSeconds: 1800, gridSeconds: 180 },
  { intervalSeconds: 3600, gridSeconds: 300 },
];

function calculateTimelineScale(durationSeconds: number): TimelineScaleConfig {
  const totalMs = Math.max(0, Math.round(durationSeconds * 1000));

  const selectedCandidate = SCALE_CANDIDATES.find((candidate) => {
    if (durationSeconds <= 0) {
      return true;
    }
    const markers = durationSeconds / candidate.intervalSeconds;
    return markers <= TARGET_MARKER_COUNT;
  }) ?? SCALE_CANDIDATES[SCALE_CANDIDATES.length - 1];

  const intervalMs = Math.round(selectedCandidate.intervalSeconds * 1000);
  const gridMs = Math.round(selectedCandidate.gridSeconds * 1000);

  // Set minItemDurationMs to 1ms for maximum granularity
  const minItemDurationMs = 1;
  const defaultItemDurationMs = Math.min(
    Math.max(minItemDurationMs, intervalMs * 2),
    totalMs > 0 ? totalMs : intervalMs * 2,
  );

  const minVisibleRangeMs = totalMs > 0
    ? Math.min(Math.max(intervalMs * 3, minItemDurationMs * 6, 1000), totalMs)
    : Math.max(intervalMs * 3, minItemDurationMs * 6, 1000);

  return {
    intervalMs,
    gridMs,
    minItemDurationMs,
    defaultItemDurationMs,
    minVisibleRangeMs,
  };
}

function createInitialRange(totalMs: number): Range {
  if (totalMs > 0) {
    return { start: 0, end: totalMs };
  }

  return { start: 0, end: FALLBACK_RANGE_MS };
}

function formatTimeLabel(milliseconds: number, intervalMs: number) {
  const totalSeconds = milliseconds / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const fractionalDigits = intervalMs < 250 ? 2 : intervalMs < 1000 ? 1 : 0;

  if (hours > 0) {
    const minutesString = minutes.toString().padStart(2, "0");
    const secondsString = Math.floor(seconds)
      .toString()
      .padStart(2, "0");
    return `${hours}:${minutesString}:${secondsString}`;
  }

  if (fractionalDigits > 0) {
    const secondsWithFraction = seconds.toFixed(fractionalDigits);
    const [wholeSeconds, fraction] = secondsWithFraction.split(".");
    return `${minutes}:${wholeSeconds.padStart(2, "0")}.${fraction}`;
  }

  return `${minutes}:${Math.floor(seconds).toString().padStart(2, "0")}`;
}

function PlaybackCursor({
  currentTimeMs,
  videoDurationMs,
  onSeek,
  timelineRef,
  videoSegments = [],
}: {
  currentTimeMs: number;
  videoDurationMs: number;
  onSeek?: (time: number) => void;
  timelineRef: React.RefObject<HTMLDivElement>;
  videoSegments?: VideoSegment[];
}) {
  const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const sideProperty = direction === "rtl" ? "right" : "left";
  const [isDragging, setIsDragging] = useState(false);

  // Derive display-time keyframe positions from real segment keyframes
  const keyframeDisplayTimes = useMemo(() => {
    const times: number[] = [];
    for (const seg of videoSegments) {
      const seen = new Set<number>();
      for (const kf of seg.keyframes) {
        if (!seen.has(kf.timeMs)) {
          seen.add(kf.timeMs);
          times.push(seg.timelineStartMs + kf.timeMs);
        }
      }
    }
    return times;
  }, [videoSegments]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !onSeek) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;

      // Allow dragging outside to 0 or max, but clamp the value
      const relativeMs = pixelsToValue(clickX);
      let absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));

      // Snap to nearby keyframe if within threshold (150ms)
      const snapThresholdMs = 150;
      for (const displayTime of keyframeDisplayTimes) {
        if (
          Math.abs(displayTime - absoluteMs) <= snapThresholdMs &&
          displayTime >= range.start &&
          displayTime <= range.end
        ) {
          absoluteMs = displayTime;
          break;
        }
      }

      // Map display time back to source time for seeking
      const sourceMs = displayToSourceTime(videoSegments, absoluteMs);
      onSeek(sourceMs / 1000);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [isDragging, onSeek, timelineRef, sidebarWidth, range.start, range.end, videoDurationMs, pixelsToValue, keyframeDisplayTimes, videoSegments]);

  if (videoDurationMs <= 0 || currentTimeMs < 0) {
    return null;
  }

  const clampedTime = Math.min(currentTimeMs, videoDurationMs);

  if (clampedTime < range.start || clampedTime > range.end) {
    return null;
  }

  const offset = valueToPixels(clampedTime - range.start);

  return (
    <div
      className="absolute top-0 bottom-0 z-50 group/cursor"
      style={{
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
        pointerEvents: 'none', // Allow clicks to pass through to timeline, but we'll enable pointer events on the handle
      }}
    >
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-primary shadow-[0_0_10px_rgba(109,213,168,0.5)] cursor-ew-resize pointer-events-auto hover:shadow-[0_0_15px_rgba(109,213,168,0.7)] transition-shadow"
        style={{
          [sideProperty]: `${offset}px`,
        }}
        onMouseDown={(e) => {
          e.stopPropagation(); // Prevent timeline click
          setIsDragging(true);
        }}
      >
        <div
          className="absolute -top-1 left-1/2 -translate-x-1/2 hover:scale-125 transition-transform"
          style={{ width: '16px', height: '16px' }}
        >
          <div className="w-3 h-3 mx-auto mt-[2px] bg-primary rotate-45 rounded-sm shadow-lg border border-white/20" />
        </div>
      </div>
    </div>
  );
}

function TimelineAxis({
  intervalMs,
  videoDurationMs,
  currentTimeMs,
}: {
  intervalMs: number;
  videoDurationMs: number;
  currentTimeMs: number;
}) {
  const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
  const sideProperty = direction === "rtl" ? "right" : "left";

  const markers = useMemo(() => {
    if (intervalMs <= 0) {
      return { markers: [], minorTicks: [] };
    }

    const maxTime = videoDurationMs > 0 ? videoDurationMs : range.end;
    const visibleStart = Math.max(0, Math.min(range.start, maxTime));
    const visibleEnd = Math.min(range.end, maxTime);
    const markerTimes = new Set<number>();

    const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;

    for (let time = firstMarker; time <= maxTime; time += intervalMs) {
      if (time >= visibleStart && time <= visibleEnd) {
        markerTimes.add(Math.round(time));
      }
    }

    if (visibleStart <= maxTime) {
      markerTimes.add(Math.round(visibleStart));
    }

    if (videoDurationMs > 0) {
      markerTimes.add(Math.round(videoDurationMs));
    }

    const sorted = Array.from(markerTimes)
      .filter(time => time <= maxTime)
      .sort((a, b) => a - b);

    // Generate minor ticks (4 ticks between major intervals)
    const minorTicks = [];
    const minorInterval = intervalMs / 5;

    for (let time = firstMarker; time <= maxTime; time += minorInterval) {
      if (time >= visibleStart && time <= visibleEnd) {
        // Skip if it's close to a major marker
        const isMajor = Math.abs(time % intervalMs) < 1;
        if (!isMajor) {
          minorTicks.push(time);
        }
      }
    }

    return {
      markers: sorted.map((time) => ({
        time,
        label: formatTimeLabel(time, intervalMs),
      })),
      minorTicks
    };
  }, [intervalMs, range.end, range.start, videoDurationMs]);

  return (
    <div
      className="h-8 bg-background border-b border-border/30 relative overflow-hidden select-none sticky top-0 z-20"
      style={{
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
      }}
    >
      {/* Minor Ticks */}
      {markers.minorTicks.map((time) => {
        const offset = valueToPixels(time - range.start);
        return (
          <div
            key={`minor-${time}`}
            className="absolute bottom-0 h-1 w-[1px] bg-secondary"
            style={{ [sideProperty]: `${offset}px` }}
          />
        );
      })}

      {/* Major Markers */}
      {markers.markers.map((marker) => {
        const offset = valueToPixels(marker.time - range.start);
        const markerStyle: React.CSSProperties = {
          position: "absolute",
          bottom: 0,
          height: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          [sideProperty]: `${offset}px`,
        };

        return (
          <div key={marker.time} style={markerStyle}>
            <div className="flex flex-col items-center pb-1">
              <div className="h-2 w-[1px] bg-white/20 mb-1" />
              <span
                className={cn(
                  "text-[10px] font-medium tabular-nums tracking-tight",
                  marker.time === currentTimeMs ? "text-primary" : "text-muted-foreground"
                )}
              >
                {marker.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({
  items,
  videoDurationMs,
  intervalMs,
  currentTimeMs,
  onSeek,
  onSelectZoom,
  onSelectTrim,
  onSelectAnnotation,
  onSelectSpotlight,
  onSelectSegment,
  selectedZoomId,
  selectedTrimId,
  selectedAnnotationId,
  selectedSpotlightId,
  selectedSegmentId,
  videoSegments = [],
  razorToolActive = false,
  onSplitSegment,
  thumbnails = [],
  children,
  videoKeyframeOverlays,
  spotlightKeyframeOverlays,
  collapsedTracks,
  onToggleTrack,
  timelineContentRef,
  videoPath,
}: {
  items: TimelineRenderItem[];
  videoDurationMs: number;
  intervalMs: number;
  currentTimeMs: number;
  onSeek?: (time: number) => void;
  onSelectZoom?: (id: string | null) => void;
  onSelectTrim?: (id: string | null) => void;
  onSelectAnnotation?: (id: string | null) => void;
  onSelectSpotlight?: (id: string | null) => void;
  onSelectSegment?: (id: string | null) => void;
  selectedZoomId: string | null;
  selectedTrimId?: string | null;
  selectedAnnotationId?: string | null;
  selectedSpotlightId?: string | null;
  selectedSegmentId?: string | null;
  videoSegments?: VideoSegment[];
  razorToolActive?: boolean;
  onSplitSegment?: (segmentId: string, sourceTimeMs: number) => void;
  thumbnails?: ThumbnailFrame[];
  children?: React.ReactNode;
  videoKeyframeOverlays?: React.ReactNode;
  spotlightKeyframeOverlays?: React.ReactNode;
  collapsedTracks?: Set<string>;
  onToggleTrack?: (trackId: string) => void;
  timelineContentRef?: React.MutableRefObject<HTMLDivElement | null>;
  videoPath?: string | null;
}) {
  const { setTimelineRef, style, sidebarWidth, range, pixelsToValue } = useTimelineContext();
  const localTimelineRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    setTimelineRef(node);
    localTimelineRef.current = node;
    if (timelineContentRef) timelineContentRef.current = node;
  }, [setTimelineRef, timelineContentRef]);

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || videoDurationMs <= 0) return;

    // Only clear selection if clicking on empty space (not on items)
    // This is handled by event propagation - items stop propagation
    onSelectZoom?.(null);
    onSelectTrim?.(null);
    onSelectAnnotation?.(null);
    onSelectSpotlight?.(null);
    onSelectSegment?.(null);

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left - sidebarWidth;

    if (clickX < 0) return;

    const relativeMs = pixelsToValue(clickX);
    const displayMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));
    // Map display (timeline) position back to source time for seeking
    const sourceMs = displayToSourceTime(videoSegments, displayMs);
    const timeInSeconds = sourceMs / 1000;

    onSeek(timeInSeconds);
  }, [onSeek, onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectSpotlight, onSelectSegment, videoDurationMs, videoSegments, sidebarWidth, range.start, pixelsToValue]);

  const zoomItems = items.filter(item => item.rowId === ZOOM_ROW_ID);
  const trimItems = items.filter(item => item.rowId === TRIM_ROW_ID);
  const annotationItems = items.filter(item => item.rowId === ANNOTATION_ROW_ID);
  const spotlightItems = items.filter(item => item.rowId === SPOTLIGHT_ROW_ID);

  const hasTrimItems = trimItems.length > 0;

  return (
    <div className="flex" style={{ minHeight: 140 }}>
      {/* Left column: track labels */}
      <div className="flex flex-col flex-shrink-0" style={{ width: TRACK_LABEL_WIDTH }}>
        {/* Spacer to match TimelineAxis height — sticky so it stays visible when scrolling */}
        <div className="h-8 border-b border-border/30 bg-background sticky top-0 z-20" />

        <TrackLabel
          label="Video"
          icon={<Film className="w-3.5 h-3.5" />}
          accentColor="#3B82F6"
          height={TRACK_HEIGHTS[VIDEO_ROW_ID]}
          collapsed={collapsedTracks?.has(VIDEO_ROW_ID)}
          onToggleCollapse={() => onToggleTrack?.(VIDEO_ROW_ID)}
        />
        <TrackLabel
          label="Zoom"
          icon={<ZoomIn className="w-3.5 h-3.5" />}
          accentColor="#3B82F6"
          height={TRACK_HEIGHTS[ZOOM_ROW_ID]}
          collapsed={collapsedTracks?.has(ZOOM_ROW_ID)}
          onToggleCollapse={() => onToggleTrack?.(ZOOM_ROW_ID)}
        />
        <TrackLabel
          label="Spotlight"
          icon={<Lightbulb className="w-3.5 h-3.5" />}
          accentColor="#8B5CF6"
          height={TRACK_HEIGHTS[SPOTLIGHT_ROW_ID]}
          collapsed={collapsedTracks?.has(SPOTLIGHT_ROW_ID)}
          onToggleCollapse={() => onToggleTrack?.(SPOTLIGHT_ROW_ID)}
        />
        {hasTrimItems && (
          <TrackLabel
            label="Trim"
            icon={<Scissors className="w-3.5 h-3.5" />}
            accentColor="#EF4444"
            height={TRACK_HEIGHTS[TRIM_ROW_ID]}
            collapsed={collapsedTracks?.has(TRIM_ROW_ID)}
            onToggleCollapse={() => onToggleTrack?.(TRIM_ROW_ID)}
          />
        )}
        <TrackLabel
          label="Annotations"
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          accentColor="#F59E0B"
          height={TRACK_HEIGHTS[ANNOTATION_ROW_ID]}
          collapsed={collapsedTracks?.has(ANNOTATION_ROW_ID)}
          onToggleCollapse={() => onToggleTrack?.(ANNOTATION_ROW_ID)}
        />
        <TrackLabel
          label="Audio"
          icon={<Volume2 className="w-3.5 h-3.5" />}
          accentColor="#6B7280"
          height={TRACK_HEIGHTS[AUDIO_ROW_ID]}
          collapsed={collapsedTracks?.has(AUDIO_ROW_ID)}
          onToggleCollapse={() => onToggleTrack?.(AUDIO_ROW_ID)}
        />
      </div>

      {/* Right column: timeline content */}
      <div
        ref={setRefs}
        style={style}
        className="flex-1 select-none bg-background relative cursor-pointer group min-w-0"
        onClick={handleTimelineClick}
      >
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px)] bg-[length:20px_100%] pointer-events-none" />
        <TimelineAxis intervalMs={intervalMs} videoDurationMs={videoDurationMs} currentTimeMs={currentTimeMs} />
        <PlaybackCursor
          currentTimeMs={currentTimeMs}
          videoDurationMs={videoDurationMs}
          onSeek={onSeek}
          timelineRef={localTimelineRef}
          videoSegments={videoSegments}
        />

        {/* Row order: Video (with manual keyframe overlays), Zoom (with zoom keyframe overlays), Spotlight, Trim (conditional), Annotations, Audio */}
        <Row id={VIDEO_ROW_ID} height={TRACK_HEIGHTS[VIDEO_ROW_ID]} collapsed={collapsedTracks?.has(VIDEO_ROW_ID)}>
          {videoSegments.map((segment) => {
            const segDuration = segment.sourceEndMs - segment.sourceStartMs;
            const segSpan: Span = {
              start: segment.timelineStartMs,
              end: segment.timelineStartMs + segDuration,
            };
            return (
              <VideoSegmentItem
                key={segment.id}
                segment={segment}
                span={segSpan}
                rowId={VIDEO_ROW_ID}
                isSelected={segment.id === selectedSegmentId}
                onSelect={() => onSelectSegment?.(segment.id)}
                razorToolActive={razorToolActive}
                onRazorClick={onSplitSegment}
                thumbnails={thumbnails}
              />
            );
          })}
          {/* Manual (non-zoom) keyframe diamond overlays rendered inside the row */}
          {videoKeyframeOverlays}
        </Row>

        <Row id={ZOOM_ROW_ID} height={TRACK_HEIGHTS[ZOOM_ROW_ID]} collapsed={collapsedTracks?.has(ZOOM_ROW_ID)}>
          {zoomItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={item.id === selectedZoomId}
              onSelect={() => onSelectZoom?.(item.id)}
              zoomDepth={item.zoomDepth}
              variant="zoom"
            >
              {item.label}
            </Item>
          ))}
          {/* Keyframe diamond overlays rendered inside the row */}
          {children}
        </Row>

        <Row id={SPOTLIGHT_ROW_ID} height={TRACK_HEIGHTS[SPOTLIGHT_ROW_ID]} collapsed={collapsedTracks?.has(SPOTLIGHT_ROW_ID)}>
          {spotlightItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={item.id === selectedSpotlightId}
              onSelect={() => onSelectSpotlight?.(item.id)}
              variant="spotlight"
            >
              {item.label}
            </Item>
          ))}
          {/* Spotlight keyframe diamond overlays */}
          {spotlightKeyframeOverlays}
        </Row>

        {hasTrimItems && (
          <Row id={TRIM_ROW_ID} height={TRACK_HEIGHTS[TRIM_ROW_ID]} collapsed={collapsedTracks?.has(TRIM_ROW_ID)}>
            {trimItems.map((item) => (
              <Item
                id={item.id}
                key={item.id}
                rowId={item.rowId}
                span={item.span}
                isSelected={item.id === selectedTrimId}
                onSelect={() => onSelectTrim?.(item.id)}
                variant="trim"
              >
                {item.label}
              </Item>
            ))}
          </Row>
        )}

        <Row id={ANNOTATION_ROW_ID} height={TRACK_HEIGHTS[ANNOTATION_ROW_ID]} collapsed={collapsedTracks?.has(ANNOTATION_ROW_ID)}>
          {annotationItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={item.id === selectedAnnotationId}
              onSelect={() => onSelectAnnotation?.(item.id)}
              variant="annotation"
            >
              {item.label}
            </Item>
          ))}
        </Row>

        <Row id={AUDIO_ROW_ID} height={TRACK_HEIGHTS[AUDIO_ROW_ID]} collapsed={collapsedTracks?.has(AUDIO_ROW_ID)}>
          <WaveformRow videoPath={videoPath} height={TRACK_HEIGHTS[AUDIO_ROW_ID]} />
        </Row>
      </div>
    </div>
  );
}

export default function TimelineEditor({
  videoDuration,
  currentTime,
  onSeek,
  zoomRegions,
  onZoomAdded,
  onZoomSpanChange,
  onZoomDelete,
  selectedZoomId,
  onSelectZoom,
  trimRegions = [],
  onTrimAdded: _onTrimAdded,
  onTrimSpanChange,
  onTrimDelete,
  selectedTrimId,
  onSelectTrim,
  annotationRegions = [],
  onAnnotationAdded,
  onAnnotationSpanChange,
  onAnnotationDelete,
  selectedAnnotationId,
  onSelectAnnotation,
  videoSegments = [],
  selectedSegmentId,
  onSelectSegment,
  onSplitSegment,
  onDeleteSegment: _onDeleteSegment,
  onSegmentSpanChange,
  razorToolActive = false,
  onRazorToolChange,
  onRazorAtPlayhead: _onRazorAtPlayhead,
  videoPath,
  aspectRatio,
  onAspectRatioChange,
  cursorData = [],
  onAutoZoomApply,
  nextZoomId = 1,
  spotlightRegions = [],
  onSpotlightAdded,
  onSpotlightSpanChange,
  onSpotlightDelete,
  selectedSpotlightId,
  onSelectSpotlight,
  onAutoSpotlightApply,
  nextSpotlightId = 1,
  onAddKeyframeAtPlayhead,
  onDeleteKeyframesAtTime,
  onMoveKeyframesAtTime,
  selectedZoomLayerId,
  onSelectZoomLayer,
  onMoveZoomLayer,
  onResizeZoomLayer,
  onDeleteZoomLayer,
}: TimelineEditorProps) {
  const totalMs = useMemo(() => Math.max(0, Math.round(videoDuration * 1000)), [videoDuration]);
  // Effective total for display: sum of segment durations (no gaps)
  const effectiveTotalMs = useMemo(() => {
    if (videoSegments.length === 0) return totalMs;
    return getTotalTimelineDuration(videoSegments);
  }, [videoSegments, totalMs]);
  // Map source playback time to display time for cursor positioning
  const currentTimeMs = useMemo(() => {
    const sourceMs = Math.round(currentTime * 1000);
    if (videoSegments.length === 0) return sourceMs;
    return sourceToDisplayTime(videoSegments, sourceMs);
  }, [currentTime, videoSegments]);
  const effectiveDuration = effectiveTotalMs / 1000;
  const timelineScale = useMemo(() => calculateTimelineScale(effectiveDuration), [effectiveDuration]);
  const safeMinDurationMs = useMemo(
    () => (effectiveTotalMs > 0 ? Math.min(timelineScale.minItemDurationMs, effectiveTotalMs) : timelineScale.minItemDurationMs),
    [timelineScale.minItemDurationMs, effectiveTotalMs],
  );

  const [range, setRange] = useState<Range>(() => createInitialRange(effectiveTotalMs));
  const [selectedKeyframeTime, setSelectedKeyframeTime] = useState<number | null>(null);
  const [selectedKeyframeSegmentId, setSelectedKeyframeSegmentId] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState({
    pan: 'Scroll',
    zoom: 'Ctrl + Scroll'
  });
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const [thumbnails, setThumbnails] = useState<ThumbnailFrame[]>([]);
  const [collapsedTracks, setCollapsedTracks] = useState<Set<string>>(new Set());
  const toggleTrack = useCallback((trackId: string) => {
    setCollapsedTracks(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  // Extract thumbnails when video path changes
  useEffect(() => {
    if (!videoPath) return;
    let cancelled = false;
    extractThumbnails(videoPath, 2000, 48)
      .then((frames) => {
        if (!cancelled) setThumbnails(frames);
      })
      .catch(() => {
        // Thumbnails are optional visual polish; don't block on failure
      });
    return () => { cancelled = true; };
  }, [videoPath]);

  useEffect(() => {
    formatShortcut(['mod', 'Scroll']).then(zoom => {
      setShortcuts({ pan: 'Scroll', zoom });
    });
  }, []);

  // Add keyframe at current playhead position on the active segment
  const addKeyframeAtPlayhead = useCallback(() => {
    if (!onAddKeyframeAtPlayhead) return;
    // Find the segment under the current playhead (in source time)
    const sourceMs = Math.round(currentTime * 1000);
    const segment = videoSegments.find(s => sourceMs >= s.sourceStartMs && sourceMs < s.sourceEndMs);
    if (!segment) return;
    // Relative time within the segment
    const relativeTimeMs = sourceMs - segment.sourceStartMs;
    onAddKeyframeAtPlayhead(segment.id, relativeTimeMs);
  }, [currentTime, videoSegments, onAddKeyframeAtPlayhead]);

  // Delete selected keyframe group
  const deleteSelectedKeyframe = useCallback(() => {
    if (selectedKeyframeTime === null || !selectedKeyframeSegmentId || !onDeleteKeyframesAtTime) return;
    onDeleteKeyframesAtTime(selectedKeyframeSegmentId, selectedKeyframeTime);
    setSelectedKeyframeTime(null);
    setSelectedKeyframeSegmentId(null);
  }, [selectedKeyframeTime, selectedKeyframeSegmentId, onDeleteKeyframesAtTime]);

  // Handle keyframe selection from KeyframeTrack
  const handleSelectKeyframeTime = useCallback((segmentId: string, timeMs: number | null) => {
    setSelectedKeyframeSegmentId(timeMs !== null ? segmentId : null);
    setSelectedKeyframeTime(timeMs);
  }, []);

  // Delete selected zoom item
  const deleteSelectedZoom = useCallback(() => {
    if (!selectedZoomId) return;
    onZoomDelete(selectedZoomId);
    onSelectZoom(null);
  }, [selectedZoomId, onZoomDelete, onSelectZoom]);

  // Delete selected trim item
  const deleteSelectedTrim = useCallback(() => {
    if (!selectedTrimId || !onTrimDelete || !onSelectTrim) return;
    onTrimDelete(selectedTrimId);
    onSelectTrim(null);
  }, [selectedTrimId, onTrimDelete, onSelectTrim]);

  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId || !onAnnotationDelete || !onSelectAnnotation) return;
    onAnnotationDelete(selectedAnnotationId);
    onSelectAnnotation(null);
  }, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

  const deleteSelectedSpotlight = useCallback(() => {
    if (!selectedSpotlightId || !onSpotlightDelete || !onSelectSpotlight) return;
    onSpotlightDelete(selectedSpotlightId);
    onSelectSpotlight(null);
  }, [selectedSpotlightId, onSpotlightDelete, onSelectSpotlight]);

  useEffect(() => {
    setRange(createInitialRange(effectiveTotalMs));
  }, [effectiveTotalMs]);

  useEffect(() => {
    if (totalMs === 0 || safeMinDurationMs <= 0) {
      return;
    }

    zoomRegions.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onZoomSpanChange(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    trimRegions.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onTrimSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });
  }, [zoomRegions, trimRegions, annotationRegions, totalMs, safeMinDurationMs, onZoomSpanChange, onTrimSpanChange, onAnnotationSpanChange]);

  const hasOverlap = useCallback((newSpan: Span, excludeId?: string): boolean => {
    // Determine which row the item belongs to
    const isZoomItem = zoomRegions.some(r => r.id === excludeId);
    const isTrimItem = trimRegions.some(r => r.id === excludeId);
    const isAnnotationItem = annotationRegions.some(r => r.id === excludeId);

    if (isAnnotationItem) {
      return false;
    }

    // newSpan is in display-time (from dnd-timeline); convert region bounds
    // to display-time before comparison so coordinates match.
    const checkOverlap = (regions: (ZoomRegion | TrimRegion)[]) => {
      return regions.some((region) => {
        if (region.id === excludeId) return false;
        const dispStart = sourceToDisplayTime(videoSegments, region.startMs);
        const dispEnd = sourceToDisplayTime(videoSegments, region.endMs);
        const gapBefore = newSpan.start - dispEnd;
        const gapAfter = dispStart - newSpan.end;
        // Reject if gap is 2ms or less (too close)
        if (gapBefore > 0 && gapBefore <= 2) return true;
        if (gapAfter > 0 && gapAfter <= 2) return true;
        return !(newSpan.end <= dispStart || newSpan.start >= dispEnd);
      });
    };

    if (isZoomItem) {
      return checkOverlap(zoomRegions);
    }

    if (isTrimItem) {
      return checkOverlap(trimRegions);
    }

    return false;
  }, [zoomRegions, trimRegions, annotationRegions, videoSegments]);

  const handleAddZoom = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0) {
      return;
    }

    const defaultDuration = Math.min(3000, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Convert display cursor time back to source time for zoom placement
    const sourceTimeMs = displayToSourceTime(videoSegments, currentTimeMs);
    const startPos = Math.max(0, Math.min(sourceTimeMs, totalMs));
    // Find the next zoom region after the playhead (source time)
    const sorted = [...zoomRegions].sort((a, b) => a.startMs - b.startMs);
    const nextRegion = sorted.find(region => region.startMs > startPos);
    const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;

    // Check if playhead is inside any zoom region
    const isOverlapping = sorted.some(region => startPos >= region.startMs && startPos < region.endMs);
    if (isOverlapping || gapToNext <= 0) {
      toast.error("Cannot place zoom here", {
        description: "Zoom already exists at this location or not enough space available.",
      });
      return;
    }

    const actualDuration = Math.min(3000, gapToNext);
    onZoomAdded({ start: startPos, end: startPos + actualDuration });
  }, [videoDuration, totalMs, currentTimeMs, videoSegments, zoomRegions, onZoomAdded]);

  // handleAddTrim removed — trim UI replaced by segment split+delete

  const handleAddSpotlight = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onSpotlightAdded) {
      return;
    }

    const defaultDuration = Math.min(1000, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    const sourceTimeMs = displayToSourceTime(videoSegments, currentTimeMs);
    const startPos = Math.max(0, Math.min(sourceTimeMs, totalMs));
    const endPos = Math.min(startPos + defaultDuration, totalMs);

    onSpotlightAdded({ start: startPos, end: endPos });
  }, [videoDuration, totalMs, currentTimeMs, videoSegments, onSpotlightAdded]);

  const handleAddAnnotation = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onAnnotationAdded) {
      return;
    }

    const defaultDuration = Math.min(1000, totalMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Convert display cursor time back to source time for annotation placement
    const sourceTimeMs = displayToSourceTime(videoSegments, currentTimeMs);
    const startPos = Math.max(0, Math.min(sourceTimeMs, totalMs));
    const endPos = Math.min(startPos + defaultDuration, totalMs);

    onAnnotationAdded({ start: startPos, end: endPos });
  }, [videoDuration, totalMs, currentTimeMs, videoSegments, onAnnotationAdded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Universal editable-target guard: blocks ALL shortcuts (including Tab
      // cycling) when focus is in an input, textarea, select, or
      // contentEditable element. Typing Tab/Delete/etc. in a text field must
      // behave normally.
      if (isEditableTarget(e)) return;

      if (e.key === 'f' || e.key === 'F') {
        addKeyframeAtPlayhead();
      }
      if (e.key === 'z' || e.key === 'Z') {
        handleAddZoom();
      }
      if (e.key === 'a' || e.key === 'A') {
        handleAddAnnotation();
      }
      if (e.key === 's' || e.key === 'S') {
        handleAddSpotlight();
      }

      // Tab: Cycle through overlapping annotations at current time
      if (e.key === 'Tab' && annotationRegions.length > 0) {
        const currentTimeMs = Math.round(currentTime * 1000);
        const overlapping = annotationRegions
          .filter(a => currentTimeMs >= a.startMs && currentTimeMs <= a.endMs)
          .sort((a, b) => a.zIndex - b.zIndex); // Sort by z-index

        if (overlapping.length > 0) {
          e.preventDefault();

          if (!selectedAnnotationId || !overlapping.some(a => a.id === selectedAnnotationId)) {
            onSelectAnnotation?.(overlapping[0].id);
          } else {
            // Cycle to next annotation
            const currentIndex = overlapping.findIndex(a => a.id === selectedAnnotationId);
            const nextIndex = e.shiftKey
              ? (currentIndex - 1 + overlapping.length) % overlapping.length // Shift+Tab = backward
              : (currentIndex + 1) % overlapping.length; // Tab = forward
            onSelectAnnotation?.(overlapping[nextIndex].id);
          }
        }
      }
      // Delete key or Ctrl+D / Cmd+D
      if (e.key === 'Delete' || e.key === 'Backspace' || ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey))) {
        if (selectedKeyframeTime !== null) {
          deleteSelectedKeyframe();
        } else if (selectedZoomId) {
          deleteSelectedZoom();
        } else if (selectedTrimId) {
          deleteSelectedTrim();
        } else if (selectedSpotlightId) {
          deleteSelectedSpotlight();
        } else if (selectedAnnotationId) {
          deleteSelectedAnnotation();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addKeyframeAtPlayhead, handleAddZoom, handleAddAnnotation, handleAddSpotlight, deleteSelectedKeyframe, deleteSelectedZoom, deleteSelectedTrim, deleteSelectedSpotlight, deleteSelectedAnnotation, selectedKeyframeTime, selectedZoomId, selectedTrimId, selectedSpotlightId, selectedAnnotationId, annotationRegions, currentTime, onSelectAnnotation]);

  const clampedRange = useMemo<Range>(() => {
    if (effectiveTotalMs === 0) {
      return range;
    }

    return {
      start: Math.max(0, Math.min(range.start, effectiveTotalMs)),
      end: Math.min(range.end, effectiveTotalMs),
    };
  }, [range, effectiveTotalMs]);

  const timelineItems = useMemo<TimelineRenderItem[]>(() => {
    // Map source-time overlays to display-time for visual alignment with segments
    const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
      id: region.id,
      rowId: ZOOM_ROW_ID,
      span: {
        start: sourceToDisplayTime(videoSegments, region.startMs),
        end: sourceToDisplayTime(videoSegments, region.endMs),
      },
      label: `Zoom ${index + 1}`,
      zoomDepth: region.depth,
      variant: 'zoom',
    }));

    const trims: TimelineRenderItem[] = trimRegions.map((region, index) => ({
      id: region.id,
      rowId: TRIM_ROW_ID,
      span: {
        start: sourceToDisplayTime(videoSegments, region.startMs),
        end: sourceToDisplayTime(videoSegments, region.endMs),
      },
      label: `Trim ${index + 1}`,
      variant: 'trim',
    }));

    const annotations: TimelineRenderItem[] = annotationRegions.map((region) => {
      let label: string;

      if (region.type === 'text') {
        // Show text preview
        const preview = region.content.trim() || 'Empty text';
        label = preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
      } else if (region.type === 'image') {
        label = 'Image';
      } else {
        label = 'Annotation';
      }

      return {
        id: region.id,
        rowId: ANNOTATION_ROW_ID,
        span: {
          start: sourceToDisplayTime(videoSegments, region.startMs),
          end: sourceToDisplayTime(videoSegments, region.endMs),
        },
        label,
        variant: 'annotation',
      };
    });

    const spotlights: TimelineRenderItem[] = spotlightRegions.map((region, index) => ({
      id: region.id,
      rowId: SPOTLIGHT_ROW_ID,
      span: {
        start: sourceToDisplayTime(videoSegments, region.startMs),
        end: sourceToDisplayTime(videoSegments, region.endMs),
      },
      label: `Spotlight ${index + 1}`,
      variant: 'spotlight',
    }));

    return [...zooms, ...trims, ...annotations, ...spotlights];
  }, [zoomRegions, trimRegions, annotationRegions, spotlightRegions, videoSegments]);

  const handleItemSpanChange = useCallback((id: string, span: Span) => {
    // Check which row the item belongs to
    if (zoomRegions.some(r => r.id === id)) {
      // Map display-time span back to source-time for storage
      const sourceSpan = {
        start: displayToSourceTime(videoSegments, span.start),
        end: displayToSourceTime(videoSegments, span.end),
      };
      onZoomSpanChange(id, sourceSpan);
    } else if (trimRegions.some(r => r.id === id)) {
      const sourceSpan = {
        start: displayToSourceTime(videoSegments, span.start),
        end: displayToSourceTime(videoSegments, span.end),
      };
      onTrimSpanChange?.(id, sourceSpan);
    } else if (annotationRegions.some(r => r.id === id)) {
      const sourceSpan = {
        start: displayToSourceTime(videoSegments, span.start),
        end: displayToSourceTime(videoSegments, span.end),
      };
      onAnnotationSpanChange?.(id, sourceSpan);
    } else if (spotlightRegions.some(r => r.id === id)) {
      const sourceSpan = {
        start: displayToSourceTime(videoSegments, span.start),
        end: displayToSourceTime(videoSegments, span.end),
      };
      onSpotlightSpanChange?.(id, sourceSpan);
    } else if (videoSegments.some(s => s.id === id)) {
      // For video segments, span change = trim resize (already in display time = timelineStartMs coords)
      const seg = videoSegments.find(s => s.id === id);
      if (seg && onSegmentSpanChange) {
        const oldDuration = seg.sourceEndMs - seg.sourceStartMs;
        const newDuration = span.end - span.start;
        // Determine which edge changed
        const startDelta = span.start - seg.timelineStartMs;
        if (Math.abs(startDelta) > 1) {
          // Left edge moved: adjust sourceStartMs
          const newSourceStart = seg.sourceStartMs + startDelta;
          onSegmentSpanChange(id, newSourceStart, seg.sourceEndMs);
        } else {
          // Right edge moved: adjust sourceEndMs
          const durationDelta = newDuration - oldDuration;
          onSegmentSpanChange(id, seg.sourceStartMs, seg.sourceEndMs + durationDelta);
        }
      }
    }
  }, [zoomRegions, trimRegions, annotationRegions, spotlightRegions, videoSegments, onZoomSpanChange, onTrimSpanChange, onAnnotationSpanChange, onSpotlightSpanChange, onSegmentSpanChange]);

  if (!videoDuration || videoDuration === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-background gap-3">
        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
          <Plus className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground/80">No Video Loaded</p>
          <p className="text-xs text-muted-foreground mt-1">Drag and drop a video to start editing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden font-sans">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 bg-background">
        <div className="flex items-center gap-1">
          <Button
            onClick={handleAddZoom}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            title="Add Zoom (Z)"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <div className="w-[1px] h-4 bg-white/10" />
          <Button
            onClick={() => onRazorToolChange?.(!razorToolActive)}
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 transition-all",
              razorToolActive
                ? "text-white bg-primary/30 border border-primary/50"
                : "text-muted-foreground hover:text-white hover:bg-white/10"
            )}
            title={razorToolActive ? "Switch to Select (V)" : "Razor Tool (C)"}
          >
            <Scissors className="w-4 h-4" style={{ transform: 'rotate(90deg)' }} />
          </Button>
          <Button
            onClick={() => onRazorToolChange?.(false)}
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 transition-all",
              !razorToolActive
                ? "text-white bg-white/10 border border-white/20"
                : "text-muted-foreground hover:text-white hover:bg-white/10"
            )}
            title="Select Tool (V)"
          >
            <MousePointer2 className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddAnnotation}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-accent hover:bg-accent/10 transition-all"
            title="Add Annotation (A)"
          >
            <MessageSquare className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddSpotlight}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-purple-400 hover:bg-purple-500/10 transition-all"
            title="Add Spotlight (S)"
          >
            <Lightbulb className="w-4 h-4" />
          </Button>
          {onAutoSpotlightApply && (
            <AutoSpotlightPopover
              cursorData={cursorData}
              spotlightRegions={spotlightRegions}
              onApply={onAutoSpotlightApply}
              nextSpotlightId={nextSpotlightId}
              disabled={cursorData.length === 0}
            />
          )}
          {onAutoZoomApply && (
            <AutoZoomPopover
              cursorData={cursorData}
              zoomRegions={zoomRegions}
              onApply={onAutoZoomApply}
              nextZoomId={nextZoomId}
              disabled={cursorData.length === 0}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all gap-1"
              >
                <span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-border/40">
              {ASPECT_RATIOS.map((ratio) => (
                <DropdownMenuItem
                  key={ratio}
                  onClick={() => onAspectRatioChange(ratio)}
                  className="text-foreground/80 hover:text-foreground hover:bg-accent cursor-pointer flex items-center justify-between gap-3"
                >
                  <span>{getAspectRatioLabel(ratio)}</span>
                  {aspectRatio === ratio && <Check className="w-3 h-3 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="w-[1px] h-4 bg-white/10" />
          <TutorialHelp />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-medium">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-secondary border border-border/40 rounded text-primary font-sans">{shortcuts.pan}</kbd>
            <span>Pan</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-secondary border border-border/40 rounded text-primary font-sans">{shortcuts.zoom}</kbd>
            <span>Zoom</span>
          </span>
        </div>
      </div>
      <div
        ref={timelineContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-background relative"
        onClick={() => { setSelectedKeyframeTime(null); setSelectedKeyframeSegmentId(null); }}
      >
        <TimelineWrapper
          range={clampedRange}
          videoDuration={effectiveDuration}
          hasOverlap={hasOverlap}
          onRangeChange={setRange}
          minItemDurationMs={timelineScale.minItemDurationMs}
          minVisibleRangeMs={timelineScale.minVisibleRangeMs}
          gridSizeMs={timelineScale.gridMs}
          onItemSpanChange={handleItemSpanChange}
        >
          <Timeline
            items={timelineItems}
            videoDurationMs={effectiveTotalMs}
            intervalMs={timelineScale.intervalMs}
            currentTimeMs={currentTimeMs}
            onSeek={onSeek}
            onSelectZoom={onSelectZoom}
            onSelectTrim={onSelectTrim}
            onSelectAnnotation={onSelectAnnotation}
            onSelectSpotlight={onSelectSpotlight}
            onSelectSegment={onSelectSegment}
            selectedZoomId={selectedZoomId}
            selectedTrimId={selectedTrimId}
            selectedAnnotationId={selectedAnnotationId}
            selectedSpotlightId={selectedSpotlightId}
            selectedSegmentId={selectedSegmentId}
            videoSegments={videoSegments}
            razorToolActive={razorToolActive}
            onSplitSegment={onSplitSegment}
            thumbnails={thumbnails}
            collapsedTracks={collapsedTracks}
            onToggleTrack={toggleTrack}
            timelineContentRef={timelineContentRef}
            videoPath={videoPath}
            videoKeyframeOverlays={videoSegments.map(segment => (
              <KeyframeTrack
                key={`kf-manual-${segment.id}`}
                segment={segment}
                filter="manual"
                selectedKeyframeTime={selectedKeyframeSegmentId === segment.id ? selectedKeyframeTime : null}
                onSelectKeyframeTime={(timeMs) => handleSelectKeyframeTime(segment.id, timeMs)}
                onDeleteKeyframesAtTime={onDeleteKeyframesAtTime}
                onMoveKeyframesAtTime={onMoveKeyframesAtTime}
                onSeek={onSeek}
                videoDurationMs={effectiveTotalMs}
                timelineRef={timelineContentRef}
              />
            ))}
            spotlightKeyframeOverlays={
              spotlightRegions.some(s => s.keyframes && s.keyframes.length > 0) ? (
                <KeyframeTrack
                  key="kf-spotlight"
                  segment={videoSegments[0] || { id: 'dummy', sourceStartMs: 0, sourceEndMs: effectiveTotalMs, timelineStartMs: 0, transform: {} as any, keyframes: [] }}
                  filter="spotlight"
                  spotlightRegions={spotlightRegions}
                  videoSegments={videoSegments}
                  selectedKeyframeTime={null}
                  onSelectKeyframeTime={() => {}}
                  onSeek={onSeek}
                  videoDurationMs={effectiveTotalMs}
                  timelineRef={timelineContentRef}
                />
              ) : undefined
            }
          >
            {(() => {
              const selected = zoomRegions.find((r) => r.id === selectedZoomId);
              if (!selected) return null;
              return (
                <ZoomLayerLane
                  region={selected}
                  videoSegments={videoSegments}
                  selectedLayerId={selectedZoomLayerId}
                  onSelectLayer={onSelectZoomLayer}
                  onMoveLayer={onMoveZoomLayer}
                  onResizeLayer={onResizeZoomLayer}
                  onDeleteLayer={onDeleteZoomLayer}
                  timelineRef={timelineContentRef}
                />
              );
            })()}
          </Timeline>
        </TimelineWrapper>
      </div>
    </div>
  );
}
