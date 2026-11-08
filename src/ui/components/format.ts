import type { DownloadJob } from '../../domain/model';
export function bytes(value: number | null | undefined): string {
  if (value == null) return 'Unknown';
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}
export function percent(job: DownloadJob): number {
  if (job.total === 0 && ['ASSEMBLING', 'EXPORTING', 'COMPLETED'].includes(job.state)) return 100;
  return job.total ? Math.min(100, (job.downloaded / job.total) * 100) : 0;
}
export function eta(job: DownloadJob): string {
  if (!job.total || !job.speed) return '—';
  const seconds = Math.ceil((job.total - job.downloaded) / job.speed);
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.ceil(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
}
export function hostname(url: string): string {
  try {
    return new URL(url.startsWith('blob:') ? url.slice(5) : url).hostname;
  } catch {
    return 'Unknown host';
  }
}
export function stateLabel(state: string): string {
  return state
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
export const isActive = (job: DownloadJob) =>
  ['PROBING', 'DOWNLOADING', 'PAUSING', 'RETRYING', 'WAITING_FOR_NETWORK', 'EXPORTING'].includes(
    job.state,
  );

/** "Today, 17:40", "Yesterday, 09:12" or "8 Nov 2026" for when a download was added. */
export function addedAt(time: number, now = Date.now()): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const gap = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (gap === 0) return `Today, ${clock}`;
  if (gap === 1) return `Yesterday, ${clock}`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
