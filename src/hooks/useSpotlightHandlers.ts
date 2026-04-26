import { useCallback, useMemo } from "react";
import type { Span } from "dnd-timeline";

import {
  DEFAULT_SPOTLIGHT_REGION,
  type SpotlightRegion,
  type SpotlightAnimProperty,
} from "@/components/video-editor/types";
import {
  resolveSpotlightAtTime,
  getUniqueSpotlightPointTimes,
  upsertAllSpotlightPropertiesAtTime,
  upsertSpotlightKeyframe,
} from "@/lib/keyframeInterpolation";
import type { EditorStateSetter } from "./editorHandlerTypes";

interface UseSpotlightHandlersArgs {
  setEditorState: EditorStateSetter;
  setEditorStateDebounced: EditorStateSetter;
  spotlightRegions: SpotlightRegion[];
  sourceTimeMs: number;
  selectedSpotlightId: string | null;
  nextSpotlightIdRef: React.MutableRefObject<number>;
  setSelectedSpotlightId: (id: string | null) => void;
  setSelectedZoomId: (id: string | null) => void;
  setSelectedTrimId: (id: string | null) => void;
  setSelectedAnnotationId: (id: string | null) => void;
}

export function useSpotlightHandlers({
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
}: UseSpotlightHandlersArgs) {
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
  }, [setEditorState, nextSpotlightIdRef, setSelectedSpotlightId, setSelectedZoomId, setSelectedTrimId, setSelectedAnnotationId]);

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
  }, [selectedSpotlightId, setEditorState, setSelectedSpotlightId]);

  const handleSpotlightUpdate = useCallback((id: string, updates: Partial<SpotlightRegion>) => {
    setEditorStateDebounced(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map((region) =>
        region.id === id ? { ...region, ...updates } : region,
      ),
    }));
  }, [setEditorStateDebounced]);

  // Drag-stop and resize-stop are discrete events — commit immediately.
  // Debouncing caused Rnd's position prop to lag the visual, which felt like
  // the spotlight "fought" the drag.
  //
  // Keyframe-aware: when the spotlight has animation keyframes and the playhead
  // is inside the region, the visible widget position comes from
  // resolveSpotlightAtTime(), not from static x/y. Updating static in that case
  // would be ignored by the renderer and the widget would visually snap back.
  // Instead route the drop into an upsert at the current playhead time.
  const handleSpotlightPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    setEditorState(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map((region) => {
        if (region.id !== id) return region;
        const hasKeyframes = (region.keyframes?.length ?? 0) > 0;
        const playheadInside = sourceTimeMs >= region.startMs && sourceTimeMs <= region.endMs;

        if (hasKeyframes && playheadInside) {
          const relTime = sourceTimeMs - region.startMs;
          let kfs = region.keyframes ?? [];
          const hasPoint = kfs.some(
            kf => kf.source === 'spotlight' && Math.abs(kf.timeMs - relTime) < 50
          );
          if (!hasPoint) {
            // Seed all four props with current interpolated values so the
            // non-dragged axes stay where they were.
            const current = resolveSpotlightAtTime(kfs, relTime, region);
            kfs = upsertAllSpotlightPropertiesAtTime(kfs, relTime, current, 'ease-in-out', 'spotlight');
          }
          kfs = upsertSpotlightKeyframe(kfs, relTime, 'x', position.x, 'ease-in-out', 'spotlight');
          kfs = upsertSpotlightKeyframe(kfs, relTime, 'y', position.y, 'ease-in-out', 'spotlight');
          return { ...region, keyframes: kfs };
        }

        return { ...region, x: position.x, y: position.y };
      }),
    }));
  }, [sourceTimeMs, setEditorState]);

  const handleSpotlightSizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    setEditorState(prev => ({
      ...prev,
      spotlightRegions: prev.spotlightRegions.map((region) => {
        if (region.id !== id) return region;
        const hasKeyframes = (region.keyframes?.length ?? 0) > 0;
        const playheadInside = sourceTimeMs >= region.startMs && sourceTimeMs <= region.endMs;

        if (hasKeyframes && playheadInside) {
          const relTime = sourceTimeMs - region.startMs;
          let kfs = region.keyframes ?? [];
          const hasPoint = kfs.some(
            kf => kf.source === 'spotlight' && Math.abs(kf.timeMs - relTime) < 50
          );
          if (!hasPoint) {
            const current = resolveSpotlightAtTime(kfs, relTime, region);
            kfs = upsertAllSpotlightPropertiesAtTime(kfs, relTime, current, 'ease-in-out', 'spotlight');
          }
          kfs = upsertSpotlightKeyframe(kfs, relTime, 'width', size.width, 'ease-in-out', 'spotlight');
          kfs = upsertSpotlightKeyframe(kfs, relTime, 'height', size.height, 'ease-in-out', 'spotlight');
          return { ...region, keyframes: kfs };
        }

        return { ...region, width: size.width, height: size.height };
      }),
    }));
  }, [sourceTimeMs, setEditorState]);

  const handleAutoSpotlightApply = useCallback((newRegions: SpotlightRegion[], nextId: number) => {
    if (newRegions.length === 0) return;
    nextSpotlightIdRef.current = nextId;
    setEditorState(prev => ({
      ...prev,
      spotlightRegions: [...prev.spotlightRegions, ...newRegions],
    }));
  }, [setEditorState, nextSpotlightIdRef]);

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

  return {
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
  };
}
