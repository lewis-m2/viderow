import type { FrameCache } from './frameCache';
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
  private zoomed = false;
  private sharpenTimer = 0;

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
   * Cached frames are stored smaller than the video. When zoomed in, once stepping pauses we
   * seek the real video to the same frame and reveal it, so the picture is sharp.
   */
  setZoomed(zoomed: boolean) {
    this.zoomed = zoomed;
    if (zoomed) this.scheduleSharpen();
    else clearTimeout(this.sharpenTimer);
  }

  setCache(cache: FrameCache | null) {
    this.cache = cache;
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
    clearTimeout(this.sharpenTimer);
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
    const bmp = cache.get(frame) ?? (await cache.request(frame));
    if (this.target !== frame) return; // user has moved on
    if (bmp) {
      cache.setCenter(frame);
      this.draw(bmp);
      this.shown = frame;
      this.onChange(frame, false);
      this.scheduleSharpen();
    } else {
      // Couldn't decode this one; show it via the video instead.
      this.seekVideo(frame);
    }
  }

  private draw(bmp: ImageBitmap) {
    const c = this.canvas;
    const rot = this.cache!.rotation;
    const sideways = rot === 90 || rot === 270;
    const w = sideways ? bmp.height : bmp.width;
    const h = sideways ? bmp.width : bmp.height;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (rot === 90) ctx.setTransform(0, 1, -1, 0, w, 0);
    else if (rot === 180) ctx.setTransform(-1, 0, 0, -1, w, h);
    else if (rot === 270) ctx.setTransform(0, -1, 1, 0, 0, h);
    ctx.drawImage(bmp, 0, 0);
    c.style.visibility = 'visible';
    this.showingFrames = true;
  }

  private scheduleSharpen() {
    clearTimeout(this.sharpenTimer);
    if (!this.zoomed || !this.showingFrames) return;
    const frame = this.target;
    const stillHere = () => this.target === frame && this.shown === frame && this.showingFrames;
    this.sharpenTimer = window.setTimeout(() => {
      if (!stillHere() || !this.video.paused) return;
      this.video.addEventListener(
        'seeked',
        () => {
          if (!stillHere()) return;
          // Wait until the video has actually painted the frame, then reveal it.
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
    }, 250);
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
