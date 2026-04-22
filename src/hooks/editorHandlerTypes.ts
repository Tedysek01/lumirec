import type { EditorUndoableState } from "@/components/video-editor/editorState";

/**
 * Setter signature compatible with the state updaters returned by useUndoRedo.
 * Accepts either a direct next state or a functional updater.
 */
export type UseUndoRedoSet<T> = (updater: T | ((prev: T) => T)) => void;

export type EditorStateSetter = UseUndoRedoSet<EditorUndoableState>;
