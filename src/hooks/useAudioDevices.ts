import { useState, useEffect, useCallback } from 'react';

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export type MicPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

interface UseAudioDevicesReturn {
  devices: AudioDevice[];
  permissionStatus: MicPermissionStatus;
  requestPermission: () => Promise<MicPermissionStatus>;
}

export function useAudioDevices(): UseAudioDevicesReturn {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [permissionStatus, setPermissionStatus] = useState<MicPermissionStatus>('unknown');

  const enumerateDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter(d => d.kind === 'audioinput' && d.deviceId !== '')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`,
        }));
      setDevices(audioInputs);
    } catch (err) {
      console.warn('Failed to enumerate audio devices:', err);
    }
  }, []);

  const checkPermission = useCallback(async () => {
    // Check via Electron API on macOS first
    if (window.electronAPI?.getMicPermissionStatus) {
      const status = await window.electronAPI.getMicPermissionStatus();
      setPermissionStatus(status as MicPermissionStatus);
      return status as MicPermissionStatus;
    }

    // Fallback: use Permissions API if available
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const status = result.state === 'granted' ? 'granted'
        : result.state === 'denied' ? 'denied'
        : 'prompt';
      setPermissionStatus(status);
      return status;
    } catch {
      setPermissionStatus('unknown');
      return 'unknown' as MicPermissionStatus;
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<MicPermissionStatus> => {
    // Request via Electron on macOS
    if (window.electronAPI?.requestMicPermission) {
      const granted = await window.electronAPI.requestMicPermission();
      const status: MicPermissionStatus = granted ? 'granted' : 'denied';
      setPermissionStatus(status);
      if (granted) await enumerateDevices();
      return status;
    }

    // Fallback: request via getUserMedia
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setPermissionStatus('granted');
      await enumerateDevices();
      return 'granted';
    } catch {
      setPermissionStatus('denied');
      return 'denied';
    }
  }, [enumerateDevices]);

  useEffect(() => {
    checkPermission().then(status => {
      if (status === 'granted') enumerateDevices();
    });
  }, [checkPermission, enumerateDevices]);

  // Listen for device changes
  useEffect(() => {
    const handler = () => enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [enumerateDevices]);

  return { devices, permissionStatus, requestPermission };
}
