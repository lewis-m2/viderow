import { IconClose, IconTrash } from '../icons';
import { COLOURS, describe, type Drawing, type Scope, type Thickness } from './model';

const THICKNESSES: Array<{ value: Thickness; label: string }> = [
  { value: 'thin', label: 'Thin' },
  { value: 'medium', label: 'Medium' },
  { value: 'thick', label: 'Thick' },
];

interface Props {
  colour: string;
  thickness: Thickness;
  scope: Scope;
  onStyle: (patch: Partial<{ colour: string; thickness: Thickness; scope: Scope }>) => void;
  /** Drawings showing on the current frame. */
  drawings: Drawing[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export function DrawingPanel(p: Props) {
  return (
    <aside class="draw-panel" aria-label="Drawing options">
      <header class="draw-panel-head">
        <h2>{p.selectedId ? 'Selected drawing' : 'Drawing options'}</h2>
        <button class="icon-button" onClick={p.onClose} aria-label="Close">
          <IconClose />
        </button>
      </header>

      <div class="segmented" role="radiogroup" aria-label="Show on">
        {(
          [
            ['frame', 'This frame only'],
            ['video', 'Whole video'],
          ] as const
        ).map(([value, label]) => (
          <button
            role="radio"
            aria-checked={p.scope === value}
            class={p.scope === value ? 'is-selected' : ''}
            onClick={() => p.onStyle({ scope: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <div class="swatches" role="radiogroup" aria-label="Colour">
        {COLOURS.map((c) => (
          <button
            role="radio"
            aria-checked={p.colour === c.value}
            aria-label={c.name}
            class={`swatch ${p.colour === c.value ? 'is-selected' : ''}`}
            style={{ '--swatch': c.value }}
            onClick={() => p.onStyle({ colour: c.value })}
          />
        ))}
      </div>

      <div class="segmented" role="radiogroup" aria-label="Thickness">
        {THICKNESSES.map((t) => (
          <button
            role="radio"
            aria-checked={p.thickness === t.value}
            class={p.thickness === t.value ? 'is-selected' : ''}
            onClick={() => p.onStyle({ thickness: t.value })}
          >
            <span class={`thickness-sample is-${t.value}`} />
            {t.label}
          </button>
        ))}
      </div>

      <h3 class="muted small">On this frame</h3>
      {p.drawings.length === 0 ? (
        <p class="muted small">No drawings on this frame.</p>
      ) : (
        <ul class="draw-list">
          {p.drawings.map((d) => (
            <li class={d.id === p.selectedId ? 'is-selected' : ''}>
              <button class="draw-list-item" onClick={() => p.onSelect(d.id)}>
                <span class="dot" style={{ background: d.colour }} />
                <span>{describe(d)}</span>
                <span class="muted small">{d.scope === 'frame' ? 'this frame' : 'whole video'}</span>
              </button>
              <button class="icon-button" onClick={() => p.onDelete(d.id)} aria-label={`Delete ${describe(d)}`}>
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button class="danger-button" onClick={p.onClearAll} disabled={p.total === 0}>
        <IconTrash />
        Clear all ({p.total})
      </button>
    </aside>
  );
}
