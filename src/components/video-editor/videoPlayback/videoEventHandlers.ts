import type React from 'react';
import type { TrimRegion, VideoSegment } from '../types';
import { computeGapRegions } from '@/lib/segmentUtils';

interface VideoEventHandlersParams {
  video: HTMLVideoElement;
  isSeekingRef: React.MutableRefObject<boolean>;
  isPlayingRef: React.MutableRefObject<boolean>;
  allowPlaybackRef: React.MutableRefObject<boolean>;
  currentTimeRef: React.MutableRefObject<number>;
  timeUpdateAnimationRef: React.MutableRefObject<number | null>;
  onPlayStateChange: (playing: boolean) => void;
  onTimeUpdate: (time: number) => void;
  trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
  videoSegmentsRef: React.MutableRefObject<VideoSegment[]>;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
  const {
    video,
    isSeekingRef,
    isPlayingRef,
    allowPlaybackRef,
    currentTimeRef,
    timeUpdateAnimationRef,
    onPlayStateChange,
    onTimeUpdate,
    trimRegionsRef,
    videoSegmentsRef,
  } = params;

  const emitTime = (timeValue: number) => {
    currentTimeRef.current = timeValue * 1000;
    onTimeUpdate(timeValue);
  };

  // Helper function to check if current time is within a trim region
  const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
    const trimRegions = trimRegionsRef.current;
    return trimRegions.find(
      (region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs
    ) || null;
  };

  // Helper: find gap region that contains the given source time
  const findActiveGapRegion = (currentTimeMs: number): { startMs: number; endMs: number } | null => {
    const segments = videoSegmentsRef.current;
    if (segments.length === 0) return null;
    const totalDurationMs = video.duration * 1000;
    const gaps = computeGapRegions(segments, totalDurationMs);
    return gaps.find(
      (gap) => currentTimeMs >= gap.startMs && currentTimeMs < gap.endMs
    ) || null;
  };

  // Get the end time of the last segment (playback should stop here, not at video.duration)
  const getLastSegmentEndMs = (): number | null => {
    const segments = videoSegmentsRef.current;
    if (segments.length === 0) return null;
    const sorted = [...segments].sort((a, b) => a.sourceEndMs - b.sourceEndMs);
    return sorted[sorted.length - 1].sourceEndMs;
  };

  function updateTime() {
    if (!video) return;

    const currentTimeMs = video.currentTime * 1000;

    // Check if we've passed the last segment end — stop playback
    const lastSegEnd = getLastSegmentEndMs();
    if (lastSegEnd !== null && currentTimeMs >= lastSegEnd && !video.paused && !video.ended) {
      video.currentTime = lastSegEnd / 1000;
      emitTime(lastSegEnd / 1000);
      video.pause();
      return;
    }

    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);
    const activeGap = findActiveGapRegion(currentTimeMs);

    // If we're in a trim region during playback, skip to the end of it
    if (activeTrimRegion && !video.paused && !video.ended) {
      const skipToTime = activeTrimRegion.endMs / 1000;

      if (skipToTime >= video.duration) {
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(skipToTime);
      }
    } else if (activeGap && !video.paused && !video.ended) {
      // If we're in a gap (deleted segment region), skip to gap end
      const skipToTime = activeGap.endMs / 1000;
      const lastEnd = getLastSegmentEndMs();

      if (skipToTime >= video.duration || (lastEnd !== null && activeGap.endMs >= lastEnd)) {
        // Gap extends past the last segment — stop playback
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(skipToTime);
      }
    } else {
      emitTime(video.currentTime);
    }

    if (!video.paused && !video.ended) {
      timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
    }
  }

  const handlePlay = () => {
    if (isSeekingRef.current) {
      video.pause();
      return;
    }

    if (!allowPlaybackRef.current) {
      video.pause();
      return;
    }

    isPlayingRef.current = true;
    onPlayStateChange(true);
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current);
    }
    timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
  };

    const handlePause = () => {
    isPlayingRef.current = false;
    onPlayStateChange(false);
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current);
      timeUpdateAnimationRef.current = null;
    }
    emitTime(video.currentTime);
  };

  const handleSeeked = () => {
    isSeekingRef.current = false;

    const currentTimeMs = video.currentTime * 1000;
    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);
    const activeGap = findActiveGapRegion(currentTimeMs);

    // If we seeked into a trim region while playing, skip to the end
    if (activeTrimRegion && isPlayingRef.current && !video.paused) {
      const skipToTime = activeTrimRegion.endMs / 1000;

      if (skipToTime >= video.duration) {
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(skipToTime);
      }
    } else if (activeGap && isPlayingRef.current && !video.paused) {
      // If we seeked into a gap while playing, skip to gap end
      const skipToTime = activeGap.endMs / 1000;
      const lastEnd = getLastSegmentEndMs();

      if (skipToTime >= video.duration || (lastEnd !== null && activeGap.endMs >= lastEnd)) {
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(skipToTime);
      }
    } else {
      if (!isPlayingRef.current && !video.paused) {
        video.pause();
      }
      emitTime(video.currentTime);
    }
  };

  const handleSeeking = () => {
    isSeekingRef.current = true;

    if (!isPlayingRef.current && !video.paused) {
      video.pause();
    }
    emitTime(video.currentTime);
  };

  return {
    handlePlay,
    handlePause,
    handleSeeked,
    handleSeeking,
  };
}
