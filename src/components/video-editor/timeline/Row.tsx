import { useRow } from "dnd-timeline";
import type { RowDefinition } from "dnd-timeline";

interface RowProps extends RowDefinition {
  children: React.ReactNode;
  overlay?: boolean;
}

export default function Row({ id, children, overlay = false }: RowProps) {
  const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

  return (
    <div
      className="border-b border-border bg-surface-0"
      style={{
        ...rowWrapperStyle,
        ...(overlay
          ? { position: 'absolute' as const, inset: 0, pointerEvents: 'none' as const, zIndex: 20, minHeight: 'unset', marginBottom: 0, border: 'none', background: 'transparent' }
          : { minHeight: 48, marginBottom: 4 }),
      }}
    >
      <div ref={setNodeRef} style={{ ...rowStyle, ...(overlay ? { height: '100%' } : {}) }}>
        {children}
      </div>
    </div>
  );
}