import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Wand2 } from 'lucide-react';
import type { CursorFrame } from '@/lib/cursorTracker';
import type { SpotlightRegion } from './types';
import {
  generateAutoSpotlightRegions,
  type AutoSpotlightConfig,
  DEFAULT_AUTO_SPOTLIGHT_CONFIG,
} from '@/lib/autoSpotlight';
import type { AutoZoomSensitivity } from '@/lib/autoZoom';

interface AutoSpotlightPopoverProps {
  cursorData: CursorFrame[];
  spotlightRegions: SpotlightRegion[];
  onApply: (newRegions: SpotlightRegion[], nextId: number) => void;
  nextSpotlightId: number;
  disabled?: boolean;
}

const SENSITIVITY_OPTIONS: Array<{ value: AutoZoomSensitivity; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function AutoSpotlightPopover({
  cursorData,
  spotlightRegions,
  onApply,
  nextSpotlightId,
  disabled = false,
}: AutoSpotlightPopoverProps) {
  const [config, setConfig] = useState<AutoSpotlightConfig>(DEFAULT_AUTO_SPOTLIGHT_CONFIG);
  const [open, setOpen] = useState(false);

  const handleGenerate = () => {
    const { regions, nextId } = generateAutoSpotlightRegions(
      cursorData,
      spotlightRegions,
      config,
      nextSpotlightId,
    );

    if (regions.length === 0) {
      toast.info('No spotlight regions detected. Try increasing sensitivity or recording with more cursor activity.');
      return;
    }

    onApply(regions, nextId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-purple-400 hover:bg-purple-500/10 transition-all"
          title="Auto Spotlight"
          disabled={disabled || cursorData.length === 0}
        >
          <Wand2 className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3 bg-popover border border-border/40"
        side="top"
        sideOffset={8}
      >
        <div className="space-y-3">
          <div className="text-[10px] font-medium text-foreground/80">Auto Spotlight</div>

          {/* Sensitivity */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1.5">Sensitivity</div>
            <div className="bg-secondary border border-border/30 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
              {SENSITIVITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setConfig(prev => ({ ...prev, sensitivity: option.value }))}
                  className={`rounded-md transition-all text-[10px] font-medium ${
                    config.sensitivity === option.value
                      ? 'bg-white text-black'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Duration */}
          <div className="p-2 rounded-lg bg-secondary border border-border/30">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] font-medium text-foreground/80">Min Duration</div>
              <span className="text-[10px] text-muted-foreground font-mono">{config.minDurationMs}ms</span>
            </div>
            <Slider
              value={[config.minDurationMs]}
              onValueChange={([v]) => setConfig(prev => ({ ...prev, minDurationMs: v }))}
              min={300}
              max={3000}
              step={100}
              className="w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
            />
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            className="w-full h-7 text-[10px] bg-purple-600 hover:bg-purple-500 text-white"
            disabled={cursorData.length < 10}
          >
            Generate
          </Button>

          {cursorData.length < 10 && (
            <p className="text-[10px] text-muted-foreground">Not enough cursor data for auto-spotlight.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
