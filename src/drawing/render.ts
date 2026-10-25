import { angleDeg, handles, THICKNESS_PX, type Drawing, type Pt } from './model';

type Map = (p: Pt) => Pt;

const SHADOW = 'rgba(0, 0, 0, 0.55)';

/** Draw a path twice: a dark outline for contrast on bright water, then the colour. */
function strokeWithShadow(ctx: CanvasRenderingContext2D, colour: string, w: number, path: () => void) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  path();
  ctx.strokeStyle = SHADOW;
  ctx.lineWidth = w + 3;
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = w;
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, p: Pt, r: number, colour: string) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = SHADOW;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, text: string, at: Pt, colour: string) {
  ctx.font = '700 16px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14;
  const h = 26;
  ctx.beginPath();
  ctx.roundRect(at.x - w / 2, at.y - h / 2, w, h, 8);
  ctx.fillStyle = 'rgba(14, 17, 22, 0.8)';
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillText(text, at.x, at.y + 1);
}

/** 'subtle' = small rings showing grabbable points; 'strong' = the selected drawing. */
export type HandleStyle = 'none' | 'subtle' | 'strong';

export function renderDrawing(ctx: CanvasRenderingContext2D, d: Drawing, map: Map, handleStyle: HandleStyle = 'none') {
  const w = THICKNESS_PX[d.thickness];
  const c = d.colour;
  switch (d.kind) {
    case 'line': {
      const a = map(d.a);
      const b = map(d.b);
      strokeWithShadow(ctx, c, w, () => {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
      break;
    }
    case 'arrow': {
      const a = map(d.a);
      const b = map(d.b);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 12 + w * 2.5;
      const spread = 0.5;
      const back = { x: b.x - Math.cos(ang) * head * 0.8, y: b.y - Math.sin(ang) * head * 0.8 };
      strokeWithShadow(ctx, c, w, () => {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(back.x, back.y);
      });
      const p1 = { x: b.x - Math.cos(ang - spread) * head, y: b.y - Math.sin(ang - spread) * head };
      const p2 = { x: b.x - Math.cos(ang + spread) * head, y: b.y - Math.sin(ang + spread) * head };
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = SHADOW;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.fill();
      break;
    }
    case 'free': {
      const pts = d.pts.map(map);
      if (pts.length === 0) break;
      strokeWithShadow(ctx, c, w, () => {
        ctx.moveTo(pts[0].x, pts[0].y);
        if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
        // Smooth through midpoints.
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      });
      break;
    }
    case 'angle':
      renderAngle(ctx, [map(d.a), map(d.b), map(d.c)], c, w, Math.round(angleDeg(d.a, d.b, d.c)));
      break;
  }
  if (handleStyle !== 'none') {
    const strong = handleStyle === 'strong';
    for (const h of handles(d).map(map)) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, strong ? 10 : 8, 0, Math.PI * 2);
      ctx.fillStyle = strong ? 'rgba(14, 17, 22, 0.5)' : 'rgba(14, 17, 22, 0.25)';
      ctx.fill();
      ctx.strokeStyle = strong ? '#F2F4F7' : 'rgba(242, 244, 247, 0.75)';
      ctx.lineWidth = strong ? 2 : 1.5;
      ctx.stroke();
    }
    if (strong && d.kind === 'free' && d.pts.length) {
      // No handles on freehand: outline its bounds instead so it's clear what's selected.
      const pts = d.pts.map(map);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const pad = 8 + w;
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#F2F4F7';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        Math.min(...xs) - pad,
        Math.min(...ys) - pad,
        Math.max(...xs) - Math.min(...xs) + pad * 2,
        Math.max(...ys) - Math.min(...ys) + pad * 2,
      );
      ctx.setLineDash([]);
    }
  }
}

/** Angle with 1–3 points placed (screen coordinates). With 3 it shows the arc and degrees. */
export function renderAngle(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  colour: string,
  w: number,
  degrees?: number,
) {
  const [a, b, c] = pts;
  if (b) {
    strokeWithShadow(ctx, colour, w, () => {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (c) ctx.lineTo(c.x, c.y);
    });
  }
  if (a && b && c) {
    const ta = Math.atan2(a.y - b.y, a.x - b.x);
    const tc = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = tc - ta;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    const shortest = Math.min(Math.hypot(a.x - b.x, a.y - b.y), Math.hypot(c.x - b.x, c.y - b.y));
    const r = Math.max(14, Math.min(40, shortest * 0.4));
    strokeWithShadow(ctx, colour, Math.max(2, w - 1), () => {
      ctx.arc(b.x, b.y, r, ta, ta + delta, delta < 0);
    });
    // Degrees label on the outside of the arc, along the bisector.
    const mid = ta + delta / 2;
    const lr = r + 24;
    if (degrees !== undefined) label(ctx, `${degrees}°`, { x: b.x + Math.cos(mid) * lr, y: b.y + Math.sin(mid) * lr }, colour);
  }
  for (const p of pts) if (p) dot(ctx, p, w / 2 + 2, colour);
}
