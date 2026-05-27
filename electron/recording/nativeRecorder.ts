/**
 * Native macOS screen recorder using ScreenCaptureKit via node-mac-recorder.
 * Records cursor-free video directly to .mov files.
 * Falls back gracefully if unavailable (non-macOS, build failure, etc.).
 */

import path from 'node:path'
import { RECORDINGS_DIR } from '../main'

// Dynamic import result - node-mac-recorder is CommonJS with native bindings
let MacRecorder: any = null
let recorderInstance: any = null
let available = false

/**
 * Initialize the native recorder. Call once at app startup.
 * Non-blocking: sets availability flag, never throws.
 */
export async function initNativeRecorder(): Promise<void> {
  if (process.platform !== 'darwin') {
    console.log('Native recorder: skipped (not macOS)')
    return
  }

  try {
    // Dynamic require to avoid bundling issues - Vite externalizes this module
    const mod = await import('node-mac-recorder')
    MacRecorder = mod.default || mod
    recorderInstance = new MacRecorder()
    available = true
    console.log('Native recorder: initialized successfully')
  } catch (err) {
    available = false
    console.warn('Native recorder: unavailable -', (err as Error).message)
  }
}

/**
 * Whether the native recorder is ready to use.
 */
export function isNativeRecorderAvailable(): boolean {
  return available
}

export interface NativeRecordingOptions {
  displayId?: string  // From ProcessedDesktopSource.display_id (screen capture)
  windowId?: string   // CGWindowID parsed from desktopCapturer source.id (window capture)
  micDeviceId?: string
  micEnabled?: boolean
  frameRate?: number
}

export interface NativeRecordingResult {
  path: string
  // Window bounds (global screen coords) when recording a window, so the renderer
  // can normalize cursor coordinates against the captured area instead of the
  // primary display.
  bounds?: { x: number; y: number; width: number; height: number }
}

/**
 * Start a cursor-free native recording.
 * Pass `windowId` to capture a single window, or `displayId` for a whole display.
 * If both are provided, `windowId` wins (node-mac-recorder will derive the display).
 */
export async function startNativeRecording(
  options: NativeRecordingOptions
): Promise<NativeRecordingResult> {
  if (!available || !recorderInstance) {
    throw new Error('Native recorder is not available')
  }

  const timestamp = Date.now()
  const outputPath = path.join(RECORDINGS_DIR, `recording-${timestamp}.mov`)

  const numericDisplayId = options.displayId ? parseInt(options.displayId, 10) : NaN
  const numericWindowId = options.windowId ? parseInt(options.windowId, 10) : NaN
  const useWindow = Number.isFinite(numericWindowId)

  let bounds: NativeRecordingResult['bounds']
  if (useWindow) {
    try {
      const windows = await recorderInstance.getWindows()
      const win = windows.find((w: any) => w.id === numericWindowId)
      if (win) {
        bounds = { x: win.x, y: win.y, width: win.width, height: win.height }
      }
    } catch (err) {
      console.warn('Native recorder: failed to resolve window bounds -', (err as Error).message)
    }
  }

  await recorderInstance.startRecording(outputPath, {
    // For window capture, leave displayId null — node-mac-recorder derives it
    // from the window's location. Passing both can mis-target the recording.
    displayId: useWindow ? null : (Number.isFinite(numericDisplayId) ? numericDisplayId : null),
    windowId: useWindow ? numericWindowId : null,
    captureCursor: false,
    quality: 'high',
    frameRate: options.frameRate ?? 60,
    includeMicrophone: options.micEnabled ?? false,
    audioDeviceId: options.micDeviceId ?? null,
    includeSystemAudio: false,
  })

  return { path: outputPath, bounds }
}

/**
 * Get the current native cursor type from the OS.
 * Returns CSS cursor keyword (e.g. 'default', 'pointer', 'text') or null if unavailable.
 */
export function getNativeCursorType(): string | null {
  if (!available || !recorderInstance) return null;
  try {
    const pos = recorderInstance.getCursorPosition();
    return pos?.cursorType ?? null;
  } catch {
    return null;
  }
}

/**
 * Stop the current native recording.
 * @returns Result with success status and output file path.
 */
export async function stopNativeRecording(): Promise<{
  success: boolean
  path?: string
  error?: string
}> {
  if (!recorderInstance) {
    return { success: false, error: 'Native recorder is not available' }
  }

  try {
    const result = await recorderInstance.stopRecording()
    return {
      success: true,
      path: result.outputPath,
    }
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
    }
  }
}
