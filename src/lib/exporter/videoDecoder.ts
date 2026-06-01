/**
 * Streaming video decoder for export.
 *
 * Fast path (.mov / .mp4): mp4box.js demuxes the file in memory and feeds raw
 * H.264/HEVC/VP9/AV1 chunks to WebCodecs `VideoDecoder`. Decoded `VideoFrame`s
 * are yielded by an async generator in source PTS order. This avoids the
 * seek-per-output-frame model and is typically 5-10× faster on screen
 * recordings (sparse keyframes, mostly delta frames).
 *
 * Slow path (.webm or any failure of the fast path): an off-screen `<video>`
 * element walks through the file at the source frame rate using
 * `requestVideoFrameCallback`. Still streaming (no per-output-frame seek), so
 * it's also faster than the old impl, just bound by the browser's decoder.
 */
import {
  createFile as createMp4File,
  MP4BoxBuffer,
  DataStream,
  Endianness,
  type ISOFile,
  type Movie,
  type Sample,
} from 'mp4box';
import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink,
} from 'mediabunny';

export interface DecodedVideoInfo {
  width: number;
  height: number;
  /** Duration in seconds. */
  duration: number;
  /** Approximate source frame rate. */
  frameRate: number;
  /** WebCodecs-style codec string (e.g. "avc1.640033"). */
  codec: string;
}

export type DecoderKind = 'mp4box' | 'mediabunny' | 'seek';

