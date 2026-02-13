import { Graphics, Container } from 'pixi.js';
import type { CursorHighlightConfig, CursorFrame } from '@/lib/cursorTracker';
import { getCursorPositionAtTime, detectClickTimes, getCursorStyleAtTime } from '@/lib/cursorTracker';
import { getSmoothedCursorPositionAtTime } from '@/lib/cursorSmoothing';

// macOS cursor from the actual Apple SVG (daviddarnes/mac-cursors).
// The macOS cursor is BLACK body with WHITE outline — opposite of Windows.
// Outer path = white border, inner path = black fill, drawn in that order.
const MACOS_OUTER = [
  // White outline path (larger) — tip at origin, ~11.4×18.1 units
  0, 0,           // tip
  0, 16.015,      // left edge bottom (perfectly vertical)
  3.316, 12.794,  // inner notch
  6.137, 18.066,  // tail bottom-left
  8.0, 17.063,    // tail bottom-right
  9.615, 16.224,  // right tail junction
  7.047, 11.408,  // outer notch
  11.379, 11.408, // right wing tip
];
const MACOS_INNER = [
  // Black body path (smaller, drawn on top)
  0.989, 2.407,   // inset tip
  0.989, 13.595,  // left edge bottom
  3.519, 11.153,  // inner notch
  6.42, 16.593,   // tail bottom-left
  8.185, 15.652,  // tail bottom-right
  5.41, 10.45,    // outer notch
  9.014, 10.45,   // right wing tip
];

const PULSE_DURATION_MS = 350;
const CLICK_SCALE_DURATION_MS = 200;

/**
 * Manages PixiJS Graphics for rendering cursor highlight, custom pointer,
 * and click pulse animations in the preview.
 * Placed inside cameraContainer so it zooms with the video.
 */
export class CursorHighlightOverlay {
  private highlightGfx: Graphics;
  private cursorGfx: Graphics;
  private pulseGfx: Graphics;
  private config: CursorHighlightConfig;
  private cachedClicks: number[] | null = null;
  private lastFramesRef: CursorFrame[] | null = null;

  constructor(parent: Container) {
    this.highlightGfx = new Graphics();
    this.pulseGfx = new Graphics();
    this.cursorGfx = new Graphics();
    this.config = { enabled: false, color: '#FFDD00', opacity: 0.3, size: 30, style: 'circle', smoothing: 'none', cursorType: 'none', cursorScale: 1.0 };
    parent.addChild(this.highlightGfx);
    parent.addChild(this.pulseGfx);
    parent.addChild(this.cursorGfx);
  }

  setConfig(config: CursorHighlightConfig) {
    this.config = config;
    const showCursorPointer = config.cursorFree && config.cursorType !== 'none';
    if (!config.enabled) {
      this.highlightGfx.clear();
      this.pulseGfx.clear();
      this.highlightGfx.visible = false;
      this.pulseGfx.visible = false;
      if (!showCursorPointer) {
        this.cursorGfx.clear();
        this.cursorGfx.visible = false;
      } else {
        this.cursorGfx.visible = true;
      }
    } else {
      this.highlightGfx.visible = true;
      this.cursorGfx.visible = true;
      this.pulseGfx.visible = true;
    }
  }

