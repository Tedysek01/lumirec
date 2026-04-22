/**
 * Audio extraction from WebM source for re-muxing into MP4 export.
 * Uses Web Audio API to decode and re-encode audio, respecting trim regions.
 *
 * Long recordings would otherwise freeze the UI because decodeAudioData and the
 * post-decode sample copying both run synchronously on the main thread. The
 * helpers below break that work into chunks and yield to the event loop so
 * React can keep painting progress updates during export.
 */

import type { TrimRegion } from '@/components/video-editor/types';

/** Yield to the event loop so the renderer can paint progress updates. */
const yieldToEventLoop = (): Promise<void> =>
  new Promise<void>(resolve => setTimeout(resolve, 0));

/** Number of samples to copy per channel before yielding during trimming. */
const TRIM_YIELD_EVERY_SAMPLES = 100_000;

export interface AudioExtractProgress {
  /** Rough progress 0-1 through the audio extraction phase. */
  ratio: number;
  stage: 'decoding' | 'trimming';
}

/**
 * Extract audio from a video blob as a decoded AudioBuffer.
 * Returns null if no audio track is present or format is unsupported.
 *
 * Yields to the event loop before and after the (blocking) decode so the UI
 * can paint progress updates; decode itself is native and cannot be paused,
 * but the surrounding yields prevent the UI from appearing frozen across the
 * full duration of the export.
 */
export async function extractAudioBuffer(
  videoBlob: Blob,
  onProgress?: (progress: AudioExtractProgress) => void,
): Promise<AudioBuffer | null> {
  try {
    onProgress?.({ ratio: 0, stage: 'decoding' });
    const arrayBuffer = await videoBlob.arrayBuffer();
    // Give the UI a frame before kicking off the decode so any pending
    // "preparing audio…" label actually paints.
    await yieldToEventLoop();

    const audioContext = new OfflineAudioContext(2, 1, 48000);

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      // Yield after decode to let the UI update before the caller starts
      // trimming / encoding.
      await yieldToEventLoop();
      onProgress?.({ ratio: 1, stage: 'decoding' });
      return audioBuffer;
    } catch {
      // No audio track or unsupported format
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Compute which sample ranges to keep after applying trim regions.
 * Returns array of [startSample, endSample] ranges to include.
 */
export function computeAudioRangesAfterTrim(
  totalSamples: number,
  sampleRate: number,
  trimRegions: TrimRegion[],
): Array<[number, number]> {
  if (trimRegions.length === 0) {
    return [[0, totalSamples]];
  }

  const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
  const ranges: Array<[number, number]> = [];
  let currentSample = 0;

  for (const trim of sorted) {
    const trimStartSample = Math.floor((trim.startMs / 1000) * sampleRate);
    const trimEndSample = Math.floor((trim.endMs / 1000) * sampleRate);

    if (currentSample < trimStartSample) {
      ranges.push([currentSample, trimStartSample]);
    }
    currentSample = trimEndSample;
  }

  if (currentSample < totalSamples) {
    ranges.push([currentSample, totalSamples]);
  }

  return ranges;
}

/**
 * Build a trimmed AudioBuffer by copying the kept sample ranges into a fresh
 * contiguous buffer. Yields to the event loop periodically so long recordings
 * don't freeze the UI during export.
 *
 * Using a plain (non-offline) AudioBuffer created via OfflineAudioContext keeps
 * us off the audio graph entirely — previous implementations scheduled buffer
 * sources and awaited startRendering(), which silently blocks on the main
 * thread for long inputs.
 */
export async function buildTrimmedAudioBuffer(
  source: AudioBuffer,
  trimRegions: TrimRegion[],
  onProgress?: (progress: AudioExtractProgress) => void,
): Promise<AudioBuffer | null> {
  const sampleRate = source.sampleRate;
  const channels = source.numberOfChannels;

  const ranges = computeAudioRangesAfterTrim(source.length, sampleRate, trimRegions);
  const totalSamples = ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
  if (totalSamples === 0) return null;

  // OfflineAudioContext is used purely as a factory for AudioBuffer; we never
  // call startRendering() so this stays off the audio graph.
  const ctx = new OfflineAudioContext(channels, totalSamples, sampleRate);
  const trimmed = ctx.createBuffer(channels, totalSamples, sampleRate);

  let samplesCopied = 0;
  let samplesSinceYield = 0;

  for (let ch = 0; ch < channels; ch++) {
    const src = source.getChannelData(ch);
    const dst = trimmed.getChannelData(ch);
    let writeOffset = 0;
    for (const [start, end] of ranges) {
      const length = end - start;
      // TypedArray.set is a fast native copy; the yielding below keeps us
      // responsive across many ranges or very long single ranges.
      dst.set(src.subarray(start, end), writeOffset);
      writeOffset += length;

      // Only count once (first channel) so progress isn't inflated.
      if (ch === 0) {
        samplesCopied += length;
        samplesSinceYield += length;
        if (samplesSinceYield >= TRIM_YIELD_EVERY_SAMPLES) {
          samplesSinceYield = 0;
          onProgress?.({ ratio: samplesCopied / totalSamples, stage: 'trimming' });
          await yieldToEventLoop();
        }
      }
    }
  }

  onProgress?.({ ratio: 1, stage: 'trimming' });
  return trimmed;
}
