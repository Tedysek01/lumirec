/**
 * Audio waveform extraction utilities.
 *
 * Decodes a video file's audio track into a per-bucket peak array, which
 * the timeline renders as a waveform strip. Results are cached by video
 * path so we don't re-decode on every render.
 */

const DEFAULT_BUCKETS = 2000;

export interface WaveformData {
  /** Peak value per bucket, normalized to 0..1. */
  peaks: Float32Array;
  /** Total decoded duration in milliseconds. */
  durationMs: number;
  /** Whether the source actually contained an audio track. */
  hasAudio: boolean;
}

export interface SilenceRange {
  startMs: number;
  endMs: number;
}

const waveformCache = new Map<string, WaveformData>();
const pendingDecodes = new Map<string, Promise<WaveformData>>();

/**
 * Extract (or retrieve from cache) a waveform for a given video path.
 *
 * `source` can be either an absolute local path or a URL (file:// or http://).
 * Internally we normalize to a URL that fetch() can resolve inside Electron.
 */
export async function getWaveform(
  source: string,
  buckets: number = DEFAULT_BUCKETS,
): Promise<WaveformData> {
  const cacheKey = `${source}::${buckets}`;

  const cached = waveformCache.get(cacheKey);
  if (cached) return cached;

  const pending = pendingDecodes.get(cacheKey);
  if (pending) return pending;

  const decodePromise = decodeWaveform(source, buckets)
    .then((data) => {
      waveformCache.set(cacheKey, data);
      pendingDecodes.delete(cacheKey);
      return data;
    })
    .catch((err) => {
      pendingDecodes.delete(cacheKey);
      throw err;
    });

  pendingDecodes.set(cacheKey, decodePromise);
  return decodePromise;
}

/**
 * Clear cached waveforms. Call when a video is unloaded.
 */
export function clearWaveformCache(source?: string): void {
  if (!source) {
    waveformCache.clear();
    return;
  }
  for (const key of Array.from(waveformCache.keys())) {
    if (key.startsWith(`${source}::`)) waveformCache.delete(key);
  }
}

async function decodeWaveform(source: string, buckets: number): Promise<WaveformData> {
  const url = normalizeSource(source);

  // Fetch the full file. For local file:// URLs in Electron this is a disk read.
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio source (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();

  // Use a lightweight AudioContext just to decode; we release it immediately after.
  const AudioCtx: typeof AudioContext | undefined =
    (typeof window !== 'undefined' && (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) ||
    undefined;
  if (!AudioCtx) {
    throw new Error('Web Audio API not available');
  }

  const tempCtx = new AudioCtx();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    await safeCloseContext(tempCtx);
    // decodeAudioData throws DOMException for files with no decodable audio.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Audio decode failed: ${message}`);
  }
  await safeCloseContext(tempCtx);

  const durationMs = audioBuffer.duration * 1000;

  if (audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
    return {
      peaks: new Float32Array(0),
      durationMs,
      hasAudio: false,
    };
  }

  const peaks = computePeaks(audioBuffer, buckets);

  return {
    peaks,
    durationMs,
    hasAudio: true,
  };
}

/**
 * Downsample the decoded buffer into a fixed-size peak array (0..1).
 * Averages channels, then takes max(|sample|) per bucket.
 */
function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const channelCount = buffer.numberOfChannels;
  const sampleCount = buffer.length;

  // Pull first channel (and optionally second for averaging) as direct references.
  const channel0 = buffer.getChannelData(0);
  const channel1 = channelCount > 1 ? buffer.getChannelData(1) : null;

  const resolvedBuckets = Math.max(1, Math.min(buckets, sampleCount));
  const samplesPerBucket = sampleCount / resolvedBuckets;
  const peaks = new Float32Array(resolvedBuckets);

  let globalMax = 0;

  for (let b = 0; b < resolvedBuckets; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(sampleCount, Math.floor((b + 1) * samplesPerBucket));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const left = channel0[i];
      const sample = channel1 ? (left + channel1[i]) * 0.5 : left;
      const abs = sample < 0 ? -sample : sample;
      if (abs > peak) peak = abs;
    }
    peaks[b] = peak;
    if (peak > globalMax) globalMax = peak;
  }

  // Normalize so that the loudest bucket maps to 1.0. Keeps quiet recordings
  // legible instead of drawing as a flat line.
  if (globalMax > 0 && globalMax < 1) {
    const inv = 1 / globalMax;
    for (let i = 0; i < peaks.length; i++) {
      peaks[i] = Math.min(1, peaks[i] * inv);
    }
  }

  return peaks;
}

async function safeCloseContext(ctx: AudioContext | OfflineAudioContext): Promise<void> {
  try {
    if ('close' in ctx && typeof ctx.close === 'function') {
      await ctx.close();
    }
  } catch {
    // Releasing context failed — not fatal.
  }
}

function normalizeSource(source: string): string {
  if (/^(file|https?|blob|data):/i.test(source)) return source;
  // Electron absolute paths (POSIX or Windows) need a file:// prefix.
  if (source.startsWith('/')) return `file://${source}`;
  if (/^[a-zA-Z]:[\\/]/.test(source)) return `file:///${source.replace(/\\/g, '/')}`;
  return source;
}

/**
 * Detect ranges of silence within a peak array.
 *
 * A bucket counts as "silent" when its peak stays at or below
 * `silenceThreshold`. Contiguous silent buckets are merged, and only
 * ranges longer than `minDurationMs` are returned.
 */
export function detectSilences(
  peaks: Float32Array,
  totalDurationMs: number,
  silenceThreshold = 0.02,
  minDurationMs = 400,
): SilenceRange[] {
  if (!peaks.length || totalDurationMs <= 0) return [];

  const msPerBucket = totalDurationMs / peaks.length;
  const ranges: SilenceRange[] = [];

  let runStart: number | null = null;

  for (let i = 0; i < peaks.length; i++) {
    const quiet = peaks[i] <= silenceThreshold;
    if (quiet && runStart === null) {
      runStart = i;
    } else if (!quiet && runStart !== null) {
      const startMs = runStart * msPerBucket;
      const endMs = i * msPerBucket;
      if (endMs - startMs >= minDurationMs) {
        ranges.push({ startMs, endMs });
      }
      runStart = null;
    }
  }

  if (runStart !== null) {
    const startMs = runStart * msPerBucket;
    const endMs = peaks.length * msPerBucket;
    if (endMs - startMs >= minDurationMs) {
      ranges.push({ startMs, endMs });
    }
  }

  return ranges;
}
