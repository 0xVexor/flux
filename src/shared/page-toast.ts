/**
 * The notice that appears on the website you are looking at when a download finishes.
 *
 * `showPageToast` is injected into the page with chrome.scripting.executeScript, which copies
 * the function's source into the page. It therefore must not use anything from outside itself:
 * no imports, no helpers, no constants. Styles are set from script (allowed on every site, even
 * under a strict content security policy), and the toast lives in a closed shadow root so the
 * site's own CSS cannot change it and it cannot change the site.
 */

export interface PageToastNotice {
  kind: 'saved' | 'ready' | 'failed' | 'queue';
  title: string;
  filename: string;
  detail: string;
  id?: string;
  /** 0 keeps the toast until it is closed. */
  autoCloseMs: number;
}

/** The same colours as tokens.css, so the toast matches the app in both themes. */
export const toastPalettes = {
  dark: {
    surface: '#111c25',
    border: '#263742',
    text: '#eef5fc',
    muted: '#a1b6c8',
    accent: '#00cfb0',
    ink: '#04201a',
    danger: '#f59a9a',
    hover: 'rgba(255, 255, 255, 0.06)',
  },
  light: {
    surface: '#ffffff',
    border: '#e2eaf2',
    text: '#09162f',
    muted: '#607697',
    accent: '#008672',
    ink: '#ffffff',
    danger: '#c0444a',
    hover: 'rgba(14, 42, 41, 0.05)',
  },
};

export function showPageToast(
  notice: PageToastNotice,
  theme: 'dark' | 'light' | 'system',
  palettes: typeof toastPalettes,
) {
  const id = 'flux-page-toast';
  document.getElementById(id)?.remove();
  const mode =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  const c = palettes[mode];
  const svgNs = 'http://www.w3.org/2000/svg';
  const make = (tag: string, css: string, text?: string) => {
    const el = document.createElement(tag);
    el.style.cssText = css;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const icon = (paths: string[], color: string) => {
    const svg = document.createElementNS(svgNs, 'svg');
    for (const [key, value] of [
      ['viewBox', '0 0 24 24'],
      ['width', '16'],
      ['height', '16'],
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '2'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['aria-hidden', 'true'],
    ] as const)
      svg.setAttribute(key, value);
    svg.style.cssText = `flex:none;color:${color};`;
    for (const d of paths) {
      const path = document.createElementNS(svgNs, d.startsWith('c:') ? 'circle' : 'path');
      if (d.startsWith('c:')) {
        path.setAttribute('cx', '12');
        path.setAttribute('cy', '12');
        path.setAttribute('r', d.slice(2));
      } else path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  };

  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const card = make(
    'div',
    `display:flex;align-items:flex-start;gap:12px;box-sizing:border-box;width:360px;max-width:calc(100vw - 32px);` +
      `padding:12px 12px 12px 16px;border:1px solid ${c.border};border-radius:8px;background:${c.surface};` +
      `color:${c.text};box-shadow:0 10px 30px rgba(0,0,0,0.25);` +
      `font:14px/20px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;` +
      `opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease;`,
  );
  card.setAttribute('role', notice.kind === 'failed' ? 'alert' : 'status');

  const symbol =
    notice.kind === 'failed'
      ? icon(['c:10', 'M12 8v4', 'M12 16h.01'], c.danger)
      : notice.kind === 'ready'
        ? icon(['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'], c.accent)
        : icon(['c:10', 'm9 12 2 2 4-4'], c.accent);
  symbol.style.marginTop = '2px';

  const body = make('div', 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;');
  body.appendChild(make('div', 'font-weight:500;', notice.title));
  body.appendChild(
    make(
      'div',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:plaintext;text-align:left;',
      notice.filename,
    ),
  );
  body.appendChild(
    make(
      'div',
      `font-size:12px;line-height:16px;overflow-wrap:anywhere;color:${notice.kind === 'failed' ? c.danger : c.muted};`,
      notice.detail,
    ),
  );

  const close = () => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px)';
    setTimeout(() => host.remove(), 200);
  };
  const button = (label: string, primary: boolean, action: 'retry' | 'open') => {
    const el = make(
      'button',
      `height:32px;padding:0 12px;border-radius:6px;font:500 13px/20px system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer;` +
        (primary
          ? `border:1px solid transparent;background:${c.accent};color:${c.ink};`
          : `border:1px solid ${c.border};background:transparent;color:${c.text};`),
      label,
    );
    el.addEventListener('click', () => {
      void chrome.runtime
        .sendMessage({ type: 'notice-action', action, id: notice.id })
        .catch(() => undefined);
      close();
    });
    return el;
  };
  if (notice.kind !== 'saved') {
    const actions = make('div', 'display:flex;gap:8px;margin-top:12px;');
    const canRetry = notice.kind === 'failed' && !!notice.id;
    if (canRetry) actions.appendChild(button('Retry', true, 'retry'));
    actions.appendChild(button('Open manager', !canRetry, 'open'));
    body.appendChild(actions);
  }

  const dismiss = make(
    'button',
    `flex:none;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:6px;` +
      `background:transparent;color:${c.muted};cursor:pointer;`,
  );
  dismiss.setAttribute('aria-label', 'Close');
  dismiss.appendChild(icon(['M18 6 6 18', 'm6 6 12 12'], 'currentColor'));
  dismiss.addEventListener('click', close);
  dismiss.addEventListener('mouseenter', () => (dismiss.style.background = c.hover));
  dismiss.addEventListener('mouseleave', () => (dismiss.style.background = 'transparent'));

  card.append(symbol, body, dismiss);
  root.appendChild(card);
  document.documentElement.appendChild(host);
  requestAnimationFrame(() => {
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  });

  // A toast that closes by itself waits while the pointer is over it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    if (notice.autoCloseMs > 0) timer = setTimeout(close, notice.autoCloseMs);
  };
  card.addEventListener('mouseenter', () => clearTimeout(timer));
  card.addEventListener('mouseleave', start);
  start();
}
