/** Snapshots are rendered at the screen's pixel density, capped to keep files reasonable. */
const SNAPSHOT_MAX_DPR = 3;
const SNAPSHOT_QUALITY = 0.9;

/** Render a W×H (CSS px) area via `paint` to a JPEG at screen sharpness. */
export function captureToJpeg(
  W: number,
  H: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Promise<Blob> {
  const dpr = Math.min(window.devicePixelRatio || 1, SNAPSHOT_MAX_DPR);
  const out = document.createElement('canvas');
  out.width = Math.round(W * dpr);
  out.height = Math.round(H * dpr);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(ctx);
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make image'))), 'image/jpeg', SNAPSHOT_QUALITY),
  );
}

/** Small A/B label pill drawn into snapshots and recordings of Compare. */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string) {
  ctx.save();
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 16;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 26, 13);
  ctx.fillStyle = 'rgba(14, 17, 22, 0.75)';
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillText(text, x + 8, y + 13.5);
  ctx.restore();
}
