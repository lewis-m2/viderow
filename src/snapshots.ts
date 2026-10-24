export interface Snapshot {
  id: string;
  blob: Blob;
  /** Object URL for showing the image. */
  url: string;
  fileName: string;
  note: string;
}

let counter = 0;

export function makeSnapshot(blob: Blob, videoName: string, frame: number): Snapshot {
  const safe = videoName.replace(/[^\w-]+/g, '_').slice(0, 40) || 'video';
  return {
    id: `${Date.now().toString(36)}-${counter++}`,
    blob,
    url: URL.createObjectURL(blob),
    fileName: `${safe}_frame${frame + 1}.jpg`,
    note: '',
  };
}

const toFile = (s: Snapshot) => new File([s.blob], s.fileName, { type: 'image/jpeg' });

export type ShareResult = 'shared' | 'cancelled' | 'unsupported';

/**
 * Open the Android share sheet with the images and the note as text (WhatsApp uses it as the
 * caption). The note is also copied to the clipboard in case the app drops the text.
 */
export async function shareSnapshots(snaps: Snapshot[], note: string): Promise<ShareResult> {
  const files = snaps.map(toFile);
  const text = note.trim();
  // Copy first: the clipboard doesn't use up the tap the way share() does.
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked; sharing still works */
    }
  }
  const data: ShareData = text ? { files, text } : { files };
  if (!navigator.canShare?.(data)) return 'unsupported';
  try {
    await navigator.share(data);
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

/** Download the image. On Android it goes to Downloads (shown in the gallery's Download album). */
export function saveSnapshot(s: Snapshot) {
  const a = document.createElement('a');
  a.href = s.url;
  a.download = s.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
