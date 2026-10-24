/** A point in video pixel coordinates. */
export interface Pt {
  x: number;
  y: number;
}

export type Tool = 'move' | 'line' | 'arrow' | 'free' | 'angle';
export type Thickness = 'thin' | 'medium' | 'thick';
export type Scope = 'frame' | 'video';

export const COLOURS = [
  { name: 'Yellow', value: '#FFD60A' },
  { name: 'Cyan', value: '#4CC9F0' },
  { name: 'Pink', value: '#FF6FD8' },
  { name: 'White', value: '#F2F4F7' },
];

/** Line widths in screen (CSS) pixels, the same at any zoom. */
export const THICKNESS_PX: Record<Thickness, number> = { thin: 2, medium: 4, thick: 7 };

interface Base {
  id: string;
  colour: string;
  thickness: Thickness;
  scope: Scope;
  /** Frame index the drawing was made on (used when scope is 'frame'). */
  frame: number;
}

export type Shape =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'arrow'; a: Pt; b: Pt }
  | { kind: 'free'; pts: Pt[] }
  /** Angle measured at b, between b→a and b→c. */
  | { kind: 'angle'; a: Pt; b: Pt; c: Pt };

export type Drawing = Base & Shape;

let counter = 0;
export const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function visibleOn(d: Drawing, frame: number): boolean {
  return d.scope === 'video' || d.frame === frame;
}

/** Angle at b in degrees, 0–180. */
export function angleDeg(a: Pt, b: Pt, c: Pt): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (len === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / len));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function describe(d: Drawing): string {
  switch (d.kind) {
    case 'line':
      return 'Line';
    case 'arrow':
      return 'Arrow';
    case 'free':
      return 'Freehand';
    case 'angle':
      return `Angle ${Math.round(angleDeg(d.a, d.b, d.c))}°`;
  }
}

/** The draggable points of a drawing (freehand has none: it moves as a whole). */
export function handles(d: Drawing): Pt[] {
  switch (d.kind) {
    case 'line':
    case 'arrow':
      return [d.a, d.b];
    case 'angle':
      return [d.a, d.b, d.c];
    case 'free':
      return [];
  }
}

export function withHandle(d: Drawing, i: number, p: Pt): Drawing {
  if (d.kind === 'line' || d.kind === 'arrow') return i === 0 ? { ...d, a: p } : { ...d, b: p };
  if (d.kind === 'angle') return i === 0 ? { ...d, a: p } : i === 1 ? { ...d, b: p } : { ...d, c: p };
  return d;
}

export function translated(d: Drawing, dx: number, dy: number): Drawing {
  const m = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  switch (d.kind) {
    case 'line':
    case 'arrow':
      return { ...d, a: m(d.a), b: m(d.b) };
    case 'angle':
      return { ...d, a: m(d.a), b: m(d.b), c: m(d.c) };
    case 'free':
      return { ...d, pts: d.pts.map(m) };
  }
}

/** Segments making up the drawing, for hit testing. */
export function segments(d: Drawing): Array<[Pt, Pt]> {
  switch (d.kind) {
    case 'line':
    case 'arrow':
      return [[d.a, d.b]];
    case 'angle':
      return [
        [d.b, d.a],
        [d.b, d.c],
      ];
    case 'free':
      return d.pts.slice(1).map((p, i) => [d.pts[i], p] as [Pt, Pt]);
  }
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
