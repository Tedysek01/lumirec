import { useItem, useTimelineContext } from "dnd-timeline";
import type { Span } from "dnd-timeline";
import { cn } from "@/lib/utils";
import { ZoomIn, Scissors, MessageSquare, Lightbulb } from "lucide-react";
import glassStyles from "./ItemGlass.module.css";

interface ItemProps {
  id: string;
  span: Span;
  rowId: string;
  children: React.ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  zoomDepth?: number;
  variant?: 'zoom' | 'trim' | 'annotation' | 'spotlight';
}

// Map zoom depth to multiplier labels
const ZOOM_LABELS: Record<number, string> = {
  1: "1.25×",
  2: "1.5×",
  3: "1.8×",
  4: "2.2×",
  5: "3.5×",
  6: "5×",
};

export default function Item({
  id,
  span,
  rowId,
  isSelected = false,
  onSelect,
  zoomDepth = 1,
  variant = 'zoom',
  children
}: ItemProps) {
  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
    id,
    span,
    data: { rowId },
  });
  const { range, valueToPixels } = useTimelineContext();

  // Whether the item's start/end boundaries are within the visible range
  const startVisible = valueToPixels(span.start - range.start) >= -1;
  const endVisible = valueToPixels(range.end - span.end) >= -1;

  const isZoom = variant === 'zoom';
  const isTrim = variant === 'trim';
  const isSpotlight = variant === 'spotlight';

  const glassClass = isZoom
    ? glassStyles.glassGreen
    : isTrim
    ? glassStyles.glassRed
    : isSpotlight
    ? glassStyles.glassPurple
    : glassStyles.glassYellow;

  const endCapColor = isZoom
    ? '#2563EB'
    : isTrim
    ? '#DC2626'
    : isSpotlight
    ? '#7C3AED'
    : '#D97706';

  const itemHeight = 40;

  return (
    <div
      ref={setNodeRef}
      style={itemStyle}
      {...listeners}
      {...attributes}
      onPointerDownCapture={() => onSelect?.()}
      className="group"
    >
      <div style={itemContentStyle}>
        <div
          className={cn(
            glassClass,
            "w-full h-full overflow-hidden flex items-center justify-center gap-1.5 cursor-grab active:cursor-grabbing relative",
            isSelected && glassStyles.selected
          )}
          style={{ height: itemHeight, color: '#fff' }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.();
          }}
        >
          {startVisible && (
            <div
              className={cn(glassStyles.zoomEndCap, glassStyles.left)}
              style={{ cursor: 'col-resize', pointerEvents: 'auto', width: 8, opacity: 0.9, background: endCapColor }}
              title="Resize left"
            />
          )}
          {endVisible && (
            <div
              className={cn(glassStyles.zoomEndCap, glassStyles.right)}
              style={{ cursor: 'col-resize', pointerEvents: 'auto', width: 8, opacity: 0.9, background: endCapColor }}
              title="Resize right"
            />
          )}
          {/* Content */}
          <div className="relative z-10 flex items-center gap-1.5 text-white/90 opacity-80 group-hover:opacity-100 transition-opacity select-none">
            {isZoom ? (
              <>
                <ZoomIn className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
                </span>
              </>
            ) : isTrim ? (
              <>
                <Scissors className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  Trim
                </span>
              </>
            ) : isSpotlight ? (
              <>
                <Lightbulb className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  Spotlight
                </span>
              </>
            ) : (
              <>
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {children}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}