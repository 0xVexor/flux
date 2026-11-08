import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { inPopup } from './popup-room';
import '../ds.css';

interface Option {
  value: string;
  label: string;
  disabled: boolean;
}
interface Group {
  label?: string;
  options: Option[];
}

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement(child)) return textOf((child.props as { children?: ReactNode }).children);
      return '';
    })
    .join('');
}

function optionOf(child: ReactNode): Option | null {
  if (!isValidElement(child) || child.type !== 'option') return null;
  const props = child.props as {
    value?: string | number;
    children?: ReactNode;
    disabled?: boolean;
  };
  const label = textOf(props.children);
  return {
    value: props.value === undefined ? label : String(props.value),
    label,
    disabled: !!props.disabled,
  };
}

/** Reads <option> and <optgroup> children, so the component swaps in for a native <select>. */
function readGroups(children: ReactNode): Group[] {
  const groups: Group[] = [];
  let loose: Option[] = [];
  const flush = () => {
    if (loose.length) groups.push({ options: loose });
    loose = [];
  };
  const visit = (nodes: ReactNode) =>
    Children.forEach(nodes, (child) => {
      if (isValidElement(child) && child.type === Fragment) {
        visit((child.props as { children?: ReactNode }).children);
        return;
      }
      if (isValidElement(child) && child.type === 'optgroup') {
        flush();
        const props = child.props as { label?: string; children?: ReactNode };
        const options: Option[] = [];
        Children.forEach(props.children, (item) => {
          const option = optionOf(item);
          if (option) options.push(option);
        });
        if (options.length) groups.push({ label: props.label, options });
        return;
      }
      const option = optionOf(child);
      if (option) loose.push(option);
    });
  visit(children);
  flush();
  return groups;
}

interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Where a floating list goes: below the trigger when there is room, above it when there is
 * not, and never taller than the room it has, so it cannot be cut off by a small window.
 */
function placeList(trigger: DOMRect, wanted: number): Place {
  const below = window.innerHeight - trigger.bottom - 12;
  const above = trigger.top - 12;
  const flip = below < Math.min(wanted, 160) && above > below;
  const room = Math.max(96, Math.min(wanted, flip ? above : below));
  return {
    left: trigger.left,
    width: trigger.width,
    maxHeight: room,
    ...(flip ? { bottom: window.innerHeight - trigger.top + 4 } : { top: trigger.bottom + 4 }),
  };
}

interface SelectProps {
  id?: string;
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string; name?: string } }) => void;
  disabled?: boolean;
  icon?: ReactNode;
  size?: 'sm';
  'aria-label'?: string;
  'aria-describedby'?: string;
  children?: ReactNode;
}

/**
 * The shared dropdown. In a normal window the list floats above the page. In the toolbar popup
 * nothing can be drawn outside the window, so the list opens inside the form, like the
 * calendar, and the window grows with it.
 */
export function Select({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  icon,
  size,
  children,
  ...aria
}: SelectProps) {
  const generated = useId();
  const listId = `${generated}-list`;
  const groups = useMemo(() => readGroups(children), [children]);
  const flat = useMemo(() => groups.flatMap((group) => group.options), [groups]);
  const [inner, setInner] = useState(String(defaultValue ?? ''));
  const current = value === undefined ? inner : String(value);
  const selected = flat.find((option) => option.value === current) ?? flat[0];
  const [open, setOpen] = useState(false);
  const [inline, setInline] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    const away = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    // A floating list would come loose from its trigger, so it closes; an inline one moves along.
    if (!inline) {
      window.addEventListener('resize', away);
      window.addEventListener('scroll', away, true);
    }
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open, inline]);
  useEffect(() => {
    if (open)
      list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  // The popup window stops growing at 600 px, so bring the whole list into view.
  useEffect(() => {
    if (open && inline) list.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open, inline]);

  function show() {
    if (disabled || !trigger.current) return;
    setActive(
      Math.max(
        0,
        flat.findIndex((option) => option.value === selected?.value),
      ),
    );
    const asInline = inPopup();
    setInline(asInline);
    if (!asInline) {
      // Rows are 32 px, group headings about 26 px, plus the list's own padding.
      const wanted = Math.min(
        232,
        flat.length * 32 + groups.filter((g) => g.label).length * 26 + 10,
      );
      setPlace(placeList(trigger.current.getBoundingClientRect(), wanted));
    }
    setOpen(true);
  }
  function choose(option: Option) {
    if (option.disabled) return;
    setOpen(false);
    if (value === undefined) setInner(option.value);
    onChange?.({ target: { value: option.value, name } });
  }
  function move(step: number) {
    let next = active;
    for (let tries = 0; tries < flat.length; tries++) {
      next = (next + step + flat.length) % flat.length;
      if (!flat[next]?.disabled) break;
    }
    setActive(next);
  }
  function keys(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) show();
      else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : flat.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) show();
      else if (flat[active]) choose(flat[active]);
    } else if (event.key === 'Escape' && open) {
      // Close only the list; the dialog around it stays.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
  }

  let index = -1;
  const menu = (style?: CSSProperties) => (
    <ul
      className={`ds-select-list${inline ? ' is-inline' : ''}`}
      role="listbox"
      id={listId}
      ref={list}
      style={style}
    >
      {groups.map((group, position) => (
        <Fragment key={position}>
          {position > 0 && <li className="ds-select-sep" role="presentation" />}
          {group.label && (
            <li className="ds-select-group" role="presentation">
              {group.label}
            </li>
          )}
          {group.options.map((option) => {
            index += 1;
            const mine = index;
            return (
              <li
                key={option.value}
                role="option"
                className="ds-select-item"
                aria-selected={option.value === selected?.value}
                aria-disabled={option.disabled || undefined}
                data-active={mine === active}
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onPointerMove={() => setActive(mine)}
              >
                <span>{option.label}</span>
                {option.value === selected?.value && (
                  <Check size={16} className="ds-select-check" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </Fragment>
      ))}
    </ul>
  );
  const floating =
    open && !inline && place
      ? createPortal(
          menu({
            left: place.left,
            minWidth: place.width,
            maxHeight: place.maxHeight,
            ...(place.top !== undefined ? { top: place.top } : { bottom: place.bottom }),
          }),
          // Inside a modal dialog the list must live in the dialog, or the top layer hides it.
          trigger.current?.closest('dialog') ?? document.body,
        )
      : null;
  return (
    <div className={`ds-select${size === 'sm' ? ' is-small' : ''}`} ref={box}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        id={id}
        ref={trigger}
        className="ds-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keys}
      >
        {icon}
        <span className="ds-select-value">{selected?.label ?? ''}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && inline ? menu() : floating}
    </div>
  );
}
