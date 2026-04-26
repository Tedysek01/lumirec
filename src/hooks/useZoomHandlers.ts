import { useCallback, useMemo } from "react";
import type { Span } from "dnd-timeline";

import {
  DEFAULT_TRANSITION_CONFIG,
  ZOOM_DEPTH_SCALES,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type VideoSegment,
} from "@/components/video-editor/types";
import { generateZoomKeyframes } from "@/lib/zoomKeyframeGenerator";
import {
  resolveTransformAtTime,
  upsertKeyframe,
  isZoomKeyframe,
  getUniquePanPointTimes,
  getLastPanPointFocus,
  getFirstPanPointFocus,
  clampToPanRange,
  syncZoomBoundaries,
} from "@/lib/keyframeInterpolation";
import { findSegmentAtSourceTime } from "@/lib/segmentUtils";
import type { EditorStateSetter } from "./editorHandlerTypes";

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

export function useZoomHandlers({
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
}: UseZoomHandlersArgs) {
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

      // Auto boundary keyframes at t1/t2/t3/t4 — zoom-in, hold, zoom-out.
      const autoKeyframes = generateZoomKeyframes({
        startRelativeMs: segRelativeStart,
        endRelativeMs: segRelativeEnd,
        targetZoom,
        focusX: 0.5,
        focusY: 0.5,
      });

      // Also seed a user-facing pan point inside the hold zone, so the region has an
      // immediately draggable diamond — matches the mental model where "one zoom = one anchor".
      const midRel = (segRelativeStart + segRelativeEnd) / 2;
      const panTime = clampToPanRange(midRel, segRelativeStart, segRelativeEnd, 400, 400);
      let kfs = [...seg.keyframes, ...autoKeyframes];
      kfs = upsertKeyframe(kfs, panTime, 'zoom', targetZoom, 'ease-in-out');
      kfs = upsertKeyframe(kfs, panTime, 'focusX', 0.5, 'ease-in-out');
      kfs = upsertKeyframe(kfs, panTime, 'focusY', 0.5, 'ease-in-out');
      kfs = kfs.map(kf => {
        if (Math.abs(kf.timeMs - panTime) < 5 && (kf.property === 'zoom' || kf.property === 'focusX' || kf.property === 'focusY')) {
          return { ...kf, source: 'zoom' as const };
        }
        return kf;
      });

      return {
        ...prev,
        zoomRegions: [...prev.zoomRegions, newRegion],
        videoSegments: prev.videoSegments.map(s =>
          s.id === seg.id ? { ...s, keyframes: kfs } : s
        ),
      };
    });
    setSelectedZoomId(id);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [setEditorState, nextZoomIdRef, setSelectedZoomId, setSelectedTrimId, setSelectedAnnotationId]);

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
          // Only touch zoom-property keyframes inside this region.
          if (kf.property !== 'zoom') return kf;
          if (kf.source !== 'zoom-auto' && kf.source !== 'zoom') return kf;
          if (kf.timeMs < segRelativeStart - 5 || kf.timeMs > segRelativeEnd + 5) return kf;
          // t1/t4 auto boundaries stay at zoom=1 (they're the un-zoomed endpoints).
          if (kf.source === 'zoom-auto' &&
              (Math.abs(kf.timeMs - segRelativeStart) < 5 || Math.abs(kf.timeMs - segRelativeEnd) < 5)) {
            return kf;
          }
          // Everything else — t2, t3, AND user pan points — gets the new depth's zoom.
          // Without this, pan points retain the old zoom and syncZoomBoundaries snaps
          // t2/t3 back to it, making the depth slider appear to do nothing.
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
  }, [selectedZoomId, setEditorState, setSelectedZoomId]);

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
  }, [setEditorState, nextZoomIdRef]);

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
    playheadInsideSelectedZoom,
    activeZoomTransform,
    currentZoomKeyframeTime,
  };
}
