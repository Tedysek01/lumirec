import { v4 as uuidv4 } from 'uuid';
import type { VideoSegment, TrimRegion } from '@/components/video-editor/types';
import { DEFAULT_SEGMENT_TRANSFORM } from '@/components/video-editor/types';

/**
 * Create a single segment spanning the full video duration.
 */
export function createInitialSegment(durationMs: number): VideoSegment {
  return {
    id: uuidv4(),
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    timelineStartMs: 0,
    transform: { ...DEFAULT_SEGMENT_TRANSFORM },
    keyframes: [],
  };
}

/**
 * Split a segment at a given source time into two segments.
 * Returns null if the split point is outside the segment or too close to edges.
 */
export function splitSegment(
  segment: VideoSegment,
  atSourceTimeMs: number,
  minDurationMs = 100,
): [VideoSegment, VideoSegment] | null {
  if (
    atSourceTimeMs <= segment.sourceStartMs + minDurationMs ||
    atSourceTimeMs >= segment.sourceEndMs - minDurationMs
  ) {
    return null;
  }

  const left: VideoSegment = {
    ...segment,
    id: uuidv4(),
    sourceEndMs: atSourceTimeMs,
    // keyframes that fall within the left segment
    keyframes: segment.keyframes.filter(
      (kf) => kf.timeMs < atSourceTimeMs - segment.sourceStartMs,
    ),
  };

  const splitOffsetMs = atSourceTimeMs - segment.sourceStartMs;
  const right: VideoSegment = {
    id: uuidv4(),
    sourceStartMs: atSourceTimeMs,
    sourceEndMs: segment.sourceEndMs,
    timelineStartMs: 0, // will be recalculated by ripple
    transform: { ...segment.transform },
    // keyframes shifted relative to new segment start
    keyframes: segment.keyframes
      .filter((kf) => kf.timeMs >= splitOffsetMs)
      .map((kf) => ({
        ...kf,
        id: uuidv4(),
        timeMs: kf.timeMs - splitOffsetMs,
      })),
  };

  return [left, right];
}

/**
 * Recalculate timelineStartMs for all segments so they are contiguous (ripple editing).
 * Segments are ordered by their sourceStartMs.
 */
export function rippleSegments(segments: VideoSegment[]): VideoSegment[] {
  const sorted = [...segments].sort((a, b) => a.sourceStartMs - b.sourceStartMs);
  let timelinePos = 0;
  return sorted.map((seg) => {
    const updated = { ...seg, timelineStartMs: timelinePos };
    timelinePos += seg.sourceEndMs - seg.sourceStartMs;
    return updated;
  });
}

/**
 * Get total output timeline duration (sum of all segment durations).
 */
export function getTotalTimelineDuration(segments: VideoSegment[]): number {
  return segments.reduce((sum, seg) => sum + (seg.sourceEndMs - seg.sourceStartMs), 0);
}

/**
 * Compute source time ranges NOT covered by any segment (gaps/deleted regions).
 */
export function computeGapRegions(
  segments: VideoSegment[],
  totalDurationMs: number,
): { startMs: number; endMs: number }[] {
  const sorted = [...segments].sort((a, b) => a.sourceStartMs - b.sourceStartMs);
  const gaps: { startMs: number; endMs: number }[] = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.sourceStartMs > cursor) {
      gaps.push({ startMs: cursor, endMs: seg.sourceStartMs });
    }
    cursor = Math.max(cursor, seg.sourceEndMs);
  }
  if (cursor < totalDurationMs) {
    gaps.push({ startMs: cursor, endMs: totalDurationMs });
  }
  return gaps;
}

/**
 * Find the segment containing a given source time.
 */
export function findSegmentAtSourceTime(
  segments: VideoSegment[],
  sourceTimeMs: number,
): VideoSegment | null {
  return segments.find(
    s => sourceTimeMs >= s.sourceStartMs && sourceTimeMs < s.sourceEndMs
  ) ?? null;
}

/**
 * Map a playback (output timeline) time to a source video time.
 * Returns null if the time falls outside any segment (shouldn't happen with ripple editing).
 */
