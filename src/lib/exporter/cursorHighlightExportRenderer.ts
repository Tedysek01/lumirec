import type { CursorHighlightConfig, CursorFrame } from '@/lib/cursorTracker';
import { getCursorPositionAtTime, detectClickTimes, getCursorStyleAtTime } from '@/lib/cursorTracker';
import { getSmoothedCursorPositionAtTime } from '@/lib/cursorSmoothing';

// macOS cursor from the actual Apple SVG (daviddarnes/mac-cursors).
// The macOS cursor is BLACK body with WHITE outline — opposite of Windows.
// Outer path = white border, inner path = black fill, drawn in that order.
const MACOS_OUTER: [number, number][] = [
  [0, 0],           // tip
  [0, 16.015],      // left edge bottom (perfectly vertical)
  [3.316, 12.794],  // inner notch
  [6.137, 18.066],  // tail bottom-left
  [8.0, 17.063],    // tail bottom-right
  [9.615, 16.224],  // right tail junction
  [7.047, 11.408],  // outer notch
  [11.379, 11.408], // right wing tip
];
const MACOS_INNER: [number, number][] = [
  [0.989, 2.407],   // inset tip
  [0.989, 13.595],  // left edge bottom
  [3.519, 11.153],  // inner notch
  [6.42, 16.593],   // tail bottom-left
  [8.185, 15.652],  // tail bottom-right
  [5.41, 10.45],    // outer notch
  [9.014, 10.45],   // right wing tip
];

const PULSE_DURATION_MS = 350;
const CLICK_SCALE_DURATION_MS = 200;

/**
 * Renders cursor highlight, custom pointer, and click pulse onto a canvas 2D context during export.
 */
