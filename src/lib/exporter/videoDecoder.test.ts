import { describe, expect, it } from 'vitest';
import { getDecoderPlanForUrl } from './videoDecoder';

describe('getDecoderPlanForUrl', () => {
  it('routes WebM recordings through streaming Mediabunny decoding before seek fallback', () => {
    expect(getDecoderPlanForUrl('file:///recordings/recording-1.webm')).toEqual([
      'mediabunny',
      'seek',
    ]);
  });

  it('keeps MP4 and MOV on the mp4box fast path first', () => {
    expect(getDecoderPlanForUrl('file:///recordings/recording-1.mp4')).toEqual([
      'mp4box',
      'mediabunny',
      'seek',
    ]);
    expect(getDecoderPlanForUrl('file:///recordings/recording-1.mov')).toEqual([
      'mp4box',
      'mediabunny',
      'seek',
    ]);
  });
});
