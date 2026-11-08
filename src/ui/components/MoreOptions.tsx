import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import '../ds.css';

/** The rarely used options stay folded, so a popup never needs scrolling just to start. */
export function MoreOptions({ children }: { children: ReactNode }) {
  return (
    <details className="more">
      <summary>
        <ChevronRight size={16} aria-hidden="true" />
        More options
      </summary>
      <div className="more-body">{children}</div>
    </details>
  );
}
