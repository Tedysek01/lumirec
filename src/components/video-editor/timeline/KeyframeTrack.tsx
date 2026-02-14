import { useTimelineContext } from "dnd-timeline";
import type { VideoSegment } from "../types";

interface KeyframeTrackProps {
  segment: VideoSegment;
  onKeyframeAdd?: (segmentId: string, timeMs: number) => void;
  onKeyframeDelete?: (segmentId: string, keyframeId: string) => void;
  selectedKeyframeId?: string | null;
  onSelectKeyframe?: (keyframeId: string | null) => void;
}

/**
 * Renders keyframe diamond markers within a video segment on the timeline.
 */
export default function KeyframeTrack({
  segment,
  onKeyframeDelete,
  selectedKeyframeId,
  onSelectKeyframe,
}: KeyframeTrackProps) {
  const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
  const sideProperty = direction === "rtl" ? "right" : "left";

  if (segment.keyframes.length === 0) return null;

  return (
    <div
      className="relative h-4"
      style={{
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
      }}
    >
      {segment.keyframes.map((kf) => {
        // Convert keyframe time (relative to segment start) to timeline time
        const timelineTimeMs = segment.timelineStartMs + kf.timeMs;
        if (timelineTimeMs < range.start || timelineTimeMs > range.end) return null;

        const offset = valueToPixels(timelineTimeMs - range.start);
        const isSelected = kf.id === selectedKeyframeId;

        return (
          <div
            key={kf.id}
            className="absolute top-1/2 -translate-y-1/2 cursor-pointer"
            style={{
              [sideProperty]: `${offset - 5}px`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectKeyframe?.(isSelected ? null : kf.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onKeyframeDelete?.(segment.id, kf.id);
            }}
            title={`${kf.property}: ${kf.value.toFixed(1)} @ ${kf.timeMs}ms (${kf.easing})`}
          >
            <div
              className={`w-[10px] h-[10px] rotate-45 transition-all ${
                isSelected
                  ? 'bg-primary border border-white shadow-lg shadow-primary/50'
                  : 'bg-blue-400/80 border border-blue-300/40 hover:bg-blue-300'
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}
