import type { JSX } from 'preact';
import {
  IconAngle,
  IconArrow,
  IconDraw,
  IconErase,
  IconLine,
  IconPan,
  IconToolsHide,
  IconTrash,
  IconUndo,
} from '../icons';
import type { Tool } from './model';
import type { DrawingSettings } from './useDrawing';

const TOOLS: Array<{ tool: Tool; label: string; icon: () => JSX.Element }> = [
  { tool: 'move', label: 'Pan', icon: () => <IconPan /> },
  { tool: 'line', label: 'Line', icon: () => <IconLine /> },
  { tool: 'angle', label: 'Angle', icon: () => <IconAngle /> },
  { tool: 'free', label: 'Draw', icon: () => <IconDraw /> },
  { tool: 'arrow', label: 'Arrow', icon: () => <IconArrow /> },
  { tool: 'erase', label: 'Erase', icon: () => <IconErase /> },
];

interface Props {
  settings: DrawingSettings;
  canUndo: boolean;
  onUndo: () => void;
  canClear: boolean;
  onClear: () => void;
  panelOpen: boolean;
  onPanel: () => void;
  /** Landscape only: slide the tool rail away. */
  onHide?: () => void;
  class?: string;
}

/** Pan / drawing tools / Undo / Clear / Colour, as a bottom tray or a side rail. */
export function ToolTray(p: Props) {
  return (
    <nav class={`tools ${p.class ?? ''}`} aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          class={`tool ${p.settings.tool === t.tool ? 'is-selected' : ''}`}
          aria-pressed={p.settings.tool === t.tool}
          aria-label={t.label}
          onClick={() => p.settings.setTool(t.tool)}
        >
          {t.icon()}
          <span class="tool-label">{t.label}</span>
        </button>
      ))}
      <button class="tool" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo">
        <IconUndo />
        <span class="tool-label">Undo</span>
      </button>
      <button class="tool tool-clear" onClick={p.onClear} disabled={!p.canClear} aria-label="Clear all">
        <IconTrash />
        <span class="tool-label">Clear</span>
      </button>
      <button
        class={`tool ${p.panelOpen ? 'is-selected' : ''}`}
        onClick={p.onPanel}
        aria-label="Colour and drawing options"
      >
        <span class="swatch-icon" style={{ background: p.settings.colour }} />
        <span class="tool-label">Colour</span>
      </button>
      {p.onHide && (
        <button class="tool tool-hide" onClick={p.onHide} aria-label="Hide drawing tools">
          <IconToolsHide />
        </button>
      )}
    </nav>
  );
}
