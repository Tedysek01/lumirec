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
  displayId: string  // From ProcessedDesktopSource.display_id
  micDeviceId?: string
  micEnabled?: boolean
  frameRate?: number
}

/**
 * Start a cursor-free native recording.
 * @returns The output file path of the recording.
 */
export async function startNativeRecording(
  options: NativeRecordingOptions
): Promise<string> {
  if (!available || !recorderInstance) {
    throw new Error('Native recorder is not available')
  }

  const timestamp = Date.now()
  const outputPath = path.join(RECORDINGS_DIR, `recording-${timestamp}.mov`)

  // Convert Electron display_id string to numeric ID for node-mac-recorder
  const numericDisplayId = options.displayId ? parseInt(options.displayId, 10) : null

  await recorderInstance.startRecording(outputPath, {
    displayId: Number.isFinite(numericDisplayId) ? numericDisplayId : null,
    captureCursor: false,
    quality: 'high',
    frameRate: options.frameRate ?? 60,
    includeMicrophone: options.micEnabled ?? false,
    audioDeviceId: options.micDeviceId ?? null,
    includeSystemAudio: false,
  })

  return outputPath
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
