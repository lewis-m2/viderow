// Simple stroke icons (24×24). Styled by the .icon class.

type P = { class?: string };
const cls = (p: P) => `icon ${p.class ?? ''}`;

export const IconVideo = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10 9.5v5l4-2.5z" />
  </svg>
);

export const IconBack = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconPlay = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </svg>
);

export const IconPause = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
    <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
  </svg>
);

/** » hide panel */
export const IconCollapse = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l6 6-6 6M13 6l6 6-6 6" />
  </svg>
);

/** « show panel */
export const IconExpand = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18 6l-6 6 6 6M11 6l-6 6 6 6" />
  </svg>
);
