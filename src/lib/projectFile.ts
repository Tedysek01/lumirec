import type { EditorUndoableState } from "@/components/video-editor/editorState";
import type { ExportQuality, ExportFormat, GifFrameRate, GifSizePreset } from "@/lib/exporter";

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

  return data;
}

export { FILE_EXTENSION, PROJECT_VERSION };
