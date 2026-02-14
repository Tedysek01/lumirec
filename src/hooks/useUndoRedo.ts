import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 100;
const DEBOUNCE_MS = 300;

/**
 * Generic undo/redo hook with history stack.
 * Uses JSON.stringify for deep equality checks (state is small, so this is cheap).
 */
export function useUndoRedo<T>(initialState: T) {
  const [state, setStateRaw] = useState<T>(initialState);

  // History stacks stored as refs to avoid re-renders on push
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<string>(JSON.stringify(initialState));

  const pushSnapshot = useCallback((prevState: T) => {
    const serialized = JSON.stringify(prevState);
    // Skip if identical to last snapshot
    if (serialized === lastSnapshotRef.current) return;
    lastSnapshotRef.current = serialized;

    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), prevState];
    futureRef.current = [];
  }, []);

  /**
   * Update state immediately. Pushes the *previous* state onto the undo stack.
   * Use for discrete actions (button clicks, add/delete operations).
   */
  const setState = useCallback((updater: T | ((prev: T) => T)) => {
    // Cancel any pending debounced snapshot
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setStateRaw(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;
      // Only push snapshot if state actually changed (avoid invisible undo steps)
      if (next !== prev) {
        pushSnapshot(prev);
      }
      return next;
    });
  }, [pushSnapshot]);

  /**
   * Update state with debounced snapshot capture.
   * Use for continuous changes (slider drags) so one undo covers the entire gesture.
   * The snapshot of the state *before the first change in a gesture* is pushed.
   */
  const setStateDebounced = useCallback((updater: T | ((prev: T) => T)) => {
    setStateRaw(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;

      // If no timer is running, capture the pre-gesture snapshot
      if (!debounceTimerRef.current) {
        const serialized = JSON.stringify(prev);
        if (serialized !== lastSnapshotRef.current) {
          lastSnapshotRef.current = serialized;
          pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), prev];
          futureRef.current = [];
        }
      } else {
        clearTimeout(debounceTimerRef.current);
      }

      // Reset debounce timer
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        // Update the last snapshot to match current state after gesture ends
        setStateRaw(current => {
          lastSnapshotRef.current = JSON.stringify(current);
          return current;
        });
      }, DEBOUNCE_MS);

      return next;
    });
  }, []);

  const undo = useCallback(() => {
    // Flush any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const past = pastRef.current;
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    pastRef.current = past.slice(0, -1);

    setStateRaw(current => {
      futureRef.current = [...futureRef.current, current];
      lastSnapshotRef.current = JSON.stringify(previous);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    // Flush any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const future = futureRef.current;
    if (future.length === 0) return;

    const next = future[future.length - 1];
    futureRef.current = future.slice(0, -1);

    setStateRaw(current => {
      pastRef.current = [...pastRef.current, current];
      lastSnapshotRef.current = JSON.stringify(next);
      return next;
    });
  }, []);

  /**
   * Reset state without pushing to history.
   * Used when loading a project or initializing.
   */
  const resetState = useCallback((newState: T) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pastRef.current = [];
    futureRef.current = [];
    lastSnapshotRef.current = JSON.stringify(newState);
    setStateRaw(newState);
  }, []);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return {
    state,
    setState,
    setStateDebounced,
    undo,
    redo,
    canUndo,
    canRedo,
    resetState,
  };
}
