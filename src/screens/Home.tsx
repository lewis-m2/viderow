import { useRef, useState } from 'preact/hooks';
import { IconHelp, IconShare, IconVideo } from '../icons';
import { HelpScreen } from './HelpScreen';
import { UnreadableFileError } from '../App';

interface Props {
  onOpen: (file: File) => Promise<void>;
  /** Problem with a video shared from another app. */
  externalError?: string | null;
  /** A shared video is being opened. */
  receiving?: boolean;
}

export function Home({ onOpen, externalError, receiving }: Props) {
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function handleFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(file);
    } catch (err) {
      console.error(err);
      if (err instanceof UnreadableFileError) {
        setError(
          `${err.message} Try sharing it to Row Coach from Google Photos or Gallery, ` +
            'or pick it from Files › DCIM › Camera.',
        );
      } else {
        setError(`Couldn't open that video: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="home">
      <h1 class="home-title">Rowing Video Coach</h1>

      {/* No accept filter: Android shows its general file chooser (Files app), which hands
          Chrome the real file. Android's photo picker (accept="video/*") gave files Chrome
          couldn't read (NotReadableError) on the user's Samsung, so it isn't offered. */}
      <button class="open-video" disabled={busy || receiving} onClick={() => filesInput.current?.click()}>
        <IconVideo />
        <span>
          <span class="open-video-label">{busy || receiving ? 'Opening…' : 'Open video'}</span>
          <span class="open-video-sub">From Files › DCIM › Camera</span>
        </span>
      </button>
      <input ref={filesInput} type="file" hidden onChange={handleFile} />

      <div class="share-tip">
        <IconShare />
        <p>
          <strong>Quicker:</strong> in Google Photos or Gallery, open the video and tap{' '}
          <strong>Share › Row Coach</strong>.
        </p>
      </div>

      {(error || externalError) && <p class="error">{error ?? externalError}</p>}

      <button class="browse-files" onClick={() => setHelpOpen(true)}>
        <IconHelp />
        <span>How to use</span>
      </button>
      {helpOpen && <HelpScreen onClose={() => setHelpOpen(false)} />}

      <footer class="home-footer muted">
        Videos stay on your phone. Nothing is uploaded.
        <div class="small">Build {__APP_BUILD__}</div>
      </footer>
    </main>
  );
}
