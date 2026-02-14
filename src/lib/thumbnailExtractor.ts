export interface ThumbnailFrame {
  timeMs: number;
  dataUrl: string;
  width: number;
}

/**
 * Extract thumbnails from a video at regular intervals.
 * Uses an offscreen video element + canvas to seek and capture frames.
 */
export async function extractThumbnails(
  videoSrc: string,
  intervalMs: number = 2000,
  height: number = 48,
): Promise<ThumbnailFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get 2D context'));
      return;
    }

    const frames: ThumbnailFrame[] = [];
    let currentTime = 0;
    let durationMs = 0;

    video.onloadedmetadata = () => {
      durationMs = video.duration * 1000;
      if (durationMs <= 0) {
        resolve([]);
        return;
      }

      // Calculate thumbnail dimensions preserving aspect ratio
      const aspectRatio = video.videoWidth / video.videoHeight;
      const thumbWidth = Math.round(height * aspectRatio);
      canvas.width = thumbWidth;
      canvas.height = height;

      // Start seeking to first frame
      currentTime = 0;
      video.currentTime = 0;
    };

    video.onseeked = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      frames.push({
        timeMs: Math.round(currentTime * 1000),
        dataUrl,
        width: canvas.width,
      });

      // Move to next frame
      currentTime += intervalMs / 1000;
      if (currentTime * 1000 < durationMs) {
        video.currentTime = currentTime;
      } else {
        // Clean up
        video.src = '';
        video.load();
        resolve(frames);
      }
    };

    video.onerror = () => {
      video.src = '';
      video.load();
      reject(new Error('Failed to load video for thumbnail extraction'));
    };

    video.src = videoSrc;
  });
}
