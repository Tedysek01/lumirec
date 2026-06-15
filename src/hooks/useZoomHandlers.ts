import { useCallback, useMemo } from "react";
import type { Span } from "dnd-timeline";
import { v4 as uuidv4 } from "uuid";

import {
  DEFAULT_TRANSITION_CONFIG,
  type ZoomDepth,
  type ZoomRegion,
  type ZoomLayer,
  type ZoomLayerKind,
  type VideoSegment,
} from "@/components/video-editor/types";
import { resolveTransitionWindow, clampLayerToHold } from "@/lib/zoomCamera";
import type { EditorStateSetter } from "./editorHandlerTypes";

const DEFAULT_ENTER_MS = 400;
const DEFAULT_EXIT_MS = 400;
/** Default ramp for a freshly added layer. */
const DEFAULT_LAYER_RAMP_MS = 200;
/** Default delta value for a freshly added zoom layer. */
const DEFAULT_ZOOM_DELTA = 0.5;

interface UseZoomHandlersArgs {
  setEditorState: EditorStateSetter;
  setEditorStateDebounced: EditorStateSetter;
  videoSegments: VideoSegment[];
  zoomRegions: ZoomRegion[];
  sourceTimeMs: number;
  selectedZoomId: string | null;
  selectedZoomLayerId: string | null;
  nextZoomIdRef: React.MutableRefObject<number>;
  setSelectedZoomId: (id: string | null) => void;
  setSelectedZoomLayerId: (id: string | null) => void;
  setSelectedTrimId: (id: string | null) => void;
  setSelectedAnnotationId: (id: string | null) => void;
}

/** Build a new layer spanning the region's hold window with sensible defaults. */
function makeLayer(region: ZoomRegion, kind: ZoomLayerKind): ZoomLayer {
  const { t2, t3 } = resolveTransitionWindow(region);
  const holdStart = t2 - region.startMs;
  const holdEnd = t3 - region.startMs;
  const base: ZoomLayer = {
    id: uuidv4(),
    kind,
    startMs: holdStart,
    endMs: holdEnd,
    enterMs: DEFAULT_LAYER_RAMP_MS,
    exitMs: DEFAULT_LAYER_RAMP_MS,
    ...(kind === 'zoom' ? { zoomDelta: DEFAULT_ZOOM_DELTA } : { focusDx: 0, focusDy: 0 }),
  };
  return clampLayerToHold(region, base);
}

