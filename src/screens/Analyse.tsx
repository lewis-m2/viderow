import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenVideo } from '../App';
import {
  IconBack,
  IconCollapse,
  IconExpand,
  IconFrameBack,
  IconFrameForward,
  IconMinus,
  IconPause,
  IconPlay,
  IconPlus,
} from '../icons';
import { formatCount, formatFps, formatLength, formatTime } from '../format';
import { frameCount, frameIndexAt, frameTime } from '../video/probe';
import { FrameCache } from '../video/frameCache';
import { Stepper } from '../video/stepper';
import { useMediaQuery } from '../useMediaQuery';
import { MAX_ZOOM, MIN_ZOOM, useZoom } from '../useZoom';

const SPEEDS = [
  { rate: 1, label: '1×' },
  { rate: 0.5, label: '½×' },
  { rate: 0.25, label: '¼×' },
  { rate: 0.125, label: '⅛×' },
];

const SCRUB_FADE_MS = 3000;
/** Hold a frame button this long before it starts repeating, then step this often. */
const HOLD_DELAY_MS = 350;
const HOLD_REPEAT_MS = 70;
/** Finger travel on the scrub strip for one frame. */
const STRIP_PX_PER_FRAME = 14;
/** Each tap of − / + zooms by this factor. */
const ZOOM_STEP = 1.5;
/** At or above this zoom, a paused cached frame is swapped for the sharper video frame. */
const SHARPEN_ZOOM = 1.5;

type StepMode = { kind: 'checking' } | { kind: 'fast' } | { kind: 'basic'; reason: string };

interface Props {
  video: OpenVideo;
  onBack: () => void;
}

