import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
const fields = {
  metadata: 'Website and category',
  size: 'Transferred size',
  speed: 'Transfer speed',
  eta: 'Time remaining',
  connections: 'Connection count',
};
type Field = keyof typeof fields;
const defaults = {
  compact: false,
  ...Object.fromEntries(Object.keys(fields).map((key) => [key, true])),
} as Record<Field, boolean> & { compact: boolean };
export function useDisplayOptions() {
  const [value, setValue] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('flux-display') ?? '{}');
      return Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => [
          key,
          typeof stored?.[key] === 'boolean' ? stored[key] : fallback,
        ]),
      ) as typeof defaults;
    } catch {
      return { ...defaults };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('flux-display', JSON.stringify(value));
    } catch {
      /* Display remains usable without persistence. */
    }
  }, [value]);
  return { value, setValue };
}
export function DisplayOptions({ value, setValue }: ReturnType<typeof useDisplayOptions>) {
  return (
    <details className="display-options">
      <summary className="ds-btn is-outline is-small">
        <SlidersHorizontal size={16} aria-hidden="true" /> View options
      </summary>
      <div className="view-menu" role="group" aria-label="Download view">
        <div className="view-menu-head">
          <strong>Download view</strong>
          <button
            className="ds-btn is-ghost is-small"
            type="button"
            onClick={() => setValue({ ...defaults })}
          >
            Reset view
          </button>
        </div>
        <label className="view-row">
          <input
            type="checkbox"
            checked={value.compact}
            onChange={(event) => setValue({ ...value, compact: event.target.checked })}
          />
          Compact rows
        </label>
        <p className="view-caption">Show in each row</p>
        {Object.entries(fields).map(([key, label]) => (
          <label className="view-row" key={key}>
            <input
              type="checkbox"
              checked={value[key as Field]}
              onChange={(event) => setValue({ ...value, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}
