import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 12;

/**
 * Zoom is stored as a scale plus the point of the video (0–1 across the picture) that sits
 * at the centre of the stage. That survives rotation and resizing; the CSS translate is
 * worked out from it whenever the stage size changes.
 */
interface Zoom {
  s: number;
  fx: number;
  fy: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The current view: how video pixels map to stage (CSS) pixels. */
export interface View {
  /** Video size in pixels (as displayed, rotation applied). 0 until the video has loaded. */
  vw: number;
  vh: number;
  /** Stage pixels per video pixel. */
  k: number;
  /** Stage position of video pixel (0, 0). */
  ox: number;
  oy: number;
}

export const toStage = (v: View, p: { x: number; y: number }) => ({
  x: v.ox + p.x * v.k,
  y: v.oy + p.y * v.k,
});

export const toVideo = (v: View, p: { x: number; y: number }) => ({
  x: (p.x - v.ox) / v.k,
  y: (p.y - v.oy) / v.k,
});

/**
 * One-finger gestures can be handed to someone else (the drawing tools). `start` returns true
 * to claim the gesture. If a second finger arrives, `cancel` is called and it becomes a pinch.
 */
export interface SingleFingerHandler {
  start(p: { x: number; y: number }): boolean;
  move(p: { x: number; y: number }): void;
  end(p: { x: number; y: number }): void;
  cancel(): void;
}

interface Options {
  stage: RefObject<HTMLElement | null>;
  layer: RefObject<HTMLElement | null>;
  video: RefObject<HTMLVideoElement | null>;
  /** Single tap on the stage (not part of a double tap or pinch). */
  onTap?: () => void;
  /** Called after every change of zoom/pan or stage size. */
  onChange?: () => void;
  single?: RefObject<SingleFingerHandler | null>;
}

export function useZoom({ stage, layer, video, onTap, onChange, single }: Options) {
  const [scale, setScale] = useState(1);
  const zoom = useRef<Zoom>({ s: 1, fx: 0.5, fy: 0.5 });
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** Where the video picture sits inside the stage at 1× (object-fit: contain). */
  function contentRect(): Rect {
    const el = stage.current!;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const vw = video.current?.videoWidth || W;
    const vh = video.current?.videoHeight || H;
    const k = Math.min(W / vw, H / vh);
    return { x: (W - vw * k) / 2, y: (H - vh * k) / 2, w: vw * k, h: vh * k };
  }

  function clampAxis(t: number, s: number, size: number, c0: number, cw: number): number {
    // Picture smaller than the stage: centre it. Otherwise don't let an edge come inside.
    if (s * cw <= size) return (size - s * cw) / 2 - s * c0;
    return Math.min(-s * c0, Math.max(size - s * (c0 + cw), t));
  }

  function toTranslate(z: Zoom, r: Rect) {
    const el = stage.current!;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const tx = W / 2 - z.s * (r.x + z.fx * r.w);
    const ty = H / 2 - z.s * (r.y + z.fy * r.h);
    return { tx: clampAxis(tx, z.s, W, r.x, r.w), ty: clampAxis(ty, z.s, H, r.y, r.h) };
  }

  function fromTranslate(s: number, tx: number, ty: number, r: Rect): Zoom {
    const el = stage.current!;
    const W = el.clientWidth;
    const H = el.clientHeight;
    tx = clampAxis(tx, s, W, r.x, r.w);
    ty = clampAxis(ty, s, H, r.y, r.h);
    return { s, fx: ((W / 2 - tx) / s - r.x) / r.w, fy: ((H / 2 - ty) / s - r.y) / r.h };
  }

  function apply() {
    if (!stage.current || !layer.current) return;
    const z = zoom.current;
    const { tx, ty } = toTranslate(z, contentRect());
    layer.current.style.transform = `translate(${tx}px, ${ty}px) scale(${z.s})`;
    setScale(Math.round(z.s * 10) / 10);
    onChangeRef.current?.();
  }

  function view(): View {
    const vw = video.current?.videoWidth ?? 0;
    const vh = video.current?.videoHeight ?? 0;
    if (!stage.current || !vw || !vh) return { vw: 0, vh: 0, k: 1, ox: 0, oy: 0 };
    const r = contentRect();
    const z = zoom.current;
    const { tx, ty } = toTranslate(z, r);
    return { vw, vh, k: (z.s * r.w) / vw, ox: tx + z.s * r.x, oy: ty + z.s * r.y };
  }

  /** Zoom to scale s keeping the stage point (px, py) fixed under the finger. */
  function zoomAt(s: number, px: number, py: number) {
    const r = contentRect();
    const z = zoom.current;
    const { tx, ty } = toTranslate(z, r);
    s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));
    const cx = (px - tx) / z.s;
    const cy = (py - ty) / z.s;
    zoom.current = fromTranslate(s, px - cx * s, py - cy * s, r);
    apply();
  }

  function zoomBy(factor: number) {
    const el = stage.current!;
    zoomAt(zoom.current.s * factor, el.clientWidth / 2, el.clientHeight / 2);
  }

  function reset() {
    zoom.current = { s: 1, fx: 0.5, fy: 0.5 };
    apply();
  }

  useEffect(() => {
    const el = stage.current!;
    const v = video.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d0: number; mx: number; my: number; s0: number; tx0: number; ty0: number } | null = null;
    let usedTwoFingers = false;
    let claimed = false;
    let tap: { x: number; y: number; t: number } | null = null;
    let lastTap: { x: number; y: number; t: number } | null = null;

    const local = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const twoPoints = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const startPinch = () => {
      const { d, mx, my } = twoPoints();
      const { tx, ty } = toTranslate(zoom.current, contentRect());
      pinch = { d0: Math.max(d, 1), mx, my, s0: zoom.current.s, tx0: tx, ty0: ty };
    };

    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.overlay-scrub')) return;
      el.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        usedTwoFingers = false;
        claimed = single?.current?.start(p) ?? false;
        tap = claimed ? null : { ...p, t: e.timeStamp };
      } else if (pts.size === 2) {
        // Two fingers never draw: hand back anything the first finger started.
        if (claimed) single?.current?.cancel();
        claimed = false;
        usedTwoFingers = true;
        tap = null;
        startPinch();
      }
    };

    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (claimed && pts.size === 1) {
        single?.current?.move(p);
        return;
      }
      if (tap && Math.hypot(p.x - tap.x, p.y - tap.y) > TAP_SLOP_PX) tap = null;
      if (pinch && pts.size >= 2) {
        const { d, mx, my } = twoPoints();
        const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.s0 * (d / pinch.d0)));
        // Keep the picture point that was under the fingers' midpoint under it now.
        const cx = (pinch.mx - pinch.tx0) / pinch.s0;
        const cy = (pinch.my - pinch.ty0) / pinch.s0;
        zoom.current = fromTranslate(s, mx - cx * s, my - cy * s, contentRect());
        apply();
      }
    };

    const up = (e: PointerEvent) => {
      const last = pts.get(e.pointerId);
      if (!pts.delete(e.pointerId)) return;
      if (claimed && pts.size === 0) {
        claimed = false;
        if (e.type === 'pointercancel') single?.current?.cancel();
        else single?.current?.end(last ?? local(e));
        return;
      }
      if (pts.size < 2) pinch = null;
      if (pts.size === 2) startPinch();
      if (pts.size > 0) return;
      if (tap && !usedTwoFingers && e.timeStamp - tap.t < DOUBLE_TAP_MS) {
        if (
          lastTap &&
          tap.t - lastTap.t < DOUBLE_TAP_MS &&
          Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 40
        ) {
          reset();
          lastTap = null;
        } else {
          lastTap = tap;
          onTapRef.current?.();
        }
      }
      tap = null;
    };

    // Mouse wheel / trackpad zoom, for working on a computer.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      zoomAt(zoom.current.s * Math.exp(-e.deltaY * 0.002), e.clientX - b.left, e.clientY - b.top);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    // Re-fit when the stage changes size (rotation, panel collapse) or the video size is known.
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    v.addEventListener('loadedmetadata', apply);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      ro.disconnect();
      v.removeEventListener('loadedmetadata', apply);
    };
  }, []);

  return { scale, zoomBy, reset, view };
}
