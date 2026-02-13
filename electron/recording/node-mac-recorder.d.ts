declare module 'node-mac-recorder' {
  class MacRecorder {
    constructor()
    startRecording(outputPath: string, options?: {
      displayId?: number | null
      windowId?: number | null
      captureCursor?: boolean
      quality?: 'low' | 'medium' | 'high'
      frameRate?: number
      includeMicrophone?: boolean
      includeSystemAudio?: boolean
      audioDeviceId?: string | null
      systemAudioDeviceId?: string | null
      captureArea?: { x: number; y: number; width: number; height: number } | null
      captureCamera?: boolean
      cameraDeviceId?: string | null
    }): Promise<string>
    stopRecording(): Promise<{
      code: number
      outputPath: string
      cameraOutputPath: string | null
      audioOutputPath: string | null
      sessionTimestamp: number | null
    }>
    getDisplays(): Promise<Array<{
      id: number
      name: string
      width: number
      height: number
      x: number
      y: number
      isPrimary: boolean
      resolution: string
    }>>
    getWindows(): Promise<Array<{
      id: number
      name: string
      appName: string
      x: number
      y: number
      width: number
      height: number
    }>>
    getStatus(): {
      isRecording: boolean
      outputPath: string | null
    }
    checkPermissions(): Promise<{
      screenRecording: boolean
      microphone: boolean
      accessibility: boolean
    }>
  }
  export = MacRecorder
}
