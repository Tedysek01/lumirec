import type { ExportConfig, ExportProgress, ExportResult } from './types';
import { VideoFileDecoder } from './videoDecoder';
import { FrameRenderer } from './frameRenderer';
import { VideoMuxer } from './muxer';
import { createProgressYieldScheduler } from './progressYield';
import type { CropRegion, TrimRegion, AnnotationRegion, SpotlightRegion, VideoSegment, ZoomRegion } from '@/components/video-editor/types';
import type { CursorFrame, CursorHighlightConfig } from '@/lib/cursorTracker';
import { extractAudioBuffer, buildTrimmedAudioBuffer } from './audioExtractor';
import { computeGapRegions } from '@/lib/segmentUtils';

interface VideoExporterConfig extends ExportConfig {
  videoUrl: string;
  wallpaper: string;
  trimRegions?: TrimRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  videoBorderRadius?: number;
  padding?: number;
  videoPadding?: number;
  cropRegion: CropRegion;
  annotationRegions?: AnnotationRegion[];
  spotlightRegions?: SpotlightRegion[];
  previewWidth?: number;
  previewHeight?: number;
  cursorData?: CursorFrame[];
  cursorHighlight?: CursorHighlightConfig;
  videoSegments?: VideoSegment[];
  zoomRegions?: ZoomRegion[];
  includeAudio?: boolean;
  onProgress?: (progress: ExportProgress) => void;
}

export class VideoExporter {
  private config: VideoExporterConfig;
  private decoder: VideoFileDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: VideoMuxer | null = null;
  private cancelled = false;
  private encodeQueue = 0;
  // Deep encoder pipeline so the renderer can race ahead of the encoder when
  // the encoder is the slow link, and the encoder can race ahead of the
  // renderer when content is light. Hardware encoders happily buffer this many.
  private readonly MAX_ENCODE_QUEUE = 240;
  // Resolvers waiting for the encoder queue to drain below the limit. Replaces
  // a setTimeout(0) busy-wait that was costing ~4 ms per spin once the queue
  // saturated.
  private encoderDrainResolvers: Array<() => void> = [];
  private videoDescription: Uint8Array | undefined;
  private videoColorSpace: VideoColorSpaceInit | undefined;
  // Track muxing promises for parallel processing
  private muxingPromises: Promise<void>[] = [];
  private chunkCount = 0;

  constructor(config: VideoExporterConfig) {
    this.config = config;
  }

  // Build a unified list of skip regions: trim regions + segment gaps
  private getSkipRegions(totalDurationMs: number): { startMs: number; endMs: number }[] {
    const trimRegions = (this.config.trimRegions || []).map(r => ({ startMs: r.startMs, endMs: r.endMs }));
    const segments = this.config.videoSegments;
    const gaps = segments && segments.length > 0
      ? computeGapRegions(segments, totalDurationMs)
      : [];
    // Merge and sort by start time
    return [...trimRegions, ...gaps].sort((a, b) => a.startMs - b.startMs);
  }

  // Calculate the total duration excluding skip regions (in seconds)
  private getEffectiveDuration(totalDuration: number): number {
    const skipRegions = this.getSkipRegions(Math.round(totalDuration * 1000));
    const totalSkipDuration = skipRegions.reduce((sum, region) => {
      return sum + (region.endMs - region.startMs) / 1000;
    }, 0);
    return totalDuration - totalSkipDuration;
  }

  private mapEffectiveToSourceTime(effectiveTimeMs: number): number {
    const skipRegions = this.getSkipRegions(Infinity);

    let sourceTimeMs = effectiveTimeMs;

    for (const skip of skipRegions) {
      // If the source time hasn't reached this skip region yet, we're done
      if (sourceTimeMs < skip.startMs) {
        break;
      }

      // Add the duration of this skip region to the source time
      const skipDuration = skip.endMs - skip.startMs;
      sourceTimeMs += skipDuration;
    }

    return sourceTimeMs;
  }

