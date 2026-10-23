import type { DecodeInfo, VideoMeta } from './probe';

/** Cached frames are scaled so their longer side is at most this many pixels. */
const CACHE_MAX_SIDE = 1280;
/** Rough memory allowed for cached frames (4 bytes per pixel). Halve this for compare. */
export const DEFAULT_CACHE_BYTES = 250e6;
const MIN_FRAMES = 24;

/**
 * Decodes frames around the current position with WebCodecs and keeps them as ImageBitmaps,
 * so stepping (especially backwards) is instant.
 *
 * Frames are decoded a whole GOP (keyframe to keyframe) at a time, because a frame can only be
 * decoded after the frames it depends on. Only frames within the window around `center` are kept.
 */
export class FrameCache {
  /** Size of cached bitmaps (unrotated, like the decoded frames). */
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  broken = false;
  onBroken?: (reason: string) => void;

  private decoder: VideoDecoder;
  private frames = new Map<number, ImageBitmap>();
  private waiters = new Map<number, Array<(bmp: ImageBitmap | null) => void>>();
  private tsToFrame = new Map<number, number>();
  /** Display index → decode index. */
  private sampleOfFrame: Int32Array;
  /** Decode index → decode index of its keyframe. */
  private keyOfSample: Int32Array;
  /** Decode index → decode index of the next keyframe (or sample count). */
  private gopEnd: Int32Array;
  private maxFrames: number;
  /** Frames within this distance of the center are kept. */
  private windowHalf: number;
  /** Missing frames within this distance get decoded. Smaller than windowHalf by a GOP length,
   *  so a decoded GOP fits inside the kept window and edge frames aren't re-decoded every step. */
  private planRadius: number;
  private center = 0;
  private queue: number[] = [];
  private inFlight = -1;
  private busy = false;
  private failedGops = new Set<number>();
  private pendingBitmaps = new Set<Promise<void>>();

  private constructor(
    private file: File,
    private info: DecodeInfo,
    config: VideoDecoderConfig,
    budgetBytes: number,
  ) {
    const scale = Math.min(1, CACHE_MAX_SIDE / Math.max(info.codedWidth, info.codedHeight));
    this.width = Math.round((info.codedWidth * scale) / 2) * 2;
    this.height = Math.round((info.codedHeight * scale) / 2) * 2;
    this.rotation = info.rotation;
    this.maxFrames = Math.max(MIN_FRAMES, Math.floor(budgetBytes / (this.width * this.height * 4)));
    this.windowHalf = Math.floor(this.maxFrames / 2);

    const { samples, timescale } = info;
    const n = samples.length;
    // Display order = sorted by presentation time.
    const order = samples.map((_, i) => i).sort((a, b) => samples[a].cts - samples[b].cts);
    this.sampleOfFrame = Int32Array.from(order);
    order.forEach((sampleIdx, frameIdx) => {
      this.tsToFrame.set(toMicros(samples[sampleIdx].cts, timescale), frameIdx);
    });
    this.keyOfSample = new Int32Array(n);
    this.gopEnd = new Int32Array(n);
    let key = 0;
    for (let i = 0; i < n; i++) {
      if (samples[i].is_sync) key = i;
      this.keyOfSample[i] = key;
    }
    let end = n;
    let maxGop = 1;
    for (let i = n - 1; i >= 0; i--) {
      this.gopEnd[i] = end;
      if (samples[i].is_sync) {
        maxGop = Math.max(maxGop, end - i);
        end = i;
      }
    }
    this.planRadius = Math.max(2, this.windowHalf - maxGop);

    this.decoder = new VideoDecoder({
      output: (frame) => this.onFrame(frame),
      error: (e) => this.fail(`decoder error: ${e.message}`),
    });
    this.decoder.configure(config);
  }

  /** Returns null if this browser/phone can't decode the video with WebCodecs. */
  static async create(
    file: File,
    meta: VideoMeta,
    budgetBytes = DEFAULT_CACHE_BYTES,
  ): Promise<{ cache: FrameCache | null; reason?: string }> {
    const info = meta.decode;
    if (!info) return { cache: null, reason: "couldn't read the video's frame table" };
    if (typeof VideoDecoder === 'undefined') return { cache: null, reason: 'WebCodecs not available' };
    const config: VideoDecoderConfig = {
      codec: info.codec,
      description: info.description,
      codedWidth: info.codedWidth,
      codedHeight: info.codedHeight,
      optimizeForLatency: true,
    };
    try {
      const { supported } = await VideoDecoder.isConfigSupported(config);
      if (!supported) return { cache: null, reason: `this phone can't decode ${info.codec} here` };
      return { cache: new FrameCache(file, info, config, budgetBytes) };
    } catch (err) {
      return { cache: null, reason: String(err) };
    }
  }

  get(frame: number): ImageBitmap | undefined {
    return this.frames.get(frame);
  }

  /** Resolves with the frame's bitmap, or null if it couldn't be decoded. */
  request(frame: number): Promise<ImageBitmap | null> {
    const hit = this.frames.get(frame);
    if (hit) {
      this.setCenter(frame);
      return Promise.resolve(hit);
    }
    if (this.broken) return Promise.resolve(null);
    const p = new Promise<ImageBitmap | null>((resolve) => {
      const list = this.waiters.get(frame) ?? [];
      list.push(resolve);
      this.waiters.set(frame, list);
    });
    this.setCenter(frame);
    return p;
  }

