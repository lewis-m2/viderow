import { createFile, MP4BoxBuffer, type Box, type Movie, type Sample } from 'mp4box';

/** What the WebCodecs frame cache needs to decode frames itself. */
export interface DecodeInfo {
  codec: string;
  /** Codec setup bytes (contents of the avcC / hvcC / av1C box). */
  description?: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  /** Clockwise rotation the player applies (0, 90, 180, 270). Decoded frames come out unrotated. */
  rotation: number;
  timescale: number;
  /** Samples in decode (file) order. */
  samples: Sample[];
  /** cts of the first displayed frame; frame time = (cts - firstCts) / timescale. */
  firstCts: number;
}

export interface VideoMeta {
  /** Presentation time (seconds, from 0) of every frame, in display order. Null if the file couldn't be read. */
  frameTimes: Float64Array | null;
  /** Average frames per second. */
  fps: number;
  /** True when fps is a guess (file wasn't an MP4/MOV we could read). */
  fpsEstimated: boolean;
  width: number;
  height: number;
  codec: string | null;
  /** Null when the file couldn't be read; stepping then falls back to seeking. */
  decode: DecodeInfo | null;
  /** Why frame info couldn't be read (shown when the video fails). */
  probeError?: string;
}

const FALLBACK_FPS = 30;

/** Read frame timing from an MP4/MOV without loading the whole file. */
export async function probeVideo(file: File): Promise<VideoMeta> {
  let probeError: string;
  try {
    return await probeMp4(file);
  } catch (err) {
    console.warn('Could not read video structure, using estimates', err);
    probeError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  return {
    probeError,
    frameTimes: null,
    fps: FALLBACK_FPS,
    fpsEstimated: true,
    width: 0,
    height: 0,
    codec: null,
    decode: null,
  };
}

interface BoxPos {
  offset: number;
  size: number;
}

/** Walk the top-level boxes to find ftyp and moov. The moov is often at the end on Android. */
async function findTopLevelBoxes(
  file: File,
): Promise<{ ftyp?: BoxPos; moov?: BoxPos; seen: string[] }> {
  const found: { ftyp?: BoxPos; moov?: BoxPos; seen: string[] } = { seen: [] };
  let offset = 0;
  while (offset + 8 <= file.size) {
    const header = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    let size = header.getUint32(0);
    const type = String.fromCharCode(
      header.getUint8(4),
      header.getUint8(5),
      header.getUint8(6),
      header.getUint8(7),
    );
    if (size === 1) size = Number(header.getBigUint64(8));
    else if (size === 0) size = file.size - offset;
    found.seen.push(type.replace(/[^ -~]/g, '?'));
    if (size < 8) break;
    if (type === 'ftyp') found.ftyp = { offset, size };
    if (type === 'moov') {
      found.moov = { offset, size };
      break;
    }
    offset += size;
  }
  return found;
}

async function probeMp4(file: File): Promise<VideoMeta> {
  if (file.size === 0) throw new Error('file is empty (0 bytes)');
  const { ftyp, moov, seen } = await findTopLevelBoxes(file);
  if (!moov) throw new Error(`not an MP4/MOV (boxes: ${seen.join(', ') || 'none'})`);

  // Build a small "ftyp + moov" file. Sample offsets inside moov stay absolute,
  // so they still point at the right bytes in the real file.
  const parts: BlobPart[] = [];
  if (ftyp) parts.push(file.slice(ftyp.offset, ftyp.offset + ftyp.size));
  parts.push(file.slice(moov.offset, moov.offset + moov.size));
  const buffer = await new Blob(parts).arrayBuffer();

  const mp4 = createFile();
  let info: Movie | null = null;
  mp4.onReady = (i) => {
    info = i;
  };
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0), true);
  mp4.flush();

  const movie = info as Movie | null;
  const track = movie?.videoTracks[0];
  if (!track) throw new Error('no video track found');

  const samples = mp4.getTrackSamplesInfo(track.id);
  if (!samples.length) throw new Error('video track has no frames');

  const timescale = track.timescale;
  const cts = samples.map((s) => s.cts).sort((a, b) => a - b);
  const first = cts[0];
  const frameTimes = Float64Array.from(cts, (c) => (c - first) / timescale);
  const totalDuration = track.samples_duration / timescale;

  const entry = mp4.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0] as {
    avcC?: Box;
    hvcC?: Box;
    av1C?: Box;
  };
  const configBox = entry.avcC ?? entry.hvcC ?? entry.av1C;
  const description =
    configBox?.start !== undefined && configBox.hdr_size !== undefined
      ? new Uint8Array(buffer.slice(configBox.start + configBox.hdr_size, configBox.start + configBox.size))
      : undefined;

  // Track matrix [a, b, u, c, d, v, x, y, w]; rotation angle from a and b.
  const m = track.matrix as ArrayLike<number>;
  const angle = m ? Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) : 0;
  const rotation = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  const codedWidth = track.video?.width ?? track.track_width;
  const codedHeight = track.video?.height ?? track.track_height;

  return {
    frameTimes,
    fps: totalDuration > 0 ? samples.length / totalDuration : FALLBACK_FPS,
    fpsEstimated: false,
    width: codedWidth,
    height: codedHeight,
    codec: track.codec,
    decode: {
      codec: track.codec,
      description,
      codedWidth,
      codedHeight,
      rotation,
      timescale,
      samples,
      firstCts: first,
    },
  };
}

/** Index (0-based) of the frame showing at time t. */
export function frameIndexAt(meta: VideoMeta, t: number): number {
  const times = meta.frameTimes;
  if (!times) return Math.max(0, Math.floor(t * meta.fps + 1e-3));
  // Largest i with times[i] <= t (small tolerance for float rounding).
  let lo = 0;
  let hi = times.length - 1;
  const target = t + 1e-3;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A time inside frame i (its midpoint), so seeking there shows exactly that frame. */
export function seekTimeFor(meta: VideoMeta, i: number): number {
  const times = meta.frameTimes;
  if (!times) return (i + 0.5) / meta.fps;
  const start = times[i];
  const next = i + 1 < times.length ? times[i + 1] : start + 1 / meta.fps;
  return (start + next) / 2;
}

/** Start time of frame i. */
export function frameTime(meta: VideoMeta, i: number): number {
  return meta.frameTimes ? meta.frameTimes[i] : i / meta.fps;
}

export function frameCount(meta: VideoMeta, duration: number): number {
  return meta.frameTimes ? meta.frameTimes.length : Math.max(1, Math.round(duration * meta.fps));
}
