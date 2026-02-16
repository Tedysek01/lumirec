

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import PlaybackControls from "./PlaybackControls";
import TimelineEditor from "./timeline/TimelineEditor";
import { SettingsPanel } from "./SettingsPanel";
import { ExportDialog } from "./ExportDialog";

import type { Span } from "dnd-timeline";
import {
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIGURE_DATA,
  DEFAULT_SEGMENT_TRANSFORM,
  DEFAULT_SPOTLIGHT_REGION,
  DEFAULT_TRANSITION_CONFIG,
  ZOOM_DEPTH_SCALES,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type TrimRegion,
  type AnnotationRegion,
  type SpotlightRegion,
  type VideoSegment,
  type FigureData,
} from "./types";
import { generateZoomKeyframes } from "@/lib/zoomKeyframeGenerator";
import {
  resolveTransformAtTime,
  findNearestKeyframeTime,
  upsertKeyframe,
  upsertAllPropertiesAtTime,
  removeKeyframesAtTime,
  moveKeyframesAtTime,
  isZoomKeyframe,
  getUniquePanPointTimes,
  getLastPanPointFocus,
  getFirstPanPointFocus,
  clampToPanRange,
  syncZoomBoundaries,
  resolveSpotlightAtTime,
  getUniqueSpotlightPointTimes,
  upsertAllSpotlightPropertiesAtTime,
  upsertSpotlightKeyframe,
} from "@/lib/keyframeInterpolation";
import type { SpotlightAnimProperty } from "./types";
import {
  createInitialSegment,
  splitSegment,
  rippleSegments,
  findSegmentAtSourceTime,
  migrateFromTrimRegions,
  sourceToDisplayTime,
  displayToSourceTime,
  getTotalTimelineDuration,
} from "@/lib/segmentUtils";
import { VideoExporter, GifExporter, type ExportProgress, type ExportQuality, type ExportSettings, type ExportFormat, type GifFrameRate, type GifSizePreset, GIF_SIZE_PRESETS, calculateOutputDimensions } from "@/lib/exporter";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { remapEditorStateForAspectRatio } from "@/lib/aspectRatioRemap";
import { getAssetPath } from "@/lib/assetPath";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { type EditorUndoableState, createInitialEditorState } from "./editorState";
import { useProjectFile } from "@/hooks/useProjectFile";
import type { ProjectFileData } from "@/lib/projectFile";
import type { CursorFrame } from "@/lib/cursorTracker";

const WALLPAPER_COUNT = 18;
const WALLPAPER_PATHS = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `/wallpapers/wallpaper${i + 1}.jpg`);

