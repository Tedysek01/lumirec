import { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog, screen, systemPreferences, webContents } from 'electron'

import fs from 'node:fs/promises'
import path from 'node:path'
import { RECORDINGS_DIR } from '../main'
import { isNativeRecorderAvailable, startNativeRecording, stopNativeRecording, getNativeCursorType } from '../recording/nativeRecorder'

const RECENT_PROJECTS_PATH = path.join(app.getPath('userData'), 'recent-projects.json')
const MAX_RECENT_PROJECTS = 10

let selectedSource: any = null

export function registerIpcHandlers(
  createEditorWindow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void
) {
  ipcMain.handle('get-sources', async (_, opts) => {
    try {
      const sources = await desktopCapturer.getSources(opts)
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        display_id: source.display_id,
        thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
        appIcon: source.appIcon ? source.appIcon.toDataURL() : null
      }))
    } catch {
      // On macOS, getSources throws when screen recording permission is denied
      return []
    }
  })

  // Fallback for macOS 15+/26 where desktopCapturer is blocked:
  // enumerate displays via electron.screen (no screen recording permission needed)
  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map((display, index) => ({
      id: `screen:${display.id}:${index}`,
      name: display.label || `Display ${index + 1}`,
      display_id: String(display.id),
      thumbnail: null,
      appIcon: null,
      bounds: display.bounds,
    }))
  })

  ipcMain.handle('select-source', (_, source) => {
    selectedSource = source
    // Broadcast source change to all renderer windows (e.g. HUD) so they can
    // react immediately instead of polling.
    webContents.getAllWebContents().forEach((wc) => {
      wc.send('selected-source-changed', selectedSource)
    })
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.close()
    }
    return selectedSource
  })

  ipcMain.handle('get-selected-source', () => {
    return selectedSource
  })

  ipcMain.handle('open-source-selector', () => {
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.focus()
      return
    }
    createSourceSelectorWindow()
  })

  ipcMain.handle('switch-to-editor', () => {
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.close()
    }
    createEditorWindow()
  })



  ipcMain.handle('store-recorded-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      const videoPath = path.join(RECORDINGS_DIR, fileName)
      await fs.writeFile(videoPath, Buffer.from(videoData))
      currentVideoPath = videoPath;
      return {
        success: true,
        path: videoPath,
        message: 'Video stored successfully'
      }
    } catch (error) {
      console.error('Failed to store video:', error)
      return {
        success: false,
        message: 'Failed to store video',
        error: String(error)
      }
    }
  })



  ipcMain.handle('get-recorded-video-path', async () => {
    try {
      const files = await fs.readdir(RECORDINGS_DIR)
      const videoFiles = files.filter(file => file.endsWith('.webm') || file.endsWith('.mov'))
      
      if (videoFiles.length === 0) {
        return { success: false, message: 'No recorded video found' }
      }
      
      const latestVideo = videoFiles.sort().reverse()[0]
      const videoPath = path.join(RECORDINGS_DIR, latestVideo)
      
      return { success: true, path: videoPath }
    } catch (error) {
      console.error('Failed to get video path:', error)
      return { success: false, message: 'Failed to get video path', error: String(error) }
    }
  })

  ipcMain.handle('set-recording-state', (_, recording: boolean) => {
    const source = selectedSource || { name: 'Screen' }
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name)
    }
  })


  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to open URL:', error)
      return { success: false, error: String(error) }
    }
  })

  // Return base path for assets so renderer can resolve file:// paths in production
  ipcMain.handle('get-asset-base-path', () => {
    try {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets')
      }
      return path.join(app.getAppPath(), 'public', 'assets')
    } catch (err) {
      console.error('Failed to resolve asset base path:', err)
      return null
    }
  })

  ipcMain.handle('save-exported-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      // Determine file type from extension
      const isGif = fileName.toLowerCase().endsWith('.gif');
      const filters = isGif 
        ? [{ name: 'GIF Image', extensions: ['gif'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }];

      const result = await dialog.showSaveDialog({
        title: isGif ? 'Save Exported GIF' : 'Save Exported Video',
        defaultPath: path.join(app.getPath('downloads'), fileName),
        filters,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          cancelled: true,
          message: 'Export cancelled'
        };
      }

      await fs.writeFile(result.filePath, Buffer.from(videoData));

      return {
        success: true,
        path: result.filePath,
        message: 'Video exported successfully'
      };
    } catch (error) {
      console.error('Failed to save exported video:', error)
      return {
        success: false,
        message: 'Failed to save exported video',
        error: String(error)
      }
    }
  })

  ipcMain.handle('open-video-file-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Video File',
        defaultPath: RECORDINGS_DIR,
        filters: [
          { name: 'Video Files', extensions: ['webm', 'mp4', 'mov', 'avi', 'mkv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open file picker:', error);
      return {
        success: false,
        message: 'Failed to open file picker',
        error: String(error)
      };
    }
  });

  let currentVideoPath: string | null = null;

  ipcMain.handle('set-current-video-path', (_, path: string) => {
    currentVideoPath = path;
    return { success: true };
  });

  ipcMain.handle('get-current-video-path', () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });

  ipcMain.handle('clear-current-video-path', () => {
    currentVideoPath = null;
    return { success: true };
  });

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  // --- Project File I/O ---

  ipcMain.handle('save-project-file', async (_, json: string, existingPath?: string) => {
    try {
      let filePath = existingPath;

      if (!filePath) {
        const result = await dialog.showSaveDialog({
          title: 'Save Project',
          defaultPath: path.join(app.getPath('documents'), 'Untitled.lumirec'),
          filters: [{ name: 'Lumirec Project', extensions: ['lumirec'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, cancelled: true };
        }
        filePath = result.filePath;
      }

      await fs.writeFile(filePath, json, 'utf-8');
      return { success: true, path: filePath };
    } catch (error) {
      console.error('Failed to save project:', error);
      return { success: false, message: String(error) };
    }
  });

  ipcMain.handle('open-project-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Open Project',
        filters: [
          { name: 'Lumirec Project', extensions: ['lumirec'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, path: filePath, content };
    } catch (error) {
      console.error('Failed to open project:', error);
      return { success: false, message: String(error) };
    }
  });

  ipcMain.handle('file-exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('add-recent-project', async (_, projectPath: string) => {
    try {
      let recent: string[] = [];
      try {
        const data = await fs.readFile(RECENT_PROJECTS_PATH, 'utf-8');
        recent = JSON.parse(data);
      } catch {
        // File doesn't exist yet
      }

      // Remove if already exists, add to front
      recent = [projectPath, ...recent.filter(p => p !== projectPath)].slice(0, MAX_RECENT_PROJECTS);
      await fs.writeFile(RECENT_PROJECTS_PATH, JSON.stringify(recent, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  });

  ipcMain.handle('get-recent-projects', async () => {
    try {
      const data = await fs.readFile(RECENT_PROJECTS_PATH, 'utf-8');
      return JSON.parse(data) as string[];
    } catch {
      return [];
    }
  });

  // --- Native Recorder (cursor-free ScreenCaptureKit) ---

  ipcMain.handle('native-recorder-available', () => {
    return isNativeRecorderAvailable()
  })

  ipcMain.handle('start-native-recording', async (_, options: {
    displayId: string
    micDeviceId?: string
    micEnabled?: boolean
  }) => {
    try {
      const outputPath = await startNativeRecording(options)
      currentVideoPath = outputPath
      return { success: true, path: outputPath }
    } catch (error) {
      console.error('Failed to start native recording:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('stop-native-recording', async () => {
    return await stopNativeRecording()
  })

  // --- Cursor Tracking ---
  let cursorTrackingInterval: ReturnType<typeof setInterval> | null = null;
  let cursorFrames: { t: number; x: number; y: number; s?: string }[] = [];
  let cursorTrackingStartTime = 0;
  let cursorSourceBounds: { x: number; y: number; width: number; height: number } | null = null;
  let lastCursorStyle: string | null = null;

  ipcMain.handle('start-cursor-tracking', (_, sourceBounds?: { x: number; y: number; width: number; height: number }) => {
    // Stop any existing tracking
    if (cursorTrackingInterval) {
      clearInterval(cursorTrackingInterval);
    }

    cursorFrames = [];
    cursorTrackingStartTime = Date.now();
    lastCursorStyle = null;

    // If source bounds provided, use them; otherwise use primary display
    if (sourceBounds) {
      cursorSourceBounds = sourceBounds;
    } else {
      const primaryDisplay = screen.getPrimaryDisplay();
      cursorSourceBounds = {
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height,
      };
    }

    // Poll cursor position at 60Hz
    cursorTrackingInterval = setInterval(() => {
      const point = screen.getCursorScreenPoint();
      const bounds = cursorSourceBounds!;
      const t = Date.now() - cursorTrackingStartTime;

      // Normalize to 0-1 relative to source bounds
      const x = Math.max(0, Math.min(1, (point.x - bounds.x) / bounds.width));
      const y = Math.max(0, Math.min(1, (point.y - bounds.y) / bounds.height));

      const frame: { t: number; x: number; y: number; s?: string } = { t, x, y };

      // Capture native cursor type — only include when it changes (run-length encoding)
      const cursorStyle = getNativeCursorType();
      if (cursorStyle && cursorStyle !== lastCursorStyle) {
        frame.s = cursorStyle;
        lastCursorStyle = cursorStyle;
      }

      cursorFrames.push(frame);
    }, 1000 / 60); // ~60Hz

    return { success: true };
  });

  ipcMain.handle('stop-cursor-tracking', () => {
    if (cursorTrackingInterval) {
      clearInterval(cursorTrackingInterval);
      cursorTrackingInterval = null;
    }

    const frames = cursorFrames;
    cursorFrames = [];
    return { success: true, frames };
  });

  ipcMain.handle('store-cursor-data', async (_, data: any, fileName: string) => {
    try {
      const filePath = path.join(RECORDINGS_DIR, fileName);
      await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
      return { success: true, path: filePath };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  });

  ipcMain.handle('get-cursor-data', async (_, filePath: string) => {
    try {
      // Try the cursor data file path (same name as video but .cursor.json)
      const cursorPath = filePath.replace(/\.(webm|mp4|mov)$/i, '.cursor.json');
      const data = await fs.readFile(cursorPath, 'utf-8');
      const parsed = JSON.parse(data);

      // Handle both formats:
      // New format: { cursorFree: true, frames: [...] }
      // Legacy format: [{ t, x, y }, ...]
      if (parsed && !Array.isArray(parsed) && parsed.frames) {
        return { success: true, frames: parsed.frames, cursorFree: parsed.cursorFree === true };
      }
      return { success: true, frames: parsed };
    } catch {
      return { success: false, frames: [] };
    }
  });

  // --- Screen Recording Permission ---
  ipcMain.handle('get-screen-permission-status', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('screen');
    }
    return 'granted';
  });

  ipcMain.handle('open-screen-recording-settings', () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });

  // --- Microphone Permission ---
  ipcMain.handle('get-mic-permission-status', () => {
    if (process.platform === 'darwin') {
      return systemPreferences.getMediaAccessStatus('microphone');
    }
    return 'granted'; // On non-macOS, permission is handled by the browser
  });

  ipcMain.handle('request-mic-permission', async () => {
    if (process.platform === 'darwin') {
      return await systemPreferences.askForMediaAccess('microphone');
    }
    return true;
  });
}
