import { Application, Container, Sprite, Graphics, BlurFilter, Texture, ImageSource } from 'pixi.js';
import type { CropRegion, AnnotationRegion, SpotlightRegion, VideoSegment, ZoomRegion } from '@/components/video-editor/types';
import { getSpotlightFadeOpacity } from '@/components/video-editor/types';
import { applyZoomTransform } from '@/components/video-editor/videoPlayback/zoomTransform';
import { DEFAULT_FOCUS } from '@/components/video-editor/videoPlayback/constants';
import { resolveTransformAtTime, resolveSpotlightAtTime } from '@/lib/keyframeInterpolation';
import { resolveCornerRadius } from '@/lib/cornerRadius';
import { resolveZoomCameraAtTime, findActiveZoomRegion, IDENTITY_CAMERA } from '@/lib/zoomCamera';
import { findSegmentAtSourceTime } from '@/lib/segmentUtils';
import { createImageAnnotationCache, renderAnnotations } from './annotationRenderer';
import { renderCursorHighlight } from './cursorHighlightExportRenderer';
import type { CursorFrame, CursorHighlightConfig } from '@/lib/cursorTracker';

interface FrameRenderConfig {
  width: number;
  height: number;
  wallpaper: string;
  videoSegments?: VideoSegment[];
  zoomRegions?: ZoomRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  videoBorderRadius?: number;
  padding?: number;
  cropRegion: CropRegion;
  videoWidth: number;
  videoHeight: number;
  annotationRegions?: AnnotationRegion[];
  spotlightRegions?: SpotlightRegion[];
  previewWidth?: number;
  previewHeight?: number;
  cursorData?: CursorFrame[];
  cursorHighlight?: CursorHighlightConfig;
}

interface AnimationState {
  scale: number;
  focusX: number;
  focusY: number;
}

// Renders video frames with all effects (background, zoom, crop, blur, shadow) to an offscreen canvas for export.

export class FrameRenderer {
  private app: Application | null = null;
  private cameraContainer: Container | null = null;
  private videoContainer: Container | null = null;
  private videoSprite: Sprite | null = null;
  private backgroundSprite: Sprite | null = null;
  private maskGraphics: Graphics | null = null;
  private blurFilter: BlurFilter | null = null;
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private compositeCanvas: HTMLCanvasElement | null = null;
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private config: FrameRenderConfig;
  private animationState: AnimationState;
  private layoutCache: any = null;
  private currentVideoTime = 0;
  private annotationImageCache = createImageAnnotationCache();

