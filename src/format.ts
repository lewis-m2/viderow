/** 53.5 → "0:53.50" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** 118.2 → "1:58" */
export function formatLength(seconds: number): string {
  const s = Math.round(Math.max(0, seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 3210 → "3,210" */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** 29.97 → "30", 23.5 → "23.5" */
export function formatFps(fps: number): string {
  const r = Math.round(fps);
  return Math.abs(fps - r) < 0.1 ? String(r) : fps.toFixed(1);
}
