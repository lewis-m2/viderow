import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker updates. A new version downloads in the background; instead of reloading
 * mid-session (which would lose snapshots), Home shows an "Update ready" banner.
 * We also check for a new version whenever the app comes back to the foreground.
 */
let ready = false;
const listeners = new Set<() => void>();

export const updateReady = () => ready;

export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyUpdate() {
  location.reload();
}

export function startUpdates() {
  registerSW({
    immediate: true,
    onNeedReload() {
      ready = true;
      listeners.forEach((fn) => fn());
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    },
  });
}
