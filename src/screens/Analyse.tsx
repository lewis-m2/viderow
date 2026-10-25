import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenVideo } from '../App';
import {
  IconBack,
  IconCamera,
  IconCollapse,
  IconCompare,
  IconExpand,
  IconFrameBack,
  IconFrameForward,
  IconHome,
  IconMinus,
  IconPause,
  IconPlay,
  IconPlus,
  IconRecord,
  IconSound,
  IconSoundOff,
  IconStop,
  IconToolsShow,
} from '../icons';
import { formatCount, formatFps, formatLength, formatTime } from '../format';
import { useMediaQuery } from '../useMediaQuery';
import { MAX_ZOOM, MIN_ZOOM } from '../useZoom';
import { useDrawingSettings } from '../drawing/useDrawing';
import { DrawingPanel } from '../drawing/DrawingPanel';
import type { Drawing } from '../drawing/model';
import { makeSnapshot, type Snapshot } from '../snapshots';
import { SnapshotScreen } from './SnapshotScreen';
import { RecordingScreen } from './RecordingScreen';
import { PaneStage, useVideoPane, videoDetails } from '../video/pane';
import { HoldButton, ScrubStrip, SPEEDS, Timeline } from '../controls';
import { ToolTray } from '../drawing/ToolTray';
import { RecBar, useRecording } from '../recording/useRecording';
import { captureToJpeg } from '../capture';

const SOUND_KEY = 'videoSound';
const SCRUB_FADE_MS = 3000;
/** Each tap of − / + zooms by this factor. */
const ZOOM_STEP = 1.5;

/** Video sound starts off (mostly coach-boat engine); the choice is remembered on this phone. */
export function loadSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

function saveSoundOn(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked: still works for this session */
  }
}

interface Props {
  video: OpenVideo;
  onBack: () => void;
  snapshots: Snapshot[];
  setSnapshots: (update: (prev: Snapshot[]) => Snapshot[]) => void;
  /** Open Compare with this video as A (current drawings passed along). */
  onCompare: (drawings: Drawing[]) => void;
}

