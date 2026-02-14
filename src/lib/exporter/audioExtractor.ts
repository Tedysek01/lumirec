/**
 * Audio extraction from WebM source for re-muxing into MP4 export.
 * Uses Web Audio API to decode and re-encode audio, respecting trim regions.
 */

import type { TrimRegion } from '@/components/video-editor/types';

/**
 * Extract audio from a video blob as a decoded AudioBuffer.
 * Returns null if no audio track is present or format is unsupported.
 */
export async function extractAudioBuffer(
  videoBlob: Blob,
): Promise<AudioBuffer | null> {
  try {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const audioContext = new OfflineAudioContext(2, 1, 48000);

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
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
