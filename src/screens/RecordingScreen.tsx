import { useEffect, useRef, useState } from 'preact/hooks';
import { IconBack, IconDownload, IconShare, IconTrash } from '../icons';
import { pushBack } from '../backStack';
import type { Recording } from '../recording/recorder';

interface Props {
  recording: Recording;
  /** Called once the screen has closed (recording is then thrown away). */
  onClose: () => void;
}

const DISCARD_PROMPT = 'Discard this recording? Save or share it first if you want to keep it.';

export function RecordingScreen({ recording, onClose }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const kept = useRef(false); // saved or shared: no need to ask before closing
  const toastTimer = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Back gesture: ask before throwing the recording away; if they cancel, stay here.
  useEffect(() => {
    let remove = () => {};
    const register = () => {
      remove = pushBack(() => {
        if (kept.current || confirm(DISCARD_PROMPT)) onCloseRef.current();
        else register();
      });
    };
    register();
    return () => {
      remove();
      clearTimeout(toastTimer.current);
    };
  }, []);

  function show(msg: string) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  const file = () => new File([recording.blob], recording.fileName, { type: recording.mimeType });

  function save() {
    const a = document.createElement('a');
    a.href = recording.url;
    a.download = recording.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    kept.current = true;
    show('Saved to Downloads (Gallery › Download).');
  }

  async function share() {
    const data: ShareData = { files: [file()] };
    if (!navigator.canShare?.(data)) {
      save();
      show("This browser can't share videos here, so it was saved to Downloads instead.");
      return;
    }
    try {
      await navigator.share(data);
      kept.current = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      show(`Couldn't share: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const mb = (recording.blob.size / 1e6).toFixed(1);
  const secs = Math.round(recording.seconds);
  const length = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const isWebm = recording.mimeType === 'video/webm';

  return (
    <div class="snapshot-screen">
      <header class="snapshot-head">
        <button class="icon-button" onClick={() => history.back()} aria-label="Back to video">
          <IconBack />
        </button>
        <h2>Recording</h2>
        <button
          class="icon-button"
          onClick={() => {
            if (!confirm('Delete this recording?')) return;
            kept.current = true; // already confirmed
            history.back();
          }}
          aria-label="Delete recording"
        >
          <IconTrash />
        </button>
      </header>

      <div class="snapshot-body">
        <video class="snapshot-preview" src={recording.url} controls playsInline />
        <div class="snapshot-side">
          <p class="muted">
            {length} · {mb} MB · {isWebm ? 'WebM' : 'MP4'}
          </p>
          {isWebm && (
            <p class="muted small">
              This phone made a WebM video. If WhatsApp won't play it, use Save and send it from the gallery.
            </p>
          )}
          <div class="snapshot-actions">
            <button class="secondary-button" onClick={save}>
              <IconDownload />
              Save
            </button>
            <button class="primary-button" onClick={share}>
              <IconShare />
              Share
            </button>
          </div>
        </div>
      </div>

      {toast && <div class="toast" role="status">{toast}</div>}
    </div>
  );
}
