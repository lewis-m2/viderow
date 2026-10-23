import { useEffect, useState } from 'preact/hooks';
import { Home } from './screens/Home';
import { Analyse } from './screens/Analyse';
import { probeVideo, type VideoMeta } from './video/probe';

export interface OpenVideo {
  file: File;
  url: string;
  name: string;
  meta: VideoMeta;
}

export class UnreadableFileError extends Error {
  constructor() {
    super('Android would not let Chrome read that video.');
  }
}

export function App() {
  const [video, setVideo] = useState<OpenVideo | null>(null);

  // Android back gesture returns to Home instead of leaving the app.
  useEffect(() => {
    const onPop = () => setVideo(null);
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

  if (!video) return <Home onOpen={open} />;
  return <Analyse video={video} onBack={() => history.back()} />;
}
