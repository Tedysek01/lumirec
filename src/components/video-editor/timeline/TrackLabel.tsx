import { ChevronDown } from "lucide-react";

interface TrackLabelProps {
  label: string;
  icon: React.ReactNode;
  accentColor: string;
  height: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const COLLAPSED_HEIGHT = 20;

export default function TrackLabel({
  label,
  icon,
  accentColor,
  height,
  collapsed = false,
  onToggleCollapse,
}: TrackLabelProps) {
  const displayHeight = collapsed ? COLLAPSED_HEIGHT : height;

  return (
    <div
      className="border-b border-border/20 bg-surface-0/60 flex items-center gap-1.5 px-2 cursor-pointer select-none overflow-hidden"
      style={{
        height: displayHeight,
        minHeight: displayHeight,
        transition: 'height 0.2s ease, min-height 0.2s ease',
      }}
      onClick={onToggleCollapse}
    >
      <ChevronDown
        className="w-3 h-3 text-muted-foreground/60 flex-shrink-0 transition-transform duration-200"
        style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
      />
      <span className="flex-shrink-0" style={{ color: accentColor }}>
        {icon}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium truncate">
        {label}
      </span>
    </div>
  );
}
