import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenVideo } from '../App';
import { frameCount, frameIndexAt, frameTime } from './probe';
import { DEFAULT_CACHE_BYTES, FrameCache } from './frameCache';
import { Stepper } from './stepper';
import { useZoom, type View } from '../useZoom';
import { useDrawing, type DrawingSettings } from '../drawing/useDrawing';
import { saveDrawings, updateRecent } from '../library';

/** Thumbnail for the recent list (stored with the video). */
const THUMB_W = 192;
const THUMB_H = 108;
const THUMB_DELAY_MS = 1000;
const SAVE_DRAWINGS_DELAY_MS = 400;

export type StepMode = { kind: 'checking' } | { kind: 'fast' } | { kind: 'basic'; reason: string };

export interface PaneOptions {
  video: OpenVideo;
  settings: DrawingSettings;
  soundOn: boolean;
  /** Memory for this video's frame cache (Compare gives each video half). */
  cacheBytes?: number;
  /** Single tap on the picture. */
  onTap?: () => void;
  /** Called after each drawing change. */
  onCommit?: () => void;
  /** Save drawings and thumbnail to the library (off when the same video is open twice). */
  persist?: boolean;
}

/**
 * Everything one video needs: the <video>, frame cache + stepping, zoom/pan, drawings
 * (saved to the phone) and painting the picture for snapshots/recordings.
 * Render its picture with <PaneStage pane={pane} />.
 */
