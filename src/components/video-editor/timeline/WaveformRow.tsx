import { useEffect, useRef, useState } from "react";
import { useTimelineContext } from "dnd-timeline";
import { getWaveform, detectSilences, type SilenceRange } from "@/lib/audioWaveform";

interface WaveformRowProps {
  videoPath?: string | null;
  height: number;
}

type Status = "idle" | "loading" | "ready" | "no-audio" | "error";

const ACCENT = "#6B7280"; // Matches the Audio track label color.
const SILENCE_OPACITY = 0.25;

/**
 * Renders the audio waveform for the current video across the full timeline
 * width, driven by the `dnd-timeline` range/valueToPixels context.
 *
 * The canvas is sized to the visible timeline region and redraws on:
 *  - videoPath change (triggers decode)
 *  - range change (user zooms/pans)
 *  - container resize
 *
 * Decoded peaks and silence ranges are cached per videoPath in
 * `src/lib/audioWaveform.ts`.
 */
export default function WaveformRow({ videoPath, height }: WaveformRowProps) {
  const { range, valueToPixels } = useTimelineContext();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const peaksRef = useRef<Float32Array | null>(null);
  const silencesRef = useRef<SilenceRange[]>([]);
  const audioDurationMsRef = useRef<number>(0);

  const [status, setStatus] = useState<Status>("idle");
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Track container width so the canvas matches the row's on-screen size.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const measure = () => setContainerWidth(el.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Decode waveform when videoPath changes.
  useEffect(() => {
    if (!videoPath) {
      peaksRef.current = null;
      silencesRef.current = [];
      audioDurationMsRef.current = 0;
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    peaksRef.current = null;
    silencesRef.current = [];

    getWaveform(videoPath)
      .then((data) => {
        if (cancelled) return;
        if (!data.hasAudio || data.peaks.length === 0) {
          peaksRef.current = null;
          silencesRef.current = [];
          audioDurationMsRef.current = data.durationMs;
          setStatus("no-audio");
          return;
        }
        peaksRef.current = data.peaks;
        audioDurationMsRef.current = data.durationMs;
        silencesRef.current = detectSilences(data.peaks, data.durationMs);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        peaksRef.current = null;
        silencesRef.current = [];
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  // Redraw on range/width/status change.
  useEffect(() => {
    if (status !== "ready") return;
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    const audioDurationMs = audioDurationMsRef.current;
    if (!canvas || !peaks || peaks.length === 0 || audioDurationMs <= 0) return;
    if (containerWidth <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = containerWidth;
    const cssHeight = height;

    // Size the canvas for hi-DPI without changing its CSS box.
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    drawWaveform(
      ctx,
      peaks,
      silencesRef.current,
      audioDurationMs,
      range.start,
      cssWidth,
      cssHeight,
      valueToPixels,
    );
  }, [status, containerWidth, height, range.start, range.end, valueToPixels]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        height,
        width: "100%",
        display: "flex",
        alignItems: "center",
        paddingLeft: 12,
      }}
    >
      {status === "ready" ? (
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      ) : (
        <span className="text-[10px] text-muted-foreground/50 font-medium tracking-wide uppercase select-none">
          {placeholderText(status)}
        </span>
      )}
    </div>
  );
}

function placeholderText(status: Status): string {
  switch (status) {
    case "loading":
      return "Analyzing audio…";
    case "no-audio":
      return "No audio";
    case "error":
      return "Audio unavailable";
    case "idle":
    default:
      return "Audio";
  }
}

/**
 * Draw the peaks into the canvas, using valueToPixels to translate from
 * milliseconds into the same pixel space as other timeline tracks.
 *
 * Silence ranges are drawn with reduced opacity so users can visually spot
 * cuttable gaps without the bars disappearing entirely.
 */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  silences: SilenceRange[],
  audioDurationMs: number,
  rangeStartMs: number,
  cssWidth: number,
  cssHeight: number,
  valueToPixels: (value: number) => number,
): void {
  const midY = cssHeight / 2;
  const maxAmp = Math.max(2, cssHeight / 2 - 2); // Leave a 2px margin top/bottom.

  // Translate the visible window into pixels. `valueToPixels` is relative to
  // range.start in dnd-timeline, so the waveform's left edge in pixels equals
  // `max(0, audioDurationMs - rangeStartMs < 0 ? out : 0)`. We just need
  // positions of (0..audioDurationMs) on screen.
  const audioStartPx = valueToPixels(0 - rangeStartMs);
  const audioEndPx = valueToPixels(audioDurationMs - rangeStartMs);

  const drawStartPx = Math.max(0, audioStartPx);
  const drawEndPx = Math.min(cssWidth, audioEndPx);

  if (drawEndPx <= drawStartPx) return;

  const audioPxWidth = audioEndPx - audioStartPx;
  if (audioPxWidth <= 0) return;

  // Build a quick silence lookup keyed by bucket index so we can dim only the
  // silent regions. We use a Uint8Array as a boolean map.
  const silenceMask = new Uint8Array(peaks.length);
  if (silences.length > 0 && audioDurationMs > 0) {
    const peaksPerMs = peaks.length / audioDurationMs;
    for (const range of silences) {
      const startIdx = Math.max(0, Math.floor(range.startMs * peaksPerMs));
      const endIdx = Math.min(peaks.length, Math.ceil(range.endMs * peaksPerMs));
      for (let i = startIdx; i < endIdx; i++) silenceMask[i] = 1;
    }
  }

  // Draw a faint baseline so even silent regions show the track.
  ctx.strokeStyle = `${ACCENT}33`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(drawStartPx, midY);
  ctx.lineTo(drawEndPx, midY);
  ctx.stroke();

  // For every on-screen pixel column, find which peak bucket(s) it samples.
  // We iterate in canvas pixel space so zoom stays cheap even for long clips.
  ctx.fillStyle = ACCENT;

  const pxToBucket = peaks.length / audioPxWidth;

  // Accumulate silence pixels so we can batch them in a lower-opacity pass.
  const silencePixelData: Array<{ x: number; amp: number }> = [];

  for (let x = Math.floor(drawStartPx); x < Math.ceil(drawEndPx); x++) {
    const localPx = x - audioStartPx;
    const bucketStart = Math.floor(localPx * pxToBucket);
    const bucketEnd = Math.max(bucketStart + 1, Math.floor((localPx + 1) * pxToBucket));
    let peak = 0;
    let silentCount = 0;
    const span = Math.min(peaks.length, bucketEnd) - bucketStart;
    for (let i = bucketStart; i < bucketEnd && i < peaks.length; i++) {
      if (peaks[i] > peak) peak = peaks[i];
      if (silenceMask[i]) silentCount++;
    }

    if (peak <= 0) continue;
    const amp = peak * maxAmp;
    const isSilent = span > 0 && silentCount / span > 0.5;
    if (isSilent) {
      silencePixelData.push({ x, amp });
    } else {
      ctx.fillRect(x, midY - amp, 1, amp * 2);
    }
  }

  if (silencePixelData.length > 0) {
    ctx.save();
    ctx.globalAlpha = SILENCE_OPACITY;
    for (const { x, amp } of silencePixelData) {
      ctx.fillRect(x, midY - amp, 1, amp * 2);
    }
    ctx.restore();
  }
}
