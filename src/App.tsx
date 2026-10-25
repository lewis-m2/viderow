import { useEffect, useState } from 'preact/hooks';
import { Home } from './screens/Home';
import { Analyse } from './screens/Analyse';
import { probeVideo, type VideoMeta } from './video/probe';
import type { Snapshot } from './snapshots';
import { adoptBack, handleBack } from './backStack';
import { CompareScreen } from './screens/CompareScreen';
import { PickVideo } from './screens/PickVideo';
import type { Drawing } from './drawing/model';
import {
  loadDrawings,
  loadVideoFile,
  rememberVideo,
  touchRecent,
  videoIdFor,
  type RecentVideo,
} from './library';

export interface OpenVideo {
  /** Key in the on-phone library (name + size). */
  id: string;
  file: File;
  url: string;
  name: string;
  meta: VideoMeta;
  /** Drawings saved for this video last time. */
  drawings: Drawing[];
  /** Starred as a reference in the recent list. */
  starred?: boolean;
}

const SHARE_CACHE = 'shared-video';

export class UnreadableFileError extends Error {
  constructor() {
    super('Android would not let Chrome read that video.');
  }
}

export function App() {
  const [video, setVideo] = useState<OpenVideo | null>(null);
  // Snapshots taken this session (kept when switching videos, gone when the app closes).
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Choosing video B for Compare (A's current drawings kept here meanwhile). */
  const [picking, setPicking] = useState<Drawing[] | null>(null);
  const [compare, setCompare] = useState<{ a: OpenVideo; b: OpenVideo } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // A video shared to the app from Android's share menu (see public/share-target-sw.js).
  useEffect(() => {
    const shared = new URLSearchParams(location.search).get('shared');
    if (!shared) return;
    history.replaceState(null, '', location.pathname);
    if (shared !== '1') {
      setShareError("Couldn't receive the shared video. Try sharing it again, or use Open video.");
      return;
    }
    setReceiving(true);
    (async () => {
      try {
        const res = await (await caches.open(SHARE_CACHE)).match('shared');
        if (!res) return;
        const blob = await res.blob();
        const name = decodeURIComponent(res.headers.get('X-File-Name') ?? 'shared-video.mp4');
        await open(new File([blob], name, { type: blob.type || 'video/mp4' }));
      } catch (err) {
        console.error(err);
        setShareError(`Couldn't open the shared video: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setReceiving(false);
      }
    })();
  }, []);

  // Android back gesture returns to Home instead of leaving the app.
  useEffect(() => {
    const onPop = () => {
      if (handleBack()) return;
      setVideo(null);
      // The shared copy is only needed while it's open; free the space.
      caches.delete(SHARE_CACHE).catch(() => {});
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Free the video's memory when a different video is opened (not when its details change).
  useEffect(() => {
    if (!video) return;
    const url = video.url;
    return () => URL.revokeObjectURL(url);
  }, [video?.url]);

  /** Check a file can be read, read its frame info and saved drawings. Keeps a copy if new. */
  async function prepareVideo(file: File, recent?: RecentVideo): Promise<OpenVideo> {
    // Android's photo picker sometimes hands over a file Chrome isn't allowed to read
    // (e.g. a cloud-only video). Catch that here rather than showing a broken screen.
    try {
      await file.slice(0, 16).arrayBuffer();
    } catch (err) {
      console.warn('File not readable', err);
      throw new UnreadableFileError();
    }
    const meta = await probeVideo(file);
    const name = recent?.name ?? file.name.replace(/\.[^.]+$/, '');
    const id = recent?.id ?? videoIdFor(file);
    const drawings = await loadDrawings(id).catch(() => []);
    const prepared: OpenVideo = { id, file, url: URL.createObjectURL(file), name, meta, drawings, starred: recent?.starred };
    if (recent) {
      touchRecent(id).catch(() => {});
    } else {
      // Keep a copy on the phone so it can be reopened from the recent list.
      rememberVideo(file, name).catch((err) => {
        console.warn('Could not keep a copy', err);
        setNotice(
          "Not enough space to keep a copy of this video on the phone, so it won't appear in the recent list. " +
            'Delete some old videos from the list to free space.',
        );
      });
    }
    return prepared;
  }

  async function open(file: File, recent?: RecentVideo) {
    setVideo(await prepareVideo(file, recent));
    history.pushState({ screen: 'analyse' }, '');
  }

  async function fileForRecent(recent: RecentVideo): Promise<File> {
    const file = await loadVideoFile(recent);
    if (!file) throw new Error('The saved copy of this video is missing. Open it again from Files.');
    return file;
  }

  async function openRecent(recent: RecentVideo) {
    await open(await fileForRecent(recent), recent);
  }

  // ---------- Compare ----------

  function startPicking(aDrawings: Drawing[]) {
    setPicking(aDrawings);
  }

  async function pickB(file: File, recent?: RecentVideo) {
    if (!video || !picking) return;
    const b = await prepareVideo(file, recent);
    const a = { ...video, drawings: picking };
    setPicking(null);
    setCompare({ a, b });
  }

  // Leaving Compare (back gesture or button): back to video A with its latest drawings.
  useEffect(() => {
    if (!compare) return;
    return adoptBack(async () => {
      URL.revokeObjectURL(compare.b.url);
      const drawings = await loadDrawings(compare.a.id).catch(() => compare.a.drawings);
      setVideo((v) => (v ? { ...v, drawings } : v));
      setCompare(null);
    });
  }, [compare]);

  const toast = notice && (
    <div class="toast" role="status" onClick={() => setNotice(null)}>
      {notice}
    </div>
  );
  if (!video) {
    return (
      <>
        <Home onOpen={open} onOpenRecent={openRecent} externalError={shareError} receiving={receiving} />
        {toast}
      </>
    );
  }
  if (compare) {
    return (
      <>
        <CompareScreen
          a={compare.a}
          b={compare.b}
          onBack={() => history.back()}
          snapshots={snapshots}
          setSnapshots={setSnapshots}
        />
        {toast}
      </>
    );
  }
  return (
    <>
      <Analyse
        key={video.url}
        video={video}
        onBack={() => history.back()}
        snapshots={snapshots}
        setSnapshots={setSnapshots}
        onCompare={startPicking}
      />
      {picking && (
        <PickVideo
          current={video}
          onPickFile={(f) => pickB(f)}
          onPickRecent={async (r) => pickB(await fileForRecent(r), r)}
          onClose={() => setPicking(null)}
        />
      )}
      {toast}
    </>
  );
}
