export function App() {
  return (
    <main class="home">
      <h1 class="home-title">Rowing Video Coach</h1>

      <button class="open-video" disabled>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10 9.5v5l4-2.5z" />
        </svg>
        <span>
          <span class="open-video-label">Open video</span>
          <span class="open-video-sub">From your phone's gallery</span>
        </span>
      </button>

      <p class="muted">Setup check: if you can see this full screen from your home screen, milestone 0 works.</p>

      <footer class="home-footer muted">Videos stay on your phone. Nothing is uploaded.</footer>
    </main>
  );
}