export function getDecoderPlanForUrl(videoUrl: string): DecoderKind[] {
  const urlWithoutQuery = videoUrl.split(/[?#]/, 1)[0].toLowerCase();

  if (urlWithoutQuery.endsWith('.webm') || urlWithoutQuery.endsWith('.mkv')) {
    return ['mediabunny', 'seek'];
  }

  return ['mp4box', 'mediabunny', 'seek'];
}

/**
 * Streaming decoder for an entire video file.
 *
 * Lifecycle:
 *   const dec = new VideoFileDecoder();
 *   const info = await dec.loadVideo(url);
 *   for await (const frame of dec.frames()) { ...; frame.close(); }
 *   dec.destroy();
 */
export class VideoFileDecoder {
  private info: DecodedVideoInfo | null = null;
  private streaming: StreamingMp4Decoder | null = null;
  private mediabunny: MediabunnyVideoDecoder | null = null;
  private seekFallback: SeekingVideoDecoder | null = null;

  async loadVideo(videoUrl: string): Promise<DecodedVideoInfo> {
    let lastError: unknown = null;

    for (const decoderKind of getDecoderPlanForUrl(videoUrl)) {
      if (decoderKind === 'mp4box') {
        const streaming = new StreamingMp4Decoder();
        try {
          this.info = await streaming.load(videoUrl);
          this.streaming = streaming;
          return this.info;
        } catch (err) {
          lastError = err;
          console.warn('[VideoFileDecoder] mp4box streaming path unavailable:', err);
          streaming.destroy();
        }
      }

      if (decoderKind === 'mediabunny') {
        const mediabunny = new MediabunnyVideoDecoder();
        try {
          this.info = await mediabunny.load(videoUrl);
          this.mediabunny = mediabunny;
          return this.info;
        } catch (err) {
          lastError = err;
          console.warn('[VideoFileDecoder] Mediabunny streaming path unavailable:', err);
          mediabunny.destroy();
        }
      }

      if (decoderKind === 'seek') {
        const seek = new SeekingVideoDecoder();
        try {
          this.info = await seek.load(videoUrl);
          this.seekFallback = seek;
          return this.info;
        } catch (err) {
          lastError = err;
          seek.destroy();
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('No video decoder could load this file');
  }

  /**
   * Async-iterate decoded frames in source PTS order. The consumer MUST call
   * `.close()` on each yielded frame. If the loop exits early (break / throw)
   * the generator's `finally` releases any buffered frames.
   */
  frames(): AsyncGenerator<VideoFrame, void, void> {
    if (this.streaming) return this.streaming.frames();
    if (this.mediabunny) return this.mediabunny.frames();
    if (this.seekFallback) return this.seekFallback.frames();
    throw new Error('loadVideo() must be called before frames()');
  }

  getInfo(): DecodedVideoInfo | null {
    return this.info;
  }

  destroy(): void {
    this.streaming?.destroy();
    this.mediabunny?.destroy();
    this.seekFallback?.destroy();
    this.streaming = null;
    this.mediabunny = null;
    this.seekFallback = null;
  }
}

// ---------------------------------------------------------------------------
// Fast path: mp4box.js + WebCodecs VideoDecoder
// ---------------------------------------------------------------------------

class StreamingMp4Decoder {
  private mp4: ISOFile | null = null;
  private decoder: VideoDecoder | null = null;
  private outputQueue: VideoFrame[] = [];
  private waiter: (() => void) | null = null;
  private flushComplete = false;
  private fatalError: Error | null = null;
  private cancelled = false;

  async load(videoUrl: string): Promise<DecodedVideoInfo> {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video (${response.status})`);
    }
    const buffer = await response.arrayBuffer();

    return new Promise<DecodedVideoInfo>((resolve, reject) => {
      const mp4 = createMp4File();
      this.mp4 = mp4;

      let resolved = false;
      const fail = (err: Error) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        } else {
          this.fatalError = err;
          this.signalWaiter();
        }
      };

      mp4.onError = (module: string, message: string) => {
        fail(new Error(`mp4box error (${module}): ${message}`));
      };

      mp4.onReady = (info: Movie) => {
        const track = info.videoTracks[0];
        if (!track) {
          fail(new Error('No video track in file'));
          return;
        }

        const description = extractCodecDescription(mp4, track.id);
        if (!description) {
          fail(new Error('Could not extract codec configuration box'));
          return;
        }

        const width = track.video?.width || track.track_width;
        const height = track.video?.height || track.track_height;
        const durationSec = track.duration / track.timescale;

        try {
          this.decoder = new VideoDecoder({
            output: (frame) => this.onDecodedFrame(frame),
            error: (err) => fail(err instanceof Error ? err : new Error(String(err))),
          });
          this.decoder.configure({
            codec: track.codec,
            codedWidth: width,
            codedHeight: height,
            description,
            hardwareAcceleration: 'prefer-hardware',
            optimizeForLatency: false,
          });
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        const decodedInfo: DecodedVideoInfo = {
          width,
          height,
          duration: durationSec,
          frameRate: durationSec > 0 ? track.nb_samples / durationSec : 60,
          codec: track.codec,
        };

        mp4.onSamples = (id: number, _user: unknown, samples: Sample[]) => {
          if (this.cancelled || this.fatalError) return;
          for (const sample of samples) {
            if (!sample.data) continue;
            const chunk = new EncodedVideoChunk({
              type: sample.is_sync ? 'key' : 'delta',
              timestamp: (sample.cts * 1_000_000) / sample.timescale,
              duration: (sample.duration * 1_000_000) / sample.timescale,
              data: sample.data,
            });
            try {
              this.decoder!.decode(chunk);
            } catch (err) {
              fail(err instanceof Error ? err : new Error(String(err)));
              return;
            }
          }
          // Release sample data back to mp4box so memory doesn't balloon on
          // long recordings. Decoder.decode() copies the chunk data, so the
          // underlying sample buffer is safe to drop.
          const last = samples[samples.length - 1];
          if (last) mp4.releaseUsedSamples(id, last.number);
        };

        mp4.setExtractionOptions(track.id, null, { nbSamples: 100 });
        mp4.start();

        if (!resolved) {
          resolved = true;
          resolve(decodedInfo);
        }
      };

      // Feed the whole file at once. onReady fires synchronously during
      // appendBuffer when the moov box is parsed; onSamples fires during
      // appendBuffer + flush as samples are extracted.
      const mp4buf = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
      mp4.appendBuffer(mp4buf, true);
      mp4.flush();

      // All chunks have now been queued in the decoder. Drain it: flush()
      // resolves once every remaining decoded frame has been emitted via the
      // output callback.
      if (this.decoder) {
        this.decoder
          .flush()
          .then(() => {
            this.flushComplete = true;
            this.signalWaiter();
          })
          .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
      }
    });
  }

  private onDecodedFrame(frame: VideoFrame): void {
    if (this.cancelled) {
      frame.close();
      return;
    }
    this.outputQueue.push(frame);
    this.signalWaiter();
  }

  private signalWaiter(): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w();
    }
  }

  async *frames(): AsyncGenerator<VideoFrame, void, void> {
    try {
      while (true) {
        if (this.fatalError) throw this.fatalError;
        if (this.outputQueue.length > 0) {
          yield this.outputQueue.shift()!;
          continue;
        }
        if (this.flushComplete) return;
        await new Promise<void>((resolve) => {
          this.waiter = resolve;
        });
      }
    } finally {
      for (const f of this.outputQueue) f.close();
      this.outputQueue = [];
    }
  }

  destroy(): void {
    this.cancelled = true;
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        /* already closed */
      }
      this.decoder = null;
    }
    if (this.mp4) {
      try {
        this.mp4.stop();
      } catch {
        /* mp4box may not be in a stoppable state */
      }
      this.mp4 = null;
    }
    for (const f of this.outputQueue) f.close();
    this.outputQueue = [];
    this.signalWaiter();
  }
}

function extractCodecDescription(mp4: ISOFile, trackId: number): Uint8Array | null {
  // mp4box's typed entries don't expose avcC/hvcC/vpcC/av1C uniformly, so we
  // duck-type on the raw box structure.
  const trak = mp4.getTrackById(trackId) as unknown as {
    mdia?: { minf?: { stbl?: { stsd?: { entries?: Array<Record<string, unknown>> } } } };
  } | undefined;
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
  if (!entries) return null;

  for (const entry of entries) {
    const box = (entry.avcC || entry.hvcC || entry.vpcC || entry.av1C) as
      | { write: (stream: DataStream) => void }
      | undefined;
    if (!box) continue;

    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    box.write(stream);
    // Strip the 8-byte ISOBMFF box header (size + fourcc); VideoDecoder wants
    // the raw configuration payload (e.g. AVCDecoderConfigurationRecord).
    const buf = stream.buffer as ArrayBuffer;
    return new Uint8Array(buf, 8);
  }

  return null;
}

// ---------------------------------------------------------------------------
// General streaming path: Mediabunny demuxer + WebCodecs-backed sample sink
// ---------------------------------------------------------------------------

class MediabunnyVideoDecoder {
  private input: Input | null = null;
  private sampleSink: VideoSampleSink | null = null;
  private cancelled = false;

  async load(videoUrl: string): Promise<DecodedVideoInfo> {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video (${response.status})`);
    }

    const blob = await response.blob();
    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    this.input = input;

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('No video track in file');
    }

    if (!(await videoTrack.canDecode())) {
      throw new Error(`Video track cannot be decoded: ${videoTrack.codec ?? 'unknown'}`);
    }

    this.sampleSink = new VideoSampleSink(videoTrack);

    const [duration, codecParameterString, packetStats] = await Promise.all([
      input.computeDuration(),
      videoTrack.getCodecParameterString(),
      videoTrack.computePacketStats(200).catch(() => null),
    ]);

    return {
      width: videoTrack.displayWidth || videoTrack.codedWidth,
      height: videoTrack.displayHeight || videoTrack.codedHeight,
      duration,
      frameRate: packetStats?.averagePacketRate || 60,
      codec: codecParameterString || videoTrack.codec || 'unknown',
    };
  }

  async *frames(): AsyncGenerator<VideoFrame, void, void> {
    if (!this.sampleSink) {
      throw new Error('MediabunnyVideoDecoder: load() not called');
    }

    try {
      for await (const sample of this.sampleSink.samples()) {
        if (this.cancelled) {
          sample.close();
          break;
        }

        const frame = sample.toVideoFrame();
        sample.close();
        yield frame;
      }
    } finally {
      this.destroy();
    }
  }

  destroy(): void {
    this.cancelled = true;
    if (this.input && !this.input.disposed) {
      this.input.dispose();
    }
    this.input = null;
    this.sampleSink = null;
  }
}

// ---------------------------------------------------------------------------
// Slow path: hidden <video> element that walks source frames in order
// ---------------------------------------------------------------------------

class SeekingVideoDecoder {
  private videoElement: HTMLVideoElement | null = null;
  private info: DecodedVideoInfo | null = null;
  private cancelled = false;

  async load(videoUrl: string): Promise<DecodedVideoInfo> {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.preload = 'auto';
    video.muted = true;
    (video as HTMLVideoElement & { playsInline: boolean }).playsInline = true;
    this.videoElement = video;

    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Failed to load video')), { once: true });
    });

    this.info = {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      frameRate: 60,
      codec: 'avc1.640033',
    };
    return this.info;
  }

  async *frames(): AsyncGenerator<VideoFrame, void, void> {
    const video = this.videoElement;
    if (!video || !this.info) {
      throw new Error('SeekingVideoDecoder: load() not called');
    }

    // Walk the source at a fixed step. Output frame rate matching is the
    // caller's responsibility — they pick the closest source frame.
    const stepSec = 1 / this.info.frameRate;
    const duration = this.info.duration;

    // Seek to the start so the first capture is the leading frame.
    video.currentTime = 0;
    await waitFor(video, 'seeked');

    let t = 0;
    while (t < duration && !this.cancelled) {
      // Capture current frame.
      const frame = new VideoFrame(video, {
        timestamp: Math.round(t * 1_000_000),
      });
      yield frame;

      t += stepSec;
      if (t >= duration) break;

      video.currentTime = t;
      // Wait for the seek to land AND for the frame to be ready in the GPU
      // pipeline. requestVideoFrameCallback fires once the new frame can be
      // sampled.
      await waitFor(video, 'seeked');
      await new Promise<void>((resolve) => {
        video.requestVideoFrameCallback(() => resolve());
      });
    }
  }

  destroy(): void {
    this.cancelled = true;
    if (this.videoElement) {
      // Pause but do NOT clear src. Setting videoElement.src = '' on Chromium
      // can aggressively tear down media pipeline state shared with other
      // <video> elements pointing at the same file URL — including the editor
      // preview. GC will reclaim this element on its own.
      this.videoElement.pause();
      this.videoElement = null;
    }
  }
}

function waitFor(video: HTMLVideoElement, eventName: string): Promise<void> {
  return new Promise((resolve) => {
    video.addEventListener(eventName, () => resolve(), { once: true });
  });
}
