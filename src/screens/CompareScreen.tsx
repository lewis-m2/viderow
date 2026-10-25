import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenVideo } from '../App';
import {
  IconBack,
  IconCamera,
  IconFrameBack,
  IconFrameForward,
  IconLink,
  IconOverlay,
  IconPause,
  IconPlay,
  IconRecord,
  IconStop,
  IconSwap,
  IconUnlink,
} from '../icons';
import { formatTime } from '../format';
import { useMediaQuery } from '../useMediaQuery';
import { useDrawingSettings, type DrawingSettings } from '../drawing/useDrawing';
import { DrawingPanel } from '../drawing/DrawingPanel';
import { ToolTray } from '../drawing/ToolTray';
import { makeSnapshot, type Snapshot } from '../snapshots';
import { SnapshotScreen } from './SnapshotScreen';
import { RecordingScreen } from './RecordingScreen';
import { PaneStage, useVideoPane, type Pane } from '../video/pane';
import { DEFAULT_CACHE_BYTES } from '../video/frameCache';
import { HoldButton, ScrubStrip, SPEEDS } from '../controls';
import { RecBar, useRecording } from '../recording/useRecording';
import { captureToJpeg, drawLabel } from '../capture';

/** Linked playback: if B drifts this far (s) from where it should be, put it back. */
const MAX_DRIFT_S = 0.1;
const DRIFT_CHECK_MS = 250;
const COLOUR_A = '#FF8A3D';
const COLOUR_B = '#4CC9F0';
/** Align B: how small / large B can be scaled to sit over A. */
const ALIGN_MIN_SCALE = 0.3;
const ALIGN_MAX_SCALE = 3;
const DOUBLE_TAP_MS = 300;

type Mode = 'stacked' | 'overlay';

/** Extra move/scale applied to B in overlay (in A's picture pixels, before A's zoom). */
interface Align {
  x: number;
  y: number;
  s: number;
}

interface Props {
  a: OpenVideo;
  b: OpenVideo;
  onBack: () => void;
  snapshots: Snapshot[];
  setSnapshots: (update: (prev: Snapshot[]) => Snapshot[]) => void;
}

interface PaneState {
  frame: number;
  time: number;
  playing: boolean;
}

/**
 * Two videos, stacked (portrait) or side by side (landscape). By default each moves on its own;
 * Link stores the time offset (B − A) so shared controls drive both, matched by time.
 */
