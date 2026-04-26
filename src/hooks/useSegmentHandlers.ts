import { useCallback } from "react";

import type { VideoSegment } from "@/components/video-editor/types";
import {
  splitSegment,
  rippleSegments,
  findSegmentAtSourceTime,
} from "@/lib/segmentUtils";
import type { EditorStateSetter } from "./editorHandlerTypes";

interface UseSegmentHandlersArgs {
  setEditorState: EditorStateSetter;
  videoSegments: VideoSegment[];
  currentTime: number;
  selectedSegmentId: string | null;
  setSelectedSegmentId: (id: string | null) => void;
}

export function useSegmentHandlers({
  setEditorState,
  videoSegments,
  currentTime,
  selectedSegmentId,
  setSelectedSegmentId,
}: UseSegmentHandlersArgs) {
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
  }, [selectedSegmentId, setEditorState, setSelectedSegmentId]);

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

  // Razor tool: split at current playhead position (source time coordinates)
  const handleRazorAtPlayhead = useCallback(() => {
    const sourceTimeMs = Math.round(currentTime * 1000);
    const segment = findSegmentAtSourceTime(videoSegments, sourceTimeMs);
    if (segment) {
      handleSplitSegmentAt(segment.id, sourceTimeMs);
    }
  }, [currentTime, videoSegments, handleSplitSegmentAt]);

  return {
    handleSplitSegmentAt,
    handleDeleteSegment,
    handleSegmentSpanChange,
    handleRazorAtPlayhead,
  };
}
