import { useState, useEffect, useMemo } from "react";
import styles from "./LaunchWindow.module.css";
import { useScreenRecorder, type AudioConfig } from "../../hooks/useScreenRecorder";
import { useAudioDevices } from "../../hooks/useAudioDevices";
import { Button } from "../ui/button";
import { BsRecordCircle } from "react-icons/bs";
import { FaRegStopCircle } from "react-icons/fa";
import { MdMonitor, MdMic, MdMicOff } from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { FaFolderMinus } from "react-icons/fa6";
import { FiMinus, FiX } from "react-icons/fi";
import { ContentClamp } from "../ui/content-clamp";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Slider } from "../ui/slider";

export function LaunchWindow() {
  const [micEnabled, setMicEnabled] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(undefined);
  const [micVolume, setMicVolume] = useState(0.8);

  const audioConfig = useMemo<AudioConfig>(() => ({
    micEnabled,
    micDeviceId,
    micVolume,
  }), [micEnabled, micDeviceId, micVolume]);

  const { recording, toggleRecording } = useScreenRecorder(audioConfig);
  const { devices, permissionStatus, requestPermission } = useAudioDevices();
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (recording) {
      if (!recordingStart) setRecordingStart(Date.now());
      timer = setInterval(() => {
        if (recordingStart) {
          setElapsed(Math.floor((Date.now() - recordingStart) / 1000));
        }
      }, 1000);
    } else {
      setRecordingStart(null);
      setElapsed(0);
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording, recordingStart]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const [selectedSource, setSelectedSource] = useState("Screen");
  const [hasSelectedSource, setHasSelectedSource] = useState(false);

  useEffect(() => {
    const applySource = (source: any) => {
      if (source) {
        setSelectedSource(source.name);
        setHasSelectedSource(true);
      } else {
        setSelectedSource("Screen");
        setHasSelectedSource(false);
      }
    };

    // Initial fetch (covers case where a source was picked before HUD mounted).
    if (window.electronAPI) {
      window.electronAPI.getSelectedSource().then(applySource);
    }

    // Subscribe to push updates from main instead of polling.
    const unsubscribe = window.electronAPI?.onSelectedSourceChange?.(applySource);
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const openSourceSelector = () => {
    if (window.electronAPI) {
      window.electronAPI.openSourceSelector();
    }
  };

  const openVideoFile = async () => {
    const result = await window.electronAPI.openVideoFilePicker();

    if (result.cancelled) {
      return;
    }

    if (result.success && result.path) {
      await window.electronAPI.setCurrentVideoPath(result.path);
      await window.electronAPI.switchToEditor();
    }
  };

  const handleMicToggle = async () => {
    if (micEnabled) {
      setMicEnabled(false);
      return;
    }

    // Request permission if needed
    if (permissionStatus !== 'granted') {
      const status = await requestPermission();
      if (status !== 'granted') return;
    }

    setMicEnabled(true);
  };

  // IPC events for hide/close
  const sendHudOverlayHide = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayHide) {
      window.electronAPI.hudOverlayHide();
    }
  };
  const sendHudOverlayClose = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayClose) {
      window.electronAPI.hudOverlayClose();
    }
  };

  return (
    <div className="w-full h-full flex items-center bg-transparent">
      <div
        className={`w-full max-w-[560px] mx-auto flex items-center justify-between px-4 py-2 font-sans ${styles.electronDrag}`}
        style={{
          borderRadius: 12,
          background: 'linear-gradient(135deg, hsl(220 18% 12% / 0.92) 0%, hsl(220 18% 8% / 0.88) 100%)',
          backdropFilter: 'blur(24px) saturate(150%)',
          WebkitBackdropFilter: 'blur(24px) saturate(150%)',
          boxShadow: '0 8px 40px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)',
          border: '1px solid hsl(220 15% 18% / 0.5)',
          minHeight: 44,
        }}
      >
        <div className={`flex items-center gap-1 ${styles.electronDrag}`}> <RxDragHandleDots2 size={18} className="text-foreground/40" /> </div>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 text-foreground bg-transparent hover:bg-transparent px-0 flex-1 text-left text-xs ${styles.electronNoDrag}`}
          onClick={openSourceSelector}
          disabled={recording}
        >
          <MdMonitor size={14} className="text-foreground" />
          <ContentClamp truncateLength={6}>{selectedSource}</ContentClamp>
        </Button>

        <div className="w-px h-6 bg-white/30" />

        {/* Mic toggle with popover for settings */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="link"
              size="sm"
              className={`gap-1 bg-transparent hover:bg-transparent px-1 text-xs ${styles.electronNoDrag}`}
              disabled={recording}
              onClick={(e) => {
                // Shift-click opens popover; plain click toggles mic
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleMicToggle();
                }
              }}
              title={micEnabled ? "Mic On (Shift+click for settings)" : "Mic Off (Shift+click for settings)"}
            >
              {micEnabled ? (
                <MdMic size={14} className="text-primary" />
              ) : (
                <MdMicOff size={14} className="text-foreground/50" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-56 p-3 bg-popover border border-border/40"
            side="top"
            sideOffset={8}
          >
            <div className="space-y-3">
              <div className="text-[10px] font-medium text-foreground/80">Microphone</div>

              {/* Device selector */}
              {devices.length > 0 && (
                <select
                  value={micDeviceId || ''}
                  onChange={(e) => setMicDeviceId(e.target.value || undefined)}
                  className="w-full text-[10px] bg-secondary border border-border/40 rounded px-2 py-1 text-foreground"
                >
                  <option value="">Default</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Volume slider */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground">Volume</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{Math.round(micVolume * 100)}%</span>
                </div>
                <Slider
                  value={[micVolume]}
                  onValueChange={([v]) => setMicVolume(v)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                />
              </div>

              {permissionStatus === 'denied' && (
                <p className="text-[10px] text-destructive">Mic permission denied. Check System Preferences.</p>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="w-px h-6 bg-white/30" />

        <Button
          variant="link"
          size="sm"
          onClick={hasSelectedSource ? toggleRecording : openSourceSelector}
          disabled={!hasSelectedSource && !recording}
          className={`gap-1 text-foreground bg-transparent hover:bg-transparent px-0 flex-1 text-center text-xs ${styles.electronNoDrag}`}
        >
          {recording ? (
            <>
              <FaRegStopCircle size={14} className="text-destructive" />
              <span className="text-destructive font-mono">{formatTime(elapsed)}</span>
            </>
          ) : (
            <>
              <BsRecordCircle size={14} className={hasSelectedSource ? "text-foreground" : "text-foreground/50"} />
              <span className={hasSelectedSource ? "text-foreground" : "text-foreground/50"}>Record</span>
            </>
          )}
        </Button>


        <div className="w-px h-6 bg-white/30" />


        <Button
          variant="link"
          size="sm"
          onClick={openVideoFile}
          className={`gap-1 text-foreground bg-transparent hover:bg-transparent px-0 flex-1 text-right text-xs ${styles.electronNoDrag} ${styles.folderButton}`}
          disabled={recording}
        >
          <FaFolderMinus size={14} className="text-foreground" />
          <span className={styles.folderText}>Open</span>
        </Button>

         {/* Separator before hide/close buttons */}
        <div className="w-px h-6 bg-white/30 mx-2" />
        <Button
          variant="link"
          size="icon"
          className={`ml-2 ${styles.electronNoDrag} hudOverlayButton`}
          title="Hide HUD"
          onClick={sendHudOverlayHide}
        >
          <FiMinus size={18} style={{ color: '#fff', opacity: 0.7 }} />

        </Button>

        <Button
          variant="link"
          size="icon"
          className={`ml-1 ${styles.electronNoDrag} hudOverlayButton`}
          title="Close App"
          onClick={sendHudOverlayClose}
        >
          <FiX size={18} style={{ color: '#fff', opacity: 0.7 }} />
        </Button>
      </div>
    </div>
  );
}