export function getSourceTimeForPlaybackTime(
  segments: VideoSegment[],
  playbackTimeMs: number,
): { sourceTimeMs: number; segment: VideoSegment } | null {
  for (const seg of segments) {
    const segDuration = seg.sourceEndMs - seg.sourceStartMs;
    const segEnd = seg.timelineStartMs + segDuration;
    if (playbackTimeMs >= seg.timelineStartMs && playbackTimeMs < segEnd) {
      const offsetInSegment = playbackTimeMs - seg.timelineStartMs;
      return {
        sourceTimeMs: seg.sourceStartMs + offsetInSegment,
        segment: seg,
      };
    }
  }

  // If exactly at the end, map to the last segment's end
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    const lastEnd = last.timelineStartMs + (last.sourceEndMs - last.sourceStartMs);
    if (Math.abs(playbackTimeMs - lastEnd) < 1) {
      return {
        sourceTimeMs: last.sourceEndMs,
        segment: last,
      };
    }
  }

  return null;
}

/**
 * Map a source video time to a playback (output timeline) time.
 * Returns null if the source time is in a removed (cut) region.
 */
export function getPlaybackTimeForSourceTime(
  segments: VideoSegment[],
  sourceTimeMs: number,
): number | null {
  for (const seg of segments) {
    if (sourceTimeMs >= seg.sourceStartMs && sourceTimeMs <= seg.sourceEndMs) {
      const offsetInSegment = sourceTimeMs - seg.sourceStartMs;
      return seg.timelineStartMs + offsetInSegment;
    }
  }
  return null;
}

/**
 * Find which segment contains a given playback time.
 */
export function findSegmentAtPlaybackTime(
  segments: VideoSegment[],
  playbackTimeMs: number,
): VideoSegment | null {
  const result = getSourceTimeForPlaybackTime(segments, playbackTimeMs);
  return result?.segment ?? null;
}

/**
 * Map a source video time to display (timeline) time, accounting for deleted gaps.
 * For times within a segment, returns the exact timeline position.
 * For times in gaps, clamps to the nearest segment boundary.
 */
export function sourceToDisplayTime(
  segments: VideoSegment[],
  sourceTimeMs: number,
): number {
  if (segments.length === 0) return sourceTimeMs;

  const sorted = [...segments].sort((a, b) => a.sourceStartMs - b.sourceStartMs);

  for (const seg of sorted) {
    if (sourceTimeMs < seg.sourceStartMs) {
      // In a gap before this segment — clamp to this segment's display start
      return seg.timelineStartMs;
    }
    if (sourceTimeMs <= seg.sourceEndMs) {
      // Within this segment
      return seg.timelineStartMs + (sourceTimeMs - seg.sourceStartMs);
    }
  }

  // Past all segments — clamp to end of last segment's display
  const last = sorted[sorted.length - 1];
  return last.timelineStartMs + (last.sourceEndMs - last.sourceStartMs);
}

/**
 * Map a display (timeline) time back to source video time.
 * For times within a segment's display range, returns the source position.
 * For times past the end, clamps to the last segment's source end.
 */
export function displayToSourceTime(
  segments: VideoSegment[],
  displayTimeMs: number,
): number {
  if (segments.length === 0) return displayTimeMs;

  const sorted = [...segments].sort((a, b) => a.timelineStartMs - b.timelineStartMs);

  for (const seg of sorted) {
    const segDisplayEnd = seg.timelineStartMs + (seg.sourceEndMs - seg.sourceStartMs);
    if (displayTimeMs <= segDisplayEnd) {
      const offset = Math.max(0, displayTimeMs - seg.timelineStartMs);
      return seg.sourceStartMs + offset;
    }
  }

  // Past all segments
  const last = sorted[sorted.length - 1];
  return last.sourceEndMs;
}

/**
 * Migrate existing trim regions to video segments.
 * Trim regions represent sections to REMOVE; we invert them to get KEPT sections.
 */
export function migrateFromTrimRegions(
  trimRegions: TrimRegion[],
  totalDurationMs: number,
): VideoSegment[] {
  if (trimRegions.length === 0) {
    return [createInitialSegment(totalDurationMs)];
  }

  // Sort trim regions by start time
  const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

  const segments: VideoSegment[] = [];
  let cursor = 0;

  for (const trim of sorted) {
    if (trim.startMs > cursor) {
      segments.push({
        id: uuidv4(),
        sourceStartMs: cursor,
        sourceEndMs: trim.startMs,
        timelineStartMs: 0,
        transform: { ...DEFAULT_SEGMENT_TRANSFORM },
        keyframes: [],
      });
    }
    cursor = Math.max(cursor, trim.endMs);
  }

  // Add remaining section after last trim
  if (cursor < totalDurationMs) {
    segments.push({
      id: uuidv4(),
      sourceStartMs: cursor,
      sourceEndMs: totalDurationMs,
      timelineStartMs: 0,
      transform: { ...DEFAULT_SEGMENT_TRANSFORM },
      keyframes: [],
    });
  }

  return rippleSegments(segments);
}