  update(
    cursorData: CursorFrame[],
    timeMs: number,
    videoDisplayWidth: number,
    videoDisplayHeight: number,
    offsetX: number = 0,
    offsetY: number = 0,
  ) {
    this.highlightGfx.clear();
    this.cursorGfx.clear();
    this.pulseGfx.clear();

    if (cursorData.length === 0) return;

    const isCursorFree = this.config.cursorFree === true;

    if (!this.config.enabled && !isCursorFree) return;

    const pos = this.config.smoothing !== 'none'
      ? getSmoothedCursorPositionAtTime(cursorData, timeMs, this.config.smoothing)
        ?? getCursorPositionAtTime(cursorData, timeMs)
      : getCursorPositionAtTime(cursorData, timeMs);
    if (!pos) return;

    const x = offsetX + pos.x * videoDisplayWidth;
    const y = offsetY + pos.y * videoDisplayHeight;
    const { size, opacity, style } = this.config;
    const colorNum = parseInt(this.config.color.replace('#', ''), 16);

    // --- Highlight (only when enabled) ---
    if (this.config.enabled) {
      if (style === 'circle') {
        this.highlightGfx.circle(x, y, size);
        this.highlightGfx.fill({ color: colorNum, alpha: opacity });
      } else if (style === 'spotlight') {
        const steps = 5;
        for (let i = steps; i >= 1; i--) {
          const ratio = i / steps;
          const r = size * ratio;
          const alpha = opacity * (1 - ratio) * 1.5;
          this.highlightGfx.circle(x, y, r);
          this.highlightGfx.fill({ color: colorNum, alpha: Math.min(alpha, opacity) });
        }
      } else if (style === 'ring') {
        this.highlightGfx.circle(x, y, size);
        this.highlightGfx.stroke({ color: colorNum, alpha: opacity, width: 3 });
      }

      if (cursorData !== this.lastFramesRef) {
        this.cachedClicks = detectClickTimes(cursorData);
        this.lastFramesRef = cursorData;
      }

      if (this.cachedClicks && this.cachedClicks.length > 0) {
        this.drawClickPulse(x, y, timeMs, size, colorNum, opacity);
      }
    }

    // --- Cursor pointer (drawn on top) ---
    const cursorType = this.config.cursorType ?? 'none';
    if (cursorType !== 'none' && (this.config.enabled || isCursorFree)) {
      // Ensure clicks are cached for click-scale animation
      if (cursorData !== this.lastFramesRef) {
        this.cachedClicks = detectClickTimes(cursorData);
        this.lastFramesRef = cursorData;
      }

      // Click-scale: cursor briefly shrinks on click for a tactile "tap" feel
      const clickScale = this.getClickScale(timeMs);
      const scale = (this.config.cursorScale ?? 1.0) * clickScale;
      const cursorHeight = Math.max(10, videoDisplayWidth * 0.014) * scale;
      const s = cursorHeight / 18.066; // scale factor based on macOS arrow height

      if (cursorType === 'native') {
        // Dynamic cursor from tracked frame data
        const nativeStyle = getCursorStyleAtTime(cursorData, timeMs);
        this.drawNativeCursor(x, y, nativeStyle, s, cursorHeight);
      } else if (cursorType === 'default') {
        this.drawMacOSArrow(x, y, s);
      } else if (cursorType === 'dot') {
        this.drawDot(x, y, cursorHeight);
      } else if (cursorType === 'crosshair') {
        this.drawCrosshair(x, y, cursorHeight);
      } else if (cursorType === 'circle') {
        this.drawCircleCursor(x, y, cursorHeight);
      }
    }
  }

  // macOS system arrow — BLACK body with WHITE outline (the real macOS look)
  private drawMacOSArrow(x: number, y: number, s: number) {
    const g = this.cursorGfx;

    // 1) White outer border
    const outer: number[] = [];
    for (let i = 0; i < MACOS_OUTER.length; i += 2) {
      outer.push(x + MACOS_OUTER[i] * s, y + MACOS_OUTER[i + 1] * s);
    }
    g.poly(outer);
    g.fill({ color: 0xffffff, alpha: 1.0 });

    // 2) Black body on top
    const inner: number[] = [];
    for (let i = 0; i < MACOS_INNER.length; i += 2) {
      inner.push(x + MACOS_INNER[i] * s, y + MACOS_INNER[i + 1] * s);
    }
    g.poly(inner);
    g.fill({ color: 0x000000, alpha: 1.0 });
  }

  private drawClickPulse(x: number, y: number, timeMs: number, size: number, color: number, baseAlpha: number) {
    if (!this.cachedClicks) return;

    for (let i = this.cachedClicks.length - 1; i >= 0; i--) {
      const elapsed = timeMs - this.cachedClicks[i];
      if (elapsed < 0) continue;
      if (elapsed >= PULSE_DURATION_MS) break;

      const phase = elapsed / PULSE_DURATION_MS;
      const eased = 1 - (1 - phase) * (1 - phase);

      const pulseRadius = size * (1 + eased * 1.5);
      const pulseAlpha = baseAlpha * (1 - eased) * 0.5;
      this.pulseGfx.circle(x, y, pulseRadius);
      this.pulseGfx.stroke({ color, alpha: pulseAlpha, width: 2 });

      const glowRadius = size * (0.6 + eased * 0.4);
      const glowAlpha = baseAlpha * (1 - eased) * 0.3;
      this.pulseGfx.circle(x, y, glowRadius);
      this.pulseGfx.fill({ color, alpha: glowAlpha });

      break;
    }
  }

