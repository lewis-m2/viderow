import { useEffect, useRef, useState } from 'preact/hooks';
import { IconHelp, IconShare, IconStar, IconStarFilled, IconTrash, IconVideo } from '../icons';
import { deleteVideo, listRecent, storageUsed, updateRecent, type RecentVideo } from '../library';
import { formatFps, formatLength } from '../format';
import { applyUpdate, onUpdateReady, updateReady } from '../updates';
import { HelpScreen } from './HelpScreen';
import { UnreadableFileError } from '../App';

interface Props {
  onOpen: (file: File) => Promise<void>;
  onOpenRecent: (video: RecentVideo) => Promise<void>;
  /** Problem with a video shared from another app. */
  externalError?: string | null;
  /** A shared video is being opened. */
  receiving?: boolean;
}

export function Home({ onOpen, onOpenRecent, externalError, receiving }: Props) {
  const filesInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [recents, setRecents] = useState<RecentVideo[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [used, setUsed] = useState<number | null>(null);
  const [hasUpdate, setHasUpdate] = useState(updateReady);
  useEffect(() => onUpdateReady(() => setHasUpdate(true)), []);

  async function refresh() {
    try {
      const list = await listRecent();
      setRecents(list);
      setUsed(await storageUsed());
      setThumbs((old) => {
        Object.values(old).forEach((u) => URL.revokeObjectURL(u));
        const next: Record<string, string> = {};
        for (const v of list) if (v.thumb) next[v.id] = URL.createObjectURL(v.thumb);
        return next;
      });
    } catch (err) {
      console.warn('Could not read recent videos', err);
      setRecents([]);
    }
  }

  useEffect(() => {
    refresh();
    // The thumbnail of the video just closed is saved a moment after leaving it.
    const t = setTimeout(refresh, 1000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => () => Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  async function openRecent(v: RecentVideo) {
    setBusy(true);
    setError(null);
    try {
      await onOpenRecent(v);
    } catch (err) {
      setError(`Couldn't open that video: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStar(v: RecentVideo) {
    await updateRecent(v.id, { starred: !v.starred });
    refresh();
  }

  async function remove(v: RecentVideo) {
    if (!confirm(`Remove "${v.name}" and its drawings from this phone?\n\nThe original stays in your gallery.`)) return;
    await deleteVideo(v.id);
    refresh();
  }

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

      {hasUpdate && (
        <button class="update-banner" onClick={applyUpdate}>
          New version ready · tap to update
        </button>
      )}

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

      {recents && recents.length > 0 && (
        <section class="recents" aria-label="Recent videos">
          <h2 class="recents-title">Recent videos</h2>
          <ul>
            {recents.map((v) => (
              <li class="recent-item">
                <button class="recent-main" disabled={busy} onClick={() => openRecent(v)}>
                  {thumbs[v.id] ? (
                    <img class="recent-thumb" src={thumbs[v.id]} alt="" />
                  ) : (
                    <span class="recent-thumb">
                      <IconVideo />
                    </span>
                  )}
                  <span class="recent-text">
                    <span class="recent-name">{v.name}</span>
                    {v.starred && <span class="ref-label">★ Reference</span>}
                    <span class="muted small">
                      {[
                        v.duration ? formatLength(v.duration) : null,
                        v.fps ? `${formatFps(v.fps)} fps` : null,
                        `${v.drawingCount} drawing${v.drawingCount === 1 ? '' : 's'}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
                <button
                  class={`icon-button star-button ${v.starred ? 'is-starred' : ''}`}
                  onClick={() => toggleStar(v)}
                  aria-label={v.starred ? 'Unstar (no longer a reference)' : 'Star as a reference video'}
                >
                  {v.starred ? <IconStarFilled /> : <IconStar />}
                </button>
                <button class="icon-button" onClick={() => remove(v)} aria-label={`Remove ${v.name}`}>
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
          <p class="muted small">
            {used !== null ? `Using ${(used / 1e9).toFixed(1)} GB on this phone. ` : ''}
            Clearing Chrome's site data removes this list; your originals stay in the gallery.
          </p>
        </section>
      )}

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
