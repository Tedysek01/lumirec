import { useRef } from "react";
import { Rnd } from "react-rnd";
import type { SpotlightRegion } from "./types";
import { cn } from "@/lib/utils";

interface SpotlightOverlayProps {
  spotlight: SpotlightRegion;
  isSelected: boolean;
  containerWidth: number;
  containerHeight: number;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSizeChange: (id: string, size: { width: number; height: number }) => void;
  onClick: (id: string) => void;
}

export function SpotlightOverlay({
  spotlight,
  isSelected,
  containerWidth,
  containerHeight,
  onPositionChange,
  onSizeChange,
  onClick,
}: SpotlightOverlayProps) {
  const x = (spotlight.x / 100) * containerWidth;
  const y = (spotlight.y / 100) * containerHeight;
  const width = (spotlight.width / 100) * containerWidth;
  const height = (spotlight.height / 100) * containerHeight;

  const isDraggingRef = useRef(false);

  return (
    <Rnd
      position={{ x, y }}
      size={{ width, height }}
      onDragStart={() => {
        isDraggingRef.current = true;
      }}
      onDragStop={(_e, d) => {
        const xPercent = (d.x / containerWidth) * 100;
        const yPercent = (d.y / containerHeight) * 100;
        onPositionChange(spotlight.id, { x: xPercent, y: yPercent });
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 100);
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        const xPercent = (position.x / containerWidth) * 100;
        const yPercent = (position.y / containerHeight) * 100;
        const widthPercent = (ref.offsetWidth / containerWidth) * 100;
        const heightPercent = (ref.offsetHeight / containerHeight) * 100;
        onPositionChange(spotlight.id, { x: xPercent, y: yPercent });
        onSizeChange(spotlight.id, { width: widthPercent, height: heightPercent });
      }}
      onClick={() => {
        if (isDraggingRef.current) return;
        onClick(spotlight.id);
      }}
      bounds="parent"
      className={cn(
        "cursor-move transition-all",
        isSelected && "ring-2 ring-purple-500 ring-offset-2 ring-offset-transparent"
      )}
      style={{
        zIndex: isSelected ? 900 : 800,
        pointerEvents: isSelected ? 'auto' : 'none',
        border: isSelected ? '2px dashed rgba(139, 92, 246, 0.8)' : '2px dashed rgba(139, 92, 246, 0.4)',
        backgroundColor: 'transparent',
        boxShadow: isSelected ? '0 0 0 1px rgba(139, 92, 246, 0.35)' : 'none',
        borderRadius: `${spotlight.borderRadius}px`,
      }}
      enableResizing={isSelected}
      disableDragging={!isSelected}
      resizeHandleStyles={{
        topLeft: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #8B5CF6' : 'none',
          borderRadius: '50%',
          left: '-6px',
          top: '-6px',
          cursor: 'nwse-resize',
        },
        topRight: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #8B5CF6' : 'none',
          borderRadius: '50%',
          right: '-6px',
          top: '-6px',
          cursor: 'nesw-resize',
        },
        bottomLeft: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #8B5CF6' : 'none',
          borderRadius: '50%',
          left: '-6px',
          bottom: '-6px',
          cursor: 'nesw-resize',
        },
        bottomRight: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #8B5CF6' : 'none',
          borderRadius: '50%',
          right: '-6px',
          bottom: '-6px',
          cursor: 'nwse-resize',
        },
      }}
    >
      <div
        className="w-full h-full"
        style={{ borderRadius: `${spotlight.borderRadius}px` }}
      />
    </Rnd>
  );
}
