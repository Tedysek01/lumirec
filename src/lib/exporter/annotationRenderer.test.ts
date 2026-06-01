import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationRegion } from '@/components/video-editor/types';
import { createImageAnnotationCache, renderAnnotations } from './annotationRenderer';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 200;
  height = 100;

  set src(_value: string) {
    FakeImage.loadCount++;
    queueMicrotask(() => this.onload?.());
  }

  static loadCount = 0;
}

function createContextStub(): CanvasRenderingContext2D {
  return {
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function createImageAnnotation(content: string): AnnotationRegion {
  return {
    id: 'image-1',
    type: 'image',
    startMs: 0,
    endMs: 1_000,
    content,
    position: { x: 0, y: 0 },
    size: { width: 50, height: 50 },
    style: {
      color: '#ffffff',
      backgroundColor: 'transparent',
      fontSize: 32,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fontStyle: 'normal',
      textDecoration: 'none',
      textAlign: 'center',
    },
    zIndex: 0,
  };
}

describe('renderAnnotations', () => {
  const OriginalImage = globalThis.Image;

  afterEach(() => {
    globalThis.Image = OriginalImage;
    FakeImage.loadCount = 0;
  });

  it('reuses decoded image annotations across frames', async () => {
    globalThis.Image = FakeImage as unknown as typeof Image;
    const ctx = createContextStub();
    const annotation = createImageAnnotation('data:image/png;base64,example');
    const imageCache = createImageAnnotationCache();

    await renderAnnotations(ctx, [annotation], 1920, 1080, 0, 1, imageCache);
    await renderAnnotations(ctx, [annotation], 1920, 1080, 16.67, 1, imageCache);

    expect(FakeImage.loadCount).toBe(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });
});
