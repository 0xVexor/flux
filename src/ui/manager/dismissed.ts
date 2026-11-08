import { useCallback, useState } from 'react';

/**
 * Remembers which setup notices the user closed, so they do not come back on every visit.
 * Storage can be missing or blocked, so every access is guarded and the notice still works
 * for the current visit.
 */
const prefix = 'flux.dismissed.';

function read(key: string): boolean {
  try {
    return localStorage.getItem(prefix + key) === '1';
  } catch {
    return false;
  }
}

export function useDismissed(key: string): [boolean, () => void] {
  const [hidden, setHidden] = useState(() => read(key));
  const dismiss = useCallback(() => {
    setHidden(true);
    try {
      localStorage.setItem(prefix + key, '1');
    } catch {
      /* the notice stays closed for this visit only */
    }
  }, [key]);
  return [hidden, dismiss];
}
