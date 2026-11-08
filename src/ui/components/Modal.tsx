import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  description,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  description?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => {
      node?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <header className="modal-header">
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="ds-icon-btn is-small" onClick={onClose} aria-label="Close dialog">
          <X size={19} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
