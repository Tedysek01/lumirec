import { useCallback } from "react";
import type { Span } from "dnd-timeline";

import {
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIGURE_DATA,
  type AnnotationRegion,
  type FigureData,
} from "@/components/video-editor/types";
import type { EditorStateSetter } from "./editorHandlerTypes";

interface UseAnnotationHandlersArgs {
  setEditorState: EditorStateSetter;
  setEditorStateDebounced: EditorStateSetter;
  selectedAnnotationId: string | null;
  nextAnnotationIdRef: React.MutableRefObject<number>;
  nextAnnotationZIndexRef: React.MutableRefObject<number>;
  setSelectedAnnotationId: (id: string | null) => void;
  setSelectedZoomId: (id: string | null) => void;
  setSelectedTrimId: (id: string | null) => void;
}

export function useAnnotationHandlers({
  setEditorState,
  setEditorStateDebounced,
  selectedAnnotationId,
  nextAnnotationIdRef,
  nextAnnotationZIndexRef,
  setSelectedAnnotationId,
  setSelectedZoomId,
  setSelectedTrimId,
}: UseAnnotationHandlersArgs) {
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
  }, [setEditorState, nextAnnotationIdRef, nextAnnotationZIndexRef, setSelectedAnnotationId, setSelectedZoomId, setSelectedTrimId]);

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
  }, [selectedAnnotationId, setEditorState, setSelectedAnnotationId]);

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

  return {
    handleAnnotationAdded,
    handleAnnotationSpanChange,
    handleAnnotationDelete,
    handleAnnotationContentChange,
    handleAnnotationTypeChange,
    handleAnnotationStyleChange,
    handleAnnotationFigureDataChange,
    handleAnnotationPositionChange,
    handleAnnotationSizeChange,
  };
}