  async export(): Promise<ExportResult> {
    try {
      this.cleanup();
      this.cancelled = false;

      // Initialize decoder and load video
      this.decoder = new VideoFileDecoder();
      const videoInfo = await this.decoder.loadVideo(this.config.videoUrl);

      // Initialize frame renderer
      this.renderer = new FrameRenderer({
        width: this.config.width,
        height: this.config.height,
        wallpaper: this.config.wallpaper,
        videoSegments: this.config.videoSegments,
        zoomRegions: this.config.zoomRegions,
        showShadow: this.config.showShadow,
        shadowIntensity: this.config.shadowIntensity,
        showBlur: this.config.showBlur,
        motionBlurEnabled: this.config.motionBlurEnabled,
        borderRadius: this.config.borderRadius,
        videoBorderRadius: this.config.videoBorderRadius,
        padding: this.config.padding,
        cropRegion: this.config.cropRegion,
        videoWidth: videoInfo.width,
        videoHeight: videoInfo.height,
        annotationRegions: this.config.annotationRegions,
        spotlightRegions: this.config.spotlightRegions,
        previewWidth: this.config.previewWidth,
        previewHeight: this.config.previewHeight,
        cursorData: this.config.cursorData,
        cursorHighlight: this.config.cursorHighlight,
      });
      await this.renderer.initialize();

      // Initialize video encoder
      await this.initializeEncoder();

      // Detect audio in source and initialize muxer accordingly
      let sourceAudioBuffer: AudioBuffer | null = null;
      const includeAudio = this.config.includeAudio ?? false;
      if (includeAudio) {
        try {
          // Report an initial audio-phase progress update so the export
          // dialog isn't stuck at 0% / "Rendering frames" while the native
          // decoder churns through long recordings.
          this.reportAudioProgress(0);
          const response = await fetch(this.config.videoUrl);
          const blob = await response.blob();
          sourceAudioBuffer = await extractAudioBuffer(blob, (p) => {
            // Map the decode stage to the first 80% of the audio phase; the
            // remaining 20% is reserved for trimming + encoding.
            this.reportAudioProgress(p.ratio * 0.8);
          });
          if (sourceAudioBuffer) {
            console.log('[VideoExporter] Audio track detected:', sourceAudioBuffer.numberOfChannels, 'ch,', sourceAudioBuffer.sampleRate, 'Hz');
          }
        } catch (err) {
          console.warn('[VideoExporter] Failed to extract audio:', err);
        }
      }

      const hasAudio = sourceAudioBuffer !== null && sourceAudioBuffer.length > 0;
      this.muxer = new VideoMuxer(this.config, hasAudio);
      await this.muxer.initialize();

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.getEffectiveDuration(videoInfo.duration);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
      const progressYield = createProgressYieldScheduler();

      console.log('[VideoExporter] Original duration:', videoInfo.duration, 's');
      console.log('[VideoExporter] Effective duration:', effectiveDuration, 's');
      console.log('[VideoExporter] Total frames to export:', totalFrames);

      if (this.config.onProgress) {
        this.config.onProgress({
          currentFrame: 0,
          totalFrames,
          percentage: 0,
          estimatedTimeRemaining: 0,
        });
        await progressYield.maybeYield();
      }

      // Precompute the desired SOURCE timestamp (μs) for every output frame.
      // The mapping accounts for trim regions + segment gaps. Doing this once
      // up front avoids recomputing the skip-region prefix sum per frame.
      const frameDurationUs = 1_000_000 / this.config.frameRate;
      const timeStep = 1 / this.config.frameRate;
      const desiredSourceUs = new Float64Array(totalFrames);
      for (let i = 0; i < totalFrames; i++) {
        const effectiveTimeMs = i * timeStep * 1000;
        const sourceTimeMs = this.mapEffectiveToSourceTime(effectiveTimeMs);
        desiredSourceUs[i] = sourceTimeMs * 1000;
      }

      // Stream-decode the file and match each output frame to the source frame
      // whose PTS is closest to the desired source time. This replaces the
      // old seek-per-output-frame loop (each iteration of which forced the
      // browser's media decoder to restart from the nearest keyframe). For
      // typical screen recordings with sparse keyframes the speed-up is huge.
      let outputIdx = 0;
      let prevSource: VideoFrame | null = null;
      let prevTimestampUs = -Infinity;

      const emitOutputFrame = async (sourceFrame: VideoFrame, idx: number) => {
        const outputTimestamp = idx * frameDurationUs;
        // Renderer time-bases regions/keyframes on the SOURCE timestamp.
        await this.renderer!.renderFrame(sourceFrame, sourceFrame.timestamp);

        const canvas = this.renderer!.getCanvas();
        // @ts-ignore - colorSpace not in lib.d.ts but works at runtime
        const exportFrame = new VideoFrame(canvas, {
          timestamp: outputTimestamp,
          duration: frameDurationUs,
          colorSpace: {
            primaries: 'bt709',
            transfer: 'iec61966-2-1',
            matrix: 'rgb',
            fullRange: true,
          },
        });

        if (this.encodeQueue >= this.MAX_ENCODE_QUEUE && !this.cancelled) {
          await new Promise<void>(resolve => {
            this.encoderDrainResolvers.push(resolve);
          });
        }
        if (this.encoder && this.encoder.state === 'configured') {
          this.encodeQueue++;
          this.encoder.encode(exportFrame, { keyFrame: idx % 150 === 0 });
        } else {
          console.warn(`[Frame ${idx}] Encoder not ready! State: ${this.encoder?.state}`);
        }
        exportFrame.close();

        if (this.config.onProgress) {
          this.config.onProgress({
            currentFrame: idx + 1,
            totalFrames,
            percentage: ((idx + 1) / totalFrames) * 100,
            estimatedTimeRemaining: 0,
          });
          await progressYield.maybeYield();
        }
      };

      for await (const sourceFrame of this.decoder.frames()) {
        if (this.cancelled) {
          sourceFrame.close();
          break;
        }
        const currentTs = sourceFrame.timestamp;

        // Emit every output frame whose desired source time is satisfied by
        // either prevSource or sourceFrame (desired ≤ currentTs). Pick whichever
        // is closer in PTS — this handles output framerates lower than source
        // (sub-sampling) and higher than source (repeating a frame).
        while (outputIdx < totalFrames && desiredSourceUs[outputIdx] <= currentTs) {
          const desired = desiredSourceUs[outputIdx];
          const useCurrent =
            !prevSource ||
            Math.abs(currentTs - desired) <= Math.abs(prevTimestampUs - desired);
          await emitOutputFrame(useCurrent ? sourceFrame : prevSource!, outputIdx);
          outputIdx++;
          if (this.cancelled) break;
        }

        // Slide the window: keep the latest source frame as `prev`.
        if (prevSource) prevSource.close();
        prevSource = sourceFrame;
        prevTimestampUs = currentTs;

        if (outputIdx >= totalFrames) break;
      }

      // Last source frame anchors any remaining output frames whose desired
      // time sits past the end of the source (rounding at end of duration).
      while (outputIdx < totalFrames && prevSource && !this.cancelled) {
        await emitOutputFrame(prevSource, outputIdx);
        outputIdx++;
      }

      if (prevSource) prevSource.close();

      if (this.cancelled) {
        return { success: false, error: 'Export cancelled' };
      }

      // Finalize encoding
      if (this.config.onProgress) {
        this.config.onProgress({
          currentFrame: totalFrames,
          totalFrames,
          percentage: 100,
          estimatedTimeRemaining: 0,
          phase: 'finalizing',
        });
        await progressYield.maybeYield();
      }

      if (this.encoder && this.encoder.state === 'configured') {
        await this.encoder.flush();
      }

      // Wait for all video muxing operations to complete
      await Promise.all(this.muxingPromises);

      // Encode and mux audio if present
      if (hasAudio && sourceAudioBuffer && this.muxer) {
        try {
          await this.encodeAndMuxAudio(sourceAudioBuffer, this.muxer);
        } catch (err) {
          console.warn('[VideoExporter] Audio encoding failed, exporting without audio:', err);
        }
      }

      // Finalize muxer and get output blob
      const blob = await this.muxer!.finalize();

      return { success: true, blob };
    } catch (error) {
      console.error('Export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.cleanup();
    }
  }

  private async initializeEncoder(): Promise<void> {
    this.encodeQueue = 0;
    this.muxingPromises = [];
    this.chunkCount = 0;
    let videoDescription: Uint8Array | undefined;

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // Capture decoder config metadata from encoder output
        if (meta?.decoderConfig?.description && !videoDescription) {
          const desc = meta.decoderConfig.description;
          videoDescription = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as any));
          this.videoDescription = videoDescription;
        }
        // Capture colorSpace from encoder metadata if provided
        if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
          this.videoColorSpace = meta.decoderConfig.colorSpace;
        }

        // Stream chunk to muxer immediately (parallel processing)
        const isFirstChunk = this.chunkCount === 0;
        this.chunkCount++;

        const muxingPromise = (async () => {
          try {
            if (isFirstChunk && this.videoDescription) {
              // Add decoder config for the first chunk
              const colorSpace = this.videoColorSpace || {
                primaries: 'bt709',
                transfer: 'iec61966-2-1',
                matrix: 'rgb',
                fullRange: true,
              };

              const metadata: EncodedVideoChunkMetadata = {
                decoderConfig: {
                  codec: this.config.codec || 'avc1.640033',
                  codedWidth: this.config.width,
                  codedHeight: this.config.height,
                  description: this.videoDescription,
                  colorSpace,
                },
              };

              await this.muxer!.addVideoChunk(chunk, metadata);
            } else {
              await this.muxer!.addVideoChunk(chunk, meta);
            }
          } catch (error) {
            console.error('Muxing error:', error);
          }
        })();

        this.muxingPromises.push(muxingPromise);
        this.encodeQueue--;
        // Wake one producer that was blocked on a full queue. Using Promises
        // (signalled here) instead of polling setTimeout cuts ~4 ms off every
        // saturated frame on macOS / Chromium.
        const next = this.encoderDrainResolvers.shift();
        if (next) next();
      },
      error: (error) => {
        console.error('[VideoExporter] Encoder error:', error);
        // Stop export encoding failed
        this.cancelled = true;
        // Unblock anyone still waiting on the queue so we can exit cleanly.
        for (const r of this.encoderDrainResolvers) r();
        this.encoderDrainResolvers = [];
      },
    });

    const codec = this.config.codec || 'avc1.640033';

    const encoderConfig: VideoEncoderConfig = {
      codec,
      width: this.config.width,
      height: this.config.height,
      bitrate: this.config.bitrate,
      framerate: this.config.frameRate,
      // 'quality' lets VideoToolbox / hardware encoders pipeline deeper and
      // batch frames; 'realtime' pins them at ~1× source frame rate which is
      // the wrong trade-off for batch export. Output bitstream is identical.
      latencyMode: 'quality',
      bitrateMode: 'variable',
      hardwareAcceleration: 'prefer-hardware',
    };

    // Check hardware support first
    const hardwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);

    if (hardwareSupport.supported) {
      // Use hardware encoding
      console.log('[VideoExporter] Using hardware acceleration');
      this.encoder.configure(encoderConfig);
    } else {
      // Fall back to software encoding
      console.log('[VideoExporter] Hardware not supported, using software encoding');
      encoderConfig.hardwareAcceleration = 'prefer-software';
      
      const softwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!softwareSupport.supported) {
        throw new Error('Video encoding not supported on this system');
      }
      
      this.encoder.configure(encoderConfig);
    }
  }

  /**
   * Encode audio from AudioBuffer and add to muxer, respecting trim regions.
   */
  private async encodeAndMuxAudio(audioBuffer: AudioBuffer, muxer: VideoMuxer): Promise<void> {
    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;

    // Build the trimmed audio buffer via the chunked helper, which yields to
    // the event loop periodically so the UI stays responsive for long inputs.
    const trimmedBuffer = await buildTrimmedAudioBuffer(
      audioBuffer,
      this.config.trimRegions || [],
      (p) => {
        // Trimming occupies 80-90% of the audio phase (decode took 0-80%).
        this.reportAudioProgress(0.8 + p.ratio * 0.1);
      },
    );
    if (!trimmedBuffer) return;

    // Encode using AudioEncoder (AAC for universal MP4 compatibility)
    const audioPromises: Promise<void>[] = [];
    let isFirstAudioChunk = true;

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        const first = isFirstAudioChunk;
        isFirstAudioChunk = false;

        const promise = (async () => {
          try {
            if (first) {
              const audioMeta: EncodedAudioChunkMetadata = {
                decoderConfig: {
                  codec: 'mp4a.40.2',
                  sampleRate,
                  numberOfChannels: channels,
                  ...(meta?.decoderConfig?.description ? { description: meta.decoderConfig.description } : {}),
                },
              };
              await muxer.addAudioChunk(chunk, audioMeta);
            } else {
              await muxer.addAudioChunk(chunk, meta);
            }
          } catch (err) {
            console.warn('[VideoExporter] Audio muxing error:', err);
          }
        })();
        audioPromises.push(promise);
      },
      error: (err) => {
        console.error('[VideoExporter] AudioEncoder error:', err);
      },
    });

    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    });

    // Feed audio data in 1024-sample frames (standard AAC frame size).
    // The loop yields to the event loop every ~100k samples so feeding a long
    // recording doesn't monopolise the main thread.
    const chunkSize = 1024;
    const totalAudioSamples = trimmedBuffer.length;
    let sampleOffset = 0;
    let samplesSinceYield = 0;

    while (sampleOffset < totalAudioSamples) {
      const remaining = totalAudioSamples - sampleOffset;
      const frameSamples = Math.min(chunkSize, remaining);

      // Create planar float32 data for AudioData
      const planarData = new Float32Array(frameSamples * channels);
      for (let ch = 0; ch < channels; ch++) {
        const channelData = trimmedBuffer.getChannelData(ch);
        planarData.set(
          channelData.subarray(sampleOffset, sampleOffset + frameSamples),
          ch * frameSamples,
        );
      }

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frameSamples,
        numberOfChannels: channels,
        timestamp: Math.round((sampleOffset / sampleRate) * 1_000_000), // microseconds
        data: planarData,
      });

      audioEncoder.encode(audioData);
      audioData.close();
      sampleOffset += frameSamples;
      samplesSinceYield += frameSamples;

      if (samplesSinceYield >= 100_000) {
        samplesSinceYield = 0;
        // Remaining 10% of the audio phase is spent on the AAC encode feed.
        const encodeRatio = sampleOffset / totalAudioSamples;
        this.reportAudioProgress(0.9 + encodeRatio * 0.1);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }

    await audioEncoder.flush();
    audioEncoder.close();
    await Promise.all(audioPromises);

    console.log('[VideoExporter] Audio encoding complete');
  }

  /**
   * Report progress for the audio phase of export. The dialog uses the
   * `phase: 'audio'` hint to show "Decoding audio…" so long recordings don't
   * look frozen at 0% while the native audio decoder runs.
   */
  private reportAudioProgress(ratio: number): void {
    if (!this.config.onProgress) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    this.config.onProgress({
      currentFrame: 0,
      totalFrames: 0,
      percentage: clamped * 100,
      estimatedTimeRemaining: 0,
      phase: 'audio',
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanup();
  }

  private cleanup(): void {
    // Wake anything still waiting on encoder backpressure so the export loop
    // can observe `cancelled` and exit instead of stalling forever.
    for (const r of this.encoderDrainResolvers) r();
    this.encoderDrainResolvers = [];

    if (this.encoder) {
      try {
        if (this.encoder.state === 'configured') {
          this.encoder.close();
        }
      } catch (e) {
        console.warn('Error closing encoder:', e);
      }
      this.encoder = null;
    }

    if (this.decoder) {
      try {
        this.decoder.destroy();
      } catch (e) {
        console.warn('Error destroying decoder:', e);
      }
      this.decoder = null;
    }

    if (this.renderer) {
      try {
        this.renderer.destroy();
      } catch (e) {
        console.warn('Error destroying renderer:', e);
      }
      this.renderer = null;
    }

    this.muxer = null;
    this.encodeQueue = 0;
    this.muxingPromises = [];
    this.chunkCount = 0;
    this.videoDescription = undefined;
    this.videoColorSpace = undefined;
  }
}
