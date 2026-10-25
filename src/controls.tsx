import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/** Hold a frame button this long before it starts repeating, then step this often. */
const HOLD_DELAY_MS = 350;
const HOLD_REPEAT_MS = 70;
/** Finger travel on the scrub strip for one frame. */
const STRIP_PX_PER_FRAME = 14;

export const SPEEDS = [
  { rate: 1, label: '1×' },
  { rate: 0.5, label: '½×' },
  { rate: 0.25, label: '¼×' },
  { rate: 0.125, label: '⅛×' },
];

/** Steps once on press, then repeats while held. */
export function HoldButton(props: {
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
export function ScrubStrip(props: {
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

export function Timeline({ time, duration, onSeek, onActivity }: TimelineProps) {
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
