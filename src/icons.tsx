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

export const IconGallery = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);

/** |◀ one frame back */
export const IconFrameBack = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 5v14" />
    <path d="M19 5.5v13L9.5 12z" fill="currentColor" />
  </svg>
);

/** ▶| one frame forward */
export const IconFrameForward = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18 5v14" />
    <path d="M5 5.5v13l9.5-6.5z" fill="currentColor" />
  </svg>
);

export const IconMinus = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** Move / edit: four-way arrows */
export const IconMove = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
  </svg>
);

export const IconLine = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 18L18 6" />
    <circle cx="5" cy="19" r="1.8" fill="currentColor" />
    <circle cx="19" cy="5" r="1.8" fill="currentColor" />
  </svg>
);

export const IconAngle = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M19 5L5 19h15" />
    <path d="M10.5 13.5a6 6 0 0 1 2 5.5" />
  </svg>
);

/** Freehand */
export const IconDraw = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 17c3-6 5-6 6-3s3 3 5-1 4-5 7-3" />
  </svg>
);

export const IconArrow = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 19L19 5M10 5h9v9" />
  </svg>
);

export const IconUndo = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconHome = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 11l8-7 8 7M6 9.5V20h4.5v-6h3v6H18V9.5" />
  </svg>
);

/** Slide the tool rail away (chevron pointing left, towards the edge) */
export const IconToolsHide = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 6l-6 6 6 6" />
    <path d="M19 4v16" />
  </svg>
);

/** Bring the tool rail back: pen + chevron */
export const IconToolsShow = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 20l1-4 9-9 3 3-9 9z" />
    <path d="M17 13l3-3-3-3" />
  </svg>
);

export const IconCamera = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const IconShare = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg class={cls(p)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
