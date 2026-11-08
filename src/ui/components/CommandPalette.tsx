import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import '../ds.css';

export type PaletteGroup = 'Go to' | 'Settings' | 'Actions' | 'Downloads';

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Muted text after the label: a state, a host or a section. */
  hint?: string;
  icon: ReactNode;
  /** Extra words that find this item. */
  keywords?: string;
  run: () => void;
}

const order: PaletteGroup[] = ['Go to', 'Actions', 'Settings', 'Downloads'];
const limits: Record<PaletteGroup, number> = {
  'Go to': 20,
  Actions: 20,
  Settings: 20,
  Downloads: 8,
};

/**
 * Quick access to every page, every settings section, the main actions and the downloads
 * themselves. Opened with / (Chrome reserves Ctrl+K). Downloads are listed only once something is
 * typed, so an empty search stays short.
 */
export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = items.filter((item) => {
      if (item.group === 'Downloads' && !words.length) return false;
      const text = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''} ${item.group}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    const used: Record<string, number> = {};
    return order.flatMap((group) =>
      found
        .filter((item) => item.group === group)
        .filter(() => {
          used[group] = (used[group] ?? 0) + 1;
          return used[group]! <= limits[group];
        }),
    );
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    // Let the palette close first, so the page it opens gets the focus.
    setTimeout(item.run, 0);
  }

  let lastGroup = '';
  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search and quick access"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((value) => Math.min(results.length - 1, value + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((value) => Math.max(0, value - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(results[active]);
          }
        }}
      >
        <div className="palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            aria-label="Search pages, settings, actions and downloads"
            placeholder="Search pages, settings, actions and downloads"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${results[active]!.id}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
          {results.map((item, index) => {
            const heading = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {heading && <p className="palette-group">{item.group}</p>}
                <div
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  className="palette-item"
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  {item.icon}
                  <span className="palette-label">{item.label}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                  {index === active && <CornerDownLeft size={14} aria-hidden="true" />}
                </div>
              </li>
            );
          })}
          {!results.length && <li className="palette-empty">Nothing matches “{query}”.</li>}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}
