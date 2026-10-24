import { useEffect, useRef, useState } from 'preact/hooks';
import { IconBack, IconDownload, IconShare, IconTrash } from '../icons';
import { saveSnapshot, shareSnapshots, type Snapshot } from '../snapshots';
import { pushBack } from '../backStack';

interface Props {
  snapshots: Snapshot[];
  /** The one being shown (normally the one just taken). */
  currentId: string;
  onSelect: (id: string) => void;
  onNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function SnapshotScreen(p: Props) {
  const current = p.snapshots.find((s) => s.id === p.currentId) ?? p.snapshots[p.snapshots.length - 1];
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);

  // The Android back gesture closes this screen rather than leaving the video.
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;
  useEffect(() => pushBack(() => onCloseRef.current()), []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  if (!current) return null;

  function show(msg: string) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  async function share(snaps: Snapshot[], note: string) {
    try {
      const result = await shareSnapshots(snaps, note);
      if (result === 'unsupported') {
        snaps.forEach(saveSnapshot);
        show("This browser can't share files here, so the image was saved to Downloads instead.");
      } else if (note.trim()) {
        show('Note copied. If WhatsApp drops the caption, paste it in.');
      }
    } catch (err) {
      console.error(err);
      show(`Couldn't share: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const allNotes = p.snapshots
    .map((s) => s.note.trim())
    .filter(Boolean)
    .join('\n\n');

  return (
    <div class="snapshot-screen">
      <header class="snapshot-head">
        <button class="icon-button" onClick={() => history.back()} aria-label="Back to video">
          <IconBack />
        </button>
        <h2>Snapshot</h2>
        <button
          class="icon-button"
          onClick={() => {
            if (!confirm('Delete this snapshot?')) return;
            const wasLast = p.snapshots.length === 1;
            p.onDelete(current.id);
            // Always leave through history so the back gesture stays in step.
            if (wasLast) history.back();
          }}
          aria-label="Delete snapshot"
        >
          <IconTrash />
        </button>
      </header>

      <div class="snapshot-body">
        <img class="snapshot-preview" src={current.url} alt="Snapshot preview" />

        <div class="snapshot-side">
          <label class="snapshot-note">
            <textarea
              rows={3}
              placeholder="Add a note (optional)"
              value={current.note}
              onInput={(e) => p.onNote(current.id, (e.currentTarget as HTMLTextAreaElement).value)}
            />
            <span class="muted small">Sent as the WhatsApp caption</span>
          </label>

          <div class="snapshot-actions">
            <button class="secondary-button" onClick={() => {
              saveSnapshot(current);
              show('Saved to Downloads (Gallery › Download).');
            }}>
              <IconDownload />
              Save
            </button>
            <button class="primary-button" onClick={() => share([current], current.note)}>
              <IconShare />
              Share
            </button>
          </div>

          <div class="snapshot-strip-head">
            <span class="muted small">This session ({p.snapshots.length})</span>
            {p.snapshots.length > 1 && (
              <button class="secondary-button small-button" onClick={() => share(p.snapshots, allNotes)}>
                <IconShare />
                Share all
              </button>
            )}
          </div>
          <div class="snapshot-strip">
            {p.snapshots.map((s) => (
              <button
                class={`snapshot-thumb ${s.id === current.id ? 'is-selected' : ''}`}
                onClick={() => p.onSelect(s.id)}
                aria-label="Show this snapshot"
              >
                <img src={s.url} alt="" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {toast && <div class="toast" role="status">{toast}</div>}
    </div>
  );
}