export function renderCursorHighlight(
  ctx: CanvasRenderingContext2D,
  cursorData: CursorFrame[],
  config: CursorHighlightConfig,
  timeMs: number,
  videoDisplayWidth: number,
  videoDisplayHeight: number,
  offsetX: number = 0,
  offsetY: number = 0,
) {
  if (cursorData.length === 0) return;

  const isCursorFree = config.cursorFree === true;

  if (!config.enabled && !isCursorFree) return;

  const pos = config.smoothing !== 'none'
    ? getSmoothedCursorPositionAtTime(cursorData, timeMs, config.smoothing)
      ?? getCursorPositionAtTime(cursorData, timeMs)
    : getCursorPositionAtTime(cursorData, timeMs);
  if (!pos) return;

  const x = offsetX + pos.x * videoDisplayWidth;
  const y = offsetY + pos.y * videoDisplayHeight;
  const { size, opacity, color, style } = config;

  // --- Highlight (only when enabled) ---
  if (config.enabled) {
    ctx.save();
    ctx.globalAlpha = opacity;

    if (style === 'circle') {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else if (style === 'spotlight') {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    } else if (style === 'ring') {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.restore();

    // --- Click pulse ---
    const clickTimes = detectClickTimes(cursorData);
    for (let i = clickTimes.length - 1; i >= 0; i--) {
      const elapsed = timeMs - clickTimes[i];
      if (elapsed < 0) continue;
      if (elapsed >= PULSE_DURATION_MS) break;

      const phase = elapsed / PULSE_DURATION_MS;
      const eased = 1 - (1 - phase) * (1 - phase);

      ctx.save();

      const pulseRadius = size * (1 + eased * 1.5);
      ctx.globalAlpha = opacity * (1 - eased) * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      const glowRadius = size * (0.6 + eased * 0.4);
      ctx.globalAlpha = opacity * (1 - eased) * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.restore();
      break;
    }
  }

  // --- Cursor pointer ---
  const cursorType = config.cursorType ?? 'none';
  if (cursorType !== 'none' && (config.enabled || isCursorFree)) {
    // Click-scale: cursor briefly shrinks on click for a tactile "tap" feel
    const clickTimes = detectClickTimes(cursorData);
    const clickScale = getClickScale(clickTimes, timeMs);
    const scale = (config.cursorScale ?? 1.0) * clickScale;
    const cursorHeight = Math.max(12, videoDisplayWidth * 0.014) * scale;
    const s = cursorHeight / 18.066;

    ctx.save();

    if (cursorType === 'native') {
      const nativeStyle = getCursorStyleAtTime(cursorData, timeMs);
      drawNativeCursor(ctx, x, y, nativeStyle, s, cursorHeight);
    } else if (cursorType === 'default') {
      drawMacOSArrow(ctx, x, y, s);
    } else if (cursorType === 'dot') {
      drawDot(ctx, x, y, cursorHeight);
    } else if (cursorType === 'crosshair') {
      drawCrosshair(ctx, x, y, cursorHeight);
    } else if (cursorType === 'circle') {
      drawCircleCursor(ctx, x, y, cursorHeight);
    }

    ctx.restore();
  }
}

// macOS system arrow — BLACK body with WHITE outline (the real macOS look)
function drawMacOSArrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  // 1) White outer border
  ctx.beginPath();
  ctx.moveTo(x + MACOS_OUTER[0][0] * s, y + MACOS_OUTER[0][1] * s);
  for (let i = 1; i < MACOS_OUTER.length; i++) {
    ctx.lineTo(x + MACOS_OUTER[i][0] * s, y + MACOS_OUTER[i][1] * s);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
  ctx.fill();

  // 2) Black body on top
  ctx.beginPath();
  ctx.moveTo(x + MACOS_INNER[0][0] * s, y + MACOS_INNER[0][1] * s);
  for (let i = 1; i < MACOS_INNER.length; i++) {
    ctx.lineTo(x + MACOS_INNER[i][0] * s, y + MACOS_INNER[i][1] * s);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
  ctx.fill();
}

// Small filled dot with subtle shadow
function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, cursorHeight: number) {
  const r = cursorHeight * 0.3;
  // Soft shadow
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, r + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fill();
  // White dot
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();
}

// Thin outlined circle with center dot — popular in screencasting tools
function drawCircleCursor(ctx: CanvasRenderingContext2D, x: number, y: number, cursorHeight: number) {
  const r = cursorHeight * 0.55;
  const strokeW = Math.max(1.2, cursorHeight * 0.08);
  // Shadow for contrast
  ctx.beginPath();
  ctx.arc(x, y, r + 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = strokeW + 1;
  ctx.stroke();
  // Ring
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = strokeW;
  ctx.stroke();
  // Center dot
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, cursorHeight * 0.06), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
}

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, cursorHeight: number) {
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
  ctx.lineWidth = w + 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // White lines
  ctx.lineWidth = w;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(x, y, w * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
}

// Click-scale: cursor shrinks to ~0.75x on click, eases back to 1.0x
function getClickScale(clickTimes: number[], timeMs: number): number {
  if (clickTimes.length === 0) return 1.0;

  for (let i = clickTimes.length - 1; i >= 0; i--) {
    const elapsed = timeMs - clickTimes[i];
    if (elapsed < 0) continue;
    if (elapsed >= CLICK_SCALE_DURATION_MS) break;

    const phase = elapsed / CLICK_SCALE_DURATION_MS;
    // Ease-out cubic: fast shrink at start, gentle return
    const eased = 1 - (1 - phase) * (1 - phase) * (1 - phase);
    return 0.75 + 0.25 * eased;
  }
  return 1.0;
}

// Dispatch native cursor style to the appropriate drawing function
function drawNativeCursor(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  style: string, s: number, cursorHeight: number,
) {
  switch (style) {
    case 'pointer':
      drawPointerHand(ctx, x, y, cursorHeight);
      break;
    case 'text':
      drawIBeam(ctx, x, y, cursorHeight);
      break;
    case 'crosshair':
      drawCrosshair(ctx, x, y, cursorHeight);
      break;
    case 'grab':
    case 'grabbing':
      drawGrabHand(ctx, x, y, cursorHeight);
      break;
    default:
      drawMacOSArrow(ctx, x, y, s);
      break;
  }
}

// macOS pointer hand — white pointing hand with black outline
function drawPointerHand(ctx: CanvasRenderingContext2D, x: number, y: number, cursorHeight: number) {
  const s = cursorHeight / 22;
  const strokeW = Math.max(0.8, s * 0.8);

  const points: [number, number][] = [
    [x + 5 * s, y],
    [x + 7 * s, y + 1 * s],
    [x + 7 * s, y + 8 * s],
    [x + 10 * s, y + 7 * s],
    [x + 10 * s, y + 10 * s],
    [x + 12 * s, y + 9 * s],
    [x + 12 * s, y + 12 * s],
    [x + 14 * s, y + 11 * s],
    [x + 14 * s, y + 17 * s],
    [x + 12 * s, y + 20 * s],
    [x + 4 * s, y + 20 * s],
    [x + 1 * s, y + 17 * s],
    [x + 1 * s, y + 10 * s],
    [x, y + 9 * s],
    [x + 1 * s, y + 7 * s],
    [x + 3 * s, y + 8 * s],
    [x + 3 * s, y + 1 * s],
  ];

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
  ctx.lineWidth = strokeW;
  ctx.stroke();
}

// I-beam text cursor — vertical line with serifs
function drawIBeam(ctx: CanvasRenderingContext2D, x: number, y: number, cursorHeight: number) {
  const h = cursorHeight;
  const serifW = h * 0.2;
  const strokeW = Math.max(1.2, h * 0.07);

  const lines: [number, number, number, number][] = [
    [x, y, x, y + h],
    [x - serifW, y, x + serifW, y],
    [x - serifW, y + h, x + serifW, y + h],
  ];

  // White outline for contrast
  ctx.lineWidth = strokeW + 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Black stroke on top
  ctx.lineWidth = strokeW;
  ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

// Grab/open hand cursor — spread fingers
function drawGrabHand(ctx: CanvasRenderingContext2D, x: number, y: number, cursorHeight: number) {
  const s = cursorHeight / 22;
  const strokeW = Math.max(0.8, s * 0.8);

  const points: [number, number][] = [
    [x + 3 * s, y + 3 * s],
    [x + 5 * s, y + 1 * s],
    [x + 6 * s, y],
    [x + 8 * s, y + 1 * s],
    [x + 9 * s, y + 0.5 * s],
    [x + 11 * s, y + 2 * s],
    [x + 12 * s, y + 2 * s],
    [x + 14 * s, y + 4 * s],
    [x + 14 * s, y + 12 * s],
    [x + 12 * s, y + 17 * s],
    [x + 4 * s, y + 17 * s],
    [x + 1 * s, y + 14 * s],
    [x, y + 8 * s],
    [x + 1 * s, y + 5 * s],
    [x + 2 * s, y + 6 * s],
  ];

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
  ctx.lineWidth = strokeW;
  ctx.stroke();
}
