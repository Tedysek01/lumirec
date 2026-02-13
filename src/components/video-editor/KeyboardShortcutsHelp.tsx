import { HelpCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { formatShortcut } from "@/utils/platformUtils";

export function KeyboardShortcutsHelp() {
  const [shortcuts, setShortcuts] = useState({
    delete: 'Ctrl + D',
    pan: 'Shift + Ctrl + Scroll',
    zoom: 'Ctrl + Scroll',
    undo: 'Ctrl + Z',
    redo: 'Shift + Ctrl + Z',
    save: 'Ctrl + S',
    open: 'Ctrl + O',
    export: 'Ctrl + E',
  });

  useEffect(() => {
    Promise.all([
      formatShortcut(['mod', 'D']),
      formatShortcut(['shift', 'mod', 'Scroll']),
      formatShortcut(['mod', 'Scroll']),
      formatShortcut(['mod', 'Z']),
      formatShortcut(['shift', 'mod', 'Z']),
      formatShortcut(['mod', 'S']),
      formatShortcut(['mod', 'O']),
      formatShortcut(['mod', 'E']),
    ]).then(([deleteKey, panKey, zoomKey, undoKey, redoKey, saveKey, openKey, exportKey]) => {
      setShortcuts({
        delete: deleteKey,
        pan: panKey,
        zoom: zoomKey,
        undo: undoKey,
        redo: redoKey,
        save: saveKey,
        open: openKey,
        export: exportKey,
      });
    });
  }, []);

  return (
    <div className="relative group">
      <HelpCircle className="w-4 h-4 text-muted-foreground hover:text-primary transition-colors cursor-help" />
      <div className="absolute right-0 top-full mt-2 w-64 bg-background border border-border/40 rounded-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 shadow-xl z-50">
        <div className="text-xs font-semibold text-foreground mb-2">Keyboard Shortcuts</div>
        <div className="space-y-1.5 text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Undo</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.undo}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Redo</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.redo}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Save Project</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.save}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Open Project</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.open}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Export</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.export}</kbd>
          </div>
          <div className="my-1.5 border-t border-border/30" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Add Zoom</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">Z</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Add Annotation</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">A</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Add Keyframe</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">F</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Add Trim</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">T</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Delete Selected</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.delete}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pan Timeline</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.pan}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Zoom Timeline</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">{shortcuts.zoom}</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pause/Play</span>
            <kbd className="px-1 py-0.5 bg-secondary border border-border/40 rounded text-primary font-mono">Space</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
