/** Longest recording allowed. */
export const MAX_RECORD_SECONDS = 120;
/** Recordings are drawn at this size on their longer side (smaller files, smooth on phones). */
const RECORD_MAX_SIDE = 1280;
const RECORD_FPS = 30;
const VIDEO_BITRATE = 2_500_000;
const AUDIO_BITRATE = 96_000;

/** MP4 first: WhatsApp plays it reliably. WebM only if MP4 isn't available. */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export interface Recording {
  blob: Blob;
  url: string;
  mimeType: string;
  seconds: number;
  fileName: string;
}

interface Options {
  /** Size of the area being recorded (CSS px) at the moment. */
  getSize: () => { W: number; H: number };
  /** Draw the recorded area (in CSS px, 0..W × 0..H) into ctx. */
  paint: (ctx: CanvasRenderingContext2D) => void;
  voice: boolean;
  onTick: (seconds: number) => void;
  /** Called when recording ends (Stop pressed or time limit). */
  onDone: (rec: Recording) => void;
  onError: (message: string) => void;
  baseName: string;
}

/**
 * Records a canvas that is redrawn ~30 times a second from what's on screen (picture + drawings),
 * plus optional microphone, with MediaRecorder.
 */
export class Recorder {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder | null = null;
  private mic: MediaStream | null = null;
  private chunks: Blob[] = [];
  private raf = 0;
  private started = 0;
  private lastDraw = 0;
  private stopped = false;
  hasMic = false;

  constructor(private o: Options) {
    this.ctx = this.canvas.getContext('2d')!;
  }

  async start() {
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error("This browser can't record video.");
    // Fixed recording size, taken from the area's shape when recording starts.
    const { W, H } = this.o.getSize();
    const scale = Math.min(window.devicePixelRatio || 1, RECORD_MAX_SIDE / Math.max(W, H));
    this.canvas.width = Math.max(2, Math.round((W * scale) / 2) * 2);
    this.canvas.height = Math.max(2, Math.round((H * scale) / 2) * 2);
    this.draw();

    const stream = this.canvas.captureStream(RECORD_FPS);
    if (this.o.voice) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        this.mic.getAudioTracks().forEach((t) => stream.addTrack(t));
        this.hasMic = true;
      } catch (err) {
        console.warn('No microphone', err);
      }
    }

    this.recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onerror = (e) => this.o.onError(String((e as ErrorEvent).message ?? 'recording error'));
    this.recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const seconds = Math.min(MAX_RECORD_SECONDS, (performance.now() - this.started) / 1000);
      const type = mimeType.split(';')[0];
      const blob = new Blob(this.chunks, { type });
      const ext = type === 'video/mp4' ? 'mp4' : 'webm';
      this.o.onDone({
        blob,
        url: URL.createObjectURL(blob),
        mimeType: type,
        seconds,
        fileName: `${this.o.baseName}_breakdown.${ext}`,
      });
    };
    this.started = performance.now();
    this.recorder.start(1000);
    this.loop();
  }

  /** Mute/unmute the voice without stopping the recording. */
  setVoice(on: boolean) {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else this.mic?.getTracks().forEach((t) => t.stop());
  }

  /** Stop and throw the result away (e.g. leaving the screen). */
  discard() {
    this.o.onDone = (rec) => URL.revokeObjectURL(rec.url);
    this.stop();
  }

  private loop = () => {
    if (this.stopped) return;
    const now = performance.now();
    const seconds = (now - this.started) / 1000;
    if (seconds >= MAX_RECORD_SECONDS) {
      this.o.onTick(MAX_RECORD_SECONDS);
      this.stop();
      return;
    }
    if (now - this.lastDraw >= 1000 / RECORD_FPS - 2) {
      this.lastDraw = now;
      this.draw();
      this.o.onTick(seconds);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Draw the area into the recording canvas, fitted (it may change shape if the phone turns). */
  private draw() {
    const { W, H } = this.o.getSize();
    const c = this.canvas;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    if (!W || !H) return;
    const f = Math.min(c.width / W, c.height / H);
    ctx.setTransform(f, 0, 0, f, (c.width - W * f) / 2, (c.height - H * f) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    this.o.paint(ctx);
    ctx.restore();
  }
}