export function useZoomHandlers({
  setEditorState,
  setEditorStateDebounced,
  zoomRegions,
  sourceTimeMs,
  selectedZoomId,
  selectedZoomLayerId,
  nextZoomIdRef,
  setSelectedZoomId,
  setSelectedZoomLayerId,
  setSelectedTrimId,
  setSelectedAnnotationId,
}: UseZoomHandlersArgs) {
  // --- Region lifecycle ---

  const handleZoomAdded = useCallback((span: Span) => {
    const id = `zoom-${nextZoomIdRef.current++}`;
    const newRegion: ZoomRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      depth: 3,
      focus: { cx: 0.5, cy: 0.5 },
      enterTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: DEFAULT_ENTER_MS },
      exitTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: DEFAULT_EXIT_MS },
      layers: [],
    };
    setEditorState((prev) => ({ ...prev, zoomRegions: [...prev.zoomRegions, newRegion] }));
    setSelectedZoomId(id);
    setSelectedZoomLayerId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [nextZoomIdRef, setEditorState, setSelectedZoomId, setSelectedZoomLayerId, setSelectedTrimId, setSelectedAnnotationId]);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== id) return r;
        const startMs = Math.round(span.start);
        const endMs = Math.round(span.end);
        if (startMs === r.startMs && endMs === r.endMs) return r;
        const updated: ZoomRegion = { ...r, startMs, endMs };
        const layers = (r.layers ?? []).map((l) => clampLayerToHold(updated, l));
        return { ...updated, layers };
      }),
    }));
  }, [setEditorState]);

  const handleZoomDelete = useCallback((id: string) => {
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.filter((r) => r.id !== id),
    }));
    if (selectedZoomId === id) setSelectedZoomId(null);
  }, [selectedZoomId, setEditorState, setSelectedZoomId]);

  const handleAutoZoomApply = useCallback((newRegions: ZoomRegion[], nextId: number) => {
    if (newRegions.length === 0) return;
    nextZoomIdRef.current = nextId;
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: [
        ...prev.zoomRegions,
        ...newRegions.map((r) => ({ ...r, layers: r.layers ?? [] })),
      ],
    }));
  }, [nextZoomIdRef, setEditorState]);

  // --- Region configuration ---

  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => (r.id === selectedZoomId ? { ...r, depth } : r)),
    }));
  }, [selectedZoomId, setEditorState]);

  const handleZoomTransitionChange = useCallback((enterMs: number, exitMs: number) => {
    if (!selectedZoomId) return;
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== selectedZoomId) return r;
        const updated: ZoomRegion = {
          ...r,
          enterTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: enterMs },
          exitTransition: { ...DEFAULT_TRANSITION_CONFIG, durationMs: exitMs },
        };
        const layers = (r.layers ?? []).map((l) => clampLayerToHold(updated, l));
        return { ...updated, layers };
      }),
    }));
  }, [selectedZoomId, setEditorState]);

  // --- Layer CRUD ---

  const handleAddZoomLayer = useCallback((regionId: string, kind: ZoomLayerKind) => {
    setEditorState((prev) => {
      let newId: string | null = null;
      const zoomRegions = prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layer = makeLayer(r, kind);
        newId = layer.id;
        return { ...r, layers: [...(r.layers ?? []), layer] };
      });
      if (newId) setSelectedZoomLayerId(newId);
      return { ...prev, zoomRegions };
    });
  }, [setEditorState, setSelectedZoomLayerId]);

  const handleUpdateZoomLayer = useCallback((regionId: string, layerId: string, patch: Partial<ZoomLayer>) => {
    setEditorStateDebounced((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layers = (r.layers ?? []).map((l) => (l.id === layerId ? { ...l, ...patch } : l));
        return { ...r, layers };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleResizeZoomLayer = useCallback((regionId: string, layerId: string, startMs: number, endMs: number) => {
    setEditorStateDebounced((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layers = (r.layers ?? []).map((l) =>
          l.id === layerId ? clampLayerToHold(r, { ...l, startMs, endMs }) : l,
        );
        return { ...r, layers };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleMoveZoomLayer = useCallback((regionId: string, layerId: string, newStartMs: number) => {
    setEditorStateDebounced((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const layers = (r.layers ?? []).map((l) => {
          if (l.id !== layerId) return l;
          const dur = l.endMs - l.startMs;
          return clampLayerToHold(r, { ...l, startMs: newStartMs, endMs: newStartMs + dur });
        });
        return { ...r, layers };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleDeleteZoomLayer = useCallback((regionId: string, layerId: string) => {
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) =>
        r.id === regionId ? { ...r, layers: (r.layers ?? []).filter((l) => l.id !== layerId) } : r,
      ),
    }));
    if (selectedZoomLayerId === layerId) setSelectedZoomLayerId(null);
  }, [setEditorState, selectedZoomLayerId, setSelectedZoomLayerId]);

  // --- Derived state for SettingsPanel ---

  const selectedRegion = useMemo(
    () => (selectedZoomId ? zoomRegions.find((r) => r.id === selectedZoomId) ?? null : null),
    [selectedZoomId, zoomRegions],
  );

  const playheadInsideSelectedZoom = useMemo(() => {
    if (!selectedRegion) return false;
    return sourceTimeMs >= selectedRegion.startMs && sourceTimeMs <= selectedRegion.endMs;
  }, [selectedRegion, sourceTimeMs]);

  const selectedLayer = useMemo(() => {
    if (!selectedRegion || !selectedZoomLayerId) return null;
    return (selectedRegion.layers ?? []).find((l) => l.id === selectedZoomLayerId) ?? null;
  }, [selectedRegion, selectedZoomLayerId]);

  return {
    handleZoomAdded,
    handleZoomSpanChange,
    handleZoomDepthChange,
    handleZoomTransitionChange,
    handleZoomDelete,
    handleAutoZoomApply,
    handleAddZoomLayer,
    handleUpdateZoomLayer,
    handleResizeZoomLayer,
    handleMoveZoomLayer,
    handleDeleteZoomLayer,
    playheadInsideSelectedZoom,
    selectedLayer,
  };
}
