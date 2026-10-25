import { useEffect, useRef, useState } from 'preact/hooks';
import type { OpenVideo } from '../App';
import { IconBack, IconVideo } from '../icons';
import { pushBack } from '../backStack';
import { listRecent, type RecentVideo } from '../library';
import { formatFps, formatLength } from '../format';

interface Props {
  /** Video A (can also be picked, to compare two moments of the same video). */
  current: OpenVideo;
  onPickFile: (file: File) => Promise<void>;
  onPickRecent: (video: RecentVideo) => Promise<void>;
  onClose: () => void;
}

/** Choose video B for Compare: ★ references first, then other recent videos, then Files. */
export function PickVideo(p: Props) {
  const [recents, setRecents] = useState<RecentVideo[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;

  useEffect(() => pushBack(() => onCloseRef.current()), []);

  useEffect(() => {
    let urls: Record<string, string> = {};
    listRecent()
      .then((list) => {
        // References first, then the rest (each newest first).
        setRecents([...list.filter((v) => v.starred), ...list.filter((v) => !v.starred)]);
        for (const v of list) if (v.thumb) urls[v.id] = URL.createObjectURL(v.thumb);
        setThumbs(urls);
      })
      .catch(() => setRecents([]));
    return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(`Couldn't open that video: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  }

  const refs = recents?.filter((v) => v.starred) ?? [];
  const others = recents?.filter((v) => !v.starred) ?? [];

  const item = (v: RecentVideo) => (
    <li class="recent-item">
      <button class="recent-main" disabled={busy} onClick={() => run(() => p.onPickRecent(v))}>
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
          {v.id === p.current.id && <span class="muted small">This video (compare two moments)</span>}
          <span class="muted small">
            {[v.duration ? formatLength(v.duration) : null, v.fps ? `${formatFps(v.fps)} fps` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div class="help-screen">
      <header class="snapshot-head">
        <button class="icon-button" onClick={() => history.back()} aria-label="Cancel">
          <IconBack />
        </button>
        <h2>Compare with…</h2>
      </header>
      <div class="help-body pick-body">
        <p class="muted">
          A is <strong>{p.current.name}</strong>. Pick video B — a reference or an earlier session.
        </p>
        {error && <p class="error">{error}</p>}
        {busy && <p>Opening…</p>}

        {refs.length > 0 && (
          <section class="recents">
            <h3>★ References</h3>
            <ul>{refs.map(item)}</ul>
          </section>
        )}
        {others.length > 0 && (
          <section class="recents">
            <h3>Recent videos</h3>
            <ul>{others.map(item)}</ul>
          </section>
        )}

        <button class="open-video pick-files" disabled={busy} onClick={() => input.current?.click()}>
          <IconVideo />
          <span>
            <span class="open-video-label">Open from Files</span>
            <span class="open-video-sub">Files › DCIM › Camera</span>
          </span>
        </button>
        <input
          ref={input}
          type="file"
          hidden
          onChange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            (e.currentTarget as HTMLInputElement).value = '';
            if (f) run(() => p.onPickFile(f));
          }}
        />
      </div>
    </div>
  );
}