export function useVideoPane(o: PaneOptions) {
  const { video, settings } = o;
  const { meta } = video;
  const persist = o.persist ?? true;
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<() => View>(() => ({ vw: 0, vh: 0, k: 1, ky: 1, ox: 0, oy: 0 }));
  const stepperRef = useRef<Stepper | null>(null);

  const [time, setTime] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | string>('loading');
  const [stepMode, setStepMode] = useState<StepMode>({ kind: 'checking' });
  const total = frameCount(meta, duration);
  const frameIdx = Math.min(frameIndexAt(meta, time), total - 1);

  const drawing = useDrawing({
    stage: stageRef,
    canvas: drawCanvasRef,
    loupe: loupeRef,
    video: videoRef,
    frameCanvas: frameCanvasRef,
    getView: () => viewRef.current(),
    frame: frameIdx,
    onDrawStart: () => {
      if (!videoRef.current!.paused) videoRef.current!.pause();
    },
    initial: video.drawings,
    settings,
    onCommit: o.onCommit,
  });
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  const zoom = useZoom({
    stage: stageRef,
    layer: layerRef,
    video: videoRef,
    onTap: o.onTap,
    onChange: () => {
      drawingRef.current.requestRender();
      const st = stageRef.current;
      if (st) stepperRef.current?.viewChanged(viewRef.current(), st.clientWidth, st.clientHeight);
    },
    single: drawing.single,
    // Pan mode: one finger moves the picture. Drawing tools: one finger draws.
    oneFingerPan: () => settingsRef.current.tool === 'move',
  });
  viewRef.current = zoom.view;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    videoRef.current!.muted = !o.soundOn;
  }, [o.soundOn]);

  // Save drawings to the phone shortly after each change (and when leaving).
  const savedDrawings = useRef(video.drawings);
  useEffect(() => {
    if (!persist || drawing.drawings === savedDrawings.current) return;
    const list = drawing.drawings;
    const t = setTimeout(() => {
      savedDrawings.current = list;
      saveDrawings(video.id, list).catch((err) => console.warn('Could not save drawings', err));
    }, SAVE_DRAWINGS_DELAY_MS);
    return () => {
      clearTimeout(t);
      if (savedDrawings.current !== list) {
        savedDrawings.current = list;
        saveDrawings(video.id, list).catch(() => {});
      }
    };
  }, [drawing.drawings]);

  // Stepper + frame cache.
  useEffect(() => {
    const stepper = new Stepper(videoRef.current!, frameCanvasRef.current!, meta, (frame, isWaiting) => {
      setTime(frameTime(meta, frame));
      setWaiting(isWaiting);
    });
    stepperRef.current = stepper;
    const st = stageRef.current!;
    stepper.viewChanged(viewRef.current(), st.clientWidth, st.clientHeight);
    let cache: FrameCache | null = null;
    let cancelled = false;
    FrameCache.create(video.file, meta, o.cacheBytes ?? DEFAULT_CACHE_BYTES).then(({ cache: c, reason }) => {
      if (cancelled) {
        c?.dispose();
        return;
      }
      cache = c;
      if (c) {
        c.onBroken = (why) => setStepMode({ kind: 'basic', reason: why });
        setStepMode({ kind: 'fast' });
      } else {
        setStepMode({ kind: 'basic', reason: reason ?? 'unknown' });
      }
      stepper.setCache(c);
    });
    return () => {
      cancelled = true;
      stepper.dispose();
      cache?.dispose();
    };
  }, []);

  // Video events. While stepping, the stepper owns the frame/time display.
  useEffect(() => {
    const v = videoRef.current!;
    const stepping = () => stepperRef.current?.stepping ?? false;
    let handle = 0;
    const onFrame: VideoFrameRequestCallback = (_now, md) => {
      if (!stepping()) setTime(md.mediaTime);
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);

    let prefetchTimer = 0;
    const sync = () => {
      setPlaying(!v.paused && !v.ended);
      if (v.paused && !stepping()) {
        setTime(v.currentTime);
        // Get frames around the paused point ready for stepping.
        clearTimeout(prefetchTimer);
        prefetchTimer = window.setTimeout(() => stepperRef.current?.prefetch(), 150);
      }
    };
    const onMeta = () => setDuration(v.duration);
    const onLoaded = () => setStatus('ready');
    const onError = () => {
      const e = v.error;
      const kinds = ['', 'loading was stopped', 'network/file read error', 'decoding failed', 'format not supported'];
      setStatus(`${kinds[e?.code ?? 0] ?? 'unknown error'}${e?.message ? ` (${e.message})` : ''}`);
    };
    const events = ['play', 'pause', 'ended', 'seeked', 'loadeddata'] as const;
    events.forEach((e) => v.addEventListener(e, sync));
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('error', onError);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    return () => {
      clearTimeout(prefetchTimer);
      v.cancelVideoFrameCallback(handle);
      events.forEach((e) => v.removeEventListener(e, sync));
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('error', onError);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
    };
  }, []);

  useEffect(() => {
    videoRef.current!.playbackRate = rate;
  }, [rate, duration]);

  // Length and frame rate for the recent list.
  useEffect(() => {
    if (persist && duration > 0) updateRecent(video.id, { duration, fps: meta.fps }).catch(() => {});
  }, [duration]);

  /**
   * Paint the stage as seen (picture at the current zoom + drawings) into ctx, in stage CSS px.
   * `live` copies the drawing layer as-is (includes a stroke being drawn, for recordings);
   * otherwise drawings are redrawn cleanly (for snapshots).
   */
  function paintStage(ctx: CanvasRenderingContext2D, live: boolean) {
    const stage = stageRef.current;
    const v = videoRef.current;
    const fc = frameCanvasRef.current;
    if (!stage || !v || !fc) return;
    const view = zoom.view();
    if (!view.vw) return;
    // Whichever is on screen: the cached frame (covers the whole picture) or the video.
    const useFrame = fc.style.visibility === 'visible' && fc.width > 0;
    const src: CanvasImageSource = useFrame ? fc : v;
    const sw = useFrame ? fc.width : v.videoWidth;
    const sh = useFrame ? fc.height : v.videoHeight;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(src, 0, 0, sw, sh, view.ox, view.oy, view.vw * view.k, view.vh * view.ky);
    } catch {
      /* video not ready */
    }
    if (live) {
      const dc = drawCanvasRef.current;
      if (dc?.width) ctx.drawImage(dc, 0, 0, stage.clientWidth, stage.clientHeight);
    } else {
      drawing.paintExport(ctx, view);
    }
  }

  /** Small picture of what's on screen (with drawings) for the recent list. */
  function saveThumbnail() {
    const stage = stageRef.current;
    if (!stage || !zoom.view().vw) return;
    const c = document.createElement('canvas');
    c.width = THUMB_W;
    c.height = THUMB_H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);
    // Cover the thumbnail with the middle of the stage.
    const f = Math.max(THUMB_W / stage.clientWidth, THUMB_H / stage.clientHeight);
    ctx.setTransform(f, 0, 0, f, (THUMB_W - stage.clientWidth * f) / 2, (THUMB_H - stage.clientHeight * f) / 2);
    paintStage(ctx, false);
    c.toBlob((b) => b && updateRecent(video.id, { thumb: b }).catch(() => {}), 'image/jpeg', 0.75);
  }

  // Keep the recent-list thumbnail showing where you are (refreshed when things settle).
  useEffect(() => {
    if (!persist || playing || status !== 'ready') return;
    const t = setTimeout(saveThumbnail, THUMB_DELAY_MS);
    return () => clearTimeout(t);
  }, [frameIdx, playing, status, drawing.drawings, zoom.scale]);

  function play() {
    const v = videoRef.current!;
    if (!v.paused && !v.ended) return;
    stepperRef.current?.beforePlay();
    if (v.ended) v.currentTime = 0;
    v.play().catch(() => {});
  }

  function pause() {
    videoRef.current?.pause();
  }

  function togglePlay() {
    const v = videoRef.current!;
    if (v.paused || v.ended) play();
    else pause();
  }

  /** Jump the playing/paused video to time t (timeline drag). */
  function seek(t: number) {
    stepperRef.current?.leaveFrames();
    videoRef.current!.currentTime = t;
    setTime(t);
  }

  return {
    video,
    meta,
    videoRef,
    frameCanvasRef,
    stageRef,
    layerRef,
    drawCanvasRef,
    loupeRef,
    stepperRef,
    time,
    waiting,
    duration,
    playing,
    rate,
    setRate,
    status,
    stepMode,
    total,
    frameIdx,
    drawing,
    zoom,
    paintStage,
    play,
    pause,
    togglePlay,
    seek,
    step: (delta: number) => stepperRef.current?.step(delta),
    goTo: (frame: number) => stepperRef.current?.goTo(frame),
    /** Frame on screen (or being moved to), for starting a strip drag. */
    currentFrame: () => stepperRef.current?.current() ?? frameIdx,
    /** Exact time of what's on screen (for linking two videos). */
    currentTime: () => {
      const s = stepperRef.current;
      return s && s.stepping ? frameTime(meta, s.target) : (videoRef.current?.currentTime ?? 0);
    },
    /** Show the frame at time t (clamped to the video). */
    goToTime: (t: number) => {
      const s = stepperRef.current;
      if (!s) return;
      const clamped = Math.max(0, Math.min(t, (videoRef.current?.duration || 0) - 0.001));
      s.goTo(frameIndexAt(meta, clamped));
    },
  };
}