export default function VideoEditor() {
  // --- Undoable state (project data) ---
  const {
    state: editorState,
    setState: setEditorState,
    setStateDebounced: setEditorStateDebounced,
    undo,
    redo,
    resetState: resetEditorState,
  } = useUndoRedo<EditorUndoableState>(createInitialEditorState(WALLPAPER_PATHS[0]));

  // Destructure undoable state for convenient access
  const {
    wallpaper, shadowIntensity, showBlur, motionBlurEnabled,
    borderRadius, padding, cropRegion, zoomRegions,
    trimRegions, videoSegments, annotationRegions, spotlightRegions, aspectRatio, cursorHighlight,
  } = editorState;

  // --- Transient state (not undoable) ---
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedSpotlightId, setSelectedSpotlightId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [razorToolActive, setRazorToolActive] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportQuality, setExportQuality] = useState<ExportQuality>('good');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mp4');
  const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(15);
  const [gifLoop, setGifLoop] = useState(true);
  const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>('medium');
  const [cursorData, setCursorData] = useState<CursorFrame[]>([]);

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
  const nextZoomIdRef = useRef(1);
  const nextTrimIdRef = useRef(1);
  const nextAnnotationIdRef = useRef(1);
  const nextAnnotationZIndexRef = useRef(1);
  const nextSpotlightIdRef = useRef(1);
  const exporterRef = useRef<VideoExporter | null>(null);

  // --- Undoable state updater helpers ---
  // Discrete updates (push undo snapshot immediately)
  const updateState = useCallback(<K extends keyof EditorUndoableState>(key: K, value: EditorUndoableState[K]) => {
    setEditorState(prev => ({ ...prev, [key]: value }));
  }, [setEditorState]);

  // Debounced updates for sliders (one undo per drag gesture)
  const updateStateDebounced = useCallback(<K extends keyof EditorUndoableState>(key: K, value: EditorUndoableState[K]) => {
    setEditorStateDebounced(prev => ({ ...prev, [key]: value }));
  }, [setEditorStateDebounced]);

  // Aspect ratio change with automatic position remapping
  const handleAspectRatioChange = useCallback((newAspectRatio: AspectRatio) => {
    const video = videoPlaybackRef.current?.video;
    const videoNativeWidth = video?.videoWidth || 1920;
    const videoNativeHeight = video?.videoHeight || 1080;
    setEditorState(prev => remapEditorStateForAspectRatio(
      prev, newAspectRatio, videoNativeWidth, videoNativeHeight,
    ));
  }, [setEditorState]);

  // --- Project Save/Load ---
  const handleLoadProject = useCallback((data: ProjectFileData, videoUrl: string) => {
    // Reset editor state (clears undo history)
    resetEditorState(data.editorState);
    // Set video path
    setVideoPath(videoUrl);
    window.electronAPI.setCurrentVideoPath(videoUrl.replace(/^file:\/\//, ''));
    // Restore export settings
    if (data.exportSettings) {
      setExportQuality(data.exportSettings.quality);
      setExportFormat(data.exportSettings.format);
      setGifFrameRate(data.exportSettings.gifFrameRate);
      setGifLoop(data.exportSettings.gifLoop);
      setGifSizePreset(data.exportSettings.gifSizePreset);
    }
    // Reset selections
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
    setSelectedSpotlightId(null);
    setSelectedSegmentId(null);
    setRazorToolActive(false);
    // Reset ID counters based on loaded data
    const maxZoomId = data.editorState.zoomRegions.reduce((max, r) => {
      const num = parseInt(r.id.replace('zoom-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const maxTrimId = data.editorState.trimRegions.reduce((max, r) => {
      const num = parseInt(r.id.replace('trim-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const maxAnnotationId = data.editorState.annotationRegions.reduce((max, r) => {
      const num = parseInt(r.id.replace('annotation-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const maxSpotlightId = (data.editorState.spotlightRegions || []).reduce((max, r) => {
      const num = parseInt(r.id.replace('spotlight-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const maxZIndex = data.editorState.annotationRegions.reduce((max, r) => Math.max(max, r.zIndex || 0), 0);
    nextZoomIdRef.current = maxZoomId + 1;
    nextTrimIdRef.current = maxTrimId + 1;
    nextAnnotationIdRef.current = maxAnnotationId + 1;
    nextAnnotationZIndexRef.current = maxZIndex + 1;
    nextSpotlightIdRef.current = maxSpotlightId + 1;
  }, [resetEditorState]);

  const { saveProject, saveProjectAs, openProject } = useProjectFile({
    videoPath,
    editorState,
    exportSettings: {
      quality: exportQuality,
      format: exportFormat,
      gifFrameRate,
      gifLoop,
      gifSizePreset,
    },
    onLoadProject: handleLoadProject,
  });

  // Helper to convert file path to proper file:// URL
  const toFileUrl = (filePath: string): string => {
    // Normalize path separators to forward slashes
    const normalized = filePath.replace(/\\/g, '/');
    
    // Check if it's a Windows absolute path (e.g., C:/Users/...)
    if (normalized.match(/^[a-zA-Z]:/)) {
      const fileUrl = `file:///${normalized}`;
      return fileUrl;
    }
    
    // Unix-style absolute path
    const fileUrl = `file://${normalized}`;
    return fileUrl;
  };

  useEffect(() => {
    async function loadVideo() {
      try {
        const result = await window.electronAPI.getCurrentVideoPath();
        
        if (result.success && result.path) {
          const videoUrl = toFileUrl(result.path);
          setVideoPath(videoUrl);
        } else {
          setError('No video to load. Please record or select a video.');
        }
      } catch (err) {
        setError('Error loading video: ' + String(err));
      } finally {
        setLoading(false);
      }
    }
    loadVideo();
  }, []);

  // Load cursor data when video path changes
  useEffect(() => {
    if (!videoPath) {
      setCursorData([]);
      return;
    }
    // Convert file:// URL back to file path for the IPC call
    const filePath = videoPath.replace(/^file:\/\//, '');
    window.electronAPI.getCursorData(filePath).then((result) => {
      if (result.success && result.frames && result.frames.length > 0) {
        setCursorData(result.frames);

        // Mark cursor-free recordings so the pointer always renders (no native cursor in video)
        if (result.cursorFree) {
          setEditorState(prev => ({
            ...prev,
            cursorHighlight: {
              ...prev.cursorHighlight,
              cursorFree: true,
              cursorType: prev.cursorHighlight.cursorType === 'none' ? 'native' : prev.cursorHighlight.cursorType,
            },
          }));
        }
      } else {
        setCursorData([]);
      }
    }).catch(() => {
      setCursorData([]);
    });
  }, [videoPath]);

  // Initialize video segments when duration becomes available
  // Also handles migration from trim regions for backwards compatibility
  useEffect(() => {
    if (duration <= 0) return;
    const totalMs = Math.round(duration * 1000);
    // Only initialize if no segments exist yet
    if (videoSegments.length === 0) {
      if (trimRegions.length > 0) {
        // Migrate: invert trim regions into kept segments
        const migrated = migrateFromTrimRegions(trimRegions, totalMs);
        setEditorState(prev => ({ ...prev, videoSegments: migrated }));
      } else {
        const initialSegment = createInitialSegment(totalMs);
        setEditorState(prev => ({ ...prev, videoSegments: [initialSegment] }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  // Initialize default wallpaper with resolved asset path (no undo snapshot for init)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resolvedPath = await getAssetPath('wallpapers/wallpaper1.jpg');
        if (mounted) {
          resetEditorState({ ...editorState, wallpaper: resolvedPath });
        }
      } catch (err) {
        console.warn('Failed to resolve default wallpaper path:', err);
      }
    })();
    return () => { mounted = false };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlayPause = useCallback(() => {
    const playback = videoPlaybackRef.current;
    const video = playback?.video;
    if (!playback || !video) return;

    if (video.paused) {
      playback.play().catch(err => console.error('Video play failed:', err));
    } else {
      playback.pause();
    }
  }, []);

  function handleSeek(time: number) {
    const video = videoPlaybackRef.current?.video;
    if (!video) return;
    video.currentTime = time;
  }

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
    if (id) {
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedSpotlightId(null);
      setSelectedSegmentId(null);
    }
  }, []);

  const handleSelectTrim = useCallback((id: string | null) => {
    setSelectedTrimId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedAnnotationId(null);
      setSelectedSpotlightId(null);
      setSelectedSegmentId(null);
    }
  }, []);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedSpotlightId(null);
      setSelectedSegmentId(null);
    }
  }, []);

  const handleSelectSpotlight = useCallback((id: string | null) => {
    setSelectedSpotlightId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedSegmentId(null);
    }
  }, []);

  const handleZoomAdded = useCallback((span: Span) => {
    const startMs = Math.round(span.start);
    const endMs = Math.round(span.end);

    // Also add a zoom region for timeline visualization
    const id = `zoom-${nextZoomIdRef.current++}`;
    const defaultDepth: ZoomDepth = 3;
    const targetZoom = ZOOM_DEPTH_SCALES[defaultDepth];
    const newRegion: ZoomRegion = {
      id,
      startMs,
      endMs,
      depth: defaultDepth,
      focus: { cx: 0.5, cy: 0.5 },
    };

    // Find the segment at this source time and stamp zoom keyframes on it
    setEditorState(prev => {
      const seg = prev.videoSegments.find(s =>
        startMs >= s.sourceStartMs && startMs < s.sourceEndMs
      );
      if (!seg) {
        // No segment found — just add the zoom region for visual reference
        return { ...prev, zoomRegions: [...prev.zoomRegions, newRegion] };
      }

      // Convert source time to relative-to-segment time
      const segRelativeStart = startMs - seg.sourceStartMs;
      const segRelativeEnd = Math.min(endMs - seg.sourceStartMs, seg.sourceEndMs - seg.sourceStartMs);

      const newKeyframes = generateZoomKeyframes({
        startRelativeMs: segRelativeStart,
        endRelativeMs: segRelativeEnd,
        targetZoom,
        focusX: 0.5,
        focusY: 0.5,
      });

      return {
        ...prev,
        zoomRegions: [...prev.zoomRegions, newRegion],
        videoSegments: prev.videoSegments.map(s =>
          s.id === seg.id
            ? { ...s, keyframes: [...s.keyframes, ...newKeyframes] }
            : s
        ),
      };
    });
    setSelectedZoomId(id);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [setEditorState]);

  const handleTrimAdded = useCallback((span: Span) => {
    const id = `trim-${nextTrimIdRef.current++}`;
    const newRegion: TrimRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setEditorState(prev => ({ ...prev, trimRegions: [...prev.trimRegions, newRegion] }));
    setSelectedTrimId(id);
    setSelectedZoomId(null);
    setSelectedAnnotationId(null);
  }, [setEditorState]);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    setEditorState(prev => {
      const region = prev.zoomRegions.find(r => r.id === id);
      if (!region) return prev;

      const newStartMs = Math.round(span.start);
      const newEndMs = Math.round(span.end);

      // Skip if span didn't actually change (e.g. click without drag)
      if (newStartMs === region.startMs && newEndMs === region.endMs) return prev;

      const oldDuration = region.endMs - region.startMs;
      const newDuration = newEndMs - newStartMs;
      const isMove = Math.abs(oldDuration - newDuration) < 2; // pure translation (same duration)
      const delta = newStartMs - region.startMs;

      const updatedSegments = prev.videoSegments.map(seg => {
        const segEnd = seg.sourceEndMs;
        const overlapsOld = region.startMs < segEnd && region.endMs > seg.sourceStartMs;
        const overlapsNew = newStartMs < segEnd && newEndMs > seg.sourceStartMs;
        if (!overlapsOld && !overlapsNew) return seg;

        // Extract old zoom keyframes within the old region range
        const oldRelStart = Math.max(0, region.startMs - seg.sourceStartMs);
        const oldRelEnd = region.endMs - seg.sourceStartMs;
        const nonZoomKfs = seg.keyframes.filter(kf => {
          if (!isZoomKeyframe(kf)) return true;
          return kf.timeMs < oldRelStart - 5 || kf.timeMs > oldRelEnd + 5;
        });

        if (!overlapsNew) return { ...seg, keyframes: nonZoomKfs };

        const enterMs = region.enterTransition?.durationMs ?? 400;
        const exitMs = region.exitTransition?.durationMs ?? 400;

        if (isMove) {
          // Pure move: shift all existing zoom keyframes by the time delta
          const shiftedKfs = seg.keyframes
            .filter(kf => {
              if (!isZoomKeyframe(kf)) return false;
              return kf.timeMs >= oldRelStart - 5 && kf.timeMs <= oldRelEnd + 5;
            })
            .map(kf => ({
              ...kf,
              timeMs: kf.timeMs + delta,
            }))
            // Clamp to segment bounds
            .filter(kf => kf.timeMs >= 0 && kf.timeMs <= (segEnd - seg.sourceStartMs));

          // After shifting, enforce minimum distance of pan points from new boundaries
          const newRelStart = newStartMs - seg.sourceStartMs;
          const newRelEnd = newEndMs - seg.sourceStartMs;
          const clampedShiftedKfs = shiftedKfs.map(kf => {
            if (kf.source !== 'zoom') return kf;
            const clamped = clampToPanRange(kf.timeMs, newRelStart, newRelEnd, enterMs, exitMs);
            return clamped !== kf.timeMs ? { ...kf, timeMs: clamped } : kf;
          });

          let finalKfs = [...nonZoomKfs, ...clampedShiftedKfs];
          finalKfs = syncZoomBoundaries(finalKfs, newRelStart, newRelEnd);
          return { ...seg, keyframes: finalKfs };
        }

        // Resize: preserve user pan points, only regenerate auto-boundary keyframes
        const panPointKfs = seg.keyframes.filter(kf => {
          if (kf.source !== 'zoom') return false;
          // Keep pan points that fall within the NEW region bounds
          const absTime = seg.sourceStartMs + kf.timeMs;
          return absTime >= newStartMs && absTime <= newEndMs;
        });

        // Clamp preserved pan points so they stay outside transition zones
        const clampedStart = Math.max(newStartMs, seg.sourceStartMs);
        const clampedEnd = Math.min(newEndMs, segEnd);
        const newRelStart = clampedStart - seg.sourceStartMs;
        const newRelEnd = clampedEnd - seg.sourceStartMs;
        const clampedPanKfs = panPointKfs.map(kf => {
          const clamped = clampToPanRange(kf.timeMs, newRelStart, newRelEnd, enterMs, exitMs);
          return clamped !== kf.timeMs ? { ...kf, timeMs: clamped } : kf;
        });

        // Use first pan point for zoom-in destination (t2), last for hold-end (t3)
        const firstPan = getFirstPanPointFocus(clampedPanKfs);
        const lastPan = getLastPanPointFocus(clampedPanKfs);
        const panTimes = [...new Set(clampedPanKfs.map(kf => kf.timeMs))].sort((a, b) => a - b);
        const firstPanZoom = panTimes.length > 0
          ? clampedPanKfs.find(kf => Math.abs(kf.timeMs - panTimes[0]) < 5 && kf.property === 'zoom')?.value
          : undefined;
        const lastPanZoom = panTimes.length > 0
          ? clampedPanKfs.find(kf => Math.abs(kf.timeMs - panTimes[panTimes.length - 1]) < 5 && kf.property === 'zoom')?.value
          : undefined;

        const targetZoom = firstPanZoom ?? ZOOM_DEPTH_SCALES[region.depth];
        const newAutoKeyframes = generateZoomKeyframes({
          startRelativeMs: newRelStart,
          endRelativeMs: newRelEnd,
          targetZoom,
          focusX: firstPan?.focusX ?? region.focus.cx,
          focusY: firstPan?.focusY ?? region.focus.cy,
          enterTransitionMs: region.enterTransition?.durationMs,
          exitTransitionMs: region.exitTransition?.durationMs,
          exitFocusX: lastPan?.focusX,
          exitFocusY: lastPan?.focusY,
          exitZoom: lastPanZoom,
        });

        // Remove auto keyframes that collide with preserved pan point times
        const panTimeSet = new Set(clampedPanKfs.map(kf => kf.timeMs));
        const dedupedAutoKfs = newAutoKeyframes.filter(kf =>
          !Array.from(panTimeSet).some(t => Math.abs(t - kf.timeMs) < 5)
        );

        let finalKfs = [...nonZoomKfs, ...clampedPanKfs, ...dedupedAutoKfs];
        finalKfs = syncZoomBoundaries(finalKfs, newRelStart, newRelEnd);
        return { ...seg, keyframes: finalKfs };
      });

      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map(r =>
          r.id === id ? { ...r, startMs: newStartMs, endMs: newEndMs } : r
        ),
        videoSegments: updatedSegments,
      };
    });
  }, [setEditorState]);

  // Current playhead position in source time (ms) — used by focus/zoom handlers
  const sourceTimeMs = Math.round(currentTime * 1000);

  const handleTrimSpanChange = useCallback((id: string, span: Span) => {
    setEditorState(prev => ({
      ...prev,
      trimRegions: prev.trimRegions.map((region) =>
        region.id === id
          ? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
          : region,
      ),
    }));
  }, [setEditorState]);

  const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
    setEditorStateDebounced(prev => {
      const region = prev.zoomRegions.find(r => r.id === id);
      if (!region) return prev;

      // Find the segment containing the current playhead
      const seg = findSegmentAtSourceTime(prev.videoSegments, sourceTimeMs);
      const playheadInZoom = sourceTimeMs >= region.startMs && sourceTimeMs <= region.endMs;

      if (seg && playheadInZoom) {
        // Create/update a pan point at the current playhead position
        const updatedSegments = prev.videoSegments.map(s => {
          if (s.id !== seg.id) return s;
          const regionRelStart = region.startMs - s.sourceStartMs;
          const regionRelEnd = region.endMs - s.sourceStartMs;
          const enterMs = region.enterTransition?.durationMs ?? 400;
          const exitMs = region.exitTransition?.durationMs ?? 400;
          const relTime = clampToPanRange(sourceTimeMs - s.sourceStartMs, regionRelStart, regionRelEnd, enterMs, exitMs);
          let kfs = s.keyframes;
          // Upsert focusX, focusY, and zoom (use target zoom, not interpolated mid-transition value)
          const targetZoom = ZOOM_DEPTH_SCALES[region.depth];
          kfs = upsertKeyframe(kfs, relTime, 'focusX', focus.cx, 'ease-in-out');
          kfs = upsertKeyframe(kfs, relTime, 'focusY', focus.cy, 'ease-in-out');
          kfs = upsertKeyframe(kfs, relTime, 'zoom', targetZoom, 'ease-in-out');
          // Tag as pan points
          kfs = kfs.map(kf => {
            if (Math.abs(kf.timeMs - relTime) < 5 && (kf.property === 'focusX' || kf.property === 'focusY' || kf.property === 'zoom')) {
              return { ...kf, source: 'zoom' as const };
            }
            return kf;
          });
          // Sync t2/t3 auto boundaries + ensure t1/t4 are correct
          kfs = syncZoomBoundaries(kfs, regionRelStart, regionRelEnd);
          return { ...s, keyframes: kfs };
        });

        return {
          ...prev,
          zoomRegions: prev.zoomRegions.map(r =>
            r.id === id ? { ...r, focus } : r
          ),
          videoSegments: updatedSegments,
        };
      }

      // Playhead not in zoom — update auto-generated focus keyframes
      // If pan points exist, they define the focus positions; only update where no pan points override
      const updatedSegments = prev.videoSegments.map(s => {
        if (region.startMs >= s.sourceEndMs || region.endMs <= s.sourceStartMs) return s;
        const segRelStart = Math.max(0, region.startMs - s.sourceStartMs);
        const segRelEnd = Math.min(s.sourceEndMs - s.sourceStartMs, region.endMs - s.sourceStartMs);
        const regionMid = (segRelStart + segRelEnd) / 2;

        // Check if this segment has pan points in this zoom region
        const regionPanPoints = s.keyframes.filter(kf =>
          kf.source === 'zoom' && kf.timeMs >= segRelStart - 5 && kf.timeMs <= segRelEnd + 5
        );
        const firstPan = getFirstPanPointFocus(regionPanPoints);
        const lastPan = getLastPanPointFocus(regionPanPoints);

        let updatedKfs = s.keyframes.map(kf => {
          if (kf.source !== 'zoom-auto') return kf;
          if (kf.timeMs < segRelStart - 5 || kf.timeMs > segRelEnd + 5) return kf;
          // Skip boundary keyframes at t1/t4 (stay at 0.5)
          if (Math.abs(kf.timeMs - segRelStart) < 5 || Math.abs(kf.timeMs - segRelEnd) < 5) return kf;
          // t2 (first half): use first pan point if exists, otherwise region.focus
          if (kf.timeMs < regionMid) {
            if (kf.property === 'focusX') return { ...kf, value: firstPan?.focusX ?? focus.cx };
            if (kf.property === 'focusY') return { ...kf, value: firstPan?.focusY ?? focus.cy };
          }
          // t3 (second half): use last pan point if exists, otherwise region.focus
          if (kf.timeMs >= regionMid) {
            if (kf.property === 'focusX') return { ...kf, value: lastPan?.focusX ?? focus.cx };
            if (kf.property === 'focusY') return { ...kf, value: lastPan?.focusY ?? focus.cy };
          }
          return kf;
        });
        // Ensure t1/t4 boundaries weren't corrupted
        updatedKfs = syncZoomBoundaries(updatedKfs, segRelStart, segRelEnd);
        return { ...s, keyframes: updatedKfs };
      });

      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map(r =>
          r.id === id ? { ...r, focus } : r
        ),
        videoSegments: updatedSegments,
      };
    });
  }, [setEditorStateDebounced, sourceTimeMs]);

  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    setEditorState(prev => {
      const region = prev.zoomRegions.find(r => r.id === selectedZoomId);
      if (!region) return prev;

      const targetZoom = ZOOM_DEPTH_SCALES[depth];

      // Update auto-boundary zoom keyframes only (preserve user pan points)
      const updatedSegments = prev.videoSegments.map(seg => {
        if (region.startMs >= seg.sourceEndMs || region.endMs <= seg.sourceStartMs) return seg;

        const segRelativeStart = Math.max(0, region.startMs - seg.sourceStartMs);
        const segRelativeEnd = Math.min(seg.sourceEndMs - seg.sourceStartMs, region.endMs - seg.sourceStartMs);

        let updatedKeyframes = seg.keyframes.map(kf => {
          // Only update auto-generated boundary keyframes, not user pan points
          if (kf.source !== 'zoom-auto' || kf.property !== 'zoom') return kf;
          if (kf.timeMs < segRelativeStart - 5 || kf.timeMs > segRelativeEnd + 5) return kf;
          // Boundary keyframes (t1/t4) stay at zoom=1
          if (Math.abs(kf.timeMs - segRelativeStart) < 5 || Math.abs(kf.timeMs - segRelativeEnd) < 5) {
            return kf;
          }
          // t2/t3 get the new target zoom (may be overridden by sync below)
          return { ...kf, value: targetZoom };
        });

        // Sync t2/t3 to pan point values (if pan points exist, they take priority)
        // and ensure t1/t4 boundaries are correct
        updatedKeyframes = syncZoomBoundaries(updatedKeyframes, segRelativeStart, segRelativeEnd);

        return { ...seg, keyframes: updatedKeyframes };
      });

      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map(r =>
          r.id === selectedZoomId ? { ...r, depth } : r
        ),
        videoSegments: updatedSegments,
      };
    });
  }, [selectedZoomId, setEditorState]);

  const handleZoomTransitionChange = useCallback((enterMs: number, exitMs: number) => {
    if (!selectedZoomId) return;
    setEditorState(prev => {
      const region = prev.zoomRegions.find(r => r.id === selectedZoomId);
      if (!region) return prev;

      const targetZoom = ZOOM_DEPTH_SCALES[region.depth];

      // Remove old zoom keyframes and regenerate with new timing
      const updatedSegments = prev.videoSegments.map(seg => {
        if (region.startMs >= seg.sourceEndMs || region.endMs <= seg.sourceStartMs) return seg;

        const segRelativeStart = Math.max(0, region.startMs - seg.sourceStartMs);
        const segRelativeEnd = Math.min(seg.sourceEndMs - seg.sourceStartMs, region.endMs - seg.sourceStartMs);

        // Remove old auto-generated keyframes, preserve user pan points
        const nonZoomKfs = seg.keyframes.filter(kf => {
          if (!isZoomKeyframe(kf)) return true;
          return kf.timeMs < segRelativeStart - 5 || kf.timeMs > segRelativeEnd + 5;
        });
        const panPointKfs = seg.keyframes.filter(kf => {
          if (kf.source !== 'zoom') return false;
          return kf.timeMs >= segRelativeStart - 5 && kf.timeMs <= segRelativeEnd + 5;
        });

        // Use first/last pan point for zoom-in/hold-end destinations (focus + zoom)
        const firstPan = getFirstPanPointFocus(panPointKfs);
        const lastPan = getLastPanPointFocus(panPointKfs);
        const panTimes = [...new Set(panPointKfs.map(kf => kf.timeMs))].sort((a, b) => a - b);
        const firstPanZoom = panTimes.length > 0
          ? panPointKfs.find(kf => Math.abs(kf.timeMs - panTimes[0]) < 5 && kf.property === 'zoom')?.value
          : undefined;
        const lastPanZoom = panTimes.length > 0
          ? panPointKfs.find(kf => Math.abs(kf.timeMs - panTimes[panTimes.length - 1]) < 5 && kf.property === 'zoom')?.value
          : undefined;

        // Regenerate with new transition durations
        const newKeyframes = generateZoomKeyframes({
          startRelativeMs: segRelativeStart,
          endRelativeMs: segRelativeEnd,
          targetZoom: firstPanZoom ?? targetZoom,
          focusX: firstPan?.focusX ?? region.focus.cx,
          focusY: firstPan?.focusY ?? region.focus.cy,
          enterTransitionMs: enterMs,
          exitTransitionMs: exitMs,
          exitFocusX: lastPan?.focusX,
          exitFocusY: lastPan?.focusY,
          exitZoom: lastPanZoom,
        });

        return { ...seg, keyframes: [...nonZoomKfs, ...panPointKfs, ...newKeyframes] };
      });

      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map(r =>
          r.id === selectedZoomId
            ? {
                ...r,
                enterTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: enterMs },
                exitTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: exitMs },
              }
            : r
        ),
        videoSegments: updatedSegments,
      };
    });
  }, [selectedZoomId, setEditorState]);

  const handleZoomDelete = useCallback((id: string) => {
    setEditorState(prev => {
      const region = prev.zoomRegions.find(r => r.id === id);

      // Remove zoom keyframes from all overlapping segments
      let updatedSegments = prev.videoSegments;
      if (region) {
        updatedSegments = prev.videoSegments.map(seg => {
          if (region.startMs >= seg.sourceEndMs || region.endMs <= seg.sourceStartMs) return seg;

          const segRelativeStart = Math.max(0, region.startMs - seg.sourceStartMs);
          const segRelativeEnd = Math.min(seg.sourceEndMs - seg.sourceStartMs, region.endMs - seg.sourceStartMs);

          const filtered = seg.keyframes.filter(kf => {
            if (!isZoomKeyframe(kf)) return true;
            return kf.timeMs < segRelativeStart - 5 || kf.timeMs > segRelativeEnd + 5;
          });

          return { ...seg, keyframes: filtered };
        });
      }

      return {
        ...prev,
        zoomRegions: prev.zoomRegions.filter(r => r.id !== id),
        videoSegments: updatedSegments,
      };
    });
    if (selectedZoomId === id) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId, setEditorState]);

  const handleTrimDelete = useCallback((id: string) => {
    setEditorState(prev => ({
      ...prev,
      trimRegions: prev.trimRegions.filter((region) => region.id !== id),
    }));
    if (selectedTrimId === id) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId, setEditorState]);

  const handleAutoZoomApply = useCallback((newRegions: ZoomRegion[], nextId: number) => {
    if (newRegions.length === 0) return;
    nextZoomIdRef.current = nextId;
    setEditorState(prev => {
      // For each new zoom region, generate keyframes on the containing segment
      let updatedSegments = [...prev.videoSegments];
      for (const region of newRegions) {
        const seg = updatedSegments.find(s =>
          region.startMs >= s.sourceStartMs && region.startMs < s.sourceEndMs
        );
        if (!seg) continue;

        const targetZoom = ZOOM_DEPTH_SCALES[region.depth];
        const newKeyframes = generateZoomKeyframes({
          startRelativeMs: region.startMs - seg.sourceStartMs,
          endRelativeMs: Math.min(region.endMs - seg.sourceStartMs, seg.sourceEndMs - seg.sourceStartMs),
          targetZoom,
          focusX: region.focus.cx,
          focusY: region.focus.cy,
        });

        updatedSegments = updatedSegments.map(s =>
          s.id === seg.id
            ? { ...s, keyframes: [...s.keyframes, ...newKeyframes] }
            : s
        );
      }

      return {
        ...prev,
        zoomRegions: [...prev.zoomRegions, ...newRegions],
        videoSegments: updatedSegments,
      };
    });
  }, [setEditorState]);

  const handleAnnotationAdded = useCallback((span: Span) => {
    const id = `annotation-${nextAnnotationIdRef.current++}`;
    const zIndex = nextAnnotationZIndexRef.current++;
    const newRegion: AnnotationRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      type: 'text',
      content: 'Enter text...',
      position: { ...DEFAULT_ANNOTATION_POSITION },
      size: { ...DEFAULT_ANNOTATION_SIZE },
      style: { ...DEFAULT_ANNOTATION_STYLE },
      zIndex,
    };
    setEditorState(prev => ({ ...prev, annotationRegions: [...prev.annotationRegions, newRegion] }));
    setSelectedAnnotationId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
  }, [setEditorState]);

  const handleAnnotationSpanChange = useCallback((id: string, span: Span) => {
    setEditorState(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.map((region) =>
        region.id === id
          ? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
          : region,
      ),
    }));
  }, [setEditorState]);

  const handleAnnotationDelete = useCallback((id: string) => {
    setEditorState(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.filter((region) => region.id !== id),
    }));
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId, setEditorState]);

  const handleAnnotationContentChange = useCallback((id: string, content: string) => {
    setEditorState(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.map((region) => {
        if (region.id !== id) return region;
        if (region.type === 'text') {
          return { ...region, content, textContent: content };
        } else if (region.type === 'image') {
          return { ...region, content, imageContent: content };
        } else {
          return { ...region, content };
        }
      }),
    }));
  }, [setEditorState]);

  const handleAnnotationTypeChange = useCallback((id: string, type: AnnotationRegion['type']) => {
    setEditorState(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.map((region) => {
        if (region.id !== id) return region;
        const updatedRegion = { ...region, type };
        if (type === 'text') {
          updatedRegion.content = region.textContent || 'Enter text...';
        } else if (type === 'image') {
          updatedRegion.content = region.imageContent || '';
        } else if (type === 'figure') {
          updatedRegion.content = '';
          if (!region.figureData) {
            updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
          }
        }
        return updatedRegion;
      }),
    }));
  }, [setEditorState]);

  const handleAnnotationStyleChange = useCallback((id: string, style: Partial<AnnotationRegion['style']>) => {
    setEditorState(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.map((region) =>
        region.id === id
          ? { ...region, style: { ...region.style, ...style } }
          : region,
      ),
    }));
  }, [setEditorState]);

  const handleAnnotationFigureDataChange = useCallback((id: string, figureData: FigureData) => {
    setEditorState(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.map((region) =>
        region.id === id
          ? { ...region, figureData }
          : region,
      ),
    }));
  }, [setEditorState]);

  const handleAnnotationPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.map((region) =>
        region.id === id
          ? { ...region, position }
          : region,
      ),
    }));
  }, [setEditorStateDebounced]);

  const handleAnnotationSizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      annotationRegions: prev.annotationRegions.map((region) =>
        region.id === id
          ? { ...region, size }
          : region,
      ),
    }));
  }, [setEditorStateDebounced]);

  // --- Spotlight handlers ---

  const handleSpotlightAdded = useCallback((span: Span) => {
    const id = `spotlight-${nextSpotlightIdRef.current++}`;
    const newRegion: SpotlightRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      ...DEFAULT_SPOTLIGHT_REGION,
    };
    setEditorState(prev => ({ ...prev, spotlightRegions: [...prev.spotlightRegions, newRegion] }));
    setSelectedSpotlightId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [setEditorState]);

  const handleSpotlightSpanChange = useCallback((id: string, span: Span) => {
    setEditorState(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map((region) =>
        region.id === id
          ? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
          : region,
      ),
    }));
  }, [setEditorState]);

  const handleSpotlightDelete = useCallback((id: string) => {
    setEditorState(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.filter((region) => region.id !== id),
    }));
    if (selectedSpotlightId === id) {
      setSelectedSpotlightId(null);
    }
  }, [selectedSpotlightId, setEditorState]);

  const handleSpotlightUpdate = useCallback((id: string, updates: Partial<SpotlightRegion>) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map((region) =>
        region.id === id ? { ...region, ...updates } : region,
      ),
    }));
  }, [setEditorStateDebounced]);

  const handleSpotlightPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map((region) =>
        region.id === id ? { ...region, x: position.x, y: position.y } : region,
      ),
    }));
  }, [setEditorStateDebounced]);

  const handleSpotlightSizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map((region) =>
        region.id === id ? { ...region, width: size.width, height: size.height } : region,
      ),
    }));
  }, [setEditorStateDebounced]);

  const handleAutoSpotlightApply = useCallback((newRegions: SpotlightRegion[], nextId: number) => {
    if (newRegions.length === 0) return;
    nextSpotlightIdRef.current = nextId;
    setEditorState(prev => ({
      ...prev,
      spotlightRegions: [...prev.spotlightRegions, ...newRegions],
    }));
  }, [setEditorState]);

  // --- Spotlight animation (pan point) handlers ---

  // Is the playhead inside the selected spotlight?
  const playheadInsideSelectedSpotlight = useMemo(() => {
    if (!selectedSpotlightId) return false;
    const spot = spotlightRegions.find(s => s.id === selectedSpotlightId);
    if (!spot) return false;
    return sourceTimeMs >= spot.startMs && sourceTimeMs <= spot.endMs;
  }, [selectedSpotlightId, spotlightRegions, sourceTimeMs]);

  // Resolve animated spotlight values at playhead
  const activeSpotlightValues = useMemo(() => {
    if (!selectedSpotlightId) return null;
    const spot = spotlightRegions.find(s => s.id === selectedSpotlightId);
    if (!spot) return null;
    if (!spot.keyframes || spot.keyframes.length === 0) return null;
    const relTime = sourceTimeMs - spot.startMs;
    return resolveSpotlightAtTime(spot.keyframes, relTime, spot);
  }, [selectedSpotlightId, spotlightRegions, sourceTimeMs]);

  // Find nearest spotlight keyframe time at playhead (50ms snap)
  const currentSpotlightKeyframeTime = useMemo<number | null>(() => {
    if (!playheadInsideSelectedSpotlight || !selectedSpotlightId) return null;
    const spot = spotlightRegions.find(s => s.id === selectedSpotlightId);
    if (!spot?.keyframes?.length) return null;
    const relTime = sourceTimeMs - spot.startMs;
    const pointTimes = getUniqueSpotlightPointTimes(spot.keyframes);
    const nearest = pointTimes.find(t => Math.abs(t - relTime) < 50);
    return nearest !== undefined ? nearest : null;
  }, [playheadInsideSelectedSpotlight, selectedSpotlightId, spotlightRegions, sourceTimeMs]);

  // Add a spotlight animation point at playhead
  const handleAddSpotlightPoint = useCallback((spotlightId: string) => {
    const spot = spotlightRegions.find(s => s.id === spotlightId);
    if (!spot) return;
    if (sourceTimeMs < spot.startMs || sourceTimeMs > spot.endMs) return;

    const relTime = sourceTimeMs - spot.startMs;
    const isFirstPoint = !spot.keyframes || spot.keyframes.length === 0;

    setEditorState(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map(s => {
        if (s.id !== spotlightId) return s;
        let kfs = s.keyframes ? [...s.keyframes] : [];

        if (isFirstPoint) {
          // Auto-create a keyframe at t=0 with current static values
          kfs = upsertAllSpotlightPropertiesAtTime(kfs, 0, { x: s.x, y: s.y, width: s.width, height: s.height }, 'ease-in-out', 'spotlight');
        }

        // Resolve current interpolated values at this time
        const currentValues = resolveSpotlightAtTime(kfs.length > 0 ? kfs : undefined, relTime, s);
        // Create user point at playhead
        kfs = upsertAllSpotlightPropertiesAtTime(kfs, relTime, currentValues, 'ease-in-out', 'spotlight');

        return { ...s, keyframes: kfs };
      }),
    }));
  }, [spotlightRegions, sourceTimeMs, setEditorState]);

  // Hold: copy most recent previous point values to playhead
  const handleHoldSpotlightPoint = useCallback((spotlightId: string) => {
    const spot = spotlightRegions.find(s => s.id === spotlightId);
    if (!spot?.keyframes?.length) return;
    if (sourceTimeMs < spot.startMs || sourceTimeMs > spot.endMs) return;

    const relTime = sourceTimeMs - spot.startMs;
    const pointTimes = getUniqueSpotlightPointTimes(spot.keyframes);
    const prevTime = pointTimes.filter(t => t < relTime - 5).pop();
    if (prevTime === undefined) return;

    // Get values from that point
    const prevValues = resolveSpotlightAtTime(spot.keyframes, prevTime, spot);

    setEditorState(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map(s => {
        if (s.id !== spotlightId) return s;
        let kfs = s.keyframes ? [...s.keyframes] : [];
        kfs = upsertAllSpotlightPropertiesAtTime(kfs, relTime, prevValues, 'ease-in-out', 'spotlight');
        return { ...s, keyframes: kfs };
      }),
    }));
  }, [spotlightRegions, sourceTimeMs, setEditorState]);

  // Change a spotlight property (x/y/width/height) at the current point
  const handleSpotlightPropertyChange = useCallback((property: SpotlightAnimProperty, value: number) => {
    if (!playheadInsideSelectedSpotlight || !selectedSpotlightId) return;
    const spot = spotlightRegions.find(s => s.id === selectedSpotlightId);
    if (!spot) return;

    const relTime = sourceTimeMs - spot.startMs;

    // Snap to existing keyframe near playhead, or use playhead time
    const targetTime = currentSpotlightKeyframeTime !== null
      ? currentSpotlightKeyframeTime
      : relTime;

    setEditorStateDebounced(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map(s => {
        if (s.id !== selectedSpotlightId) return s;
        let kfs = s.keyframes ? [...s.keyframes] : [];

        // Auto-create point if none exists at this time
        const hasPoint = kfs.some(
          kf => kf.source === 'spotlight' && Math.abs(kf.timeMs - targetTime) < 50
        );
        if (!hasPoint) {
          // Create all 4 properties at this time with current interpolated values
          const currentValues = resolveSpotlightAtTime(kfs.length > 0 ? kfs : undefined, targetTime, s);
          kfs = upsertAllSpotlightPropertiesAtTime(kfs, targetTime, currentValues, 'ease-in-out', 'spotlight');
        }

        // Update the specific property
        kfs = upsertSpotlightKeyframe(kfs, targetTime, property, value, 'ease-in-out', 'spotlight');
        return { ...s, keyframes: kfs };
      }),
    }));
  }, [playheadInsideSelectedSpotlight, selectedSpotlightId, spotlightRegions, sourceTimeMs, currentSpotlightKeyframeTime, setEditorStateDebounced]);

  // --- Video Segment handlers ---

  const handleSelectSegment = useCallback((id: string | null) => {
    setSelectedSegmentId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedSpotlightId(null);
    }
  }, []);

  const handleSplitSegmentAt = useCallback((segmentId: string, sourceTimeMs: number) => {
    setEditorState(prev => {
      const segment = prev.videoSegments.find(s => s.id === segmentId);
      if (!segment) return prev;
      const result = splitSegment(segment, sourceTimeMs);
      if (!result) return prev;
      const [left, right] = result;
      const updated = prev.videoSegments.map(s => s.id === segmentId ? left : s);
      // Insert right after left
      const idx = updated.findIndex(s => s.id === left.id);
      updated.splice(idx + 1, 0, right);
      return { ...prev, videoSegments: rippleSegments(updated) };
    });
  }, [setEditorState]);

  const handleDeleteSegment = useCallback((segmentId: string) => {
    setEditorState(prev => {
      const updated = prev.videoSegments.filter(s => s.id !== segmentId);
      if (updated.length === 0) return prev; // Don't allow deleting all segments
      return { ...prev, videoSegments: rippleSegments(updated) };
    });
    if (selectedSegmentId === segmentId) {
      setSelectedSegmentId(null);
    }
  }, [selectedSegmentId, setEditorState]);

  const handleSegmentSpanChange = useCallback((segmentId: string, newSourceStart: number, newSourceEnd: number) => {
    setEditorState(prev => {
      const updated = prev.videoSegments.map(s =>
        s.id === segmentId
          ? { ...s, sourceStartMs: Math.round(newSourceStart), sourceEndMs: Math.round(newSourceEnd) }
          : s,
      );
      return { ...prev, videoSegments: rippleSegments(updated) };
    });
  }, [setEditorState]);

  const handleSegmentTransformChange = useCallback((segmentId: string, transform: Partial<VideoSegment['transform']>, playheadTimeMs?: number) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s => {
        if (s.id !== segmentId) return s;

        // If playheadTimeMs is provided and keyframes exist at that time, upsert keyframes
        if (playheadTimeMs !== undefined) {
          const nearestTime = findNearestKeyframeTime(s.keyframes, playheadTimeMs);
          if (nearestTime !== null) {
            let updatedKfs = s.keyframes;
            for (const [prop, value] of Object.entries(transform)) {
              updatedKfs = upsertKeyframe(updatedKfs, nearestTime, prop as keyof VideoSegment['transform'], value as number);
            }
            return { ...s, keyframes: updatedKfs };
          }
        }

        // Fallback: update static transform baseline
        return { ...s, transform: { ...s.transform, ...transform } };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleSegmentTransformReset = useCallback((segmentId: string) => {
    setEditorState(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s =>
        s.id === segmentId
          ? { ...s, transform: { ...DEFAULT_SEGMENT_TRANSFORM }, keyframes: [] }
          : s,
      ),
    }));
  }, [setEditorState]);

  // --- Keyframe CRUD handlers ---

  // Add keyframes for ALL 8 properties at the playhead, using current interpolated values
  const handleAddKeyframeAtPlayhead = useCallback((segmentId: string, relativeTimeMs: number) => {
    setEditorState(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s => {
        if (s.id !== segmentId) return s;
        // Resolve current interpolated transform at this time
        const currentTransform = resolveTransformAtTime(s.keyframes, relativeTimeMs, s.transform);
        const updatedKfs = upsertAllPropertiesAtTime(s.keyframes, relativeTimeMs, currentTransform);
        return { ...s, keyframes: updatedKfs };
      }),
    }));
  }, [setEditorState]);

  // Delete all keyframes at a specific time
  const handleDeleteKeyframesAtTime = useCallback((segmentId: string, timeMs: number) => {
    setEditorState(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s =>
        s.id === segmentId
          ? { ...s, keyframes: removeKeyframesAtTime(s.keyframes, timeMs) }
          : s,
      ),
    }));
  }, [setEditorState]);

  // Move all keyframes from one time to another
  const handleMoveKeyframesAtTime = useCallback((segmentId: string, oldTimeMs: number, newTimeMs: number) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s =>
        s.id === segmentId
          ? { ...s, keyframes: moveKeyframesAtTime(s.keyframes, oldTimeMs, newTimeMs) }
          : s,
      ),
    }));
  }, [setEditorStateDebounced]);

  // --- Zoom-derived state for SettingsPanel ---

  // Is the playhead inside the selected zoom region?
  const playheadInsideSelectedZoom = useMemo(() => {
    if (!selectedZoomId) return false;
    const region = zoomRegions.find(r => r.id === selectedZoomId);
    if (!region) return false;
    return sourceTimeMs >= region.startMs && sourceTimeMs <= region.endMs;
  }, [selectedZoomId, zoomRegions, sourceTimeMs]);

  // Resolve the current zoom/focusX/focusY at the playhead from the containing segment
  const activeZoomTransform = useMemo(() => {
    if (!playheadInsideSelectedZoom) return null;
    const seg = findSegmentAtSourceTime(videoSegments, sourceTimeMs);
    if (!seg) return null;
    const relTime = sourceTimeMs - seg.sourceStartMs;
    const resolved = resolveTransformAtTime(seg.keyframes, relTime, seg.transform);
    return { zoom: resolved.zoom, focusX: resolved.focusX, focusY: resolved.focusY };
  }, [playheadInsideSelectedZoom, videoSegments, sourceTimeMs]);

  // Find the nearest zoom keyframe time at the playhead (for enabling slider editing)
  const currentZoomKeyframeTime = useMemo<{ segmentId: string; relativeTimeMs: number } | null>(() => {
    if (!playheadInsideSelectedZoom) return null;
    const seg = findSegmentAtSourceTime(videoSegments, sourceTimeMs);
    if (!seg) return null;
    const relTime = sourceTimeMs - seg.sourceStartMs;
    const panPointTimes = getUniquePanPointTimes(seg.keyframes);
    // Snap threshold: 50ms
    const nearest = panPointTimes.find(t => Math.abs(t - relTime) < 50);
    if (nearest === undefined) return null;
    return { segmentId: seg.id, relativeTimeMs: nearest };
  }, [playheadInsideSelectedZoom, videoSegments, sourceTimeMs]);

  // Add a "pan point" — insert zoom/focusX/focusY keyframes at playhead inside a zoom region
  const handleAddZoomPanPoint = useCallback((zoomRegionId: string) => {
    const region = zoomRegions.find(r => r.id === zoomRegionId);
    if (!region) return;
    if (sourceTimeMs < region.startMs || sourceTimeMs > region.endMs) return;

    const seg = findSegmentAtSourceTime(videoSegments, sourceTimeMs);
    if (!seg) return;

    setEditorState(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s => {
        if (s.id !== seg.id) return s;
        const regionRelStart = region.startMs - s.sourceStartMs;
        const regionRelEnd = region.endMs - s.sourceStartMs;
        const enterMs = region.enterTransition?.durationMs ?? 400;
        const exitMs = region.exitTransition?.durationMs ?? 400;
        const relTime = clampToPanRange(sourceTimeMs - s.sourceStartMs, regionRelStart, regionRelEnd, enterMs, exitMs);
        const currentTransform = resolveTransformAtTime(s.keyframes, relTime, s.transform);
        const targetZoom = ZOOM_DEPTH_SCALES[region.depth];
        let kfs = s.keyframes;
        kfs = upsertKeyframe(kfs, relTime, 'zoom', targetZoom, 'ease-in-out');
        kfs = upsertKeyframe(kfs, relTime, 'focusX', currentTransform.focusX, 'ease-in-out');
        kfs = upsertKeyframe(kfs, relTime, 'focusY', currentTransform.focusY, 'ease-in-out');
        // Tag as pan points
        kfs = kfs.map(kf => {
          if (Math.abs(kf.timeMs - relTime) < 5 && (kf.property === 'zoom' || kf.property === 'focusX' || kf.property === 'focusY')) {
            return { ...kf, source: 'zoom' as const };
          }
          return kf;
        });
        // Sync t2/t3 auto boundaries + ensure t1/t4 are correct
        kfs = syncZoomBoundaries(kfs, regionRelStart, regionRelEnd);
        return { ...s, keyframes: kfs };
      }),
    }));
  }, [zoomRegions, sourceTimeMs, videoSegments, setEditorState]);

  // Duplicate the most recent pan point at the playhead to create a "hold" segment.
  // Camera stays still between the original and the duplicate, then moves to the next point.
  const handleHoldPanPoint = useCallback((zoomRegionId: string) => {
    const region = zoomRegions.find(r => r.id === zoomRegionId);
    if (!region) return;
    if (sourceTimeMs < region.startMs || sourceTimeMs > region.endMs) return;

    const seg = findSegmentAtSourceTime(videoSegments, sourceTimeMs);
    if (!seg) return;
    const regionRelStart = region.startMs - seg.sourceStartMs;
    const regionRelEnd = region.endMs - seg.sourceStartMs;
    const enterMs = region.enterTransition?.durationMs ?? 400;
    const exitMs = region.exitTransition?.durationMs ?? 400;
    const relTime = clampToPanRange(sourceTimeMs - seg.sourceStartMs, regionRelStart, regionRelEnd, enterMs, exitMs);

    // Find the most recent pan point before the playhead
    const panPoints = seg.keyframes.filter(kf => kf.source === 'zoom');
    const panPointTimes = [...new Set(panPoints.map(kf => kf.timeMs))].sort((a, b) => a - b);
    const prevTime = panPointTimes.filter(t => t < relTime - 5).pop();
    if (prevTime === undefined) return; // No previous pan point to duplicate

    // Get focus values from that pan point
    const atPrev = panPoints.filter(kf => Math.abs(kf.timeMs - prevTime) < 5);
    const prevFocusX = atPrev.find(kf => kf.property === 'focusX')?.value ?? 0.5;
    const prevFocusY = atPrev.find(kf => kf.property === 'focusY')?.value ?? 0.5;
    const prevZoom = atPrev.find(kf => kf.property === 'zoom')?.value;

    setEditorState(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s => {
        if (s.id !== seg.id) return s;
        let kfs = s.keyframes;
        const targetZoom = ZOOM_DEPTH_SCALES[region.depth];
        kfs = upsertKeyframe(kfs, relTime, 'focusX', prevFocusX, 'ease-in-out');
        kfs = upsertKeyframe(kfs, relTime, 'focusY', prevFocusY, 'ease-in-out');
        kfs = upsertKeyframe(kfs, relTime, 'zoom', prevZoom ?? targetZoom, 'ease-in-out');
        // Tag as pan points
        kfs = kfs.map(kf => {
          if (Math.abs(kf.timeMs - relTime) < 5 && (kf.property === 'focusX' || kf.property === 'focusY' || kf.property === 'zoom')) {
            return { ...kf, source: 'zoom' as const };
          }
          return kf;
        });
        // Sync t2/t3 auto boundaries + ensure t1/t4 are correct
        kfs = syncZoomBoundaries(kfs, regionRelStart, regionRelEnd);
        return { ...s, keyframes: kfs };
      }),
    }));
  }, [zoomRegions, sourceTimeMs, videoSegments, setEditorState]);

  // Change a zoom property (zoom/focusX/focusY) at the current pan point.
  // Updates only the specific keyframe. Then syncs t2/t3 auto boundaries to
  // match the first/last pan point values (zoom + focus), so transitions are smooth.
  const handleZoomPropertyChange = useCallback((property: 'zoom' | 'focusX' | 'focusY', value: number) => {
    if (!playheadInsideSelectedZoom) return;

    const seg = findSegmentAtSourceTime(videoSegments, sourceTimeMs);
    if (!seg) return;

    setEditorStateDebounced(prev => ({
      ...prev,
      videoSegments: prev.videoSegments.map(s => {
        if (s.id !== seg.id) return s;

        const region = prev.zoomRegions.find(r => r.id === selectedZoomId);
        if (!region) return s;
        const regionRelStart = region.startMs - s.sourceStartMs;
        const regionRelEnd = region.endMs - s.sourceStartMs;
        const enterMs = region.enterTransition?.durationMs ?? 400;
        const exitMs = region.exitTransition?.durationMs ?? 400;
        const clampedRelTime = clampToPanRange(sourceTimeMs - s.sourceStartMs, regionRelStart, regionRelEnd, enterMs, exitMs);

        // Snap to existing pan point near playhead, or use clamped playhead time
        const targetTime = currentZoomKeyframeTime?.segmentId === seg.id
          ? currentZoomKeyframeTime.relativeTimeMs
          : clampedRelTime;

        let kfs = s.keyframes;

        // Auto-create pan point if none exists at this time
        const hasPanPoint = kfs.some(
          kf => kf.source === 'zoom' && Math.abs(kf.timeMs - targetTime) < 50
        );
        if (!hasPanPoint) {
          const currentTransform = resolveTransformAtTime(kfs, targetTime, s.transform);
          const targetZoom = ZOOM_DEPTH_SCALES[region.depth];
          kfs = upsertKeyframe(kfs, targetTime, 'zoom', targetZoom, 'ease-in-out');
          kfs = upsertKeyframe(kfs, targetTime, 'focusX', currentTransform.focusX, 'ease-in-out');
          kfs = upsertKeyframe(kfs, targetTime, 'focusY', currentTransform.focusY, 'ease-in-out');
          kfs = kfs.map(kf => {
            if (Math.abs(kf.timeMs - targetTime) < 5 && (kf.property === 'zoom' || kf.property === 'focusX' || kf.property === 'focusY')) {
              return { ...kf, source: 'zoom' as const };
            }
            return kf;
          });
        }

        // Update the specific property on THIS pan point only
        kfs = upsertKeyframe(kfs, targetTime, property, value, 'ease-in-out');
        kfs = kfs.map(kf => {
          if (Math.abs(kf.timeMs - targetTime) < 5 && kf.property === property) {
            return { ...kf, source: 'zoom' as const };
          }
          return kf;
        });

        // Sync t2/t3 auto boundaries + ensure t1/t4 are correct
        kfs = syncZoomBoundaries(kfs, regionRelStart, regionRelEnd);
        return { ...s, keyframes: kfs };
      }),
    }));
  }, [playheadInsideSelectedZoom, videoSegments, sourceTimeMs, currentZoomKeyframeTime, setEditorStateDebounced, selectedZoomId]);

  // Razor tool: split at current playhead position (source time coordinates)
  const handleRazorAtPlayhead = useCallback(() => {
    const sourceTimeMs = Math.round(currentTime * 1000);
    const segment = findSegmentAtSourceTime(videoSegments, sourceTimeMs);
    if (segment) {
      handleSplitSegmentAt(segment.id, sourceTimeMs);
    }
  }, [currentTime, videoSegments, handleSplitSegmentAt]);

  // Global Tab prevention + keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Allow tab only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
      }

      // Cmd+B / Ctrl+B: Split at playhead
      if ((e.key === 'b' || e.key === 'B') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleRazorAtPlayhead();
        return;
      }

      // Delete / Backspace: Remove selected segment
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSegmentId) {
        // Don't intercept if in an input/textarea
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
        handleDeleteSegment(selectedSegmentId);
        return;
      }

      // Razor tool shortcuts (only without modifiers, not in inputs)
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        setRazorToolActive(true);
        return;
      }
      if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        setRazorToolActive(false);
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        // Allow space only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();

        const playback = videoPlaybackRef.current;
        if (playback?.video) {
          if (playback.video.paused) {
            playback.play().catch(console.error);
          } else {
            playback.pause();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleRazorAtPlayhead, handleDeleteSegment, selectedSegmentId]);

  useEffect(() => {
    if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId, zoomRegions]);

  useEffect(() => {
    if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId, trimRegions]);

  useEffect(() => {
    if (selectedAnnotationId && !annotationRegions.some((region) => region.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId, annotationRegions]);

  useEffect(() => {
    if (selectedSpotlightId && !spotlightRegions.some((region) => region.id === selectedSpotlightId)) {
      setSelectedSpotlightId(null);
    }
  }, [selectedSpotlightId, spotlightRegions]);

  useEffect(() => {
    if (selectedSegmentId && !videoSegments.some((s) => s.id === selectedSegmentId)) {
      setSelectedSegmentId(null);
    }
  }, [selectedSegmentId, videoSegments]);

  const handleExport = useCallback(async (settings: ExportSettings) => {
    if (!videoPath) {
      toast.error('No video loaded');
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error('Video not ready');
      return;
    }

    setIsExporting(true);
    setExportProgress(null);
    setExportError(null);

    try {
      const wasPlaying = isPlaying;
      if (wasPlaying) {
        videoPlaybackRef.current?.pause();
      }

      const aspectRatioValue = getAspectRatioValue(aspectRatio);
      const sourceWidth = video.videoWidth || 1920;
      const sourceHeight = video.videoHeight || 1080;

      // Get preview CONTAINER dimensions for scaling
      const playbackRef = videoPlaybackRef.current;
      const containerElement = playbackRef?.containerRef?.current;
      const previewWidth = containerElement?.clientWidth || 1920;
      const previewHeight = containerElement?.clientHeight || 1080;

      if (settings.format === 'gif' && settings.gifConfig) {
        // GIF Export
        const gifExporter = new GifExporter({
          videoUrl: videoPath,
          width: settings.gifConfig.width,
          height: settings.gifConfig.height,
          frameRate: settings.gifConfig.frameRate,
          loop: settings.gifConfig.loop,
          sizePreset: settings.gifConfig.sizePreset,
          wallpaper,
          trimRegions,
          showShadow: shadowIntensity > 0,
          shadowIntensity,
          showBlur,
          motionBlurEnabled,
          borderRadius,
          padding,
          videoPadding: padding,
          cropRegion,
          annotationRegions,
          spotlightRegions,
          previewWidth,
          previewHeight,
          cursorData,
          cursorHighlight,
          videoSegments,
          onProgress: (progress: ExportProgress) => {
            setExportProgress(progress);
          },
        });

        exporterRef.current = gifExporter as unknown as VideoExporter;
        const result = await gifExporter.export();

        if (result.success && result.blob) {
          const arrayBuffer = await result.blob.arrayBuffer();
          const timestamp = Date.now();
          const fileName = `export-${timestamp}.gif`;

          const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

          if (saveResult.cancelled) {
            toast.info('Export cancelled');
          } else if (saveResult.success) {
            toast.success(`GIF exported successfully to ${saveResult.path}`);
          } else {
            setExportError(saveResult.message || 'Failed to save GIF');
            toast.error(saveResult.message || 'Failed to save GIF');
          }
        } else {
          setExportError(result.error || 'GIF export failed');
          toast.error(result.error || 'GIF export failed');
        }
      } else {
        // MP4 Export
        const quality = settings.quality || exportQuality;
        let exportWidth: number;
        let exportHeight: number;
        let bitrate: number;

        if (quality === 'source') {
          // Use source resolution
          exportWidth = sourceWidth;
          exportHeight = sourceHeight;

          if (aspectRatioValue === 1) {
            // Square (1:1): use smaller dimension to avoid codec limits
            const baseDimension = Math.floor(Math.min(sourceWidth, sourceHeight) / 2) * 2;
            exportWidth = baseDimension;
            exportHeight = baseDimension;
          } else if (aspectRatioValue > 1) {
            // Landscape: find largest even dimensions that exactly match aspect ratio
            const baseWidth = Math.floor(sourceWidth / 2) * 2;
            let found = false;
            for (let w = baseWidth; w >= 100 && !found; w -= 2) {
              const h = Math.round(w / aspectRatioValue);
              if (h % 2 === 0 && Math.abs((w / h) - aspectRatioValue) < 0.0001) {
                exportWidth = w;
                exportHeight = h;
                found = true;
              }
            }
            if (!found) {
              exportWidth = baseWidth;
              exportHeight = Math.floor((baseWidth / aspectRatioValue) / 2) * 2;
            }
          } else {
            // Portrait: find largest even dimensions that exactly match aspect ratio
            const baseHeight = Math.floor(sourceHeight / 2) * 2;
            let found = false;
            for (let h = baseHeight; h >= 100 && !found; h -= 2) {
              const w = Math.round(h * aspectRatioValue);
              if (w % 2 === 0 && Math.abs((w / h) - aspectRatioValue) < 0.0001) {
                exportWidth = w;
                exportHeight = h;
                found = true;
              }
            }
            if (!found) {
              exportHeight = baseHeight;
              exportWidth = Math.floor((baseHeight * aspectRatioValue) / 2) * 2;
            }
          }

          // Calculate visually lossless bitrate matching screen recording optimization
          const totalPixels = exportWidth * exportHeight;
          bitrate = 30_000_000;
          if (totalPixels > 1920 * 1080 && totalPixels <= 2560 * 1440) {
            bitrate = 50_000_000;
          } else if (totalPixels > 2560 * 1440) {
            bitrate = 80_000_000;
          }
        } else {
          // Use quality-based target resolution
          const targetHeight = quality === 'medium' ? 720 : 1080;

          // Calculate dimensions maintaining aspect ratio
          exportHeight = Math.floor(targetHeight / 2) * 2;
          exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;

          // Adjust bitrate for lower resolutions
          const totalPixels = exportWidth * exportHeight;
          if (totalPixels <= 1280 * 720) {
            bitrate = 10_000_000;
          } else if (totalPixels <= 1920 * 1080) {
            bitrate = 20_000_000;
          } else {
            bitrate = 30_000_000;
          }
        }

        const exporter = new VideoExporter({
          videoUrl: videoPath,
          width: exportWidth,
          height: exportHeight,
          frameRate: 60,
          bitrate,
          codec: 'avc1.640033',
          wallpaper,
          trimRegions,
          showShadow: shadowIntensity > 0,
          shadowIntensity,
          showBlur,
          motionBlurEnabled,
          borderRadius,
          padding,
          cropRegion,
          annotationRegions,
          spotlightRegions,
          previewWidth,
          previewHeight,
          cursorData,
          cursorHighlight,
          videoSegments,
          onProgress: (progress: ExportProgress) => {
            setExportProgress(progress);
          },
        });

        exporterRef.current = exporter;
        const result = await exporter.export();

        if (result.success && result.blob) {
          const arrayBuffer = await result.blob.arrayBuffer();
          const timestamp = Date.now();
          const fileName = `export-${timestamp}.mp4`;

          const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

          if (saveResult.cancelled) {
            toast.info('Export cancelled');
          } else if (saveResult.success) {
            toast.success(`Video exported successfully to ${saveResult.path}`);
          } else {
            setExportError(saveResult.message || 'Failed to save video');
            toast.error(saveResult.message || 'Failed to save video');
          }
        } else {
          setExportError(result.error || 'Export failed');
          toast.error(result.error || 'Export failed');
        }
      }

      if (wasPlaying) {
        videoPlaybackRef.current?.play();
      }
    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setExportError(errorMessage);
      toast.error(`Export failed: ${errorMessage}`);
    } finally {
      setIsExporting(false);
      exporterRef.current = null;
      // Reset dialog state to ensure it can be opened again on next export
      // This fixes the bug where second export doesn't show save dialog
      setShowExportDialog(false);
      setExportProgress(null);
    }
  }, [videoPath, wallpaper, trimRegions, shadowIntensity, showBlur, motionBlurEnabled, borderRadius, padding, cropRegion, annotationRegions, spotlightRegions, isPlaying, aspectRatio, exportQuality, cursorData, cursorHighlight, videoSegments]);

  const handleOpenExportDialog = useCallback(() => {
    if (!videoPath) {
      toast.error('No video loaded');
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error('Video not ready');
      return;
    }

    // Build export settings from current state
    const sourceWidth = video.videoWidth || 1920;
    const sourceHeight = video.videoHeight || 1080;
    const gifDimensions = calculateOutputDimensions(sourceWidth, sourceHeight, gifSizePreset, GIF_SIZE_PRESETS);

    const settings: ExportSettings = {
      format: exportFormat,
      quality: exportFormat === 'mp4' ? exportQuality : undefined,
      gifConfig: exportFormat === 'gif' ? {
        frameRate: gifFrameRate,
        loop: gifLoop,
        sizePreset: gifSizePreset,
        width: gifDimensions.width,
        height: gifDimensions.height,
      } : undefined,
    };

    setShowExportDialog(true);
    setExportError(null);

    // Start export immediately
    handleExport(settings);
  }, [videoPath, exportFormat, exportQuality, gifFrameRate, gifLoop, gifSizePreset, handleExport]);

  const handleCancelExport = useCallback(() => {
    if (exporterRef.current) {
      exporterRef.current.cancel();
      toast.info('Export cancelled');
      setShowExportDialog(false);
      setIsExporting(false);
      setExportProgress(null);
      setExportError(null);
    }
  }, []);

  // Listen for Electron menu actions (placed after all handlers are defined)
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuAction((action: string) => {
      switch (action) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'save': saveProject(); break;
        case 'save-as': saveProjectAs(); break;
        case 'open': openProject(); break;
        case 'export': handleOpenExportDialog(); break;
        case 'toggle-play': togglePlayPause(); break;
      }
    });
    return cleanup;
  }, [undo, redo, saveProject, saveProjectAs, openProject, handleOpenExportDialog, togglePlayPause]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-foreground">Loading video...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }


  return (
    <div className="flex flex-col h-screen bg-background text-foreground font-sans overflow-hidden selection:bg-primary/30">
      <div
        className="h-10 flex-shrink-0 bg-surface-0/80 backdrop-blur-md border-b border-border/40 flex items-center justify-between px-6 z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex-1" />
      </div>

      <div className="flex-1 p-5 gap-4 flex min-h-0 relative">
        {/* Left Column - Video & Timeline */}
        <div className="flex-[7] flex flex-col gap-3 min-w-0 h-full">
          <PanelGroup direction="vertical" className="gap-3">
            {/* Top section: video preview and controls */}
            <Panel defaultSize={70} minSize={40}>
              <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 rounded-lg border border-border/30 shadow-2xl overflow-hidden">
                {/* Video preview */}
                <div className="w-full flex justify-center items-center" style={{ flex: '1 1 auto', margin: '6px 0 0' }}>
                  <div className="relative" style={{ width: 'auto', height: '100%', aspectRatio: getAspectRatioValue(aspectRatio), maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
                    <VideoPlayback
                      aspectRatio={aspectRatio}
                      ref={videoPlaybackRef}
                      videoPath={videoPath || ''}
                      onDurationChange={setDuration}
                      onTimeUpdate={setCurrentTime}
                      currentTime={currentTime}
                      onPlayStateChange={setIsPlaying}
                      onError={setError}
                      wallpaper={wallpaper}
                      zoomRegions={zoomRegions}
                      selectedZoomId={selectedZoomId}
                      onSelectZoom={handleSelectZoom}
                      onZoomFocusChange={handleZoomFocusChange}
                      isPlaying={isPlaying}
                      showShadow={shadowIntensity > 0}
                      shadowIntensity={shadowIntensity}
                      showBlur={showBlur}
                      motionBlurEnabled={motionBlurEnabled}
                      borderRadius={borderRadius}
                      padding={padding}
                      cropRegion={cropRegion}
                      trimRegions={trimRegions}
                      annotationRegions={annotationRegions}
                      selectedAnnotationId={selectedAnnotationId}
                      onSelectAnnotation={handleSelectAnnotation}
                      onAnnotationPositionChange={handleAnnotationPositionChange}
                      onAnnotationSizeChange={handleAnnotationSizeChange}
                      cursorData={cursorData}
                      cursorHighlight={cursorHighlight}
                      videoSegments={videoSegments}
                      spotlightRegions={spotlightRegions}
                      selectedSpotlightId={selectedSpotlightId}
                      onSelectSpotlight={handleSelectSpotlight}
                      onSpotlightPositionChange={handleSpotlightPositionChange}
                      onSpotlightSizeChange={handleSpotlightSizeChange}
                    />
                  </div>
                </div>
                {/* Playback controls */}
                <div className="w-full flex justify-center items-center" style={{ height: '48px', flexShrink: 0, padding: '6px 12px', margin: '6px 0 6px 0' }}>
                  <div style={{ width: '100%', maxWidth: '700px' }}>
                    <PlaybackControls
                      isPlaying={isPlaying}
                      currentTime={videoSegments.length > 0
                        ? sourceToDisplayTime(videoSegments, Math.round(currentTime * 1000)) / 1000
                        : currentTime}
                      duration={videoSegments.length > 0
                        ? getTotalTimelineDuration(videoSegments) / 1000
                        : duration}
                      onTogglePlayPause={togglePlayPause}
                      onSeek={(displayTimeSec) => {
                        if (videoSegments.length > 0) {
                          const sourceMs = displayToSourceTime(videoSegments, displayTimeSec * 1000);
                          handleSeek(sourceMs / 1000);
                        } else {
                          handleSeek(displayTimeSec);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="h-3 bg-background/80 hover:bg-background transition-colors rounded-full mx-4 flex items-center justify-center">
              <div className="w-8 h-1 bg-foreground/20 rounded-full"></div>
            </PanelResizeHandle>

            {/* Timeline section */}
            <Panel defaultSize={30} minSize={20}>
              <div className="h-full bg-background rounded-lg border border-border/30 shadow-lg overflow-hidden flex flex-col">
                <TimelineEditor
              videoDuration={duration}
              currentTime={currentTime}
              onSeek={handleSeek}
              zoomRegions={zoomRegions}
              onZoomAdded={handleZoomAdded}
              onZoomSpanChange={handleZoomSpanChange}
              onZoomDelete={handleZoomDelete}
              selectedZoomId={selectedZoomId}
              onSelectZoom={handleSelectZoom}
              trimRegions={trimRegions}
              onTrimAdded={handleTrimAdded}
              onTrimSpanChange={handleTrimSpanChange}
              onTrimDelete={handleTrimDelete}
              selectedTrimId={selectedTrimId}
              onSelectTrim={handleSelectTrim}
              annotationRegions={annotationRegions}
              onAnnotationAdded={handleAnnotationAdded}
              onAnnotationSpanChange={handleAnnotationSpanChange}
              onAnnotationDelete={handleAnnotationDelete}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={handleSelectAnnotation}
              videoSegments={videoSegments}
              selectedSegmentId={selectedSegmentId}
              onSelectSegment={handleSelectSegment}
              onSplitSegment={handleSplitSegmentAt}
              onDeleteSegment={handleDeleteSegment}
              onSegmentSpanChange={handleSegmentSpanChange}
              razorToolActive={razorToolActive}
              onRazorToolChange={setRazorToolActive}
              onRazorAtPlayhead={handleRazorAtPlayhead}
              videoPath={videoPath}
              aspectRatio={aspectRatio}
              onAspectRatioChange={handleAspectRatioChange}
              cursorData={cursorData}
              onAutoZoomApply={handleAutoZoomApply}
              nextZoomId={nextZoomIdRef.current}
              spotlightRegions={spotlightRegions}
              onSpotlightAdded={handleSpotlightAdded}
              onSpotlightSpanChange={handleSpotlightSpanChange}
              onSpotlightDelete={handleSpotlightDelete}
              selectedSpotlightId={selectedSpotlightId}
              onSelectSpotlight={handleSelectSpotlight}
              onAutoSpotlightApply={handleAutoSpotlightApply}
              nextSpotlightId={nextSpotlightIdRef.current}
              onAddKeyframeAtPlayhead={handleAddKeyframeAtPlayhead}
              onDeleteKeyframesAtTime={handleDeleteKeyframesAtTime}
              onMoveKeyframesAtTime={handleMoveKeyframesAtTime}
            />
              </div>
            </Panel>
          </PanelGroup>
        </div>

          {/* Right section: settings panel */}
          <SettingsPanel
          selected={wallpaper}
          onWallpaperChange={(v) => updateState('wallpaper', v)}
          selectedZoomDepth={selectedZoomId ? zoomRegions.find(z => z.id === selectedZoomId)?.depth : null}
          onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
          selectedZoomId={selectedZoomId}
          zoomEnterTransitionMs={selectedZoomId ? (zoomRegions.find(z => z.id === selectedZoomId)?.enterTransition?.durationMs ?? 400) : 400}
          zoomExitTransitionMs={selectedZoomId ? (zoomRegions.find(z => z.id === selectedZoomId)?.exitTransition?.durationMs ?? 400) : 400}
          onZoomTransitionChange={handleZoomTransitionChange}
          onZoomDelete={handleZoomDelete}
          selectedTrimId={selectedTrimId}
          onTrimDelete={handleTrimDelete}
          shadowIntensity={shadowIntensity}
          onShadowChange={(v) => updateStateDebounced('shadowIntensity', v)}
          showBlur={showBlur}
          onBlurChange={(v) => updateState('showBlur', v)}
          motionBlurEnabled={motionBlurEnabled}
          onMotionBlurChange={(v) => updateState('motionBlurEnabled', v)}
          borderRadius={borderRadius}
          onBorderRadiusChange={(v) => updateStateDebounced('borderRadius', v)}
          padding={padding}
          onPaddingChange={(v) => updateStateDebounced('padding', v)}
          cropRegion={cropRegion}
          onCropChange={(v) => updateState('cropRegion', v)}
          aspectRatio={aspectRatio}
          videoElement={videoPlaybackRef.current?.video || null}
          exportQuality={exportQuality}
          onExportQualityChange={setExportQuality}
          exportFormat={exportFormat}
          onExportFormatChange={setExportFormat}
          gifFrameRate={gifFrameRate}
          onGifFrameRateChange={setGifFrameRate}
          gifLoop={gifLoop}
          onGifLoopChange={setGifLoop}
          gifSizePreset={gifSizePreset}
          onGifSizePresetChange={setGifSizePreset}
          gifOutputDimensions={calculateOutputDimensions(
            videoPlaybackRef.current?.video?.videoWidth || 1920,
            videoPlaybackRef.current?.video?.videoHeight || 1080,
            gifSizePreset,
            GIF_SIZE_PRESETS
          )}
          onExport={handleOpenExportDialog}
          selectedAnnotationId={selectedAnnotationId}
          annotationRegions={annotationRegions}
          onAnnotationContentChange={handleAnnotationContentChange}
          onAnnotationTypeChange={handleAnnotationTypeChange}
          onAnnotationStyleChange={handleAnnotationStyleChange}
          onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
          onAnnotationDelete={handleAnnotationDelete}
          cursorHighlight={cursorHighlight}
          onCursorHighlightChange={(v) => updateState('cursorHighlight', v)}
          hasCursorData={cursorData.length > 0}
          spotlightRegions={spotlightRegions}
          selectedSpotlightId={selectedSpotlightId}
          onSpotlightUpdate={handleSpotlightUpdate}
          onSpotlightDelete={handleSpotlightDelete}
          playheadInsideSpotlight={playheadInsideSelectedSpotlight}
          activeSpotlightValues={activeSpotlightValues}
          currentSpotlightKeyframeTime={currentSpotlightKeyframeTime}
          onAddSpotlightPoint={handleAddSpotlightPoint}
          onHoldSpotlightPoint={handleHoldSpotlightPoint}
          onSpotlightPropertyChange={handleSpotlightPropertyChange}
          videoSegments={videoSegments}
          selectedSegmentId={selectedSegmentId}
          onSegmentTransformChange={handleSegmentTransformChange}
          onSegmentTransformReset={handleSegmentTransformReset}
          onSegmentDelete={handleDeleteSegment}
          playheadRelativeTimeMs={(() => {
            if (!selectedSegmentId) return 0;
            const seg = videoSegments.find(s => s.id === selectedSegmentId);
            if (!seg) return 0;
            const sourceMs = Math.round(currentTime * 1000);
            return Math.max(0, sourceMs - seg.sourceStartMs);
          })()}
          activeZoomTransform={activeZoomTransform}
          playheadInsideSelectedZoom={playheadInsideSelectedZoom}
          onAddZoomPanPoint={handleAddZoomPanPoint}
          onHoldPanPoint={handleHoldPanPoint}
          onZoomPropertyChange={handleZoomPropertyChange}
        />
      </div>

      <Toaster theme="dark" className="pointer-events-auto" />
      
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        progress={exportProgress}
        isExporting={isExporting}
        error={exportError}
        onCancel={handleCancelExport}
        exportFormat={exportFormat}
      />
    </div>
  );
}