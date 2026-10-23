import { useRef, useState } from 'preact/hooks';
import { IconFolder, IconVideo } from '../icons';
import { UnreadableFileError } from '../App';

interface Props {
  onOpen: (file: File) => Promise<void>;
}

export function Home({ onOpen }: Props) {
  const galleryInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          `${err.message} Try "Browse files" and open it from the Camera folder (DCIM › Camera). ` +
            'If the video is only in Google Photos, download it to the phone first.',
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

      <button class="open-video" disabled={busy} onClick={() => galleryInput.current?.click()}>
        <IconVideo />
        <span>
          <span class="open-video-label">{busy ? 'Opening…' : 'Open video'}</span>
          <span class="open-video-sub">From your phone's gallery</span>
        </span>
      </button>
      <input ref={galleryInput} type="file" accept="video/*" hidden onChange={handleFile} />

      {/* No accept filter: Android shows its general file chooser (Files app)
          instead of the photo picker, which hands over the real file. */}
      <button class="browse-files" disabled={busy} onClick={() => filesInput.current?.click()}>
        <IconFolder />
        <span>Browse files</span>
      </button>
      <input ref={filesInput} type="file" hidden onChange={handleFile} />

      {error && <p class="error">{error}</p>}

      <footer class="home-footer muted">
        Videos stay on your phone. Nothing is uploaded.
        <div class="small">Build {__APP_BUILD__}</div>
      </footer>
    </main>
  );
}
