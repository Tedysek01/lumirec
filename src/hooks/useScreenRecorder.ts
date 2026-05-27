import { useState, useRef, useEffect } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import { toast } from "sonner";

export interface AudioConfig {
  micEnabled: boolean;
  micDeviceId?: string;
  micVolume: number; // 0-1
}

type UseScreenRecorderReturn = {
  recording: boolean;
  toggleRecording: () => void;
};

export function useScreenRecorder(audioConfig?: AudioConfig): UseScreenRecorderReturn {
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef<number>(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  // Track whether current recording uses native path
  const isNativeRecording = useRef(false);

  // Target visually lossless 4K @ 60fps; fall back gracefully when hardware cannot keep up
  const TARGET_FRAME_RATE = 60;
  const TARGET_WIDTH = 3840;
  const TARGET_HEIGHT = 2160;
  const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;

  const selectMimeType = (withAudio: boolean) => {
    // When audio is included, prefer codecs that support audio+video together
    const preferred = withAudio
      ? [
          "video/webm;codecs=h264,opus",
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=h264",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm"
        ]
      : [
          "video/webm;codecs=av1",
          "video/webm;codecs=h264",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm"
        ];

    return preferred.find(type => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
  };

  const computeBitrate = (width: number, height: number) => {
    const pixels = width * height;
    const highFrameRateBoost = TARGET_FRAME_RATE >= 60 ? 1.7 : 1;

    if (pixels >= FOUR_K_PIXELS) {
      return Math.round(45_000_000 * highFrameRateBoost);
    }

    if (pixels >= 2560 * 1440) {
      return Math.round(28_000_000 * highFrameRateBoost);
    }

    return Math.round(18_000_000 * highFrameRateBoost);
  };

  const cleanupAudio = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    gainNodeRef.current = null;
  };

  const stopRecording = useRef(() => {
    if (isNativeRecording.current) {
      // Native path: stop via IPC
      stopNativeRecording();
      return;
    }

    // Fallback path: stop MediaRecorder
    if (mediaRecorder.current?.state === "recording") {
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
      }
      mediaRecorder.current.stop();
      cleanupAudio();
      setRecording(false);

      window.electronAPI?.setRecordingState(false);
    }
  });

  // Update gain node when volume changes during recording
  useEffect(() => {
    if (gainNodeRef.current && audioConfig) {
      gainNodeRef.current.gain.value = audioConfig.micVolume;
    }
  }, [audioConfig?.micVolume]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (window.electronAPI?.onStopRecordingFromTray) {
      cleanup = window.electronAPI.onStopRecordingFromTray(() => {
        stopRecording.current();
      });
    }

    return () => {
      if (cleanup) cleanup();

      if (mediaRecorder.current?.state === "recording") {
        mediaRecorder.current.stop();
      }
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
        stream.current = null;
      }
      cleanupAudio();
    };
  }, []);

  // --- Native recording path (cursor-free ScreenCaptureKit) ---

  async function startNativeRecordingPath(selectedSource: any) {
    isNativeRecording.current = true;

    // Electron desktopCapturer source.id is "window:<CGWindowID>:0" or "screen:<id>:0".
    // For windows we must pass windowId so ScreenCaptureKit records the window
    // instead of the whole display it sits on.
    const isWindow = typeof selectedSource.id === 'string' && selectedSource.id.startsWith('window:');
    const windowId = isWindow ? selectedSource.id.split(':')[1] : undefined;

    const result = await window.electronAPI.startNativeRecording({
      displayId: isWindow ? undefined : selectedSource.display_id,
      windowId,
      micDeviceId: audioConfig?.micDeviceId,
      micEnabled: audioConfig?.micEnabled ?? false,
    });

    if (!result.success) {
      throw new Error(result.error || 'Native recording failed to start');
    }

    startTime.current = performance.now();
    setRecording(true);
    window.electronAPI?.setRecordingState(true);

    // Cursor coords need to be normalized against whatever area was actually
    // captured. For a window, that's the window's screen rect (returned by the
    // recorder). For full-screen, omit bounds and let the main process default
    // to the primary display.
    window.electronAPI?.startCursorTracking(result.bounds).catch((err: unknown) => {
      console.warn('Failed to start cursor tracking:', err);
    });
  }

  async function stopNativeRecording() {
    setRecording(false);
    isNativeRecording.current = false;
    window.electronAPI?.setRecordingState(false);

    // Stop cursor tracking and get recorded frames
    let cursorFrames: { t: number; x: number; y: number }[] = [];
    try {
      const cursorResult = await window.electronAPI?.stopCursorTracking();
      if (cursorResult?.success && cursorResult.frames) {
        cursorFrames = cursorResult.frames;
      }
    } catch (err) {
      console.warn('Failed to stop cursor tracking:', err);
    }

    try {
      const result = await window.electronAPI.stopNativeRecording();
      if (!result.success) {
        console.error('Failed to stop native recording:', result.error);
        return;
      }

      const videoPath = result.path;
      if (!videoPath) return;

      // Store cursor data alongside video with cursorFree flag
      if (cursorFrames.length > 0) {
        const videoFileName = videoPath.split('/').pop() || '';
        const cursorFileName = videoFileName.replace(/\.(mov|webm|mp4)$/i, '.cursor.json');
        const cursorData = { cursorFree: true, frames: cursorFrames };
        await window.electronAPI.storeCursorData(cursorData as any, cursorFileName);
      }

      await window.electronAPI.setCurrentVideoPath(videoPath);
      await window.electronAPI.switchToEditor();
    } catch (error) {
      console.error('Error finalizing native recording:', error);
    }
  }

  // --- Fallback recording path (desktopCapturer + MediaRecorder) ---

  async function startFallbackRecording(selectedSource: any) {
    isNativeRecording.current = false;

    const mediaStream = await (navigator.mediaDevices as any).getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: selectedSource.id,
          maxWidth: TARGET_WIDTH,
          maxHeight: TARGET_HEIGHT,
          maxFrameRate: TARGET_FRAME_RATE,
          minFrameRate: 30,
        },
      },
    });
    stream.current = mediaStream;
    if (!stream.current) {
      throw new Error("Media stream is not available.");
    }
    const videoTrack = stream.current.getVideoTracks()[0];
    try {
      await videoTrack.applyConstraints({
        frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
        width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
        height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
      });
    } catch (error) {
      console.warn("Unable to lock 4K/60fps constraints, using best available track settings.", error);
    }

    let { width = 1920, height = 1080 } = videoTrack.getSettings();

    // Ensure dimensions are divisible by 2 for VP9/AV1 codec compatibility
    width = Math.floor(width / 2) * 2;
    height = Math.floor(height / 2) * 2;

    const videoBitsPerSecond = computeBitrate(width, height);

    // Combine video with mic audio if enabled
    let combinedStream = stream.current;
    const micEnabled = audioConfig?.micEnabled ?? false;

    if (micEnabled) {
      try {
        const micConstraints: MediaStreamConstraints = {
          audio: audioConfig?.micDeviceId
            ? { deviceId: { exact: audioConfig.micDeviceId } }
            : true,
          video: false,
        };
        const micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
        micStreamRef.current = micStream;

        // Use Web Audio to control volume via GainNode
        const audioCtx = new AudioContext();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(micStream);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = audioConfig?.micVolume ?? 1;
        gainNodeRef.current = gainNode;
        const destination = audioCtx.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(destination);

        // Create combined stream with video + processed audio
        combinedStream = new MediaStream([
          ...stream.current.getVideoTracks(),
          ...destination.stream.getAudioTracks(),
        ]);
      } catch (err) {
        console.warn('Failed to capture mic audio, recording without audio:', err);
        // Continue without audio
      }
    }

    const mimeType = selectMimeType(micEnabled && micStreamRef.current !== null);

    chunks.current = [];
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond,
    });
    mediaRecorder.current = recorder;
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.current.push(e.data);
    };
    recorder.onstop = async () => {
      stream.current = null;
      cleanupAudio();
      if (chunks.current.length === 0) return;
      const duration = performance.now() - startTime.current;
      const recordedChunks = chunks.current;
      const buggyBlob = new Blob(recordedChunks, { type: mimeType });
      // Clear chunks early to free memory immediately after blob creation
      chunks.current = [];
      const timestamp = Date.now();
      const videoFileName = `recording-${timestamp}.webm`;

      // Stop cursor tracking and get recorded frames
      let cursorFrames: { t: number; x: number; y: number }[] = [];
      try {
        const cursorResult = await window.electronAPI?.stopCursorTracking();
        if (cursorResult?.success && cursorResult.frames) {
          cursorFrames = cursorResult.frames;
        }
      } catch (err) {
        console.warn('Failed to stop cursor tracking:', err);
      }

      try {
        const videoBlob = await fixWebmDuration(buggyBlob, duration);
        const arrayBuffer = await videoBlob.arrayBuffer();
        const videoResult = await window.electronAPI.storeRecordedVideo(arrayBuffer, videoFileName);
        if (!videoResult.success) {
          console.error('Failed to store video:', videoResult.message);
          return;
        }

        // Store cursor data alongside video
        if (cursorFrames.length > 0) {
          const cursorFileName = videoFileName.replace('.webm', '.cursor.json');
          await window.electronAPI.storeCursorData(cursorFrames, cursorFileName);
        }

        if (videoResult.path) {
          await window.electronAPI.setCurrentVideoPath(videoResult.path);
        }

        await window.electronAPI.switchToEditor();
      } catch (error) {
        console.error('Error saving recording:', error);
      }
    };
    recorder.onerror = () => {
      cleanupAudio();
      setRecording(false);
    };
    recorder.start(1000);
    startTime.current = performance.now();
    setRecording(true);
    window.electronAPI?.setRecordingState(true);

    // Start cursor tracking in parallel with recording
    window.electronAPI?.startCursorTracking().catch((err: unknown) => {
      console.warn('Failed to start cursor tracking:', err);
    });
  }

  // --- Entry point ---

  const startRecording = async () => {
    try {
      const selectedSource = await window.electronAPI.getSelectedSource();
      if (!selectedSource) {
        toast.error("Please select a source to record");
        return;
      }

      // Try native recorder first (cursor-free ScreenCaptureKit on macOS)
      let nativeAvailable = false;
      try {
        nativeAvailable = await window.electronAPI.nativeRecorderAvailable();
      } catch {
        // API not available, use fallback
      }

      if (nativeAvailable) {
        try {
          await startNativeRecordingPath(selectedSource);
          return;
        } catch (err) {
          console.warn('Native recording failed, falling back to MediaRecorder:', err);
          // Fall through to fallback path
        }
      }

      await startFallbackRecording(selectedSource);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setRecording(false);
      cleanupAudio();
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
        stream.current = null;
      }
    }
  };

  const toggleRecording = () => {
    recording ? stopRecording.current() : startRecording();
  };

  return { recording, toggleRecording };
}
