import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { inPopup } from './popup-room';
import '../ds.css';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Reads "YYYY-MM-DDTHH:mm" (the same text a datetime-local input uses). */
function parse(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as number[];
  return { date: new Date(y!, mo! - 1, d!), time: `${pad(h!)}:${pad(mi!)}` };
}

interface Props {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Date and time in one popover: a month calendar above a time field. */
export function DateTimePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  ...aria
}: Props) {
  const generated = useId();
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value === undefined ? inner : value;
  const parsed = parse(current);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const base = parsed?.date ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    // A floating calendar is placed once; if the window changes under it, close it.
    const away = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open]);

  // The toolbar popup cannot draw outside its window (600 px at most), so there the calendar
  // opens inline and is scrolled into view. Everywhere else it floats over the page.
  const inline = typeof document === 'undefined' || inPopup();
  useEffect(() => {
    if (open && inline) panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, inline]);

  function emit(date: Date, time: string) {
    const next = `${dayKey(date)}T${time}`;
    if (value === undefined) setInner(next);
    onChange?.(next);
  }
  function show() {
    if (disabled) return;
    const base = parsed?.date ?? new Date();
    setMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    const rect = trigger.current?.getBoundingClientRect();
    if (rect && !inline) {
      const wanted = 400;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const flip = below < Math.min(wanted, 320) && above > below;
      const room = Math.max(200, Math.min(wanted, flip ? above : below));
      setPlace({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 296 - 8)),
        maxHeight: room,
        ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    setOpen(true);
  }
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  // Six weeks starting on Monday, so the grid never changes height.
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
  const label = parsed
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(
          parsed.date.getFullYear(),
          parsed.date.getMonth(),
          parsed.date.getDate(),
          Number(parsed.time.slice(0, 2)),
          Number(parsed.time.slice(3)),
        ),
      )
    : '';
  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    month,
  );

  const wrap = (node: ReactElement) =>
    inline ? node : createPortal(node, trigger.current?.closest('dialog') ?? document.body);

  return (
    <div className="ds-select ds-datepicker" ref={box} onKeyDown={keys}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        id={id}
        ref={trigger}
        className="ds-select-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${generated}-panel`}
        aria-label={aria['aria-label']}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span className={`ds-select-value${label ? '' : ' is-empty'}`}>
          {label || 'Pick date and time'}
        </span>
      </button>
      {open && (inline || place) &&
        wrap(
        <div
          ref={panel}
          className={`ds-datepicker-panel${inline ? '' : ' is-floating'}`}
          style={inline || !place ? undefined : place}
          id={`${generated}-panel`}
          role="dialog"
          aria-label="Choose date and time"
        >
          <div className="ds-cal-head">
            <button
              type="button"
              className="ds-icon-btn"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeft size={16} />
            </button>
            <strong>{title}</strong>
            <button
              type="button"
              className="ds-icon-btn"
              aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="ds-cal-grid" role="grid">
            {WEEKDAYS.map((name) => (
              <span key={name} className="ds-cal-weekday" role="columnheader">
                {name}
              </span>
            ))}
            {days.map((day) => {
              const key = dayKey(day);
              const past = day < today;
              const selected = parsed ? key === dayKey(parsed.date) : false;
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  className={[
                    'ds-day',
                    day.getMonth() !== month.getMonth() ? 'is-outside' : '',
                    key === dayKey(today) ? 'is-today' : '',
                    selected ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-selected={selected}
                  disabled={past}
                  onClick={() => emit(day, parsed?.time ?? '09:00')}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
          <div className="ds-cal-time">
            <label htmlFor={`${generated}-time`}>Time</label>
            <input
              id={`${generated}-time`}
              type="time"
              value={parsed?.time ?? '09:00'}
              onChange={(event) => {
                if (event.target.value) emit(parsed?.date ?? today, event.target.value);
              }}
            />
          </div>
        </div>,
        )}
    </div>
  );
}