export function CompareScreen(p: Props) {
  const settings = useDrawingSettings();
  const landscape = useMediaQuery('(orientation: landscape)');
  const [swapped, setSwapped] = useState(false);
  /** Seconds B is ahead of A while linked; null = each video moves on its own. */
  const [offset, setOffset] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, PaneState>>({});
  const panes = useRef<Record<string, Pane>>({});
  const panesBox = useRef<HTMLDivElement>(null);
  const undoStack = useRef<string[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [active, setActive] = useState(p.a.url);
  const [mode, setMode] = useState<Mode>('stacked');
  /** Overlay: how much of B shows through (0 = only A, 1 = only B). */
  const [ghost, setGhost] = useState(0.5);
  const [aligning, setAligning] = useState(false);
  const align = useRef<Align>({ x: 0, y: 0, s: 1 });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const order = swapped ? [p.b, p.a] : [p.a, p.b];
  const [vA, vB] = order;
  const paneA = () => panes.current[vA.url];
  const paneB = () => panes.current[vB.url];
  const label = (v: OpenVideo) => (v === vA ? 'A · Today' : v.starred ? 'B · Reference' : 'B');
  const colour = (v: OpenVideo) => (v === vA ? COLOUR_A : COLOUR_B);
  const linked = offset !== null;
  const aState = states[vA.url];
  const overlay = mode === 'overlay';

  // ---------- overlay ----------

  /** Put B exactly over A: A's zoom/pan, then B's own alignment. */
  function applyOverlay() {
    for (const v of order) {
      const st = panes.current[v.url]?.stageRef.current;
      if (st && (v !== vB || modeRef.current !== 'overlay')) st.style.transform = '';
    }
    if (modeRef.current !== 'overlay') return;
    const A = paneA();
    const st = paneB()?.stageRef.current;
    if (!A || !st) return;
    const z = A.zoom.transform();
    const al = align.current;
    st.style.transformOrigin = '0 0';
    st.style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.s}) translate(${al.x}px, ${al.y}px) scale(${al.s})`;
  }

  useEffect(() => {
    // B follows A's zoom in overlay, so its own zoom goes back to 1×.
    if (overlay) paneB()?.zoom.reset();
    else setAligning(false);
    applyOverlay();
  }, [mode, swapped]);

  // Align B gestures: one finger moves B, two fingers scale it, double-tap resets.
  const alignPts = useRef(new Map<number, { x: number; y: number }>());
  const alignGesture = useRef<{
    start: Align;
    z: { s: number; tx: number; ty: number };
    x: number;
    y: number;
    d: number;
    lastTap: number;
  }>({ start: { x: 0, y: 0, s: 1 }, z: { s: 1, tx: 0, ty: 0 }, x: 0, y: 0, d: 1, lastTap: 0 });

  function alignBegin() {
    const pts = [...alignPts.current.values()];
    const g = alignGesture.current;
    g.start = { ...align.current };
    g.z = paneA().zoom.transform();
    g.x = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    g.y = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    g.d = pts.length > 1 ? Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) : 1;
  }

  function alignMove() {
    const pts = [...alignPts.current.values()];
    const g = alignGesture.current;
    const { s: zs, tx, ty } = g.z;
    const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    const my = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    const scale =
      pts.length > 1
        ? Math.min(ALIGN_MAX_SCALE, Math.max(ALIGN_MIN_SCALE, (g.start.s * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) / g.d))
        : g.start.s;
    // Keep the point of B that was under the fingers under them.
    const qx = ((g.x - tx) / zs - g.start.x) / g.start.s;
    const qy = ((g.y - ty) / zs - g.start.y) / g.start.s;
    align.current = { x: (mx - tx) / zs - scale * qx, y: (my - ty) / zs - scale * qy, s: scale };
    applyOverlay();
  }

  const alignHandlers = {
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
      alignPts.current.set(e.pointerId, { x: e.clientX - b.left, y: e.clientY - b.top });
      if (alignPts.current.size === 1) {
        const g = alignGesture.current;
        if (e.timeStamp - g.lastTap < DOUBLE_TAP_MS) {
          align.current = { x: 0, y: 0, s: 1 };
          applyOverlay();
        }
        g.lastTap = e.timeStamp;
      }
      alignBegin();
    },
    onPointerMove: (e: PointerEvent) => {
      if (!alignPts.current.has(e.pointerId)) return;
      const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
      alignPts.current.set(e.pointerId, { x: e.clientX - b.left, y: e.clientY - b.top });
      alignMove();
    },
    onPointerUp: (e: PointerEvent) => {
      alignPts.current.delete(e.pointerId);
      if (alignPts.current.size) alignBegin();
    },
    onPointerCancel: (e: PointerEvent) => {
      alignPts.current.delete(e.pointerId);
      if (alignPts.current.size) alignBegin();
    },
  };

  // ---------- linked controls ----------

  function followB() {
    if (offset === null) return;
    paneB()?.goToTime(paneA().currentTime() + offset);
  }

  function link() {
    paneA().pause();
    paneB().pause();
    setOffset(paneB().currentTime() - paneA().currentTime());
  }

  function linkedStep(delta: number) {
    paneA().step(delta);
    followB();
  }

  function linkedGoTo(frame: number) {
    paneA().goTo(frame);
    followB();
  }

  function linkedToggle() {
    const A = paneA();
    const B = paneB();
    if (A.playing) {
      A.pause();
      B.pause();
      return;
    }
    B.seek(Math.max(0, A.currentTime() + (offset ?? 0)));
    A.play();
    B.play();
  }

  function setLinkedRate(r: number) {
    setRate(r);
    paneA().setRate(r);
    paneB().setRate(r);
  }

  // While linked and playing, keep B in step with A; when A stops, line B up exactly.
  useEffect(() => {
    if (offset === null) return;
    if (!aState?.playing) {
      paneB()?.pause();
      followB();
      return;
    }
    const id = setInterval(() => {
      const a = paneA().videoRef.current;
      const b = paneB().videoRef.current;
      if (!a || !b) return;
      const target = a.currentTime + offset;
      if (target >= b.duration || target < 0) {
        b.pause();
      } else if (Math.abs(b.currentTime - target) > MAX_DRIFT_S) {
        b.currentTime = target;
        if (b.paused) b.play().catch(() => {});
      }
    }, DRIFT_CHECK_MS);
    return () => clearInterval(id);
  }, [offset, aState?.playing]);

  function swap() {
    paneA().pause();
    paneB().pause();
    setOffset(null);
    align.current = { x: 0, y: 0, s: 1 };
    setSwapped(!swapped);
  }

  // ---------- drawings across both videos ----------

  function onCommit(url: string) {
    undoStack.current.push(url);
    setUndoCount(undoStack.current.length);
  }

  function undo() {
    while (undoStack.current.length) {
      const url = undoStack.current.pop()!;
      const pane = panes.current[url];
      if (pane?.drawing.canUndo) {
        // The pane's undo doesn't count as a new change.
        pane.drawing.undo();
        break;
      }
    }
    setUndoCount(undoStack.current.length);
  }

  function clearAll() {
    const n = order.reduce((sum, v) => sum + (panes.current[v.url]?.drawing.drawings.length ?? 0), 0);
    if (!n || !confirm(`Delete all ${n} drawing${n === 1 ? '' : 's'} on both videos?`)) return;
    order.forEach((v) => panes.current[v.url]?.drawing.clearAll(false));
  }

  const activePane = panes.current[active] ?? paneA();
  const totalDrawings = order.reduce((sum, v) => sum + (panes.current[v.url]?.drawing.drawings.length ?? 0), 0);

  // ---------- snapshot / recording of both videos as shown ----------

  /** Bounding box (page px) of both pictures (just A's in overlay, where B sits on top of it). */
  function box() {
    const rects = (overlay ? [vA] : order).map((v) => panes.current[v.url]?.stageRef.current?.getBoundingClientRect());
    const ok = rects.filter(Boolean) as DOMRect[];
    const left = Math.min(...ok.map((r) => r.left));
    const top = Math.min(...ok.map((r) => r.top));
    const right = Math.max(...ok.map((r) => r.right));
    const bottom = Math.max(...ok.map((r) => r.bottom));
    return { left, top, W: right - left, H: bottom - top, rects };
  }

  function paintBoth(ctx: CanvasRenderingContext2D, live: boolean) {
    if (modeRef.current === 'overlay') {
      paintOverlay(ctx, live);
      return;
    }
    const b = box();
    order.forEach((v, i) => {
      const r = b.rects[i];
      const pane = panes.current[v.url];
      if (!r || !pane) return;
      const x = r.left - b.left;
      const y = r.top - b.top;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, r.width, r.height);
      ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, r.width, r.height);
      pane.paintStage(ctx, live);
      ctx.restore();
      drawLabel(ctx, `${label(v)}  ${formatTime(pane.time)}`, x + 8, y + 8, colour(v));
    });
  }

  /** Overlay as seen: A, then B see-through with A's zoom and B's alignment. */
  function paintOverlay(ctx: CanvasRenderingContext2D, live: boolean) {
    const A = paneA();
    const B = paneB();
    const r = A.stageRef.current?.getBoundingClientRect();
    if (!r) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, r.width, r.height);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, r.width, r.height);
    A.paintStage(ctx, live);
    ctx.globalAlpha = ghost;
    const z = A.zoom.transform();
    const al = align.current;
    ctx.transform(z.s, 0, 0, z.s, z.tx, z.ty);
    ctx.transform(al.s, 0, 0, al.s, al.x, al.y);
    B.paintStage(ctx, live);
    ctx.restore();
    drawLabel(ctx, `${label(vA)}  ${formatTime(A.time)}`, 8, 8, COLOUR_A);
    const bText = `${label(vB)}  ${formatTime(B.time)}`;
    ctx.save();
    ctx.font = '700 14px Inter, system-ui, sans-serif';
    const w = ctx.measureText(bText).width + 16;
    ctx.restore();
    drawLabel(ctx, bText, r.width - w - 8, 8, COLOUR_B);
  }

  const rec = useRecording({
    getSize: () => {
      const b = box();
      return { W: b.W, H: b.H };
    },
    paint: (ctx) => paintBoth(ctx, true),
    baseName: `${vA.name}_vs_${vB.name}`,
  });

  async function takeSnapshot() {
    paneA().pause();
    paneB().pause();
    const b = box();
    try {
      const blob = await captureToJpeg(b.W, b.H, (ctx) => paintBoth(ctx, false));
      const snap = makeSnapshot(blob, `${vA.name}_vs_${vB.name}`, paneA().frameIdx);
      p.setSnapshots((prev) => [...prev, snap]);
      setSnapshotId(snap.id);
    } catch (err) {
      alert(`Couldn't take snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const recordButton = (
    <button
      class={`icon-button record-button ${rec.isRecording ? 'is-recording' : ''}`}
      onClick={rec.isRecording ? rec.stop : rec.start}
      aria-label={rec.isRecording ? 'Stop recording' : 'Record'}
    >
      {rec.isRecording ? <IconStop /> : <IconRecord />}
    </button>
  );
  const modeSwitch = (
    <div class="segmented cmp-mode" role="radiogroup" aria-label="View">
      {(
        [
          ['stacked', landscape ? 'Side by side' : 'Stacked'],
          ['overlay', 'Overlay'],
        ] as const
      ).map(([m, text]) => (
        <button role="radio" aria-checked={mode === m} class={mode === m ? 'is-selected' : ''} onClick={() => setMode(m)}>
          {text}
        </button>
      ))}
    </div>
  );
  const headButtons = (
    <>
      <button class="icon-button" onClick={swap} aria-label="Swap A and B">
        <IconSwap />
      </button>
      <button class="icon-button" onClick={takeSnapshot} aria-label="Take snapshot">
        <IconCamera />
      </button>
      {recordButton}
    </>
  );
  const linkButton = (
    <button class="link-button" onClick={link} aria-label="Link: move both videos together">
      <IconLink />
      <span>Link</span>
    </button>
  );

  return (
    <div class={`compare ${landscape ? 'cmp-land' : 'cmp-port'}`} onContextMenu={(e) => e.preventDefault()}>
      <header class="topbar cmp-top">
        <button class="icon-button" onClick={p.onBack} aria-label="Back">
          <IconBack />
        </button>
        {modeSwitch}
        {headButtons}
      </header>

      <div
        class={`cmp-panes ${overlay ? 'cmp-overlay' : ''} ${rec.isRecording ? 'is-recording' : ''}`}
        ref={panesBox}
        style={{ '--ghost': String(ghost) }}
      >
        {order.map((v) => (
          <ComparePane
            key={v.url}
            slot={v === vA ? 'a' : 'b'}
            video={v}
            label={label(v)}
            colour={colour(v)}
            settings={settings}
            linked={linked}
            active={active === v.url}
            persist={!(v === p.b && p.b.id === p.a.id)}
            onPane={(pane) => (panes.current[v.url] = pane)}
            onState={(s) => setStates((old) => ({ ...old, [v.url]: s }))}
            onCommit={() => onCommit(v.url)}
            onTouch={() => setActive(v.url)}
            onViewChange={v === vA ? applyOverlay : undefined}
          />
        ))}
        {overlay && aligning && (
          // Over both pictures: gestures here move/scale only B.
          <div class="align-layer" {...alignHandlers}>
            <span class="align-hint">Drag / pinch to line B up with A · double-tap to reset</span>
          </div>
        )}
        {rec.isRecording && <RecBar rec={rec} />}
      </div>

      {overlay && (
        <div class="cmp-overlay-controls">
          <span class="ghost-end" style={{ color: COLOUR_A }}>A</span>
          <input
            class="timeline ghost-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(ghost * 100)}
            style={{ '--pct': `${ghost * 100}%` }}
            aria-label="See-through: A to B"
            onInput={(e) => setGhost(Number((e.currentTarget as HTMLInputElement).value) / 100)}
          />
          <span class="ghost-end" style={{ color: COLOUR_B }}>B</span>
          <button
            class={`secondary-button small-button ${aligning ? 'is-on' : ''}`}
            onClick={() => setAligning(!aligning)}
            aria-pressed={aligning}
          >
            {aligning ? 'Done' : 'Align B'}
          </button>
        </div>
      )}

      {linked ? (
        <section class="cmp-linked">
          <div class="cmp-linked-row">
            <span class="cmp-linked-label">
              <IconLink /> Linked · both move together
            </span>
            <button class="secondary-button small-button" onClick={() => setOffset(null)}>
              <IconUnlink />
              Unlink
            </button>
          </div>
          <ScrubStrip frame={aState?.frame ?? 0} onStart={() => paneA().currentFrame()} onMove={linkedGoTo} />
          <div class="cmp-play-row">
            <HoldButton class="frame-button" label="Previous frame" onStep={() => linkedStep(-1)}>
              <IconFrameBack />
            </HoldButton>
            <button class="play-button" onClick={linkedToggle} aria-label={aState?.playing ? 'Pause' : 'Play'}>
              {aState?.playing ? <IconPause /> : <IconPlay />}
            </button>
            <HoldButton class="frame-button" label="Next frame" onStep={() => linkedStep(1)}>
              <IconFrameForward />
            </HoldButton>
            <div class="speeds cmp-speeds" role="radiogroup" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button
                  role="radio"
                  aria-checked={rate === s.rate}
                  class={`speed ${rate === s.rate ? 'is-selected' : ''}`}
                  onClick={() => setLinkedRate(s.rate)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <p class="cmp-hint muted">
          Slide each video to the moment you want to compare — catch to catch, finish to finish — then tap Link.
        </p>
      )}

      <div class="cmp-bottom">
        {landscape && (
          <div class="cmp-bottom-head">
            <button class="icon-button" onClick={p.onBack} aria-label="Back">
              <IconBack />
            </button>
            <button
              class={`icon-button ${overlay ? 'is-on' : ''}`}
              onClick={() => setMode(overlay ? 'stacked' : 'overlay')}
              aria-label={overlay ? 'Side by side' : 'Overlay'}
            >
              <IconOverlay />
            </button>
            {headButtons}
          </div>
        )}
        <ToolTray
          class="cmp-tools"
          settings={settings}
          canUndo={undoCount > 0}
          onUndo={undo}
          canClear={totalDrawings > 0}
          onClear={clearAll}
          panelOpen={panelOpen}
          onPanel={() => setPanelOpen(!panelOpen)}
        />
        {!linked && linkButton}
      </div>

      {panelOpen && activePane && (
        <DrawingPanel
          colour={settings.colour}
          thickness={settings.thickness}
          scope={settings.scope}
          onStyle={activePane.drawing.restyle}
          drawings={activePane.drawing.visible}
          total={totalDrawings}
          selectedId={activePane.drawing.selectedId}
          onSelect={activePane.drawing.select}
          onDelete={activePane.drawing.remove}
          onClearAll={clearAll}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {snapshotId && p.snapshots.length > 0 && (
        <SnapshotScreen
          snapshots={p.snapshots}
          currentId={snapshotId}
          onSelect={setSnapshotId}
          onNote={(id, note) => p.setSnapshots((prev) => prev.map((x) => (x.id === id ? { ...x, note } : x)))}
          onDelete={(id) => {
            const gone = p.snapshots.find((x) => x.id === id);
            if (gone) URL.revokeObjectURL(gone.url);
            const rest = p.snapshots.filter((x) => x.id !== id);
            p.setSnapshots(() => rest);
            setSnapshotId(rest.length ? rest[rest.length - 1].id : null);
          }}
          onClose={() => setSnapshotId(null)}
        />
      )}

      {rec.result && <RecordingScreen recording={rec.result} onClose={rec.clearResult} />}
    </div>
  );
}

interface PaneProps {
  /** a = first (top / left / underneath in overlay), b = second. */
  slot: 'a' | 'b';
  video: OpenVideo;
  label: string;
  colour: string;
  settings: DrawingSettings;
  linked: boolean;
  active: boolean;
  persist: boolean;
  onPane: (pane: Pane) => void;
  onState: (s: PaneState) => void;
  onCommit: () => void;
  onTouch: () => void;
  onViewChange?: () => void;
}

/** One of the two videos: label + time, picture, and (when not linked) its own frame controls. */
function ComparePane(p: PaneProps) {
  const pane = useVideoPane({
    video: p.video,
    settings: p.settings,
    soundOn: false,
    // Two videos means two frame caches: each gets half the memory.
    cacheBytes: DEFAULT_CACHE_BYTES / 2,
    onCommit: p.onCommit,
    persist: p.persist,
    onViewChange: p.onViewChange,
  });
  p.onPane(pane);

  useEffect(() => {
    p.onState({ frame: pane.frameIdx, time: pane.time, playing: pane.playing });
  }, [pane.frameIdx, pane.time, pane.playing]);

  return (
    <div class={`cmp-pane is-${p.slot} ${p.active ? 'is-active' : ''}`} onPointerDownCapture={p.onTouch}>
      <div class="cmp-wrap">
        <PaneStage pane={pane}>
          {pane.status !== 'ready' && (
            <div class="stage-message">
              <p>{pane.status === 'loading' ? 'Loading video…' : `Can't play this video: ${pane.status}`}</p>
            </div>
          )}
        </PaneStage>
        {/* Outside the stage, so it isn't moved/scaled with B in overlay. */}
        <div class="cmp-label" style={{ color: p.colour }}>
          {p.label} <span class="cmp-time">{formatTime(pane.time)}</span>
        </div>
      </div>
      {!p.linked && (
        <div class="cmp-row">
          <span class="cmp-row-tag" style={{ color: p.colour }}>
            {p.slot.toUpperCase()}
          </span>
          <HoldButton class="frame-button" label={`${p.label}: previous frame`} onStep={() => pane.step(-1)}>
            <IconFrameBack />
          </HoldButton>
          <ScrubStrip frame={pane.frameIdx} onStart={pane.currentFrame} onMove={pane.goTo} />
          <HoldButton class="frame-button" label={`${p.label}: next frame`} onStep={() => pane.step(1)}>
            <IconFrameForward />
          </HoldButton>
        </div>
      )}
    </div>
  );
}
