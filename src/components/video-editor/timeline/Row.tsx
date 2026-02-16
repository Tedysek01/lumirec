import { useRow } from "dnd-timeline";
import type { RowDefinition } from "dnd-timeline";

interface RowProps extends RowDefinition {
  children: React.ReactNode;
  height?: number;
  collapsed?: boolean;
}

export default function Row({ id, children, height, collapsed = false }: RowProps) {
  const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

  return (
    <div
      className="border-b border-border/20 bg-surface-0"
      style={{
        ...rowWrapperStyle,
        minHeight: collapsed ? 0 : (height ?? 48),
        height: collapsed ? 0 : height,
        overflow: collapsed ? 'hidden' : undefined,
        transition: 'height 0.2s ease, min-height 0.2s ease',
        marginBottom: 0,
      }}
    >
      <div ref={setNodeRef} style={rowStyle}>
        {children}
      </div>
    </div>
  );
}