  // Small filled dot with subtle shadow
  private drawDot(x: number, y: number, cursorHeight: number) {
    const g = this.cursorGfx;
    const r = cursorHeight * 0.3;
    // Soft shadow
    g.circle(x + 0.5, y + 0.5, r + 1.5);
    g.fill({ color: 0x000000, alpha: 0.25 });
    // White dot
    g.circle(x, y, r);
    g.fill({ color: 0xffffff, alpha: 0.95 });
  }

  // Thin outlined circle with a small center dot — popular in screencasting tools
  private drawCircleCursor(x: number, y: number, cursorHeight: number) {
    const g = this.cursorGfx;
    const r = cursorHeight * 0.55;
    const strokeW = Math.max(1.2, cursorHeight * 0.08);
    // Outer shadow for contrast on any background
    g.circle(x, y, r + 0.5);
    g.stroke({ color: 0x000000, alpha: 0.2, width: strokeW + 1 });
    // Ring
    g.circle(x, y, r);
    g.stroke({ color: 0xffffff, alpha: 0.9, width: strokeW });
    // Center dot
    g.circle(x, y, Math.max(1, cursorHeight * 0.06));
    g.fill({ color: 0xffffff, alpha: 0.9 });
  }

  private drawCrosshair(x: number, y: number, cursorHeight: number) {
    const g = this.cursorGfx;
    const arm = cursorHeight * 0.6;
    const gap = cursorHeight * 0.15;
    const w = Math.max(1, cursorHeight * 0.08);

    const lines: [number, number, number, number][] = [
      [x - arm, y, x - gap, y],
      [x + gap, y, x + arm, y],
      [x, y - arm, x, y - gap],
      [x, y + gap, x, y + arm],
    ];
    // Dark outline
    for (const [x1, y1, x2, y2] of lines) {
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
    }
    g.stroke({ color: 0x000000, alpha: 0.4, width: w + 1 });

    // White lines
    for (const [x1, y1, x2, y2] of lines) {
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
    }
    g.stroke({ color: 0xffffff, alpha: 0.9, width: w });

    // Center dot
    g.circle(x, y, w * 0.6);
    g.fill({ color: 0xffffff, alpha: 0.9 });
  }

  // Compute a scale multiplier for the cursor "tap" animation.
  // Shrinks to ~0.75x on click, then eases back to 1.0x over CLICK_SCALE_DURATION_MS.
  private getClickScale(timeMs: number): number {
    if (!this.cachedClicks || this.cachedClicks.length === 0) return 1.0;

    for (let i = this.cachedClicks.length - 1; i >= 0; i--) {
      const elapsed = timeMs - this.cachedClicks[i];
      if (elapsed < 0) continue;
      if (elapsed >= CLICK_SCALE_DURATION_MS) break;

      const phase = elapsed / CLICK_SCALE_DURATION_MS;
      // Ease-out cubic: fast shrink at start, gentle return
      const eased = 1 - (1 - phase) * (1 - phase) * (1 - phase);
      // Scale: 0.75 at click → 1.0 at end
      return 0.75 + 0.25 * eased;
    }
    return 1.0;
  }

  // Dispatch native cursor style to the appropriate drawing method
  private drawNativeCursor(x: number, y: number, style: string, s: number, cursorHeight: number) {
    switch (style) {
      case 'pointer':
        this.drawPointerHand(x, y, cursorHeight);
        break;
      case 'text':
        this.drawIBeam(x, y, cursorHeight);
        break;
      case 'crosshair':
        this.drawCrosshair(x, y, cursorHeight);
        break;
      case 'grab':
      case 'grabbing':
        this.drawGrabHand(x, y, cursorHeight);
        break;
      default:
        this.drawMacOSArrow(x, y, s);
        break;
    }
  }

