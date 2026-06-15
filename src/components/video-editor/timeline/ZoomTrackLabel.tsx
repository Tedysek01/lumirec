import { ChevronDown, ZoomIn, Plus } from "lucide-react";
import type { ZoomLayerKind } from "../types";

interface ZoomTrackLabelProps {
  accentColor: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Total gutter height — must match the (possibly expanded) zoom row height. */
  height: number;
  headerHeight: number;
  /** Region a new layer attaches to (selected, else under playhead). Null = no zoom yet. */
  addTargetRegionId: string | null;
  onAddLayer: (regionId: string, kind: ZoomLayerKind) => void;
}

const COLLAPSED_HEIGHT = 20;

/**
 * Left-gutter header for the Zoom track. Shows the track header plus always-
 * available add-layer buttons. Layer bars label themselves on the right, so the
 * gutter stays a simple header even when the row is expanded for stacked layers.
 */
export default function ZoomTrackLabel({
  accentColor,
  collapsed = false,
  onToggleCollapse,
  height,
  headerHeight,
  addTargetRegionId,
  onAddLayer,
}: ZoomTrackLabelProps) {
  const displayHeight = collapsed ? COLLAPSED_HEIGHT : height;
  const bandHeight = collapsed ? COLLAPSED_HEIGHT : headerHeight;
  const canAdd = addTargetRegionId !== null;

  return (
    <div
      className="border-b border-border/20 bg-surface-0/60 select-none overflow-hidden"
      style={{ height: displayHeight, minHeight: displayHeight, transition: 'height 0.2s ease' }}
    >
      <div
        className="flex items-center gap-1.5 px-2 cursor-pointer"
        style={{ height: bandHeight, minHeight: bandHeight }}
        onClick={onToggleCollapse}
      >
        <ChevronDown
          className="w-3 h-3 text-muted-foreground/60 flex-shrink-0 transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
        />
        <span className="flex-shrink-0" style={{ color: accentColor }}>
          <ZoomIn className="w-3.5 h-3.5" />
        </span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium truncate">
          Zoom
        </span>

        {!collapsed && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={!canAdd}
              onClick={(e) => { e.stopPropagation(); if (addTargetRegionId) onAddLayer(addTargetRegionId, 'zoom'); }}
              className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={canAdd ? "Přidat zoom vrstvu" : "Nejdřív přidej/vyber zoom"}
            >
              <Plus className="w-2.5 h-2.5" /> zoom
            </button>
            <button
              type="button"
              disabled={!canAdd}
              onClick={(e) => { e.stopPropagation(); if (addTargetRegionId) onAddLayer(addTargetRegionId, 'position'); }}
              className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/30 hover:bg-purple-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={canAdd ? "Přidat posun vrstvu" : "Nejdřív přidej/vyber zoom"}
            >
              <Plus className="w-2.5 h-2.5" /> posun
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
