/**
 * The Android back gesture (and Chrome's back button) fire `popstate`. Screens that open on top
 * of others (like the snapshot screen) register a closer here; App's popstate handler closes the
 * top-most one, or leaves the video if there are none.
 */
const closers: Array<() => void> = [];

/** Add a history entry for an overlay. Returns a function to call when it unmounts. */
export function pushBack(close: () => void): () => void {
  history.pushState({ overlay: closers.length + 1 }, '');
  closers.push(close);
  return () => {
    const i = closers.lastIndexOf(close);
    if (i >= 0) closers.splice(i, 1);
  };
}

/** Called from App's popstate handler. True if an overlay handled the back press. */
export function handleBack(): boolean {
  const close = closers.pop();
  if (!close) return false;
  close();
  return true;
}
