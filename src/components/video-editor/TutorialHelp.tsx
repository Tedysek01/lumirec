import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    HelpCircle,
    ZoomIn,
    Lightbulb,
    MessageSquare,
    Scissors,
    Diamond,
    MousePointerClick,
} from "lucide-react";

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-accent/80 border border-border/50 rounded text-[10px] font-mono text-foreground/90 leading-none">
            {children}
        </kbd>
    );
}

function FeatureRow({
    icon,
    color,
    label,
    shortcut,
    description,
}: {
    icon: React.ReactNode;
    color: string;
    label: string;
    shortcut: string;
    description: string;
}) {
    return (
        <div className="flex items-start gap-3 py-2">
            <div
                className="mt-0.5 w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: `${color}20`, color }}
            >
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <Kbd>{shortcut}</Kbd>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
            </div>
        </div>
    );
}

export function TutorialHelp() {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-all gap-1.5"
                >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span className="font-medium">Editor guide</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg bg-background border-border/40 [&>button]:text-muted-foreground [&>button:hover]:text-white">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold text-foreground">
                        Editor Guide
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Timeline tools and keyboard shortcuts.
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-2 space-y-5">
                    {/* Timeline tools */}
                    <div>
                        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">
                            Timeline tools
                        </h3>
                        <div className="divide-y divide-border/20">
                            <FeatureRow
                                icon={<ZoomIn className="w-3.5 h-3.5" />}
                                color="#3B82F6"
                                label="Zoom"
                                shortcut="Z"
                                description="Add a zoom region at the playhead. Drag edges to adjust timing, use the settings panel to set zoom level and focus point."
                            />
                            <FeatureRow
                                icon={<Lightbulb className="w-3.5 h-3.5" />}
                                color="#7C3AED"
                                label="Spotlight"
                                shortcut="S"
                                description="Dim the screen and highlight a specific area. Great for drawing attention to UI elements in demos."
                            />
                            <FeatureRow
                                icon={<MessageSquare className="w-3.5 h-3.5" />}
                                color="#D97706"
                                label="Annotation"
                                shortcut="A"
                                description="Add text, images, or shapes on top of the video. Drag to position, resize with handles."
                            />
                            <FeatureRow
                                icon={<Diamond className="w-3.5 h-3.5" />}
                                color="#FFE100"
                                label="Keyframe"
                                shortcut="F"
                                description="Add a keyframe at the playhead to animate transforms (rotation, scale, position) over time."
                            />
                            <FeatureRow
                                icon={<Scissors className="w-3.5 h-3.5" />}
                                color="#EF4444"
                                label="Razor / Split"
                                shortcut="C"
                                description="Activate the razor tool to click on a segment and split it. Press V to switch back to the select tool."
                            />
                        </div>
                    </div>

                    {/* Keyboard shortcuts */}
                    <div>
                        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                            Keyboard shortcuts
                        </h3>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Play / Pause</span>
                                <Kbd>Space</Kbd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Split at playhead</span>
                                <div className="flex gap-0.5"><Kbd>⌘</Kbd><Kbd>B</Kbd></div>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Delete selected</span>
                                <Kbd>⌫</Kbd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Cycle annotations</span>
                                <Kbd>Tab</Kbd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Razor tool</span>
                                <Kbd>C</Kbd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Select tool</span>
                                <Kbd>V</Kbd>
                            </div>
                        </div>
                    </div>

                    {/* Navigation */}
                    <div>
                        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                            Navigation
                        </h3>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Pan timeline</span>
                                <span className="text-muted-foreground/60 flex items-center gap-1">
                                    <MousePointerClick className="w-3 h-3" /> Scroll horizontally
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Zoom timeline</span>
                                <div className="flex gap-0.5"><Kbd>⌘</Kbd><span className="text-muted-foreground/60 text-[10px]">+ Scroll</span></div>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">Seek</span>
                                <span className="text-muted-foreground/60 text-[10px]">Click timeline</span>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
