

import { useCallback, useEffect, useRef, useState } from "react";
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
  DEFAULT_SEGMENT_TRANSFORM,
  type TrimRegion,
  type VideoSegment,
} from "./types";
import {
  resolveTransformAtTime,
  findNearestKeyframeTime,
  upsertKeyframe,
  upsertAllPropertiesAtTime,
  removeKeyframesAtTime,
  moveKeyframesAtTime,
} from "@/lib/keyframeInterpolation";
import {
  createInitialSegment,
  migrateFromTrimRegions,
  sourceToDisplayTime,
  displayToSourceTime,
  getTotalTimelineDuration,
} from "@/lib/segmentUtils";
import { useZoomHandlers } from "@/hooks/useZoomHandlers";
import { useSegmentHandlers } from "@/hooks/useSegmentHandlers";
import { useAnnotationHandlers } from "@/hooks/useAnnotationHandlers";
import { useSpotlightHandlers } from "@/hooks/useSpotlightHandlers";
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

  // Current playhead position in source time (ms) — used by focus/zoom/spotlight handlers
  const sourceTimeMs = Math.round(currentTime * 1000);

  // --- Extracted handler hooks ---
  const {
    handleZoomAdded,
    handleZoomSpanChange,
    handleZoomFocusChange,
    handleZoomDepthChange,
    handleZoomTransitionChange,
    handleZoomDelete,
    handleAutoZoomApply,
    handleAddZoomPanPoint,
    handleHoldPanPoint,
    handleZoomPropertyChange,
    playheadInsideSelectedZoom,
    activeZoomTransform,
  } = useZoomHandlers({
    setEditorState,
    setEditorStateDebounced,
    videoSegments,
    zoomRegions,
    sourceTimeMs,
    selectedZoomId,
    nextZoomIdRef,
    setSelectedZoomId,
    setSelectedTrimId,
    setSelectedAnnotationId,
  });

  const {
    handleSplitSegmentAt,
    handleDeleteSegment,
    handleSegmentSpanChange,
    handleRazorAtPlayhead,
  } = useSegmentHandlers({
    setEditorState,
    videoSegments,
    currentTime,
    selectedSegmentId,
    setSelectedSegmentId,
  });

  const {
    handleAnnotationAdded,
    handleAnnotationSpanChange,
    handleAnnotationDelete,
    handleAnnotationContentChange,
    handleAnnotationTypeChange,
    handleAnnotationStyleChange,
    handleAnnotationFigureDataChange,
    handleAnnotationPositionChange,
    handleAnnotationSizeChange,
  } = useAnnotationHandlers({
    setEditorState,
    setEditorStateDebounced,
    selectedAnnotationId,
    nextAnnotationIdRef,
    nextAnnotationZIndexRef,
    setSelectedAnnotationId,
    setSelectedZoomId,
    setSelectedTrimId,
  });

  const {
    handleSpotlightAdded,
    handleSpotlightSpanChange,
    handleSpotlightDelete,
    handleSpotlightUpdate,
    handleSpotlightPositionChange,
    handleSpotlightSizeChange,
    handleAutoSpotlightApply,
    handleAddSpotlightPoint,
    handleHoldSpotlightPoint,
    handleSpotlightPropertyChange,
    playheadInsideSelectedSpotlight,
    activeSpotlightValues,
    currentSpotlightKeyframeTime,
  } = useSpotlightHandlers({
    setEditorState,
    setEditorStateDebounced,
    spotlightRegions,
    sourceTimeMs,
    selectedSpotlightId,
    nextSpotlightIdRef,
    setSelectedSpotlightId,
    setSelectedZoomId,
    setSelectedTrimId,
    setSelectedAnnotationId,
  });

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

  const handleTrimDelete = useCallback((id: string) => {
    setEditorState(prev => ({
      ...prev,
      trimRegions: prev.trimRegions.filter((region) => region.id !== id),
    }));
    if (selectedTrimId === id) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId, setEditorState]);

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