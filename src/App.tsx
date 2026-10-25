import { useEffect, useState } from 'preact/hooks';
import { Home } from './screens/Home';
import { Analyse } from './screens/Analyse';
import { probeVideo, type VideoMeta } from './video/probe';
import type { Snapshot } from './snapshots';
import { handleBack } from './backStack';

export interface OpenVideo {
  file: File;
  url: string;
  name: string;
  meta: VideoMeta;
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

  useEffect(() => {
    if (!video) return;
    return () => URL.revokeObjectURL(video.url);
  }, [video]);

  async function open(file: File) {
    // Android's photo picker sometimes hands over a file Chrome isn't allowed to read
    // (e.g. a cloud-only video). Catch that here rather than showing a broken screen.
    try {
      await file.slice(0, 16).arrayBuffer();
    } catch (err) {
      console.warn('File not readable', err);
      throw new UnreadableFileError();
    }
    const meta = await probeVideo(file);
    const name = file.name.replace(/\.[^.]+$/, '');
    setVideo({ file, url: URL.createObjectURL(file), name, meta });
    history.pushState({ screen: 'analyse' }, '');
  }

  if (!video) return <Home onOpen={open} externalError={shareError} receiving={receiving} />;
  return (
    <Analyse
      video={video}
      onBack={() => history.back()}
      snapshots={snapshots}
      setSnapshots={setSnapshots}
    />
  );
}