  /** Move the cache window: drop far frames, start decoding missing nearby ones. */
  setCenter(frame: number) {
    this.center = frame;
    // Stale waiters (user has moved on) resolve as null so they don't pile up.
    for (const [f, list] of this.waiters) {
      if (Math.abs(f - frame) > this.windowHalf) {
        this.waiters.delete(f);
        list.forEach((r) => r(null));
      }
    }
    for (const f of [...this.frames.keys()]) {
      if (Math.abs(f - frame) > this.windowHalf) this.evict(f);
    }
    this.planQueue();
  }

  dispose() {
    this.broken = true;
    try {
      this.decoder.close();
    } catch {
      /* already closed */
    }
    this.frames.forEach((b) => b.close());
    this.frames.clear();
    this.waiters.forEach((list) => list.forEach((r) => r(null)));
    this.waiters.clear();
  }

  // ---------- internals ----------

  private gopOfFrame(frame: number): number {
    return this.keyOfSample[this.sampleOfFrame[frame]];
  }

  private wanted(frame: number): boolean {
    return Math.abs(frame - this.center) <= this.windowHalf || this.waiters.has(frame);
  }

  /** Queue GOPs covering missing frames, nearest to the center first. */
  private planQueue() {
    const total = this.sampleOfFrame.length;
    const queue: number[] = [];
    const add = (f: number) => {
      if (f < 0 || f >= total || this.frames.has(f)) return;
      const g = this.gopOfFrame(f);
      if (g !== this.inFlight && !this.failedGops.has(g) && !queue.includes(g)) queue.push(g);
    };
    for (const f of this.waiters.keys()) add(f);
    add(this.center);
    for (let d = 1; d <= this.planRadius; d++) {
      add(this.center - d);
      add(this.center + d);
    }
    this.queue = queue;
    void this.pump();
  }

  private async pump() {
    if (this.busy || this.broken) return;
    this.busy = true;
    try {
      while (this.queue.length && !this.broken) {
        const gop = this.queue.shift()!;
        this.inFlight = gop;
        await this.decodeGop(gop);
        this.inFlight = -1;
      }
    } catch (err) {
      this.fail(String(err));
    } finally {
      this.inFlight = -1;
      this.busy = false;
    }
  }

  private async decodeGop(key: number) {
    const { samples, timescale } = this.info;
    const end = this.gopEnd[key];
    let start = Infinity;
    let stop = 0;
    for (let i = key; i < end; i++) {
      start = Math.min(start, samples[i].offset);
      stop = Math.max(stop, samples[i].offset + samples[i].size);
    }
    // One read covering the whole GOP (it may include some audio, that's fine).
    const bytes = new Uint8Array(await this.file.slice(start, stop).arrayBuffer());
    if (this.broken) return;

    for (let i = key; i < end; i++) {
      const s = samples[i];
      this.decoder.decode(
        new EncodedVideoChunk({
          type: s.is_sync ? 'key' : 'delta',
          timestamp: toMicros(s.cts, timescale),
          duration: toMicros(s.duration, timescale),
          data: bytes.subarray(s.offset - start, s.offset - start + s.size),
        }),
      );
    }
    await this.decoder.flush();
    await Promise.all(this.pendingBitmaps);

    // Anyone still waiting on a frame of this GOP won't get it.
    let missing = false;
    for (const [f, list] of this.waiters) {
      if (this.gopOfFrame(f) === key && !this.frames.has(f)) {
        missing = true;
        this.waiters.delete(f);
        list.forEach((r) => r(null));
      }
    }
    if (missing) this.failedGops.add(key);
  }

  private onFrame(frame: VideoFrame) {
    const idx = this.tsToFrame.get(frame.timestamp);
    if (idx === undefined || this.frames.has(idx) || !this.wanted(idx)) {
      frame.close();
      return;
    }
    const p = createImageBitmap(frame, {
      resizeWidth: this.width,
      resizeHeight: this.height,
      resizeQuality: 'medium',
    })
      .then((bmp) => this.store(idx, bmp))
      .catch((err) => console.warn('createImageBitmap failed', err))
      .finally(() => {
        frame.close();
        this.pendingBitmaps.delete(p);
      });
    this.pendingBitmaps.add(p);
  }

  private store(idx: number, bmp: ImageBitmap) {
    if (this.broken || !this.wanted(idx)) {
      bmp.close();
      return;
    }
    this.frames.set(idx, bmp);
    const list = this.waiters.get(idx);
    if (list) {
      this.waiters.delete(idx);
      list.forEach((r) => r(bmp));
    }
    // Over budget: drop the frames farthest from the center.
    while (this.frames.size > this.maxFrames) {
      let far = -1;
      let farDist = -1;
      for (const f of this.frames.keys()) {
        const d = Math.abs(f - this.center);
        if (d > farDist) {
          far = f;
          farDist = d;
        }
      }
      if (far === idx) break;
      this.evict(far);
    }
  }

  private evict(frame: number) {
    this.frames.get(frame)?.close();
    this.frames.delete(frame);
  }

  private fail(reason: string) {
    if (this.broken) return;
    console.warn('Frame cache disabled:', reason);
    this.broken = true;
    this.waiters.forEach((list) => list.forEach((r) => r(null)));
    this.waiters.clear();
    this.onBroken?.(reason);
  }
}

function toMicros(t: number, timescale: number): number {
  return Math.round((t * 1e6) / timescale);
}