export function Analyse({ video, onBack, snapshots, setSnapshots, onCompare }: Props) {
  const settings = useDrawingSettings();
  const [panelOpen, setPanelOpen] = useState(false);
  const [toolsHidden, setToolsHidden] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(loadSoundOn);
  const [collapsed, setCollapsed] = useState(false);
  const [scrubVisible, setScrubVisible] = useState(true);
  const fadeTimer = useRef<number | undefined>(undefined);
  const landscape = useMediaQuery('(orientation: landscape)');
  const showOverlay = landscape && collapsed;

  const pane = useVideoPane({
    video,
    settings,
    soundOn,
    onTap: () => showOverlayRef.current && showScrub(),
  });
  const showOverlayRef = useRef(showOverlay);
  showOverlayRef.current = showOverlay;
  const { drawing, zoom, meta } = pane;

  useEffect(() => saveSoundOn(soundOn), [soundOn]);

  const rec = useRecording({
    getSize: () => {
      const st = pane.stageRef.current;
      return { W: st?.clientWidth ?? 0, H: st?.clientHeight ?? 0 };
    },
    paint: (ctx) => pane.paintStage(ctx, true),
    baseName: video.name,
  });

  // Keyboard (handy when developing on a computer): space plays, arrows step.
  const paneRef = useRef(pane);
  paneRef.current = pane;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea')) return;
      const p = paneRef.current;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') p.drawing.undo();
      else if (e.code === 'Space') p.togglePlay();
      else if (e.code === 'ArrowLeft') p.step(-1);
      else if (e.code === 'ArrowRight') p.step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Slim scrub bar over the video (landscape collapsed) fades when unused.
  // While recording it stays up, so you can scrub through the stroke as you talk.
  function showScrub() {
    setScrubVisible(true);
    clearTimeout(fadeTimer.current);
    if (rec.isRecording) return;
    fadeTimer.current = window.setTimeout(() => setScrubVisible(false), SCRUB_FADE_MS);
  }
  useEffect(() => {
    if (landscape && collapsed) showScrub();
    return () => clearTimeout(fadeTimer.current);
  }, [landscape, collapsed, rec.isRecording]);

  const frameLabel = `Frame ${formatCount(pane.frameIdx + 1)} / ${formatCount(pane.total)} · ${formatTime(pane.time)}`;
  const stepLabel =
    pane.stepMode.kind === 'fast' ? 'fast stepping' : pane.stepMode.kind === 'basic' ? 'basic stepping' : '';
  const fpsLabel = [`${meta.fpsEstimated ? '~' : ''}${formatFps(meta.fps)} fps`, formatLength(pane.duration), stepLabel]
    .filter(Boolean)
    .join(' · ');

  function showDetails() {
    const sm = pane.stepMode;
    const lines = [
      videoDetails(video),
      sm.kind === 'basic'
        ? `Basic stepping (seeking the video): ${sm.reason}`
        : sm.kind === 'fast'
          ? 'Fast stepping (frame cache) is on.'
          : 'Checking frame cache…',
    ];
    alert(lines.join('\n\n'));
  }

  async function takeSnapshot() {
    pane.pause();
    const st = pane.stageRef.current!;
    try {
      const blob = await captureToJpeg(st.clientWidth, st.clientHeight, (ctx) => pane.paintStage(ctx, false));
      const snap = makeSnapshot(blob, video.name, pane.frameIdx);
      setSnapshots((prev) => [...prev, snap]);
      setSnapshotId(snap.id);
    } catch (err) {
      alert(`Couldn't take snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function compare() {
    pane.pause();
    onCompare(drawing.drawings);
  }

  const recordButton = (cls = '') => (
    <button
      class={`icon-button record-button ${rec.isRecording ? 'is-recording' : ''} ${cls}`}
      onClick={rec.isRecording ? rec.stop : rec.start}
      aria-label={rec.isRecording ? 'Stop recording' : 'Record'}
    >
      {rec.isRecording ? <IconStop /> : <IconRecord />}
    </button>
  );
  const soundButton = (cls = '') => (
    <button
      class={`icon-button ${cls}`}
      onClick={() => setSoundOn(!soundOn)}
      aria-label={soundOn ? 'Video sound on (tap to mute)' : 'Video sound off (tap to unmute)'}
    >
      {soundOn ? <IconSound /> : <IconSoundOff />}
    </button>
  );
  const snapshotButton = (cls = '') => (
    <button class={`icon-button ${cls}`} onClick={takeSnapshot} aria-label="Take snapshot">
      <IconCamera />
    </button>
  );
  const compareButton = (cls = '') => (
    <button class={`icon-button ${cls}`} onClick={compare} aria-label="Compare with another video">
      <IconCompare />
    </button>
  );
  const playButton = (cls: string) => (
    <button class={`play-button ${cls}`} onClick={pane.togglePlay} aria-label={pane.playing ? 'Pause' : 'Play'}>
      {pane.playing ? <IconPause /> : <IconPlay />}
    </button>
  );
  const backButton = () => (
    <HoldButton class="frame-button" label="Previous frame" onStep={() => pane.step(-1)}>
      <IconFrameBack />
    </HoldButton>
  );
  const forwardButton = () => (
    <HoldButton class="frame-button" label="Next frame" onStep={() => pane.step(1)}>
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
        {soundButton()}
        {compareButton()}
        {snapshotButton()}
        {recordButton()}
      </header>

      <PaneStage pane={pane} class={rec.isRecording ? 'is-recording' : ''}>
        {rec.isRecording && <RecBar rec={rec} />}
        {landscape && toolsHidden && (
          <button class="tools-tab" onClick={() => setToolsHidden(false)} aria-label="Show drawing tools">
            <IconToolsShow />
          </button>
        )}
        {pane.status !== 'ready' && (
          <div class="stage-message">
            {pane.status === 'loading' ? (
              <p>Loading video…</p>
            ) : (
              <>
                <p>Chrome can't play this video: {pane.status}</p>
                <p class="muted small">{videoDetails(video)}</p>
              </>
            )}
          </div>
        )}
        {showOverlay && (
          <div class={`overlay-scrub ${scrubVisible ? '' : 'is-hidden'}`}>
            <div class={`frame-label small ${pane.waiting ? 'is-waiting' : ''}`}>{frameLabel}</div>
            <Timeline time={pane.time} duration={pane.duration} onSeek={pane.seek} onActivity={showScrub} />
            <ScrubStrip frame={pane.frameIdx} onStart={pane.currentFrame} onMove={pane.goTo} onActivity={showScrub} />
          </div>
        )}
      </PaneStage>

      <section class="info">
        <div class={`frame-label ${pane.waiting ? 'is-waiting' : ''}`}>{frameLabel}</div>
        <Timeline time={pane.time} duration={pane.duration} onSeek={pane.seek} />
        <ScrubStrip frame={pane.frameIdx} onStart={pane.currentFrame} onMove={pane.goTo} />
      </section>

      <section class="controls">
        {landscape && (
          <div class="panel-head">
            <button class="icon-button" onClick={onBack} aria-label="Back to videos">
              <IconHome />
            </button>
            {compareButton('panel-snapshot')}
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
              aria-checked={pane.rate === s.rate}
              class={`speed ${pane.rate === s.rate ? 'is-selected' : ''}`}
              onClick={() => pane.setRate(s.rate)}
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
          {landscape && soundButton('zoom-button')}
        </div>
      </section>

      <ToolTray
        settings={settings}
        canUndo={drawing.canUndo}
        onUndo={drawing.undo}
        canClear={drawing.drawings.length > 0}
        onClear={() => drawing.clearAll()}
        panelOpen={panelOpen}
        onPanel={() => setPanelOpen(!panelOpen)}
        onHide={landscape ? () => setToolsHidden(true) : undefined}
      />

      {panelOpen && (
        <DrawingPanel
          colour={settings.colour}
          thickness={settings.thickness}
          scope={settings.scope}
          onStyle={drawing.restyle}
          drawings={drawing.visible}
          total={drawing.drawings.length}
          selectedId={drawing.selectedId}
          onSelect={drawing.select}
          onDelete={drawing.remove}
          onClearAll={() => drawing.clearAll()}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {snapshotId && snapshots.length > 0 && (
        <SnapshotScreen
          snapshots={snapshots}
          currentId={snapshotId}
          onSelect={setSnapshotId}
          onNote={(id, note) => setSnapshots((prev) => prev.map((x) => (x.id === id ? { ...x, note } : x)))}
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

      {rec.result && <RecordingScreen recording={rec.result} onClose={rec.clearResult} />}

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
