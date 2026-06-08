import type { EditorUndoableState } from "@/components/video-editor/editorState";
import type { ExportQuality, ExportFormat, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import { migrateZoomKeyframesToRegions } from "@/lib/migrateZoom";

const PROJECT_VERSION = 1;
const FILE_EXTENSION = '.lumirec';

export interface ProjectFileData {
  version: number;
  videoPath: string;
  videoRelativePath?: string;
  editorState: EditorUndoableState;
  exportSettings: {
    quality: ExportQuality;
    format: ExportFormat;
    gifFrameRate: GifFrameRate;
    gifLoop: boolean;
    gifSizePreset: GifSizePreset;
  };
  savedAt: string;
}

export function serializeProject(
  videoPath: string,
  editorState: EditorUndoableState,
  exportSettings: ProjectFileData['exportSettings'],
  projectFilePath?: string,
): string {
  // Calculate relative video path if project file path is known
  let videoRelativePath: string | undefined;
  if (projectFilePath && videoPath) {
    const cleanVideoPath = videoPath.replace(/^file:\/\//, '');
    const projectDir = projectFilePath.substring(0, projectFilePath.lastIndexOf('/'));
    if (cleanVideoPath.startsWith(projectDir)) {
      videoRelativePath = cleanVideoPath.substring(projectDir.length + 1);
    }
  }

  const data: ProjectFileData = {
    version: PROJECT_VERSION,
    videoPath: videoPath.replace(/^file:\/\//, ''),
    videoRelativePath,
    editorState,
    exportSettings,
    savedAt: new Date().toISOString(),
  };

  return JSON.stringify(data, null, 2);
}

export function deserializeProject(json: string): ProjectFileData {
  const data = JSON.parse(json) as ProjectFileData;

  if (!data.version || data.version > PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${data.version}`);
  }

  if (!data.videoPath) {
    throw new Error('Project file is missing video path');
  }

  if (!data.editorState) {
    throw new Error('Project file is missing editor state');
  }

  // Migrate: lift legacy zoom keyframes into region pan points (single source of truth)
  migrateZoomKeyframesToRegions(data.editorState);

  // Migrate: backfill videoBorderRadius for projects saved before the field
  // existed. Default to 0 to preserve the exact visual of legacy projects
  // (they intentionally had no video-sprite rounding).
  if (typeof (data.editorState as Partial<EditorUndoableState>).videoBorderRadius !== 'number') {
    data.editorState.videoBorderRadius = 0;
  }

  return data;
}

export { FILE_EXTENSION, PROJECT_VERSION };
