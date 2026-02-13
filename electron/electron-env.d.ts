/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  electronAPI: {
    getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>
    switchToEditor: () => Promise<void>
    openSourceSelector: () => Promise<void>
    selectSource: (source: any) => Promise<any>
    getSelectedSource: () => Promise<any>
    storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{ success: boolean; path?: string; message?: string }>
    getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>
    setRecordingState: (recording: boolean) => Promise<void>
    onStopRecordingFromTray: (callback: () => void) => () => void
    openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>
    saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }>
    openVideoFilePicker: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
    setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
    getPlatform: () => Promise<string>
    hudOverlayHide: () => void;
    hudOverlayClose: () => void;
    // Native recorder (cursor-free ScreenCaptureKit)
    nativeRecorderAvailable: () => Promise<boolean>
    startNativeRecording: (options: { displayId: string; micDeviceId?: string; micEnabled?: boolean }) => Promise<{ success: boolean; path?: string; error?: string }>
    stopNativeRecording: () => Promise<{ success: boolean; path?: string; error?: string }>
    // Cursor tracking
    startCursorTracking: (sourceBounds?: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean }>
    stopCursorTracking: () => Promise<{ success: boolean; frames: { t: number; x: number; y: number }[] }>
    storeCursorData: (data: any, fileName: string) => Promise<{ success: boolean; path?: string }>
    getCursorData: (videoFilePath: string) => Promise<{ success: boolean; frames: { t: number; x: number; y: number }[]; cursorFree?: boolean }>
    // Microphone permission
    getMicPermissionStatus: () => Promise<string>
    requestMicPermission: () => Promise<boolean>
    // Project file operations
    saveProjectFile: (json: string, existingPath?: string) => Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }>
    openProjectFile: () => Promise<{ success: boolean; path?: string; content?: string; message?: string; cancelled?: boolean }>
    fileExists: (filePath: string) => Promise<boolean>
    addRecentProject: (projectPath: string) => Promise<{ success: boolean }>
    getRecentProjects: () => Promise<string[]>
    // Menu action listener
    onMenuAction: (callback: (action: string) => void) => () => void
  }
}

interface ProcessedDesktopSource {
  id: string
  name: string
  display_id: string
  thumbnail: string | null
  appIcon: string | null
}
