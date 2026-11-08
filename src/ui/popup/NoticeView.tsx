import { ArrowDownToLine, CircleAlert, CircleCheck, ListChecks, X } from 'lucide-react';
import { noticeDetail, noticeTitle, type DownloadNotice } from '../../shared/notices';
import '../ds.css';

const icons = {
  saved: CircleCheck,
  ready: ArrowDownToLine,
  failed: CircleAlert,
  queue: ListChecks,
};

/**
 * What the toolbar popup shows when a download finishes, is ready to save, or fails. A saved
 * file closes the popup by itself; the others wait until the user has seen them.
 */
export function NoticeView({
  notice,
  onClose,
  onOpenManager,
  onRetry,
}: {
  notice: DownloadNotice;
  onClose: () => void;
  onOpenManager: () => void;
  onRetry: () => void;
}) {
  const Icon = icons[notice.kind];
  const canRetry = notice.kind === 'failed' && !!notice.id;
  return (
    <div
      className={`notice-view is-${notice.kind}`}
      role={notice.kind === 'failed' ? 'alert' : 'status'}
    >
      <Icon size={16} className="notice-icon" aria-hidden="true" />
      <div className="notice-body">
        <strong>{noticeTitle[notice.kind]}</strong>
        <p className="notice-file" title={notice.filename}>
          {notice.filename}
        </p>
        <small className="notice-detail">{noticeDetail(notice)}</small>
        {notice.kind !== 'saved' && (
          <div className="notice-actions">
            {canRetry && (
              <button type="button" className="ds-btn is-primary is-small" onClick={onRetry}>
                Retry
              </button>
            )}
            <button
              type="button"
              className={`ds-btn is-small ${canRetry ? 'is-outline' : 'is-primary'}`}
              onClick={onOpenManager}
            >
              Open manager
            </button>
          </div>
        )}
      </div>
      <button type="button" className="ds-icon-btn is-small" aria-label="Close" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
