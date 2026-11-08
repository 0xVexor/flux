/** What the download engine tells the user: one event, shown in the popup and as a system notice. */
export type NoticeKind = 'saved' | 'ready' | 'failed' | 'queue';

export interface DownloadNotice {
  kind: NoticeKind;
  /** The download, when there is one to act on (retry). */
  id?: string;
  /** The file name; for a finished queue, the queue's name. */
  filename: string;
  folder?: string;
  error?: string;
  waiting?: number;
  at: number;
}

export const noticeTitle: Record<NoticeKind, string> = {
  saved: 'Download complete',
  ready: 'Ready to save',
  failed: 'Download failed',
  queue: 'Queue finished',
};

/** The second line of a notice: where it went, what to do, or what went wrong. */
export function noticeDetail(notice: DownloadNotice) {
  if (notice.kind === 'saved')
    return notice.folder ? `Saved in ${notice.folder}` : 'Saved to your download folder';
  if (notice.kind === 'ready') return 'Verified and waiting for you to save it';
  if (notice.kind === 'failed') return notice.error || 'Something went wrong';
  const files = notice.waiting ?? 0;
  return `${files} ${files === 1 ? 'file' : 'files'} verified and waiting to save`;
}

const kinds: NoticeKind[] = ['saved', 'ready', 'failed', 'queue'];
const clip = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : undefined;

/** Reads a notice from a message or from storage; anything malformed is dropped. */
export function readNotice(value: unknown): DownloadNotice | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const filename = clip(v.filename, 200);
  if (!kinds.includes(v.kind as NoticeKind) || !filename) return null;
  const waiting =
    typeof v.waiting === 'number' && Number.isInteger(v.waiting) && v.waiting >= 0
      ? Math.min(v.waiting, 100000)
      : undefined;
  return {
    kind: v.kind as NoticeKind,
    filename,
    at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : Date.now(),
    ...(clip(v.id, 80) ? { id: clip(v.id, 80) } : {}),
    ...(clip(v.folder, 120) ? { folder: clip(v.folder, 120) } : {}),
    ...(clip(v.error, 160) ? { error: clip(v.error, 160) } : {}),
    ...(waiting !== undefined ? { waiting } : {}),
  };
}
