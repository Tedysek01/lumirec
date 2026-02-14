import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { serializeProject, deserializeProject, type ProjectFileData } from "@/lib/projectFile";
import type { EditorUndoableState } from "@/components/video-editor/editorState";
import type { ExportQuality, ExportFormat, GifFrameRate, GifSizePreset } from "@/lib/exporter";

const AUTOSAVE_DEBOUNCE_MS = 30_000;

interface UseProjectFileOptions {
  videoPath: string | null;
  editorState: EditorUndoableState;
  exportSettings: {
    quality: ExportQuality;
    format: ExportFormat;
    gifFrameRate: GifFrameRate;
    gifLoop: boolean;
    gifSizePreset: GifSizePreset;
  };
  onLoadProject: (data: ProjectFileData, videoUrl: string) => void;
}

export function useProjectFile({
  videoPath,
  editorState,
  exportSettings,
  onLoadProject,
}: UseProjectFileOptions) {
  const projectPathRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorStateRef = useRef(editorState);
  const exportSettingsRef = useRef(exportSettings);
  const videoPathRef = useRef(videoPath);

  // Keep refs in sync
  useEffect(() => { editorStateRef.current = editorState; }, [editorState]);
  useEffect(() => { exportSettingsRef.current = exportSettings; }, [exportSettings]);
  useEffect(() => { videoPathRef.current = videoPath; }, [videoPath]);

  const toFileUrl = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.match(/^[a-zA-Z]:/)) return `file:///${normalized}`;
    return `file://${normalized}`;
  };

  const saveProject = useCallback(async (saveAs = false) => {
    const currentVideoPath = videoPathRef.current;
    if (!currentVideoPath) {
      toast.error('No video loaded');
      return;
    }

    const json = serializeProject(
      currentVideoPath,
      editorStateRef.current,
      exportSettingsRef.current,
      saveAs ? undefined : projectPathRef.current || undefined,
    );

    const result = await window.electronAPI.saveProjectFile(
      json,
      saveAs ? undefined : projectPathRef.current || undefined,
    );

    if (result.cancelled) return;

    if (result.success && result.path) {
      projectPathRef.current = result.path;
      toast.success('Project saved');
      // Add to recent projects
      window.electronAPI.addRecentProject(result.path).catch(() => {});
    } else {
      toast.error(result.message || 'Failed to save project');
    }
  }, []);

  const openProject = useCallback(async () => {
    const result = await window.electronAPI.openProjectFile();

    if (result.cancelled || !result.success) return;

    try {
      const data = deserializeProject(result.content!);

      // Try to resolve video path
      let resolvedVideoPath = data.videoPath;
      const projectDir = result.path!.substring(0, result.path!.lastIndexOf('/'));

      // Check if absolute path exists
      const absoluteExists = await window.electronAPI.fileExists(resolvedVideoPath);
      if (!absoluteExists && data.videoRelativePath) {
        // Try relative path
        const relativeFull = `${projectDir}/${data.videoRelativePath}`;
        const relativeExists = await window.electronAPI.fileExists(relativeFull);
        if (relativeExists) {
          resolvedVideoPath = relativeFull;
        } else {
          // Ask user to locate the video
          const locateResult = await window.electronAPI.openVideoFilePicker();
          if (locateResult.success && locateResult.path) {
            resolvedVideoPath = locateResult.path;
          } else {
            toast.error('Cannot find video file. Project load cancelled.');
            return;
          }
        }
      }

      projectPathRef.current = result.path!;
      const videoUrl = toFileUrl(resolvedVideoPath);

      onLoadProject(data, videoUrl);

      // Add to recent projects
      window.electronAPI.addRecentProject(result.path!).catch(() => {});
      toast.success('Project loaded');
    } catch (err) {
      toast.error(`Failed to load project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onLoadProject]);

  // Auto-save: debounce 30s after last change, only if project has a path
  useEffect(() => {
    if (!projectPathRef.current) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      saveProject(false).catch(console.error);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [editorState, saveProject]);

  return {
    saveProject,
    saveProjectAs: useCallback(() => saveProject(true), [saveProject]),
    openProject,
    projectPath: projectPathRef.current,
  };
}