export type Pane = ReturnType<typeof useVideoPane>;

/** The picture of a pane: video + cached frame (zoomed together), drawings, magnifier. */
export function PaneStage(props: { pane: Pane; class?: string; children?: ComponentChildren }) {
  const { pane } = props;
  return (
    <div class={`stage ${props.class ?? ''}`} ref={pane.stageRef}>
      {/* One transform moves the video and the cached frame together. */}
      <div class="zoom-layer" ref={pane.layerRef}>
        <video ref={pane.videoRef} src={pane.video.url} playsInline preload="auto" disablePictureInPicture muted />
        <canvas ref={pane.frameCanvasRef} class="frame-canvas" />
      </div>
      {/* Drawings sit outside the zoom layer so lines stay crisp; they're mapped through the zoom. */}
      <canvas ref={pane.drawCanvasRef} class="draw-canvas" />
      <canvas ref={pane.loupeRef} class="loupe" />
      {props.children}
    </div>
  );
}

export function videoDetails({ file, meta }: OpenVideo): string {
  const size = `${(file.size / 1e6).toFixed(0)} MB`;
  const type = file.type || 'unknown type';
  if (meta.fpsEstimated) return `${type} · ${size} · frame info: ${meta.probeError ?? 'unknown'}`;
  return `${type} · ${size} · ${meta.codec} · ${meta.width}×${meta.height} · ${meta.fps.toFixed(2)} fps`;
}
