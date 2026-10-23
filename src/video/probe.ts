import { createFile, MP4BoxBuffer, type Movie, type Sample } from 'mp4box';

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
  /** Raw sample table, kept for the frame cache (milestone 2). */
  samples: Sample[] | null;
  trackId: number | null;
}

const FALLBACK_FPS = 30;

/** Read frame timing from an MP4/MOV without loading the whole file. */
export async function probeVideo(file: File): Promise<VideoMeta> {
  try {
    const meta = await probeMp4(file);
    if (meta) return meta;
  } catch (err) {
    console.warn('Could not read video structure, using estimates', err);
  }
  return {
    frameTimes: null,
    fps: FALLBACK_FPS,
    fpsEstimated: true,
    width: 0,
    height: 0,
    codec: null,
    samples: null,
    trackId: null,
  };
}

interface BoxPos {
  offset: number;
  size: number;
}

/** Walk the top-level boxes to find ftyp and moov. The moov is often at the end on Android. */
async function findTopLevelBoxes(file: File): Promise<{ ftyp?: BoxPos; moov?: BoxPos }> {
  const found: { ftyp?: BoxPos; moov?: BoxPos } = {};
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

async function probeMp4(file: File): Promise<VideoMeta | null> {
  const { ftyp, moov } = await findTopLevelBoxes(file);
  if (!moov) return null;

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
  if (!track) return null;

  const samples = mp4.getTrackSamplesInfo(track.id);
  if (!samples.length) return null;

  const timescale = track.timescale;
  const cts = samples.map((s) => s.cts).sort((a, b) => a - b);
  const first = cts[0];
  const frameTimes = Float64Array.from(cts, (c) => (c - first) / timescale);
  const totalDuration = track.samples_duration / timescale;

  return {
    frameTimes,
    fps: totalDuration > 0 ? samples.length / totalDuration : FALLBACK_FPS,
    fpsEstimated: false,
    width: track.video?.width ?? track.track_width,
    height: track.video?.height ?? track.track_height,
    codec: track.codec,
    samples,
    trackId: track.id,
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

export function frameCount(meta: VideoMeta, duration: number): number {
  return meta.frameTimes ? meta.frameTimes.length : Math.max(1, Math.round(duration * meta.fps));
}
