import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Trash2, Diamond, Pause } from "lucide-react";
import type { SpotlightRegion, SpotlightAnimProperty } from "./types";

interface SpotlightSettingsPanelProps {
  spotlight: SpotlightRegion;
  onDimOpacityChange: (opacity: number) => void;
  onBorderRadiusChange: (radius: number) => void;
  onDelete: () => void;
  // Animation props
  playheadInsideSpotlight?: boolean;
  activeValues?: { x: number; y: number; width: number; height: number };
  currentKeyframeTime?: number;
  onAddPoint?: () => void;
  onHoldPoint?: () => void;
  onPropertyChange?: (property: SpotlightAnimProperty, value: number) => void;
}

export function SpotlightSettingsPanel({
  spotlight,
  onDimOpacityChange,
  onBorderRadiusChange,
  onDelete,
  playheadInsideSpotlight = false,
  activeValues,
  currentKeyframeTime,
  onAddPoint,
  onHoldPoint,
  onPropertyChange,
}: SpotlightSettingsPanelProps) {
  const hasKeyframes = spotlight.keyframes && spotlight.keyframes.length > 0;
  const isAtKeyframe = currentKeyframeTime !== undefined;

  // Use animated values when available, otherwise static values
  const displayX = activeValues?.x ?? spotlight.x;
  const displayY = activeValues?.y ?? spotlight.y;
  const displayWidth = activeValues?.width ?? spotlight.width;
  const displayHeight = activeValues?.height ?? spotlight.height;

  // Sliders are editable when at a keyframe time, or when spotlight has no keyframes (static editing)
  const slidersEditable = !hasKeyframes || isAtKeyframe;

  return (
    <div className="flex-[2] min-w-0 bg-background border border-border/30 rounded-lg font-sans flex flex-col shadow-xl h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-0">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-foreground">Spotlight</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
            onClick={onDelete}
            title="Delete spotlight"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Dim Opacity */}
        <div className="p-3 rounded-lg bg-secondary border border-border/30 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-foreground/80">Dim Opacity</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {Math.round(spotlight.dimOpacity * 100)}%
            </span>
          </div>
          <Slider
            value={[spotlight.dimOpacity * 100]}
            onValueChange={([v]) => onDimOpacityChange(v / 100)}
            min={0}
            max={100}
            step={5}
            className="w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
          />
        </div>

        {/* Border Radius */}
        <div className="p-3 rounded-lg bg-secondary border border-border/30 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-foreground/80">Border Radius</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {spotlight.borderRadius}px
            </span>
          </div>
          <Slider
            value={[spotlight.borderRadius]}
            onValueChange={([v]) => onBorderRadiusChange(v)}
            min={0}
            max={32}
            step={1}
            className="w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
          />
        </div>

        {/* Animation Points Section */}
        {onAddPoint && (
          <div className="p-3 rounded-lg bg-secondary border border-border/30 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-foreground/80">Animation</span>
              {hasKeyframes && (
                <span className="text-[10px] text-purple-400 font-mono">
                  {new Set(spotlight.keyframes!.filter(kf => kf.source === 'spotlight').map(kf => kf.timeMs)).size} points
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
                onClick={onAddPoint}
                disabled={!playheadInsideSpotlight}
                title={playheadInsideSpotlight ? "Add animation point at playhead" : "Move playhead inside spotlight first"}
              >
                <Diamond className="w-3 h-3" />
                Add Point
              </Button>
              {hasKeyframes && onHoldPoint && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
                  onClick={onHoldPoint}
                  disabled={!playheadInsideSpotlight}
                  title="Hold position from previous point"
                >
                  <Pause className="w-3 h-3" />
                  Hold Here
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Position & Size Sliders — shown when spotlight has keyframes */}
        {hasKeyframes && onPropertyChange && (
          <>
            {/* Position X */}
            <div className="p-3 rounded-lg bg-secondary border border-border/30 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-foreground/80">Position X</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {Math.round(displayX)}%
                </span>
              </div>
              <Slider
                value={[displayX]}
                onValueChange={([v]) => onPropertyChange('x', v)}
                min={0}
                max={100}
                step={0.5}
                disabled={!slidersEditable}
                className="w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
              />
            </div>

            {/* Position Y */}
            <div className="p-3 rounded-lg bg-secondary border border-border/30 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-foreground/80">Position Y</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {Math.round(displayY)}%
                </span>
              </div>
              <Slider
                value={[displayY]}
                onValueChange={([v]) => onPropertyChange('y', v)}
                min={0}
                max={100}
                step={0.5}
                disabled={!slidersEditable}
                className="w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
              />
            </div>

            {/* Width */}
            <div className="p-3 rounded-lg bg-secondary border border-border/30 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-foreground/80">Width</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {Math.round(displayWidth)}%
                </span>
              </div>
              <Slider
                value={[displayWidth]}
                onValueChange={([v]) => onPropertyChange('width', v)}
                min={5}
                max={100}
                step={0.5}
                disabled={!slidersEditable}
                className="w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
              />
            </div>

            {/* Height */}
            <div className="p-3 rounded-lg bg-secondary border border-border/30 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-foreground/80">Height</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {Math.round(displayHeight)}%
                </span>
              </div>
              <Slider
                value={[displayHeight]}
                onValueChange={([v]) => onPropertyChange('height', v)}
                min={5}
                max={100}
                step={0.5}
                disabled={!slidersEditable}
                className="w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
              />
            </div>

            {/* Hint when not at keyframe */}
            {!slidersEditable && (
              <p className="text-[10px] text-muted-foreground/60 text-center px-2 mb-3">
                Move to a point or add one to edit position/size
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
