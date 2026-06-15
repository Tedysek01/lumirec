import { useCallback, useMemo } from "react";
import type { Span } from "dnd-timeline";
import { v4 as uuidv4 } from "uuid";

import {
  DEFAULT_TRANSITION_CONFIG,
  ZOOM_DEPTH_SCALES,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type ZoomPanPoint,
  type VideoSegment,
} from "@/components/video-editor/types";
import {
  resolveZoomCameraAtTime,
  resolveHoldCameraAtRelTime,
  clampPanPointTime,
} from "@/lib/zoomCamera";
import type { EditorStateSetter } from "./editorHandlerTypes";

const DEFAULT_ENTER_MS = 400;
const DEFAULT_EXIT_MS = 400;
/** Snap window (ms) for matching an edit to an existing pan point. */
const PAN_SNAP_MS = 50;

interface UseZoomHandlersArgs {
  setEditorState: EditorStateSetter;
  setEditorStateDebounced: EditorStateSetter;
  videoSegments: VideoSegment[];
  zoomRegions: ZoomRegion[];
  sourceTimeMs: number;
  selectedZoomId: string | null;
  nextZoomIdRef: React.MutableRefObject<number>;
  setSelectedZoomId: (id: string | null) => void;
  setSelectedTrimId: (id: string | null) => void;
  setSelectedAnnotationId: (id: string | null) => void;
}

/** Insert or update a pan point at a given region-relative time. */
function upsertPanPoint(
  points: ZoomPanPoint[],
  timeMs: number,
  focusX: number,
  focusY: number,
  zoom: number,
  snapMs: number = PAN_SNAP_MS,
): ZoomPanPoint[] {
  const idx = points.findIndex((p) => Math.abs(p.timeMs - timeMs) <= snapMs);
  if (idx >= 0) {
    const updated = [...points];
    updated[idx] = { ...updated[idx], timeMs, focusX, focusY, zoom };
    return updated;
  }
  return [...points, { id: uuidv4(), timeMs, focusX, focusY, zoom }];
}

