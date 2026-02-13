import { useItem } from "dnd-timeline";
import type { Span } from "dnd-timeline";
import { cn } from "@/lib/utils";
import { Film } from "lucide-react";
import glassStyles from "./ItemGlass.module.css";
import type { VideoSegment } from "../types";
import type { ThumbnailFrame } from "@/lib/thumbnailExtractor";

// Scissors SVG cursor (16x16) as a data URI for the razor tool
const SCISSORS_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6' cy='6' r='3'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Cline x1='20' y1='4' x2='8.12' y2='15.88'/%3E%3Cline x1='14.47' y1='14.48' x2='20' y2='20'/%3E%3Cline x1='8.12' y1='8.12' x2='12' y2='12'/%3E%3C/svg%3E") 8 8, crosshair`;

interface VideoSegmentItemProps {
  segment: VideoSegment;
  span: Span;
  rowId: string;
  isSelected: boolean;
  onSelect: () => void;
  razorToolActive: boolean;
  onRazorClick?: (segmentId: string, sourceTimeMs: number) => void;
  thumbnails?: ThumbnailFrame[];
}

function formatDuration(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    return `${totalSec.toFixed(1)}s`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export default function VideoSegmentItem({
  segment,
  span,
  rowId,
  isSelected,
  onSelect,
  razorToolActive,
  onRazorClick,
  thumbnails = [],
}: VideoSegmentItemProps) {
  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
    id: segment.id,
    span,
    data: { rowId },
  });

  const durationMs = segment.sourceEndMs - segment.sourceStartMs;

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();

    if (razorToolActive && onRazorClick) {
      // Calculate the source time from click position within the element
      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = (event.clientX - rect.left) / rect.width;
      const sourceTimeMs = segment.sourceStartMs + relativeX * durationMs;
      onRazorClick(segment.id, sourceTimeMs);
      return;
    }

    onSelect();
  };

  // Compute thumbnail strip styles
  const hasThumbnails = thumbnails.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={itemStyle}
      {...(razorToolActive ? {} : listeners)}
      {...attributes}
      onPointerDownCapture={() => {
        if (!razorToolActive) onSelect();
      }}
      className="group"
    >
      <div style={itemContentStyle}>
        <div
          className={cn(
            glassStyles.glassBlue,
            "w-full h-full overflow-hidden flex items-center justify-center gap-1.5 relative",
            !razorToolActive && "cursor-grab active:cursor-grabbing",
            isSelected && glassStyles.selected,
          )}
          style={{ height: 48, color: '#fff', cursor: razorToolActive ? SCISSORS_CURSOR : undefined }}
          onClick={handleClick}
        >
          {/* Thumbnail filmstrip background */}
          {hasThumbnails && (
            <div
              className="absolute inset-0 flex overflow-hidden opacity-40 pointer-events-none"
              style={{ zIndex: 0 }}
            >
              {thumbnails
                .filter(
                  (t) =>
                    t.timeMs >= segment.sourceStartMs &&
                    t.timeMs < segment.sourceEndMs,
                )
                .map((t) => (
                  <img
                    key={t.timeMs}
                    src={t.dataUrl}
                    alt=""
                    className="h-full object-cover flex-shrink-0"
                    style={{ width: t.width }}
                    draggable={false}
                  />
                ))}
            </div>
          )}

          {/* Resize handles */}
          <div
            className={cn(glassStyles.zoomEndCap, glassStyles.left)}
            style={{
              cursor: 'col-resize',
              pointerEvents: 'auto',
              width: 6,
              opacity: 0.9,
              background: '#2563EB',
            }}
            title="Trim left"
          />
          <div
            className={cn(glassStyles.zoomEndCap, glassStyles.right)}
            style={{
              cursor: 'col-resize',
              pointerEvents: 'auto',
              width: 6,
              opacity: 0.9,
              background: '#2563EB',
            }}
            title="Trim right"
          />

          {/* Content */}
          <div className="relative z-10 flex items-center gap-1.5 text-white/90 opacity-80 group-hover:opacity-100 transition-opacity select-none px-2">
            <Film className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-[11px] font-semibold tracking-tight truncate">
              {formatDuration(durationMs)}
            </span>
          </div>

          {/* Razor tool hover indicator */}
          {razorToolActive && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-[2px] h-full bg-white/60 absolute" style={{ left: '50%' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