  constructor(config: FrameRenderConfig) {
    this.config = config;
    this.animationState = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };
  }

  async initialize(): Promise<void> {
    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = this.config.width;
    canvas.height = this.config.height;
    
    // Try to set colorSpace if supported (may not be available on all platforms)
    try {
      if (canvas && 'colorSpace' in canvas) {
        // @ts-ignore
        canvas.colorSpace = 'srgb';
      }
    } catch (error) {
      // Silently ignore colorSpace errors on platforms that don't support it
      console.warn('[FrameRenderer] colorSpace not supported on this platform:', error);
    }

    // Initialize PixiJS with optimized settings for export performance
    this.app = new Application();
    await this.app.init({
      canvas,
      width: this.config.width,
      height: this.config.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: 1,
      autoDensity: true,
    });

    // Setup containers
    this.cameraContainer = new Container();
    this.videoContainer = new Container();
    this.app.stage.addChild(this.cameraContainer);
    this.cameraContainer.addChild(this.videoContainer);

    // Setup background (render separately, not in PixiJS)
    await this.setupBackground();

    // Setup blur filter for video container
    this.blurFilter = new BlurFilter();
    this.blurFilter.quality = 5;
    this.blurFilter.resolution = this.app.renderer.resolution;
    this.blurFilter.blur = 0;
    this.videoContainer.filters = [this.blurFilter];

    // Setup composite canvas for final output with shadows
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.config.width;
    this.compositeCanvas.height = this.config.height;
    this.compositeCtx = this.compositeCanvas.getContext('2d', { willReadFrequently: false });
    
    if (!this.compositeCtx) {
      throw new Error('Failed to get 2D context for composite canvas');
    }

    // Setup shadow canvas if needed
    if (this.config.showShadow) {
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = this.config.width;
      this.shadowCanvas.height = this.config.height;
      this.shadowCtx = this.shadowCanvas.getContext('2d', { willReadFrequently: false });
      
      if (!this.shadowCtx) {
        throw new Error('Failed to get 2D context for shadow canvas');
      }
    }

    // Setup mask
    this.maskGraphics = new Graphics();
    this.videoContainer.addChild(this.maskGraphics);
    this.videoContainer.mask = this.maskGraphics;
  }

  private async setupBackground(): Promise<void> {
    const wallpaper = this.config.wallpaper;

    // Create background canvas for separate rendering (not affected by zoom)
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = this.config.width;
    bgCanvas.height = this.config.height;
    const bgCtx = bgCanvas.getContext('2d')!;

    try {
      // Render background based on type
      if (wallpaper.startsWith('file://') || wallpaper.startsWith('data:') || wallpaper.startsWith('/') || wallpaper.startsWith('http')) {
        // Image background
        const img = new Image();
        // Don't set crossOrigin for same-origin images to avoid CORS taint
        // Only set it for cross-origin URLs
        let imageUrl: string;
        if (wallpaper.startsWith('http')) {
          imageUrl = wallpaper;
          if (!imageUrl.startsWith(window.location.origin)) {
            img.crossOrigin = 'anonymous';
          }
        } else if (wallpaper.startsWith('file://') || wallpaper.startsWith('data:')) {
          imageUrl = wallpaper;
        } else {
          imageUrl = window.location.origin + wallpaper;
        }
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = (err) => {
            console.error('[FrameRenderer] Failed to load background image:', imageUrl, err);
            reject(new Error(`Failed to load background image: ${imageUrl}`));
          };
          img.src = imageUrl;
        });
        
        // Draw the image using cover and center positioning
        const imgAspect = img.width / img.height;
        const canvasAspect = this.config.width / this.config.height;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imgAspect > canvasAspect) {
          drawHeight = this.config.height;
          drawWidth = drawHeight * imgAspect;
          drawX = (this.config.width - drawWidth) / 2;
          drawY = 0;
        } else {
          drawWidth = this.config.width;
          drawHeight = drawWidth / imgAspect;
          drawX = 0;
          drawY = (this.config.height - drawHeight) / 2;
        }
        
        bgCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      } else if (wallpaper.startsWith('#')) {
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      } else if (wallpaper.startsWith('linear-gradient') || wallpaper.startsWith('radial-gradient')) {
        
        const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
        if (gradientMatch) {
          const [, type, params] = gradientMatch;
          const parts = params.split(',').map(s => s.trim());
          
          let gradient: CanvasGradient;
          
          if (type === 'linear') {
            gradient = bgCtx.createLinearGradient(0, 0, 0, this.config.height);
            parts.forEach((part, index) => {
              if (part.startsWith('to ') || part.includes('deg')) return;
              
              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          } else {
            const cx = this.config.width / 2;
            const cy = this.config.height / 2;
            const radius = Math.max(this.config.width, this.config.height) / 2;
            gradient = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            
            parts.forEach((part, index) => {
              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          }
          
          bgCtx.fillStyle = gradient;
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        } else {
          console.warn('[FrameRenderer] Could not parse gradient, using black fallback');
          bgCtx.fillStyle = '#000000';
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        }
      } else {
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      }
    } catch (error) {
      console.error('[FrameRenderer] Error setting up background, using fallback:', error);
      bgCtx.fillStyle = '#000000';
      bgCtx.fillRect(0, 0, this.config.width, this.config.height);
    }

    // Store the background canvas for compositing
    this.backgroundSprite = bgCanvas as any;
  }

  async renderFrame(videoFrame: VideoFrame, timestamp: number): Promise<void> {
    if (!this.app || !this.videoContainer || !this.cameraContainer) {
      throw new Error('Renderer not initialized');
    }

    this.currentVideoTime = timestamp / 1000000;

    // Create or update video sprite from VideoFrame.
    // Use ImageSource directly to bypass Pixi's global texture cache —
    // Texture.from() would pollute the shared cache and corrupt the editor's
    // VideoPlayback Pixi instance when textures are destroyed after export.
    const newSource = new ImageSource({ resource: videoFrame as any });
    const newTexture = new Texture({ source: newSource });

    if (!this.videoSprite) {
      this.videoSprite = new Sprite(newTexture);
      this.videoContainer.addChild(this.videoSprite);
    } else {
      const oldTexture = this.videoSprite.texture;
      this.videoSprite.texture = newTexture;
      // Destroy old texture and its source without touching the global cache
      oldTexture.source.destroy();
      oldTexture.destroy();
    }

    // Apply layout
    this.updateLayout();

    const timeMs = this.currentVideoTime * 1000;
    const motionIntensity = this.updateAnimationState(timeMs);

    // Resolve segment transform for additional rotation/scale/position
    let segmentTransform: import('@/components/video-editor/types').SegmentTransform | undefined;
    const segments = this.config.videoSegments;
    if (segments && segments.length > 0) {
      const seg = findSegmentAtSourceTime(segments, timeMs);
      if (seg) {
        const relativeTime = timeMs - seg.sourceStartMs;
        const resolved = resolveTransformAtTime(seg.keyframes, relativeTime, seg.transform);
        if (resolved.rotation !== 0 || resolved.scaleX !== 1 || resolved.scaleY !== 1 || resolved.positionX !== 0 || resolved.positionY !== 0) {
          // positionX/Y are authored in preview-stage pixels. Rescale them to
          // the export stage so the offset lands in the same relative spot —
          // otherwise a 1080p+ export shows roughly half the shift seen in the
          // preview.
          const previewW = this.config.previewWidth || this.config.width;
          const previewH = this.config.previewHeight || this.config.height;
          segmentTransform = {
            ...resolved,
            positionX: resolved.positionX * (this.config.width / previewW),
            positionY: resolved.positionY * (this.config.height / previewH),
          };
        }
      }
    }

    applyZoomTransform({
      cameraContainer: this.cameraContainer,
      blurFilter: this.blurFilter,
      stageSize: this.layoutCache.stageSize,
      baseMask: this.layoutCache.maskRect,
      zoomScale: this.animationState.scale,
      focusX: this.animationState.focusX,
      focusY: this.animationState.focusY,
      motionIntensity,
      isPlaying: true,
      motionBlurEnabled: this.config.motionBlurEnabled ?? false,
      segmentTransform,
    });

    // Render the PixiJS stage to its canvas (video only, transparent background)
    this.app.renderer.render(this.app.stage);

    // Composite with shadows to final output canvas
    this.compositeWithShadows();

    // Render spotlight dim overlay with fade-in/out
    if (this.config.spotlightRegions && this.config.spotlightRegions.length > 0 && this.compositeCtx) {
      const ctx = this.compositeCtx;
      const w = this.config.width;
      const h = this.config.height;
      for (const spot of this.config.spotlightRegions) {
        const opacity = getSpotlightFadeOpacity(spot, timeMs);
        if (opacity <= 0) continue;

        // Resolve animated values when keyframes exist
        const relTime = timeMs - spot.startMs;
        const resolved = spot.keyframes?.length
          ? resolveSpotlightAtTime(spot.keyframes, relTime, spot)
          : spot;
        const sx = (resolved.x / 100) * w;
        const sy = (resolved.y / 100) * h;
        const sw = (resolved.width / 100) * w;
        const sh = (resolved.height / 100) * h;
        const br = spot.borderRadius;

        ctx.save();
        // Draw dim overlay with cutout using even-odd fill
        ctx.beginPath();
        // Outer rect (clockwise)
        ctx.rect(0, 0, w, h);
        // Inner rect (counter-clockwise) with rounded corners
        if (br > 0) {
          ctx.moveTo(sx + br, sy);
          ctx.lineTo(sx + sw - br, sy);
          ctx.arcTo(sx + sw, sy, sx + sw, sy + br, br);
          ctx.lineTo(sx + sw, sy + sh - br);
          ctx.arcTo(sx + sw, sy + sh, sx + sw - br, sy + sh, br);
          ctx.lineTo(sx + br, sy + sh);
          ctx.arcTo(sx, sy + sh, sx, sy + sh - br, br);
          ctx.lineTo(sx, sy + br);
          ctx.arcTo(sx, sy, sx + br, sy, br);
        } else {
          ctx.rect(sx, sy, sw, sh);
        }
        ctx.fillStyle = `rgba(0,0,0,${opacity})`;
        ctx.fill('evenodd');
        ctx.restore();
      }
    }

    // Render annotations on top if present
    if (this.config.annotationRegions && this.config.annotationRegions.length > 0 && this.compositeCtx) {
      // Calculate scale factor based on export vs preview dimensions
      const previewWidth = this.config.previewWidth || 1920;
      const previewHeight = this.config.previewHeight || 1080;
      const scaleX = this.config.width / previewWidth;
      const scaleY = this.config.height / previewHeight;
      const scaleFactor = (scaleX + scaleY) / 2;

      await renderAnnotations(
        this.compositeCtx,
        this.config.annotationRegions,
        this.config.width,
        this.config.height,
        timeMs,
        scaleFactor,
        this.annotationImageCache
      );
    }

    // Render cursor highlight on top
    if (this.config.cursorData && this.config.cursorHighlight && this.compositeCtx && this.layoutCache) {
      const videoW = this.config.videoWidth;
      const videoH = this.config.videoHeight;
      const { baseScale, baseOffset } = this.layoutCache;
      const { cropRegion } = this.config;
      // Offset accounts for video container position and crop
      const cursorOffX = baseOffset.x - cropRegion.x * videoW * baseScale;
      const cursorOffY = baseOffset.y - cropRegion.y * videoH * baseScale;
      renderCursorHighlight(
        this.compositeCtx,
        this.config.cursorData,
        this.config.cursorHighlight,
        timeMs,
        videoW * baseScale,
        videoH * baseScale,
        cursorOffX,
        cursorOffY,
      );
    }
  }

  private updateLayout(): void {
    if (!this.app || !this.videoSprite || !this.maskGraphics || !this.videoContainer) return;

    const { width, height } = this.config;
    const { cropRegion, borderRadius = 0, videoBorderRadius, padding = 0 } = this.config;
    // Prefer the explicit videoBorderRadius when > 0; fall back to the
    // legacy borderRadius (Roundness slider) otherwise. Using ?? would treat
    // 0 as a valid override and zero out rounding for new projects whose
    // videoBorderRadius default is 0.
    const effectiveVideoRadius = videoBorderRadius && videoBorderRadius > 0
      ? videoBorderRadius
      : borderRadius;
    const videoWidth = this.config.videoWidth;
    const videoHeight = this.config.videoHeight;

    // Calculate cropped video dimensions
    const cropStartX = cropRegion.x;
    const cropStartY = cropRegion.y;
    const cropEndX = cropRegion.x + cropRegion.width;
    const cropEndY = cropRegion.y + cropRegion.height;

    const croppedVideoWidth = videoWidth * (cropEndX - cropStartX);
    const croppedVideoHeight = videoHeight * (cropEndY - cropStartY);
    
    // Calculate scale to fit in viewport
    // Padding is a percentage (0-100), where 50% ~ 0.8 scale
    const paddingScale = 1.0 - (padding / 100) * 0.4;
    const viewportWidth = width * paddingScale;
    const viewportHeight = height * paddingScale;
    const scale = Math.min(viewportWidth / croppedVideoWidth, viewportHeight / croppedVideoHeight);

    // Position video sprite
    this.videoSprite.width = videoWidth * scale;
    this.videoSprite.height = videoHeight * scale;

    const cropPixelX = cropStartX * videoWidth * scale;
    const cropPixelY = cropStartY * videoHeight * scale;
    this.videoSprite.x = -cropPixelX;
    this.videoSprite.y = -cropPixelY;

    // Position video container
    const croppedDisplayWidth = croppedVideoWidth * scale;
    const croppedDisplayHeight = croppedVideoHeight * scale;
    const centerOffsetX = (width - croppedDisplayWidth) / 2;
    const centerOffsetY = (height - croppedDisplayHeight) / 2;
    this.videoContainer.x = centerOffsetX;
    this.videoContainer.y = centerOffsetY;

    // The corner radius is a fraction of the displayed frame's shorter side
    // (see cornerRadius.ts). Because it is resolution-independent, the exported
    // rounded corners match the preview exactly without any canvas-ratio fudge.
    const safeRadius = resolveCornerRadius(effectiveVideoRadius, croppedDisplayWidth, croppedDisplayHeight);

    this.maskGraphics.clear();
    this.maskGraphics.roundRect(0, 0, croppedDisplayWidth, croppedDisplayHeight, safeRadius);
    this.maskGraphics.fill({ color: 0xffffff });

    // Cache layout info
    this.layoutCache = {
      stageSize: { width, height },
      videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
      baseScale: scale,
      baseOffset: { x: centerOffsetX, y: centerOffsetY },
      maskRect: { x: 0, y: 0, width: croppedDisplayWidth, height: croppedDisplayHeight },
    };
  }

  private updateAnimationState(timeMs: number): number {
    if (!this.cameraContainer || !this.layoutCache) return 0;

    const state = this.animationState;
    const prevScale = state.scale;
    const prevFocusX = state.focusX;
    const prevFocusY = state.focusY;

    // Zoom/focus are derived from the active zoom region (single source of
    // truth), matching the live preview exactly. Keyframes only carry manual
    // rotation/scale/position (applied separately via segmentTransform).
    const region = findActiveZoomRegion(this.config.zoomRegions ?? [], timeMs);
    const cam = region ? resolveZoomCameraAtTime(region, timeMs) : IDENTITY_CAMERA;

    state.scale = cam.zoom;
    state.focusX = cam.focusX;
    state.focusY = cam.focusY;

    return Math.max(
      Math.abs(state.scale - prevScale),
      Math.abs(state.focusX - prevFocusX),
      Math.abs(state.focusY - prevFocusY)
    );
  }

  private compositeWithShadows(): void {
    if (!this.compositeCanvas || !this.compositeCtx || !this.app) return;

    const videoCanvas = this.app.canvas as HTMLCanvasElement;
    const ctx = this.compositeCtx;
    const w = this.compositeCanvas.width;
    const h = this.compositeCanvas.height;

    // Clear composite canvas
    ctx.clearRect(0, 0, w, h);

    // Step 1: Draw background layer (with optional blur, not affected by zoom)
    if (this.backgroundSprite) {
      const bgCanvas = this.backgroundSprite as any as HTMLCanvasElement;
      
      if (this.config.showBlur) {
        ctx.save();
        ctx.filter = 'blur(6px)'; // Canvas blur is weaker than CSS
        ctx.drawImage(bgCanvas, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(bgCanvas, 0, 0, w, h);
      }
    } else {
      console.warn('[FrameRenderer] No background sprite found during compositing!');
    }

    // Draw video layer with shadows on top of background
    if (this.config.showShadow && this.config.shadowIntensity > 0 && this.shadowCanvas && this.shadowCtx) {
      const shadowCtx = this.shadowCtx;
      shadowCtx.clearRect(0, 0, w, h);
      shadowCtx.save();
      
      // Calculate shadow parameters based on intensity (0-1)
      const intensity = this.config.shadowIntensity;
      const baseBlur1 = 48 * intensity;
      const baseBlur2 = 16 * intensity;
      const baseBlur3 = 8 * intensity;
      const baseAlpha1 = 0.7 * intensity;
      const baseAlpha2 = 0.5 * intensity;
      const baseAlpha3 = 0.3 * intensity;
      const baseOffset = 12 * intensity;
      
      shadowCtx.filter = `drop-shadow(0 ${baseOffset}px ${baseBlur1}px rgba(0,0,0,${baseAlpha1})) drop-shadow(0 ${baseOffset/3}px ${baseBlur2}px rgba(0,0,0,${baseAlpha2})) drop-shadow(0 ${baseOffset/6}px ${baseBlur3}px rgba(0,0,0,${baseAlpha3}))`;
      shadowCtx.drawImage(videoCanvas, 0, 0, w, h);
      shadowCtx.restore();
      ctx.drawImage(this.shadowCanvas, 0, 0, w, h);
    } else {
      ctx.drawImage(videoCanvas, 0, 0, w, h);
    }
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.compositeCanvas) {
      throw new Error('Renderer not initialized');
    }
    return this.compositeCanvas;
  }


  destroy(): void {
    if (this.videoSprite) {
      // Destroy the current frame texture/source before destroying the sprite
      if (this.videoSprite.texture) {
        this.videoSprite.texture.source.destroy();
        this.videoSprite.texture.destroy();
      }
      this.videoSprite.destroy({ texture: false });
      this.videoSprite = null;
    }
    this.backgroundSprite = null;
    if (this.app) {
      // Do NOT pass textureSource:true — that would destroy Pixi's global
      // texture resources shared with the editor's VideoPlayback instance.
      this.app.destroy(true, { children: true, texture: false, textureSource: false });
      this.app = null;
    }
    this.cameraContainer = null;
    this.videoContainer = null;
    this.maskGraphics = null;
    this.blurFilter = null;
    this.shadowCanvas = null;
    this.shadowCtx = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
  }
}
