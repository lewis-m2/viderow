import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { toStage, toVideo, type SingleFingerHandler, type View } from '../useZoom';
import {
  COLOURS,
  THICKNESS_PX,
  distToSegment,
  handles,
  newId,
  segments,
  visibleOn,
  type Drawing,
  type Pt,
  type Scope,
  type Thickness,
  type Tool,
} from './model';
import { renderAngle, renderDrawing } from './render';

const LOUPE_SIZE = 120;
const LOUPE_MAG = 2;
const LOUPE_OFFSET = 110;
/** How close (screen px) the Erase tool must come to a drawing to remove it. */
const ERASE_HIT_PX = 20;
const MIN_LINE_PX = 8;
const MAX_UNDO = 100;

interface Options {
  stage: RefObject<HTMLElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  loupe: RefObject<HTMLCanvasElement | null>;
  video: RefObject<HTMLVideoElement | null>;
  frameCanvas: RefObject<HTMLCanvasElement | null>;
  getView: () => View;
  /** Frame index currently on screen. */
  frame: number;
  /** Called when a drawing gesture starts (pause playback). */
  onDrawStart: () => void;
  /** Drawings saved for this video last time. */
  initial?: Drawing[];
}


export function useDrawing(o: Options) {
  const [drawings, setDrawings] = useState<Drawing[]>(() => o.initial ?? []);
  const [tool, setToolState] = useState<Tool>('move');
  const [colour, setColour] = useState(COLOURS[0].value);
  const [thickness, setThickness] = useState<Thickness>('medium');
  const [scope, setScope] = useState<Scope>('video');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  // Mirrors of state for the gesture handlers (which live outside renders).
  const st = useRef({ drawings, tool, colour, thickness, scope, selectedId, frame: o.frame });
  st.current = { drawings, tool, colour, thickness, scope, selectedId, frame: o.frame };
  const opts = useRef(o);
  opts.current = o;

  const history = useRef<Drawing[][]>([]);
  const draft = useRef<Drawing | null>(null);
  const anglePts = useRef<Pt[]>([]);
  const anglePending = useRef<Pt | null>(null);
  /** Drawings touched by the current Erase gesture (hidden until the finger lifts). */
  const erasing = useRef<Set<string> | null>(null);
  const loupeAt = useRef<Pt | null>(null);
  const frameReq = useRef(0);

  function commit(next: Drawing[]) {
    history.current.push(st.current.drawings);
    if (history.current.length > MAX_UNDO) history.current.shift();
    st.current.drawings = next;
    setDrawings(next);
    setCanUndo(true);
  }

  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    anglePts.current = [];
    st.current.drawings = prev;
    setDrawings(prev);
    setCanUndo(history.current.length > 0);
    if (selectedId && !prev.some((d) => d.id === selectedId)) setSelectedId(null);
  }

  function clearAll() {
    if (!st.current.drawings.length) return;
    const n = st.current.drawings.length;
    if (!confirm(`Delete all ${n} drawing${n === 1 ? '' : 's'} in this video?`)) return;
    commit([]);
    setSelectedId(null);
  }

  function remove(id: string) {
    commit(st.current.drawings.filter((d) => d.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function setTool(t: Tool) {
    anglePts.current = [];
    anglePending.current = null;
    draft.current = null;
    setToolState(t);
  }

  function select(id: string) {
    setSelectedId(id);
  }

  /** Change a style setting: becomes the default, and applies to the selected drawing. */
  function restyle(patch: Partial<Pick<Drawing, 'colour' | 'thickness' | 'scope'>>) {
    if (patch.colour) setColour(patch.colour);
    if (patch.thickness) setThickness(patch.thickness);
    if (patch.scope) setScope(patch.scope);
    const id = st.current.selectedId;
    if (id) {
      commit(
        st.current.drawings.map((d) =>
          d.id === id ? { ...d, ...patch, frame: patch.scope === 'frame' ? st.current.frame : d.frame } : d,
        ),
      );
    }
  }

  // ---------- rendering ----------

  function requestRender() {
    if (frameReq.current) return;
    frameReq.current = requestAnimationFrame(() => {
      frameReq.current = 0;
      render();
    });
  }

  function newDrawingBase() {
    const s = st.current;
    return { id: newId(), colour: s.colour, thickness: s.thickness, scope: s.scope, frame: s.frame };
  }

  /** Everything to draw right now, with any in-progress edit swapped in. */
  function shown(): Drawing[] {
    const s = st.current;
    const list = s.drawings.filter((d) => visibleOn(d, s.frame) && !erasing.current?.has(d.id));
    if (draft.current) list.push(draft.current);
    return list;
  }

  function paint(ctx: CanvasRenderingContext2D, map: (p: Pt) => Pt) {
    const s = st.current;
    for (const d of shown()) renderDrawing(ctx, d, map, d.id === s.selectedId ? 'strong' : 'none');
    const pts = [...anglePts.current];
    if (anglePending.current) pts.push(anglePending.current);
    if (pts.length) renderAngle(ctx, pts.map(map), s.colour, THICKNESS_PX[s.thickness]);
  }

  function render() {
    const canvas = opts.current.canvas.current;
    const stage = opts.current.stage.current;
    if (!canvas || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const v = opts.current.getView();
    if (!v.vw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, (p) => toStage(v, p));
    renderLoupe(v);
  }

  function renderLoupe(v: View) {
    const el = opts.current.loupe.current;
    const stage = opts.current.stage.current;
    if (!el || !stage) return;
    const at = loupeAt.current;
    if (!at) {
      el.style.display = 'none';
      return;
    }
    const L = LOUPE_SIZE;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== L * dpr) {
      el.width = L * dpr;
      el.height = L * dpr;
    }
    // Sit above the finger (below if there's no room), kept inside the stage.
    const sp = toStage(v, at);
    let cy = sp.y - LOUPE_OFFSET;
    if (cy - L / 2 < 0) cy = sp.y + LOUPE_OFFSET;
    const cx = Math.max(L / 2, Math.min(stage.clientWidth - L / 2, sp.x));
    el.style.display = 'block';
    el.style.left = `${cx - L / 2}px`;
    el.style.top = `${cy - L / 2}px`;

    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(L / 2, L / 2, L / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, L, L);
    // Picture: whichever is on screen (cached frame or the video).
    const fc = opts.current.frameCanvas.current;
    const useFrame = fc && fc.style.visibility === 'visible' && fc.width > 0;
    const source: CanvasImageSource | null = useFrame ? fc : opts.current.video.current;
    const perVideoPx = useFrame ? fc!.width / v.vw : 1;
    const kL = v.k * LOUPE_MAG; // loupe px per video px
    const region = L / kL;
    if (source) {
      try {
        ctx.drawImage(
          source,
          (at.x - region / 2) * perVideoPx,
          (at.y - region / 2) * perVideoPx,
          region * perVideoPx,
          region * perVideoPx,
          0,
          0,
          L,
          L,
        );
      } catch {
        /* video not ready */
      }
    }
    paint(ctx, (p) => ({ x: (p.x - at.x) * kL + L / 2, y: (p.y - at.y) * kL + L / 2 }));
    ctx.restore();
    // Crosshair and rim.
    ctx.strokeStyle = 'rgba(242, 244, 247, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L / 2 - 10, L / 2);
    ctx.lineTo(L / 2 + 10, L / 2);
    ctx.moveTo(L / 2, L / 2 - 10);
    ctx.lineTo(L / 2, L / 2 + 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(L / 2, L / 2, L / 2 - 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#F2F4F7';
    ctx.stroke();
  }

  useEffect(requestRender, [drawings, o.frame, tool, selectedId, colour, thickness]);
  useEffect(() => () => cancelAnimationFrame(frameReq.current), []);

  // ---------- one-finger gestures ----------

  /** Erase every visible drawing near the finger. */
  function eraseAt(sp: Pt, v: View) {
    const s = st.current;
    const set = erasing.current;
    if (!set) return;
    for (const d of s.drawings) {
      if (!visibleOn(d, s.frame) || set.has(d.id)) continue;
      const reach = ERASE_HIT_PX + THICKNESS_PX[d.thickness] / 2;
      const nearLine = segments(d).some(([a, b]) => distToSegment(sp, toStage(v, a), toStage(v, b)) <= reach);
      const nearPoint = handles(d).some((h) => {
        const q = toStage(v, h);
        return Math.hypot(q.x - sp.x, q.y - sp.y) <= reach;
      });
      if (nearLine || nearPoint) set.add(d.id);
    }
  }

  const single = useRef<SingleFingerHandler>({
    start(sp) {
      const v = opts.current.getView();
      if (!v.vw) return false;
      const p = toVideo(v, sp);
      const s = st.current;
      // Pan mode: one finger pans / taps (handled by the zoom code). Drawings can't be grabbed.
      if (s.tool === 'move') return false;
      switch (s.tool) {
        case 'erase':
          erasing.current = new Set();
          eraseAt(sp, v);
          break;
        case 'line':
        case 'arrow':
          opts.current.onDrawStart();
          draft.current = { ...newDrawingBase(), kind: s.tool, a: p, b: p };
          loupeAt.current = p;
          break;
        case 'free':
          opts.current.onDrawStart();
          draft.current = { ...newDrawingBase(), kind: 'free', pts: [p] };
          break;
        case 'angle':
          opts.current.onDrawStart();
          anglePending.current = p;
          loupeAt.current = p;
          break;
      }
      requestRender();
      return true;
    },

    move(sp) {
      const v = opts.current.getView();
      const p = toVideo(v, sp);
      const d = draft.current;
      if (erasing.current) {
        eraseAt(sp, v);
      } else if (d && (d.kind === 'line' || d.kind === 'arrow')) {
        draft.current = { ...d, b: p };
        loupeAt.current = p;
      } else if (d && d.kind === 'free') {
        const last = toStage(v, d.pts[d.pts.length - 1]);
        if (Math.hypot(last.x - sp.x, last.y - sp.y) >= 2) d.pts.push(p);
      } else if (anglePending.current) {
        anglePending.current = p;
        loupeAt.current = p;
      }
      requestRender();
    },

    end(sp) {
      const v = opts.current.getView();
      const p = toVideo(v, sp);
      const d = draft.current;
      if (erasing.current) {
        const gone = erasing.current;
        erasing.current = null;
        // One erase gesture = one undo step.
        if (gone.size) {
          commit(st.current.drawings.filter((x) => !gone.has(x.id)));
          if (st.current.selectedId && gone.has(st.current.selectedId)) setSelectedId(null);
        }
      } else if (d && (d.kind === 'line' || d.kind === 'arrow')) {
        const a = toStage(v, d.a);
        const b = toStage(v, p);
        if (Math.hypot(a.x - b.x, a.y - b.y) >= MIN_LINE_PX) commit([...st.current.drawings, { ...d, b: p }]);
      } else if (d && d.kind === 'free') {
        if (d.pts.length >= 2) commit([...st.current.drawings, d]);
      } else if (anglePending.current) {
        anglePts.current = [...anglePts.current, p];
        anglePending.current = null;
        if (anglePts.current.length === 3) {
          const [a, b, c] = anglePts.current;
          anglePts.current = [];
          commit([...st.current.drawings, { ...newDrawingBase(), kind: 'angle', a, b, c }]);
        }
      }
      draft.current = null;
      loupeAt.current = null;
      requestRender();
    },

    cancel() {
      // A second finger arrived: this was a pinch, not a drawing. Points already placed
      // for an angle are kept, so you can zoom in between taps.
      draft.current = null;
      anglePending.current = null;
      erasing.current = null;
      loupeAt.current = null;
      requestRender();
    },
  });

  /** Paint the drawings on this frame for a snapshot: no handles, nothing half-drawn. */
  function paintExport(ctx: CanvasRenderingContext2D, v: View) {
    const s = st.current;
    for (const d of s.drawings) if (visibleOn(d, s.frame)) renderDrawing(ctx, d, (p) => toStage(v, p));
  }

  const visible = drawings.filter((d) => visibleOn(d, o.frame));

  return {
    drawings,
    visible,
    tool,
    setTool,
    colour,
    thickness,
    scope,
    restyle,
    selectedId,
    select,
    remove,
    undo,
    canUndo,
    clearAll,
    single,
    requestRender,
    paintExport,
  };
}