  // macOS pointer hand — white pointing hand with black outline
  private drawPointerHand(x: number, y: number, cursorHeight: number) {
    const g = this.cursorGfx;
    const s = cursorHeight / 22;

    // Pointing index finger + palm shape
    const outer: number[] = [
      x + 5 * s, y,              // fingertip
      x + 7 * s, y + 1 * s,     // finger right
      x + 7 * s, y + 8 * s,     // finger base right
      x + 10 * s, y + 7 * s,    // middle finger tip
      x + 10 * s, y + 10 * s,   // middle base
      x + 12 * s, y + 9 * s,    // ring finger tip
      x + 12 * s, y + 12 * s,   // ring base
      x + 14 * s, y + 11 * s,   // pinky tip
      x + 14 * s, y + 17 * s,   // palm right
      x + 12 * s, y + 20 * s,   // palm bottom right
      x + 4 * s, y + 20 * s,    // palm bottom left
      x + 1 * s, y + 17 * s,    // wrist left
      x + 1 * s, y + 10 * s,    // thumb junction
      x + 0, y + 9 * s,         // thumb tip
      x + 1 * s, y + 7 * s,     // thumb inner
      x + 3 * s, y + 8 * s,     // thumb base
      x + 3 * s, y + 1 * s,     // finger left
    ];

    // White fill
    g.poly(outer);
    g.fill({ color: 0xffffff, alpha: 1.0 });
    // Black outline
    g.poly(outer);
    g.stroke({ color: 0x000000, alpha: 1.0, width: Math.max(0.8, s * 0.8) });
  }

  // I-beam text cursor — vertical line with serifs
  private drawIBeam(x: number, y: number, cursorHeight: number) {
    const g = this.cursorGfx;
    const h = cursorHeight;
    const serifW = h * 0.2;
    const strokeW = Math.max(1.2, h * 0.07);

    // White outline for contrast
    const lines: [number, number, number, number][] = [
      [x, y, x, y + h],                          // vertical bar
      [x - serifW, y, x + serifW, y],            // top serif
      [x - serifW, y + h, x + serifW, y + h],    // bottom serif
    ];
    for (const [x1, y1, x2, y2] of lines) {
      g.moveTo(x1, y1); g.lineTo(x2, y2);
    }
    g.stroke({ color: 0xffffff, alpha: 0.9, width: strokeW + 1.5 });

    // Black stroke on top
    for (const [x1, y1, x2, y2] of lines) {
      g.moveTo(x1, y1); g.lineTo(x2, y2);
    }
    g.stroke({ color: 0x000000, alpha: 1.0, width: strokeW });
  }

  // Grab/open hand cursor — spread fingers
  private drawGrabHand(x: number, y: number, cursorHeight: number) {
    const g = this.cursorGfx;
    const s = cursorHeight / 22;

    const outer: number[] = [
      x + 3 * s, y + 3 * s,     // index tip
      x + 5 * s, y + 1 * s,     // index right
      x + 6 * s, y + 0,         // middle tip
      x + 8 * s, y + 1 * s,     // middle right
      x + 9 * s, y + 0.5 * s,   // ring tip
      x + 11 * s, y + 2 * s,    // ring right
      x + 12 * s, y + 2 * s,    // pinky tip
      x + 14 * s, y + 4 * s,    // pinky right
      x + 14 * s, y + 12 * s,   // palm right
      x + 12 * s, y + 17 * s,   // palm bottom right
      x + 4 * s, y + 17 * s,    // palm bottom left
      x + 1 * s, y + 14 * s,    // wrist left
      x + 0, y + 8 * s,         // thumb area
      x + 1 * s, y + 5 * s,     // thumb tip
      x + 2 * s, y + 6 * s,     // thumb inner
    ];

    g.poly(outer);
    g.fill({ color: 0xffffff, alpha: 1.0 });
    g.poly(outer);
    g.stroke({ color: 0x000000, alpha: 1.0, width: Math.max(0.8, s * 0.8) });
  }

  destroy() {
    this.highlightGfx.destroy();
    this.cursorGfx.destroy();
    this.pulseGfx.destroy();
  }
}
