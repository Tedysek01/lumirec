import { Slider } from "@/components/ui/slider";
import type { TransitionConfig, TransitionType } from "./types";

interface TransitionSettingsPanelProps {
  enterTransition: TransitionConfig;
  exitTransition: TransitionConfig;
  onEnterChange: (config: TransitionConfig) => void;
  onExitChange: (config: TransitionConfig) => void;
}

const TRANSITION_OPTIONS: Array<{ value: TransitionType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-left', label: 'Slide L' },
  { value: 'slide-right', label: 'Slide R' },
  { value: 'zoom-in', label: 'Zoom In' },
  { value: 'zoom-out', label: 'Zoom Out' },
];

function TransitionRow({
  label,
  config,
  onChange,
}: {
  label: string;
  config: TransitionConfig;
  onChange: (config: TransitionConfig) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="bg-secondary border border-border/30 p-0.5 w-full grid grid-cols-6 h-7 rounded-lg">
        {TRANSITION_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange({ ...config, type: option.value })}
            className={`rounded-md transition-all text-[9px] font-medium ${
              config.type === option.value
                ? 'bg-white text-black'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {config.type !== 'none' && (
        <div className="p-2 rounded-lg bg-secondary border border-border/30">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-medium text-foreground/80">Duration</div>
            <span className="text-[10px] text-muted-foreground font-mono">{config.durationMs}ms</span>
          </div>
          <Slider
            value={[config.durationMs]}
            onValueChange={([v]) => onChange({ ...config, durationMs: v })}
            min={100}
            max={1000}
            step={50}
            className="w-full [&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
          />
        </div>
      )}
    </div>
  );
}

export function TransitionSettingsPanel({
  enterTransition,
  exitTransition,
  onEnterChange,
  onExitChange,
}: TransitionSettingsPanelProps) {
  return (
    <div className="space-y-3">
      <TransitionRow
        label="Enter Transition"
        config={enterTransition}
        onChange={onEnterChange}
      />
      <TransitionRow
        label="Exit Transition"
        config={exitTransition}
        onChange={onExitChange}
      />
    </div>
  );
}
