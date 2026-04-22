import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    hudOverlayHide: () => {
      ipcRenderer.send('hud-overlay-hide');
    },
    hudOverlayShow: () => {
      ipcRenderer.send('hud-overlay-show');
    },
    hudOverlayClose: () => {
      ipcRenderer.send('hud-overlay-close');
    },
  getAssetBasePath: async () => {
    // ask main process for the correct base path (production vs dev)
    return await ipcRenderer.invoke('get-asset-base-path')
  },
  getSources: async (opts: Electron.SourcesOptions) => {
    return await ipcRenderer.invoke('get-sources', opts)
  },
  getDisplays: () => {
    return ipcRenderer.invoke('get-displays')
  },
  switchToEditor: () => {
    return ipcRenderer.invoke('switch-to-editor')
  },
  openSourceSelector: () => {
    return ipcRenderer.invoke('open-source-selector')
  },
  selectSource: (source: any) => {
    return ipcRenderer.invoke('select-source', source)
  },
  getSelectedSource: () => {
    return ipcRenderer.invoke('get-selected-source')
  },

  storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('store-recorded-video', videoData, fileName)
  },

  getRecordedVideoPath: () => {
    return ipcRenderer.invoke('get-recorded-video-path')
  },
  setRecordingState: (recording: boolean) => {
    return ipcRenderer.invoke('set-recording-state', recording)
  },
  onStopRecordingFromTray: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('stop-recording-from-tray', listener)
    return () => ipcRenderer.removeListener('stop-recording-from-tray', listener)
  },
  openExternalUrl: (url: string) => {
    return ipcRenderer.invoke('open-external-url', url)
  },
  saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('save-exported-video', videoData, fileName)
  },
  openVideoFilePicker: () => {
    return ipcRenderer.invoke('open-video-file-picker')
  },
  setCurrentVideoPath: (path: string) => {
    return ipcRenderer.invoke('set-current-video-path', path)
  },
  getCurrentVideoPath: () => {
    return ipcRenderer.invoke('get-current-video-path')
  },
  clearCurrentVideoPath: () => {
    return ipcRenderer.invoke('clear-current-video-path')
  },
  getPlatform: () => {
    return ipcRenderer.invoke('get-platform')
  },
  // Project file operations
  saveProjectFile: (json: string, existingPath?: string) => {
    return ipcRenderer.invoke('save-project-file', json, existingPath)
  },
  openProjectFile: () => {
    return ipcRenderer.invoke('open-project-file')
  },
  fileExists: (filePath: string) => {
    return ipcRenderer.invoke('file-exists', filePath)
  },
  addRecentProject: (projectPath: string) => {
    return ipcRenderer.invoke('add-recent-project', projectPath)
  },
  getRecentProjects: () => {
    return ipcRenderer.invoke('get-recent-projects')
  },
  // Native recorder (cursor-free ScreenCaptureKit)
  nativeRecorderAvailable: () => {
    return ipcRenderer.invoke('native-recorder-available')
  },
  startNativeRecording: (options: { displayId: string; micDeviceId?: string; micEnabled?: boolean }) => {
    return ipcRenderer.invoke('start-native-recording', options)
  },
  stopNativeRecording: () => {
    return ipcRenderer.invoke('stop-native-recording')
  },
  // Cursor tracking
  startCursorTracking: (sourceBounds?: { x: number; y: number; width: number; height: number }) => {
    return ipcRenderer.invoke('start-cursor-tracking', sourceBounds)
  },
  stopCursorTracking: () => {
    return ipcRenderer.invoke('stop-cursor-tracking')
  },
  storeCursorData: (frames: any[], fileName: string) => {
    return ipcRenderer.invoke('store-cursor-data', frames, fileName)
  },
  getCursorData: (videoFilePath: string) => {
    return ipcRenderer.invoke('get-cursor-data', videoFilePath)
  },
  // Screen recording permission
  getScreenPermissionStatus: () => {
    return ipcRenderer.invoke('get-screen-permission-status')
  },
  openScreenRecordingSettings: () => {
    return ipcRenderer.invoke('open-screen-recording-settings')
  },
  // Microphone permission
  getMicPermissionStatus: () => {
    return ipcRenderer.invoke('get-mic-permission-status')
  },
  requestMicPermission: () => {
    return ipcRenderer.invoke('request-mic-permission')
  },
  // Menu action listener
  onMenuAction: (callback: (action: string) => void) => {
    const listener = (_event: any, action: string) => callback(action)
    ipcRenderer.on('menu-action', listener)
    return () => ipcRenderer.removeListener('menu-action', listener)
  },
})