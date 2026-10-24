import type { CacheCrop, CachedFrame, FrameCache } from './frameCache';
import type { View } from '../useZoom';

/** Extra area kept around the visible part when zoomed, as a fraction of the visible size. */
const CROP_MARGIN = 0.15;
/** Wait this long after zooming/panning stops before re-decoding at the new crop. */
const RECROP_DELAY_MS = 200;
import { frameCount, frameIndexAt, seekTimeFor, type VideoMeta } from './probe';

/**
 * Frame stepping. While playing, the <video> is shown. When stepping, frames come from the
 * frame cache and are drawn on a canvas laid exactly over the video. If there's no cache
 * (or a frame can't be decoded) it falls back to seeking the <video> to each frame.
 */
export class Stepper {
  /** Frame the user asked for. */
  target = 0;
  /** True while a cached frame (not the video) is on screen. */
  showingFrames = false;
  private shown = -1;
  private seekTarget = -1;
  private seekIssued = -1;
  private cache: FrameCache | null = null;
  private recropTimer = 0;
  private lastView: { view: View; W: number; H: number } | null = null;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private meta: VideoMeta,
    /** Called whenever the target frame changes, and whether we're waiting for it. */
    private onChange: (frame: number, waiting: boolean) => void,
  ) {
    video.addEventListener('seeked', this.onSeeked);
  }

  /**
   * The zoom/pan or stage size changed. The cache keeps only what's visible, at screen
   * sharpness, so: show the real video for now (it's always sharp and covers everything),
   * then re-decode around the current frame for the new view once things settle.
   */
  viewChanged(view: View, W: number, H: number) {
    this.lastView = { view, W, H };
    if (this.showingFrames) this.revealVideo();
    clearTimeout(this.recropTimer);
    this.recropTimer = window.setTimeout(() => this.applyCrop(), RECROP_DELAY_MS);
  }

  setCache(cache: FrameCache | null) {
    this.cache = cache;
    this.applyCrop();
    this.prefetch();
  }

  /** True while the user is stepping (screen shows a chosen frame rather than the playing video). */
  get stepping(): boolean {
    return this.showingFrames || this.seekTarget >= 0;
  }

  get usingCache(): boolean {
    return !!this.cache && !this.cache.broken;
  }

  /** Frame currently on screen (or being moved to). */
  current(): number {
    if (this.showingFrames || this.seekTarget >= 0) return this.target;
    return this.videoFrame();
  }

  step(delta: number) {
    const from = this.current();
    // Holding a button: don't run more than a couple of frames ahead of what's on screen.
    if (this.shown >= 0 && Math.abs(from + delta - this.shown) > 2 && this.isWaiting()) return;
    this.goTo(from + delta);
  }

  goTo(frame: number) {
    if (!this.video.paused) this.video.pause();
    const total = frameCount(this.meta, this.video.duration || 0);
    frame = Math.max(0, Math.min(total - 1, Math.round(frame)));
    if (this.shown < 0) this.shown = this.current();
    this.target = frame;
    if (this.usingCache) void this.showFromCache(frame);
    else this.seekVideo(frame);
    this.onChange(frame, this.isWaiting());
  }

  /** Call before playing: put the video on the frame we stepped to. */
  beforePlay() {
    if (this.showingFrames) {
      this.video.currentTime = seekTimeFor(this.meta, this.target);
      // Keep the canvas up until the video has the frame, to avoid a flash.
      this.video.requestVideoFrameCallback(() => this.hideCanvas());
    }
    this.seekTarget = -1;
    this.seekIssued = -1;
    this.shown = -1;
  }

  /** Call when the timeline is dragged: the video takes over the screen. */
  leaveFrames() {
    this.hideCanvas();
    this.seekTarget = -1;
    this.seekIssued = -1;
    this.shown = -1;
  }

  /** Decode frames around the paused point so the first step is instant. */
  prefetch() {
    if (this.usingCache && this.video.paused && !this.showingFrames) {
      this.cache!.setCenter(this.videoFrame());
    }
  }

  dispose() {
    clearTimeout(this.recropTimer);
    this.video.removeEventListener('seeked', this.onSeeked);
  }

  // ---------- internals ----------

  private videoFrame() {
    return frameIndexAt(this.meta, this.video.currentTime);
  }

  private isWaiting() {
    return this.shown !== this.target;
  }

  private async showFromCache(frame: number) {
    const cache = this.cache!;
    const f = cache.get(frame) ?? (await cache.request(frame));
    if (this.target !== frame) return; // user has moved on
    if (f) {
      cache.setCenter(frame);
      this.draw(f);
      this.shown = frame;
      this.onChange(frame, false);
    } else {
      // Couldn't decode this one; show it via the video instead.
      this.seekVideo(frame);
    }
  }

  /** Work out the crop (visible area + margin, at screen sharpness) and give it to the cache. */
  private applyCrop() {
    const cache = this.cache;
    const lv = this.lastView;
    if (!cache || !lv || !lv.view.vw) return;
    const { view: v, W, H } = lv;
    const dpr = window.devicePixelRatio || 1;
    // Visible area in displayed-video pixels, plus a margin, kept inside the picture.
    let x0 = Math.max(0, -v.ox / v.k);
    let x1 = Math.min(v.vw, (W - v.ox) / v.k);
    let y0 = Math.max(0, -v.oy / v.k);
    let y1 = Math.min(v.vh, (H - v.oy) / v.k);
    const mx = (x1 - x0) * CROP_MARGIN;
    const my = (y1 - y0) * CROP_MARGIN;
    x0 = Math.max(0, x0 - mx);
    x1 = Math.min(v.vw, x1 + mx);
    y0 = Math.max(0, y0 - my);
    y1 = Math.min(v.vh, y1 + my);
    // Displayed -> unrotated frame coordinates.
    const fw = cache.frameWidth;
    const fh = cache.frameHeight;
    const toFrame = (x: number, y: number): [number, number] => {
      switch (cache.rotation) {
        case 90:
          return [y, fh - x];
        case 180:
          return [fw - x, fh - y];
        case 270:
          return [fw - y, x];
        default:
          return [x, y];
      }
    };
    const [ax, ay] = toFrame(x0, y0);
    const [bx, by] = toFrame(x1, y1);
    const cx0 = Math.floor(Math.max(0, Math.min(ax, bx)));
    const cy0 = Math.floor(Math.max(0, Math.min(ay, by)));
    const cx1 = Math.ceil(Math.min(fw, Math.max(ax, bx)));
    const cy1 = Math.ceil(Math.min(fh, Math.max(ay, by)));
    if (cx1 - cx0 < 2 || cy1 - cy0 < 2) return;
    // Bitmap pixels per frame pixel: as sharp as the screen, never bigger than the source.
    const f = Math.min(1, v.k * dpr);
    const crop: CacheCrop = {
      x: cx0,
      y: cy0,
      w: cx1 - cx0,
      h: cy1 - cy0,
      outW: Math.max(2, Math.round((cx1 - cx0) * f)),
      outH: Math.max(2, Math.round((cy1 - cy0) * f)),
    };
    cache.setCrop(crop);
    if (this.video.paused) cache.setCenter(this.current());
  }

  private draw({ bmp, crop }: CachedFrame) {
    const c = this.canvas;
    const cache = this.cache!;
    const rot = cache.rotation;
    const sideways = rot === 90 || rot === 270;
    // The canvas covers the whole picture (so it lines up with the video); the cached crop
    // is drawn into its place. f = canvas pixels per frame pixel.
    const f = crop.outW / crop.w;
    const fw = Math.round(cache.frameWidth * f);
    const fh = Math.round(cache.frameHeight * f);
    const w = sideways ? fh : fw;
    const h = sideways ? fw : fh;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (rot === 90) ctx.setTransform(0, 1, -1, 0, w, 0);
    else if (rot === 180) ctx.setTransform(-1, 0, 0, -1, w, h);
    else if (rot === 270) ctx.setTransform(0, -1, 1, 0, 0, h);
    ctx.drawImage(bmp, crop.x * f, crop.y * f, crop.w * f, crop.h * f);
    c.style.visibility = 'visible';
    this.showingFrames = true;
  }

  /** Seek the real video to the frame on screen and swap it in once it has painted. */
  private revealVideo() {
    const frame = this.target;
    const stillHere = () => this.target === frame && this.showingFrames;
    if (!this.video.paused) return;
    this.video.addEventListener(
      'seeked',
      () => {
        if (!stillHere()) return;
        let done = false;
        const reveal = () => {
          if (done) return;
          done = true;
          if (stillHere()) this.hideCanvas();
        };
        this.video.requestVideoFrameCallback(reveal);
        setTimeout(reveal, 150);
      },
      { once: true },
    );
    this.video.currentTime = seekTimeFor(this.meta, frame);
  }

  private hideCanvas() {
    this.canvas.style.visibility = 'hidden';
    this.showingFrames = false;
  }

  private seekVideo(frame: number) {
    this.hideCanvas();
    this.seekTarget = frame;
    // One seek at a time; the next one starts when this finishes (see onSeeked).
    if (!this.video.seeking) this.issueSeek(frame);
  }

  private issueSeek(frame: number) {
    this.seekIssued = frame;
    this.video.currentTime = seekTimeFor(this.meta, frame);
  }

  private onSeeked = () => {
    if (this.seekTarget < 0) return;
    // The target moved on while we were seeking: go there next.
    if (this.seekIssued !== this.seekTarget) {
      this.issueSeek(this.seekTarget);
      return;
    }
    this.shown = this.seekTarget;
    this.onChange(this.target, this.isWaiting());
  };
}
