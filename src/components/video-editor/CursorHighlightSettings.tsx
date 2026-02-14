import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { type CursorHighlightConfig, type CursorType } from "@/lib/cursorTracker";
import type { CursorSmoothingStrength } from "@/lib/cursorSmoothing";

interface CursorHighlightSettingsProps {
  config: CursorHighlightConfig;
  onChange: (config: CursorHighlightConfig) => void;
  hasCursorData: boolean;
}

const STYLE_OPTIONS: Array<{ value: CursorHighlightConfig['style']; label: string }> = [
  { value: 'circle', label: 'Circle' },
  { value: 'spotlight', label: 'Spotlight' },
  { value: 'ring', label: 'Ring' },
];

const CURSOR_TYPE_OPTIONS: Array<{ value: CursorType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'native', label: 'Native' },
  { value: 'default', label: 'Arrow' },
  { value: 'circle', label: 'Circle' },
  { value: 'dot', label: 'Dot' },
  { value: 'crosshair', label: 'Cross' },
];

const CURSOR_TYPE_OPTIONS_CURSOR_FREE: Array<{ value: CursorType; label: string }> = [
  { value: 'native', label: 'Native' },
  { value: 'default', label: 'Arrow' },
  { value: 'circle', label: 'Circle' },
  { value: 'dot', label: 'Dot' },
  { value: 'crosshair', label: 'Cross' },
];

const SMOOTHING_OPTIONS: Array<{ value: CursorSmoothingStrength; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' },
];

const COLOR_PRESETS = [
  '#FFDD00', // Yellow (default)
  '#FF4444', // Red
  '#3B82F6', // Green
  '#4A90D9', // Blue
  '#FF8C00', // Orange
  '#FFFFFF', // White
];

export function CursorHighlightSettings({ config, onChange, hasCursorData }: CursorHighlightSettingsProps) {
  const update = (partial: Partial<CursorHighlightConfig>) => {
    onChange({ ...config, ...partial });
  };

  const isCursorFree = config.cursorFree === true;
  const cursorTypeOptions = isCursorFree ? CURSOR_TYPE_OPTIONS_CURSOR_FREE : CURSOR_TYPE_OPTIONS;

  return (
    <div className="space-y-3">
      {!hasCursorData && (
        <p className="text-[10px] text-muted-foreground">No cursor data available for this recording.</p>
      )}

      {/* Cursor type & smoothing — always visible for cursor-free recordings */}
      {hasCursorData && (isCursorFree || config.enabled) && (
        <>
          {/* Cursor type selector */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1.5">Cursor</div>
            <div className={`bg-secondary border border-border/30 p-0.5 w-full grid h-7 rounded-lg`} style={{ gridTemplateColumns: `repeat(${cursorTypeOptions.length}, 1fr)` }}>
              {cursorTypeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => update({ cursorType: option.value })}
                  className={`rounded-md transition-all text-[10px] font-medium ${
                    (config.cursorType ?? 'none') === option.value
                      ? 'bg-white text-black'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cursor size slider */}
          {(config.cursorType ?? 'none') !== 'none' && (
            <div className="p-2 rounded-lg bg-secondary border border-border/30">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-medium text-foreground/80">Cursor Size</div>
                <span className="text-[10px] text-muted-foreground font-mono">{(config.cursorScale ?? 1.0).toFixed(1)}x</span>
              </div>
              <Slider
                value={[config.cursorScale ?? 1.0]}
                onValueChange={([v]) => update({ cursorScale: v })}
                min={0.5}
                max={3.0}
                step={0.1}
                className="w-full [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
              />
            </div>
          )}

          {/* Smoothing selector */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1.5">Smoothing</div>
            <div className="bg-secondary border border-border/30 p-0.5 w-full grid grid-cols-4 h-7 rounded-lg">
              {SMOOTHING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => update({ smoothing: option.value })}
                  className={`rounded-md transition-all text-[10px] font-medium ${
                    config.smoothing === option.value
                      ? 'bg-white text-black'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Highlight toggle + settings */}
      {hasCursorData && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-medium text-foreground/80">Highlight</div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
              className="scale-90"
            />
          </div>

          {config.enabled && (
            <>
              {/* Color presets */}
              <div>
                <div className="text-[10px] text-muted-foreground mb-1.5">Color</div>
                <div className="flex gap-1.5">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      onClick={() => update({ color })}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        config.color === color
                          ? 'border-white scale-110'
                          : 'border-border/40 hover:border-border/60'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Opacity slider */}
              <div className="p-2 rounded-lg bg-secondary border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-medium text-foreground/80">Opacity</div>
                  <span className="text-[10px] text-muted-foreground font-mono">{Math.round(config.opacity * 100)}%</span>
                </div>
                <Slider
                  value={[config.opacity]}
                  onValueChange={([v]) => update({ opacity: v })}
                  min={0.05}
                  max={1}
                  step={0.05}
                  className="w-full [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                />
              </div>

              {/* Size slider */}
              <div className="p-2 rounded-lg bg-secondary border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-medium text-foreground/80">Size</div>
                  <span className="text-[10px] text-muted-foreground font-mono">{config.size}px</span>
                </div>
                <Slider
                  value={[config.size]}
                  onValueChange={([v]) => update({ size: v })}
                  min={5}
                  max={50}
                  step={1}
                  className="w-full [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                />
              </div>

              {/* Style selector */}
              <div>
                <div className="text-[10px] text-muted-foreground mb-1.5">Style</div>
                <div className="bg-secondary border border-border/30 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
                  {STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => update({ style: option.value })}
                      className={`rounded-md transition-all text-[10px] font-medium ${
                        config.style === option.value
                          ? 'bg-white text-black'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