export function Analyse({ video, onBack }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const stepperRef = useRef<Stepper | null>(null);
  const [time, setTime] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [collapsed, setCollapsed] = useState(false);
  const [scrubVisible, setScrubVisible] = useState(true);
  const [status, setStatus] = useState<'loading' | 'ready' | string>('loading');
  const [stepMode, setStepMode] = useState<StepMode>({ kind: 'checking' });
  const fadeTimer = useRef<number | undefined>(undefined);
  const landscape = useMediaQuery('(orientation: landscape)');
  const { meta } = video;
  const showOverlay = landscape && collapsed;
  const zoom = useZoom({
    stage: stageRef,
    layer: layerRef,
    video: ref,
    onTap: showOverlay ? showScrub : undefined,
  });

  useEffect(() => {
    stepperRef.current?.setZoomed(zoom.scale >= SHARPEN_ZOOM);
  }, [zoom.scale]);

  // Stepper + frame cache.
  useEffect(() => {
    const stepper = new Stepper(ref.current!, canvasRef.current!, meta, (frame, isWaiting) => {
      setTime(frameTime(meta, frame));
      setWaiting(isWaiting);
    });
    stepperRef.current = stepper;
    let cache: FrameCache | null = null;
    let cancelled = false;
    FrameCache.create(video.file, meta).then(({ cache: c, reason }) => {
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
    const v = ref.current!;
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
    ref.current!.playbackRate = rate;
  }, [rate, duration]);

  // Keyboard (handy when developing on a computer): space plays, arrows step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') togglePlay();
      else if (e.code === 'ArrowLeft') step(-1);
      else if (e.code === 'ArrowRight') step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function togglePlay() {
    const v = ref.current!;
    if (v.paused || v.ended) {
      stepperRef.current?.beforePlay();
      if (v.ended) v.currentTime = 0;
      v.play();
    } else {
      v.pause();
    }
  }

  function step(delta: number) {
    stepperRef.current?.step(delta);
  }

  function seek(t: number) {
    stepperRef.current?.leaveFrames();
    ref.current!.currentTime = t;
    setTime(t);
  }

  // Slim scrub bar over the video (landscape collapsed) fades when unused.
  function showScrub() {
    setScrubVisible(true);
    clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => setScrubVisible(false), SCRUB_FADE_MS);
  }
  useEffect(() => {
    if (landscape && collapsed) showScrub();
    return () => clearTimeout(fadeTimer.current);
  }, [landscape, collapsed]);

  const total = frameCount(meta, duration);
  const frameIdx = Math.min(frameIndexAt(meta, time), total - 1);
  const frameLabel = `Frame ${formatCount(frameIdx + 1)} / ${formatCount(total)} · ${formatTime(time)}`;
  const stepLabel =
    stepMode.kind === 'fast' ? 'fast stepping' : stepMode.kind === 'basic' ? 'basic stepping' : '';
  const fpsLabel = [
    `${meta.fpsEstimated ? '~' : ''}${formatFps(meta.fps)} fps`,
    formatLength(duration),
    stepLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  function showDetails() {
    const lines = [
      videoDetails(video),
      stepMode.kind === 'basic'
        ? `Basic stepping (seeking the video): ${stepMode.reason}`
        : stepMode.kind === 'fast'
          ? 'Fast stepping (frame cache) is on.'
          : 'Checking frame cache…',
    ];
    alert(lines.join('\n\n'));
  }

  const playButton = (cls: string) => (
    <button class={`play-button ${cls}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
      {playing ? <IconPause /> : <IconPlay />}
    </button>
  );
  const backButton = () => (
    <HoldButton class="frame-button" label="Previous frame" onStep={() => step(-1)}>
      <IconFrameBack />
    </HoldButton>
  );
  const forwardButton = () => (
    <HoldButton class="frame-button" label="Next frame" onStep={() => step(1)}>
      <IconFrameForward />
    </HoldButton>
  );

  return (
    <div
      class={`analyse ${landscape ? 'is-landscape' : 'is-portrait'} ${showOverlay ? 'is-collapsed' : ''}`}
    >
      <header class="topbar">
        <button class="icon-button" onClick={onBack} aria-label="Back">
          <IconBack />
        </button>
        <button class="topbar-title" onClick={showDetails}>
          <div class="video-name">{video.name}</div>
          <div class="muted small">{fpsLabel}</div>
        </button>
      </header>

      <div class="stage" ref={stageRef}>
        {/* One transform moves the video and the cached frame together. */}
        <div class="zoom-layer" ref={layerRef}>
          <video ref={ref} src={video.url} playsInline preload="auto" disablePictureInPicture />
          <canvas ref={canvasRef} class="frame-canvas" />
        </div>
        {status !== 'ready' && (
          <div class="stage-message">
            {status === 'loading' ? (
              <p>Loading video…</p>
            ) : (
              <>
                <p>Chrome can't play this video: {status}</p>
                <p class="muted small">{videoDetails(video)}</p>
              </>
            )}
          </div>
        )}
        {showOverlay && (
          <div class={`overlay-scrub ${scrubVisible ? '' : 'is-hidden'}`}>
            <div class={`frame-label small ${waiting ? 'is-waiting' : ''}`}>{frameLabel}</div>
            <Timeline time={time} duration={duration} onSeek={seek} onActivity={showScrub} />
          </div>
        )}
      </div>

      <section class="info">
        <div class={`frame-label ${waiting ? 'is-waiting' : ''}`}>{frameLabel}</div>
        <Timeline time={time} duration={duration} onSeek={seek} />
        <ScrubStrip
          frame={frameIdx}
          onStart={() => stepperRef.current?.current() ?? frameIdx}
          onMove={(f) => stepperRef.current?.goTo(f)}
        />
      </section>

      <section class="controls">
        {landscape && (
          <button
            class="icon-button collapse-button"
            onClick={() => setCollapsed(true)}
            aria-label="Hide panel"
          >
            <IconCollapse />
          </button>
        )}
        <div class="playback-row">
          {backButton()}
          {playButton('is-big')}
          {forwardButton()}
        </div>
        <div class="speeds" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              role="radio"
              aria-checked={rate === s.rate}
              class={`speed ${rate === s.rate ? 'is-selected' : ''}`}
              onClick={() => setRate(s.rate)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div class="zoom-row">
          <button
            class="zoom-button"
            onClick={() => zoom.zoomBy(1 / ZOOM_STEP)}
            disabled={zoom.scale <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <IconMinus />
          </button>
          <span class="zoom-level">{zoom.scale === 1 ? '1×' : `${zoom.scale.toFixed(1)}×`}</span>
          <button
            class="zoom-button"
            onClick={() => zoom.zoomBy(ZOOM_STEP)}
            disabled={zoom.scale >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <IconPlus />
          </button>
        </div>
      </section>

      {showOverlay && (
        <section class="mini-controls">
          <button class="icon-button" onClick={() => setCollapsed(false)} aria-label="Show panel">
            <IconExpand />
          </button>
          {backButton()}
          {playButton('')}
          {forwardButton()}
        </section>
      )}
    </div>
  );
}

function videoDetails({ file, meta }: OpenVideo): string {
  const size = `${(file.size / 1e6).toFixed(0)} MB`;
  const type = file.type || 'unknown type';
  if (meta.fpsEstimated) return `${type} · ${size} · frame info: ${meta.probeError ?? 'unknown'}`;
  return `${type} · ${size} · ${meta.codec} · ${meta.width}×${meta.height} · ${meta.fps.toFixed(2)} fps`;
}

/** Steps once on press, then repeats while held. */
function HoldButton(props: {
  class: string;
  label: string;
  onStep: () => void;
  children: ComponentChildren;
}) {
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
  };
  useEffect(() => stop, []);
  return (
    <button
      class={props.class}
      aria-label={props.label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        stop();
        props.onStep();
        timers.current.delay = window.setTimeout(() => {
          timers.current.repeat = window.setInterval(props.onStep, HOLD_REPEAT_MS);
        }, HOLD_DELAY_MS);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.children}
    </button>
  );
}

/** Drag left/right to move frame by frame; small drags move single frames. */
function ScrubStrip(props: {
  frame: number;
  onStart: () => number;
  onMove: (frame: number) => void;
}) {
  const drag = useRef<{ x: number; base: number; last: number } | null>(null);
  const offset = -((props.frame * STRIP_PX_PER_FRAME) % (STRIP_PX_PER_FRAME * 10));
  const end = () => {
    drag.current = null;
  };
  return (
    <div
      class="scrub-strip"
      role="slider"
      aria-label="Scrub frame by frame"
      aria-valuenow={props.frame + 1}
      style={{ '--offset': `${offset}px`, '--tick': `${STRIP_PX_PER_FRAME}px` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const base = props.onStart();
        drag.current = { x: e.clientX, base, last: base };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // Drag left = forward in time, like pulling film through.
        const f = d.base + Math.round((d.x - e.clientX) / STRIP_PX_PER_FRAME);
        if (f !== d.last) {
          d.last = f;
          props.onMove(f);
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div class="scrub-marker" />
    </div>
  );
}

interface TimelineProps {
  time: number;
  duration: number;
  onSeek: (t: number) => void;
  onActivity?: () => void;
}

function Timeline({ time, duration, onSeek, onActivity }: TimelineProps) {
  const pct = duration > 0 ? (time / duration) * 100 : 0;
  return (
    <input
      class="timeline"
      type="range"
      min={0}
      max={duration || 0}
      step="any"
      value={time}
      style={{ '--pct': `${pct}%` }}
      aria-label="Timeline"
      onInput={(e) => {
        onSeek(Number((e.currentTarget as HTMLInputElement).value));
        onActivity?.();
      }}
      onPointerDown={onActivity}
    />
  );
}
