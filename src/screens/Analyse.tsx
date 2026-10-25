import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenVideo } from '../App';
import {
  IconAngle,
  IconArrow,
  IconBack,
  IconCamera,
  IconMic,
  IconMicOff,
  IconRecord,
  IconStop,
  IconDraw,
  IconErase,
  IconLine,
  IconPan,
  IconTrash,
  IconUndo,
  IconCollapse,
  IconExpand,
  IconFrameBack,
  IconFrameForward,
  IconHome,
  IconToolsHide,
  IconToolsShow,
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
import { MAX_ZOOM, MIN_ZOOM, useZoom, type View } from '../useZoom';
import { useDrawing } from '../drawing/useDrawing';
import { DrawingPanel } from '../drawing/DrawingPanel';
import type { Tool } from '../drawing/model';
import { makeSnapshot, type Snapshot } from '../snapshots';
import { SnapshotScreen } from './SnapshotScreen';
import { RecordingScreen } from './RecordingScreen';
import { MAX_RECORD_SECONDS, Recorder, type Recording } from '../recording/recorder';

/** Snapshots are rendered at the screen's pixel density, capped to keep files reasonable. */
const SNAPSHOT_MAX_DPR = 3;
const SNAPSHOT_QUALITY = 0.9;

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

const TOOLS: Array<{ tool: Tool; label: string; icon: () => preact.JSX.Element }> = [
  { tool: 'move', label: 'Pan', icon: () => <IconPan /> },
  { tool: 'line', label: 'Line', icon: () => <IconLine /> },
  { tool: 'angle', label: 'Angle', icon: () => <IconAngle /> },
  { tool: 'free', label: 'Draw', icon: () => <IconDraw /> },
  { tool: 'arrow', label: 'Arrow', icon: () => <IconArrow /> },
  { tool: 'erase', label: 'Erase', icon: () => <IconErase /> },
];

type StepMode = { kind: 'checking' } | { kind: 'fast' } | { kind: 'basic'; reason: string };

interface Props {
  video: OpenVideo;
  onBack: () => void;
  snapshots: Snapshot[];
  setSnapshots: (update: (prev: Snapshot[]) => Snapshot[]) => void;
}

export function Analyse({ video, onBack, snapshots, setSnapshots }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<() => View>(() => ({ vw: 0, vh: 0, k: 1, ox: 0, oy: 0 }));
  const [panelOpen, setPanelOpen] = useState(false);
  const [toolsHidden, setToolsHidden] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  /** Whole seconds recorded so far, or null when not recording. */
  const [recSeconds, setRecSeconds] = useState<number | null>(null);
  const [voice, setVoice] = useState(true);
  const [hasMic, setHasMic] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
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
  const total = frameCount(meta, duration);
  const frameIdx = Math.min(frameIndexAt(meta, time), total - 1);

  const drawing = useDrawing({
    stage: stageRef,
    canvas: drawCanvasRef,
    loupe: loupeRef,
    video: ref,
    frameCanvas: canvasRef,
    getView: () => viewRef.current(),
    frame: frameIdx,
    onDrawStart: () => {
      if (!ref.current!.paused) ref.current!.pause();
    },
  });
  const zoom = useZoom({
    stage: stageRef,
    layer: layerRef,
    video: ref,
    onTap: showOverlay ? showScrub : undefined,
    onChange: () => {
      drawing.requestRender();
      const st = stageRef.current;
      if (st) stepperRef.current?.viewChanged(viewRef.current(), st.clientWidth, st.clientHeight);
    },
    single: drawing.single,
    // Pan mode: one finger moves the picture. Drawing tools: one finger draws.
    oneFingerPan: () => drawingRef.current?.tool === 'move',
  });
  viewRef.current = zoom.view;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;


  // Stepper + frame cache.
  useEffect(() => {
    const stepper = new Stepper(ref.current!, canvasRef.current!, meta, (frame, isWaiting) => {
      setTime(frameTime(meta, frame));
      setWaiting(isWaiting);
    });
    stepperRef.current = stepper;
    const st = stageRef.current!;
    stepper.viewChanged(viewRef.current(), st.clientWidth, st.clientHeight);
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
      if ((e.target as HTMLElement).closest?.('input, textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') drawingRef.current.undo();
      else if (e.code === 'Space') togglePlay();
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

  /**
   * Paint the stage as seen (picture at the current zoom + drawings) into ctx, in stage CSS px.
   * `live` copies the drawing layer as-is (includes a stroke being drawn, for recordings);
   * otherwise drawings are redrawn cleanly (for snapshots).
   */
  function paintStage(ctx: CanvasRenderingContext2D, live: boolean) {
    const stage = stageRef.current!;
    const v = ref.current!;
    const fc = canvasRef.current!;
    const view = zoom.view();
    if (!view.vw) return;
    // Whichever is on screen: the cached frame (covers the whole picture) or the video.
    const useFrame = fc.style.visibility === 'visible' && fc.width > 0;
    const src: CanvasImageSource = useFrame ? fc : v;
    const sw = useFrame ? fc.width : v.videoWidth;
    const sh = useFrame ? fc.height : v.videoHeight;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(src, 0, 0, sw, sh, view.ox, view.oy, view.vw * view.k, view.vh * view.k);
    } catch {
      /* video not ready */
    }
    if (live) {
      const dc = drawCanvasRef.current!;
      if (dc.width) ctx.drawImage(dc, 0, 0, stage.clientWidth, stage.clientHeight);
    } else {
      drawing.paintExport(ctx, view);
    }
  }

  /** Render exactly what's on screen (picture at the current zoom + drawings) to a JPEG. */
  function captureView(): Promise<Blob> {
    const stage = stageRef.current!;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, SNAPSHOT_MAX_DPR);
    const out = document.createElement('canvas');
    out.width = Math.round(W * dpr);
    out.height = Math.round(H * dpr);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStage(ctx, false);
    return new Promise((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make image'))), 'image/jpeg', SNAPSHOT_QUALITY),
    );
  }

  async function takeSnapshot() {
    const v = ref.current!;
    if (!v.paused) v.pause();
    try {
      const snap = makeSnapshot(await captureView(), video.name, frameIdx);
      setSnapshots((prev) => [...prev, snap]);
      setSnapshotId(snap.id);
    } catch (err) {
      alert(`Couldn't take snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function startRecording() {
    if (recorderRef.current) return;
    const rec = new Recorder({
      getSize: () => {
        const st = stageRef.current;
        return { W: st?.clientWidth ?? 0, H: st?.clientHeight ?? 0 };
      },
      paint: (ctx) => paintStage(ctx, true),
      voice,
      baseName: video.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'video',
      onTick: (secs) => {
        const whole = Math.floor(secs);
        setRecSeconds((prev) => (prev === whole ? prev : whole));
      },
      onDone: (result) => {
        recorderRef.current = null;
        setRecSeconds(null);
        setRecording(result);
      },
      onError: (msg) => alert(`Recording problem: ${msg}`),
    });
    recorderRef.current = rec;
    setRecSeconds(0);
    try {
      await rec.start();
      setHasMic(rec.hasMic);
      rec.setVoice(voice);
    } catch (err) {
      recorderRef.current = null;
      setRecSeconds(null);
      alert(`Couldn't start recording: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function toggleVoice() {
    const next = !voice;
    setVoice(next);
    recorderRef.current?.setVoice(next);
  }

  // Leaving the video mid-recording throws the recording away.
  useEffect(() => () => recorderRef.current?.discard(), []);

  const isRecording = recSeconds !== null;
  const recordButton = (cls = '') => (
    <button
      class={`icon-button record-button ${isRecording ? 'is-recording' : ''} ${cls}`}
      onClick={isRecording ? stopRecording : startRecording}
      aria-label={isRecording ? 'Stop recording' : 'Record'}
    >
      {isRecording ? <IconStop /> : <IconRecord />}
    </button>
  );
  const fmtSecs = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

  const snapshotButton = (cls = '') => (
    <button class={`icon-button ${cls}`} onClick={takeSnapshot} aria-label="Take snapshot">
      <IconCamera />
    </button>
  );

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
      class={[
        'analyse',
        landscape ? 'is-landscape' : 'is-portrait',
        showOverlay ? 'is-collapsed' : '',
        landscape && toolsHidden ? 'is-tools-hidden' : '',
      ].join(' ')}
      // Stop Chrome's long-press menu (Download video / Copy video frame).
      onContextMenu={(e) => e.preventDefault()}
    >
      <header class="topbar">
        <button class="icon-button" onClick={onBack} aria-label="Back">
          <IconBack />
        </button>
        <button class="topbar-title" onClick={showDetails}>
          <div class="video-name">{video.name}</div>
          <div class="muted small">{fpsLabel}</div>
        </button>
        {snapshotButton()}
        {recordButton()}
      </header>

      <div class={`stage ${isRecording ? 'is-recording' : ''}`} ref={stageRef}>
        {/* One transform moves the video and the cached frame together. */}
        <div class="zoom-layer" ref={layerRef}>
          <video ref={ref} src={video.url} playsInline preload="auto" disablePictureInPicture />
          <canvas ref={canvasRef} class="frame-canvas" />
        </div>
        {/* Drawings sit outside the zoom layer so lines stay crisp; they're mapped through the zoom. */}
        <canvas ref={drawCanvasRef} class="draw-canvas" />
        <canvas ref={loupeRef} class="loupe" />
        {isRecording && (
          // On top of the video but not part of the recording.
          <div class="rec-bar">
            <span class="rec-pill">
              <span class="rec-dot" />
              REC {fmtSecs(recSeconds)} / {fmtSecs(MAX_RECORD_SECONDS)}
            </span>
            <button
              class={`rec-voice ${voice && hasMic ? 'is-on' : ''}`}
              onClick={toggleVoice}
              disabled={!hasMic}
              aria-label={voice && hasMic ? 'Voice on (tap to mute)' : 'Voice off'}
            >
              {voice && hasMic ? <IconMic /> : <IconMicOff />}
              <span>{!hasMic ? 'No mic' : voice ? 'Voice on' : 'Voice off'}</span>
            </button>
            <button class="rec-stop" onClick={stopRecording} aria-label="Stop recording">
              <IconStop />
              <span>Stop</span>
            </button>
          </div>
        )}
        {landscape && toolsHidden && (
          <button class="tools-tab" onClick={() => setToolsHidden(false)} aria-label="Show drawing tools">
            <IconToolsShow />
          </button>
        )}
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
            <ScrubStrip
              frame={frameIdx}
              onStart={() => stepperRef.current?.current() ?? frameIdx}
              onMove={(f) => stepperRef.current?.goTo(f)}
              onActivity={showScrub}
            />
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
          <div class="panel-head">
            <button class="icon-button" onClick={onBack} aria-label="Back to videos">
              <IconHome />
            </button>
            {snapshotButton('panel-snapshot')}
            {recordButton('panel-snapshot')}
            <button class="icon-button" onClick={() => setCollapsed(true)} aria-label="Hide panel">
              <IconCollapse />
            </button>
          </div>
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

      <nav class="tools" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <button
            class={`tool ${drawing.tool === t.tool ? 'is-selected' : ''}`}
            aria-pressed={drawing.tool === t.tool}
            aria-label={t.label}
            onClick={() => drawing.setTool(t.tool)}
          >
            {t.icon()}
            <span class="tool-label">{t.label}</span>
          </button>
        ))}
        <button class="tool" onClick={drawing.undo} disabled={!drawing.canUndo} aria-label="Undo">
          <IconUndo />
          <span class="tool-label">Undo</span>
        </button>
        <button
          class="tool tool-clear"
          onClick={drawing.clearAll}
          disabled={!drawing.drawings.length}
          aria-label="Clear all"
        >
          <IconTrash />
          <span class="tool-label">Clear</span>
        </button>
        <button
          class={`tool ${panelOpen ? 'is-selected' : ''}`}
          onClick={() => setPanelOpen(!panelOpen)}
          aria-label="Colour and drawing options"
        >
          <span class="swatch-icon" style={{ background: drawing.colour }} />
          <span class="tool-label">Colour</span>
        </button>
        {landscape && (
          <button class="tool tool-hide" onClick={() => setToolsHidden(true)} aria-label="Hide drawing tools">
            <IconToolsHide />
          </button>
        )}
      </nav>

      {panelOpen && (
        <DrawingPanel
          colour={drawing.colour}
          thickness={drawing.thickness}
          scope={drawing.scope}
          onStyle={drawing.restyle}
          drawings={drawing.visible}
          total={drawing.drawings.length}
          selectedId={drawing.selectedId}
          onSelect={drawing.select}
          onDelete={drawing.remove}
          onClearAll={drawing.clearAll}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {snapshotId && snapshots.length > 0 && (
        <SnapshotScreen
          snapshots={snapshots}
          currentId={snapshotId}
          onSelect={setSnapshotId}
          onNote={(id, note) =>
            setSnapshots((prev) => prev.map((x) => (x.id === id ? { ...x, note } : x)))
          }
          onDelete={(id) => {
            const gone = snapshots.find((x) => x.id === id);
            if (gone) URL.revokeObjectURL(gone.url);
            const rest = snapshots.filter((x) => x.id !== id);
            setSnapshots(() => rest);
            setSnapshotId(rest.length ? rest[rest.length - 1].id : null);
          }}
          onClose={() => setSnapshotId(null)}
        />
      )}

      {recording && (
        <RecordingScreen
          recording={recording}
          onClose={() => {
            URL.revokeObjectURL(recording.url);
            setRecording(null);
          }}
        />
      )}

      {showOverlay && (
        <section class="mini-controls">
          <button class="icon-button" onClick={() => setCollapsed(false)} aria-label="Show panel">
            <IconExpand />
          </button>
          {backButton()}
          {playButton('')}
          {forwardButton()}
          {snapshotButton()}
          {recordButton()}
          <button class="icon-button mini-home" onClick={onBack} aria-label="Back to videos">
            <IconHome />
          </button>
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
  /** Called while in use (keeps the fading overlay visible). */
  onActivity?: () => void;
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
        props.onActivity?.();
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
          props.onActivity?.();
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
