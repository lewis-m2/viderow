import { createStore, del, get, set, update, values } from 'idb-keyval';
import type { Drawing } from './drawing/model';

/**
 * Videos opened in the app are kept on the phone (IndexedDB) with their drawings, so they can
 * be reopened from the Home screen. Three separate stores so listing never loads video data.
 */
const metaStore = createStore('rowcoach-meta', 'meta');
const videoStore = createStore('rowcoach-videos', 'videos');
const drawingStore = createStore('rowcoach-drawings', 'drawings');

export interface RecentVideo {
  id: string;
  name: string;
  fileName: string;
  type: string;
  size: number;
  addedAt: number;
  openedAt: number;
  duration?: number;
  fps?: number;
  drawingCount: number;
  starred: boolean;
  thumb?: Blob;
}

/** Copies still being written; updates for that video wait for them. */
const pending = new Map<string, Promise<unknown>>();
const settled = (id: string) => pending.get(id)?.catch(() => {});

/** Same name + size = same video (shared files get a new "modified" time each time). */
export function videoIdFor(file: File): string {
  return `${file.name}|${file.size}`;
}

export async function listRecent(): Promise<RecentVideo[]> {
  const all = await values<RecentVideo>(metaStore);
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

export async function getRecent(id: string): Promise<RecentVideo | undefined> {
  return get<RecentVideo>(id, metaStore);
}

/**
 * Remember a newly opened video: store a copy (if not already stored) and its details.
 * Throws if the phone is out of space for the copy.
 */
export function rememberVideo(file: File, name: string): Promise<RecentVideo> {
  const id = videoIdFor(file);
  const p = writeVideo(id, file, name);
  pending.set(id, p);
  p.finally(() => pending.get(id) === p && pending.delete(id)).catch(() => {});
  return p;
}

async function writeVideo(id: string, file: File, name: string): Promise<RecentVideo> {
  const existing = await get<RecentVideo>(id, metaStore);
  if (!existing || !(await get(id, videoStore))) {
    // Ask Chrome not to clear our storage when the phone gets low on space.
    navigator.storage?.persist?.().catch(() => {});
    await set(id, file, videoStore);
  }
  const now = Date.now();
  const meta: RecentVideo = existing
    ? { ...existing, openedAt: now }
    : {
        id,
        name,
        fileName: file.name,
        type: file.type || 'video/mp4',
        size: file.size,
        addedAt: now,
        openedAt: now,
        drawingCount: 0,
        starred: false,
      };
  await set(id, meta, metaStore);
  return meta;
}

export async function touchRecent(id: string) {
  await updateRecent(id, { openedAt: Date.now() });
}

export async function updateRecent(id: string, patch: Partial<RecentVideo>) {
  await settled(id);
  await update<RecentVideo | undefined>(id, (old) => (old ? { ...old, ...patch } : old), metaStore);
}

export async function loadVideoFile(meta: RecentVideo): Promise<File | null> {
  const blob = await get<Blob>(meta.id, videoStore);
  if (!blob) return null;
  return blob instanceof File ? blob : new File([blob], meta.fileName, { type: meta.type });
}

export async function loadDrawings(id: string): Promise<Drawing[]> {
  return (await get<Drawing[]>(id, drawingStore)) ?? [];
}

export async function saveDrawings(id: string, drawings: Drawing[]) {
  await settled(id);
  await set(id, drawings, drawingStore);
  await updateRecent(id, { drawingCount: drawings.length });
}

export async function deleteVideo(id: string) {
  await Promise.all([del(id, videoStore), del(id, drawingStore), del(id, metaStore)]);
}

/** Space used by the app on this phone, in bytes (null if the browser won't say). */
export async function storageUsed(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch {
    return null;
  }
}
