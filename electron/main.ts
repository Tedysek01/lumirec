import { app, BrowserWindow, Tray, Menu, nativeImage, systemPreferences } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createHudOverlayWindow, createEditorWindow, createSourceSelectorWindow, showHudOverlay } from './windows'
import { registerIpcHandlers } from './ipc/handlers'
import { buildApplicationMenu } from './menu'
import { initNativeRecorder } from './recording/nativeRecorder'


const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')


async function ensureRecordingsDir() {
  try {
    await fs.mkdir(RECORDINGS_DIR, { recursive: true })
    console.log('RECORDINGS_DIR:', RECORDINGS_DIR)
    console.log('User Data Path:', app.getPath('userData'))
  } catch (error) {
    console.error('Failed to create recordings directory:', error)
  }
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Window references
let mainWindow: BrowserWindow | null = null
let sourceSelectorWindow: BrowserWindow | null = null
let tray: Tray | null = null
let selectedSourceName = ''

// Tray Icons
const defaultTrayIcon = getTrayIcon('lumirec.png');
const recordingTrayIcon = getTrayIcon('rec-button.png');

function createWindow() {
  mainWindow = createHudOverlayWindow()
}

function createTray() {
  tray = new Tray(defaultTrayIcon);
}

function getTrayIcon(filename: string) {
  return nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename)).resize({
    width: 24,
    height: 24,
    quality: 'best'
  });
}


// Recording time tracking — performance.now() resists sleep/wake drift
let recordingStartTimestamp: number | null = null;
let recordingTickInterval: ReturnType<typeof setInterval> | null = null;

function formatRecordingElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  const h = Math.floor(totalSec / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function buildRecordingMenu(elapsedLabel: string): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: `● Recording — ${elapsedLabel}`,
      enabled: false,
    },
    {
      label: "Stop Recording",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("stop-recording-from-tray");
        }
      },
    },
    {
      label: "Show HUD",
      click: () => {
        showHudOverlay();
      },
    },
    { type: 'separator' },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ];
}

function buildIdleMenu(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: "Open",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.isMinimized() && mainWindow.restore();
        } else {
          createWindow();
        }
      },
    },
    {
      label: "Show HUD",
      click: () => {
        showHudOverlay();
      },
    },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ];
}

function updateTrayMenu(recording: boolean = false) {
  if (!tray) return;
  const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
  const elapsed = recording && recordingStartTimestamp !== null
    ? performance.now() - recordingStartTimestamp
    : 0;
  const elapsedLabel = formatRecordingElapsed(elapsed);
  const trayToolTip = recording
    ? `Recording • ${elapsedLabel} • ${selectedSourceName}`
    : "Lumirec";
  const menuTemplate = recording ? buildRecordingMenu(elapsedLabel) : buildIdleMenu();
  tray.setImage(trayIcon);
  tray.setToolTip(trayToolTip);
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

function createEditorWindowWrapper() {
  if (mainWindow) {
    mainWindow.close()
    mainWindow = null
  }
  mainWindow = createEditorWindow()
}

function createSourceSelectorWindowWrapper() {
  sourceSelectorWindow = createSourceSelectorWindow()
  sourceSelectorWindow.on('closed', () => {
    sourceSelectorWindow = null
  })
  return sourceSelectorWindow
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Keep app running (macOS behavior)
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})



// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
    // Listen for HUD overlay quit event (macOS only)
    const { ipcMain } = await import('electron');
    ipcMain.on('hud-overlay-close', () => {
      app.quit();
    });
    createTray()
    updateTrayMenu()

  // Request microphone permission on macOS (non-blocking)
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      systemPreferences.askForMediaAccess('microphone').catch(() => {})
    }
  }

  // Ensure recordings directory exists
  await ensureRecordingsDir()

  // Initialize native recorder (non-blocking, sets availability flag)
  await initNativeRecorder()

  registerIpcHandlers(
    createEditorWindowWrapper,
    createSourceSelectorWindowWrapper,
    () => mainWindow,
    () => sourceSelectorWindow,
    (recording: boolean, sourceName: string) => {
      selectedSourceName = sourceName
      if (!tray) createTray();

      if (recording) {
        recordingStartTimestamp = performance.now();
        if (recordingTickInterval) clearInterval(recordingTickInterval);
        // Refresh tray tooltip + menu header every second so elapsed stays live
        recordingTickInterval = setInterval(() => {
          updateTrayMenu(true);
        }, 1000);
      } else {
        if (recordingTickInterval) {
          clearInterval(recordingTickInterval);
          recordingTickInterval = null;
        }
        recordingStartTimestamp = null;
      }

      updateTrayMenu(recording);

      if (!recording) {
        if (mainWindow) mainWindow.restore();
      }
    }
  )

  // Set application menu with shortcuts
  buildApplicationMenu(() => mainWindow)

  createWindow()
})