export function useZoomHandlers({
  setEditorState,
  setEditorStateDebounced,
  zoomRegions,
  sourceTimeMs,
  selectedZoomId,
  nextZoomIdRef,
  setSelectedZoomId,
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
      panPoints: [],
    };
    setEditorState((prev) => ({ ...prev, zoomRegions: [...prev.zoomRegions, newRegion] }));
    setSelectedZoomId(id);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [nextZoomIdRef, setEditorState, setSelectedZoomId, setSelectedTrimId, setSelectedAnnotationId]);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== id) return r;
        const startMs = Math.round(span.start);
        const endMs = Math.round(span.end);
        if (startMs === r.startMs && endMs === r.endMs) return r;
        const updated: ZoomRegion = { ...r, startMs, endMs };
        // Keep pan points inside the (possibly resized) hold window.
        const panPoints = (r.panPoints ?? []).map((p) => ({
          ...p,
          timeMs: clampPanPointTime(updated, p.timeMs),
        }));
        return { ...updated, panPoints };
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
        ...newRegions.map((r) => ({ ...r, panPoints: r.panPoints ?? [] })),
      ],
    }));
  }, [nextZoomIdRef, setEditorState]);

  // --- Region configuration ---

  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== selectedZoomId) return r;
        const zoom = ZOOM_DEPTH_SCALES[depth];
        // Depth sets the region's base zoom AND retargets every pan point so the
        // slider is a quick "set the whole zoom level".
        const panPoints = (r.panPoints ?? []).map((p) => ({ ...p, zoom }));
        return { ...r, depth, panPoints };
      }),
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
        // Re-clamp pan points so none ends up inside the new transition ramps.
        const panPoints = (r.panPoints ?? []).map((p) => ({
          ...p,
          timeMs: clampPanPointTime(updated, p.timeMs),
        }));
        return { ...updated, panPoints };
      }),
    }));
  }, [selectedZoomId, setEditorState]);

  // --- Focus / pan points ---

  const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
    setEditorStateDebounced((prev) => {
      const region = prev.zoomRegions.find((r) => r.id === id);
      if (!region) return prev;
      const inside = sourceTimeMs >= region.startMs && sourceTimeMs <= region.endMs;
      if (!inside) {
        const points = region.panPoints ?? [];
        if (points.length === 0) {
          // No pan points — the base focus drives the implicit anchor.
          return {
            ...prev,
            zoomRegions: prev.zoomRegions.map((r) => (r.id === id ? { ...r, focus } : r)),
          };
        }
        // Pan points override the base focus, so aiming from outside the
        // region retargets the nearest end of the path instead: before the
        // region steer where the zoom enters, after it where it leaves.
        const sorted = [...points].sort((a, b) => a.timeMs - b.timeMs);
        const target = sourceTimeMs < region.startMs ? sorted[0] : sorted[sorted.length - 1];
        const panPoints = points.map((p) =>
          p.id === target.id ? { ...p, focusX: focus.cx, focusY: focus.cy } : p,
        );
        return {
          ...prev,
          zoomRegions: prev.zoomRegions.map((r) => (r.id === id ? { ...r, focus, panPoints } : r)),
        };
      }
      const relTime = clampPanPointTime(region, sourceTimeMs - region.startMs);
      // Zoom must come from the hold path, never from the enter/exit ramp the
      // playhead may be sitting in — otherwise the pan point bakes in a
      // half-ramped zoom and the region pans without zooming.
      const cam = resolveHoldCameraAtRelTime(region, relTime);
      const panPoints = upsertPanPoint(region.panPoints ?? [], relTime, focus.cx, focus.cy, cam.zoom);
      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map((r) => (r.id === id ? { ...r, focus, panPoints } : r)),
      };
    });
  }, [setEditorStateDebounced, sourceTimeMs]);

  const handleAddZoomPanPoint = useCallback((zoomRegionId: string) => {
    setEditorState((prev) => {
      const region = prev.zoomRegions.find((r) => r.id === zoomRegionId);
      if (!region) return prev;
      if (sourceTimeMs < region.startMs || sourceTimeMs > region.endMs) return prev;
      const relTime = clampPanPointTime(region, sourceTimeMs - region.startMs);
      const cam = resolveHoldCameraAtRelTime(region, relTime);
      const panPoints = upsertPanPoint(region.panPoints ?? [], relTime, cam.focusX, cam.focusY, cam.zoom);
      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map((r) => (r.id === zoomRegionId ? { ...r, panPoints } : r)),
      };
    });
  }, [setEditorState, sourceTimeMs]);

  // Duplicate the previous pan point's values at the playhead so the camera
  // holds still between the two before moving on.
  const handleHoldPanPoint = useCallback((zoomRegionId: string) => {
    setEditorState((prev) => {
      const region = prev.zoomRegions.find((r) => r.id === zoomRegionId);
      if (!region) return prev;
      if (sourceTimeMs < region.startMs || sourceTimeMs > region.endMs) return prev;
      const relTime = clampPanPointTime(region, sourceTimeMs - region.startMs);
      const sorted = [...(region.panPoints ?? [])].sort((a, b) => a.timeMs - b.timeMs);
      const prevPoint = sorted.filter((p) => p.timeMs < relTime - 5).pop();
      const cam = resolveHoldCameraAtRelTime(region, relTime);
      const fx = prevPoint?.focusX ?? cam.focusX;
      const fy = prevPoint?.focusY ?? cam.focusY;
      const z = prevPoint?.zoom ?? cam.zoom;
      const panPoints = upsertPanPoint(region.panPoints ?? [], relTime, fx, fy, z);
      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map((r) => (r.id === zoomRegionId ? { ...r, panPoints } : r)),
      };
    });
  }, [setEditorState, sourceTimeMs]);

  const handleZoomPropertyChange = useCallback((property: "zoom" | "focusX" | "focusY", value: number) => {
    if (!selectedZoomId) return;
    setEditorStateDebounced((prev) => {
      const region = prev.zoomRegions.find((r) => r.id === selectedZoomId);
      if (!region) return prev;
      const inside = sourceTimeMs >= region.startMs && sourceTimeMs <= region.endMs;
      if (!inside) return prev;
      const relTime = clampPanPointTime(region, sourceTimeMs - region.startMs);
      const cam = resolveHoldCameraAtRelTime(region, relTime);
      const next = {
        focusX: property === "focusX" ? value : cam.focusX,
        focusY: property === "focusY" ? value : cam.focusY,
        zoom: property === "zoom" ? value : cam.zoom,
      };
      const panPoints = upsertPanPoint(region.panPoints ?? [], relTime, next.focusX, next.focusY, next.zoom);
      return {
        ...prev,
        zoomRegions: prev.zoomRegions.map((r) => (r.id === selectedZoomId ? { ...r, panPoints } : r)),
      };
    });
  }, [selectedZoomId, setEditorStateDebounced, sourceTimeMs]);

  // --- Timeline pan-point drag/delete (region-based) ---

  /** Clamp a candidate pan-point time (region-relative) into the safe hold window. */
  const clampZoomPanPointTime = useCallback((regionId: string, relTimeMs: number): number => {
    const region = zoomRegions.find((r) => r.id === regionId);
    if (!region) return relTimeMs;
    return clampPanPointTime(region, relTimeMs);
  }, [zoomRegions]);

  const handleMoveZoomPanPoint = useCallback((regionId: string, oldRelTimeMs: number, newRelTimeMs: number) => {
    setEditorStateDebounced((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const clamped = clampPanPointTime(r, newRelTimeMs);
        const panPoints = (r.panPoints ?? []).map((p) =>
          Math.abs(p.timeMs - oldRelTimeMs) <= 5 ? { ...p, timeMs: clamped } : p,
        );
        return { ...r, panPoints };
      }),
    }));
  }, [setEditorStateDebounced]);

  const handleDeleteZoomPanPoint = useCallback((regionId: string, relTimeMs: number) => {
    setEditorState((prev) => ({
      ...prev,
      zoomRegions: prev.zoomRegions.map((r) => {
        if (r.id !== regionId) return r;
        const panPoints = (r.panPoints ?? []).filter((p) => Math.abs(p.timeMs - relTimeMs) > 5);
        return { ...r, panPoints };
      }),
    }));
  }, [setEditorState]);

  // --- Derived state for SettingsPanel ---

  const selectedRegion = useMemo(
    () => (selectedZoomId ? zoomRegions.find((r) => r.id === selectedZoomId) ?? null : null),
    [selectedZoomId, zoomRegions],
  );

  const playheadInsideSelectedZoom = useMemo(() => {
    if (!selectedRegion) return false;
    return sourceTimeMs >= selectedRegion.startMs && sourceTimeMs <= selectedRegion.endMs;
  }, [selectedRegion, sourceTimeMs]);

  const activeZoomTransform = useMemo(() => {
    if (!selectedRegion || !playheadInsideSelectedZoom) return null;
    const cam = resolveZoomCameraAtTime(selectedRegion, sourceTimeMs);
    return { zoom: cam.zoom, focusX: cam.focusX, focusY: cam.focusY };
  }, [selectedRegion, playheadInsideSelectedZoom, sourceTimeMs]);

  return {
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
    handleMoveZoomPanPoint,
    handleDeleteZoomPanPoint,
    clampZoomPanPointTime,
    playheadInsideSelectedZoom,
    activeZoomTransform,
  };
}
