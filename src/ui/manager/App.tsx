import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DisplayOptions, useDisplayOptions } from './DisplayOptions';
import {
  CircleCheck,
  ArrowDown,
  ArrowDownToLine,
  Archive,
  AudioLines,
  Check,
  CheckCheck,
  CircleCheckBig,
  Database,
  FolderOpen,
  Layers,
  Link2,
  Upload,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  File,
  FileText,
  FolderDown,
  Image,
  LayoutGrid,
  ListFilter,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { manager } from '../../application/client';
import type { DownloadJob, DownloadQueue, Category } from '../../domain/model';
import type { Action } from '../../application/contracts';
import { addedAt, bytes, eta, hostname, isActive, percent, stateLabel } from '../components/format';
import { DateTimePicker } from '../components/DateTimePicker';
import { CommandPalette, type PaletteItem } from '../components/CommandPalette';
import { Select } from '../components/Select';
import { useDismissed } from './dismissed';
import { AddDownload } from './AddDownload';
import { Details } from './Details';
import { Settings } from '../settings/Settings';
import { captureOrigins } from '../../shared/capture';
import { BatchDownloads } from './BatchDownloads';
import { Queues } from './Queues';
import { queueStatus } from '../components/queue-status';
import { SaveSetup } from './SaveSetup';
import { exportDownloadList } from './export-list';
import { browserNeedsReview } from '../../domain/browser-download';
interface NativeOffer {
  id: number;
  url: string;
  filename: string;
  at: number;
}
function nativeOffers(value: unknown): NativeOffer[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (offer): offer is NativeOffer =>
        Boolean(offer) &&
        typeof offer.id === 'number' &&
        typeof offer.url === 'string' &&
        typeof offer.filename === 'string' &&
        typeof offer.at === 'number',
    )
    .slice(0, 3);
}
const categoryIcons = {
  Documents: FileText,
  Archives: Archive,
  Videos: Video,
  Audio: AudioLines,
  Images: Image,
  Software: LayoutGrid,
  Other: File,
};
const navigation = [
  { id: 'all', label: 'All downloads', Icon: LayoutGrid, tone: '' },
  { id: 'active', label: 'Downloading', Icon: ArrowDownToLine, tone: 'is-live' },
  { id: 'queued', label: 'Queued', Icon: Clock3, tone: 'is-warn' },
  { id: 'completed', label: 'Completed', Icon: CheckCheck, tone: 'is-done' },
  { id: 'failed', label: 'Failed', Icon: CircleAlert, tone: 'is-bad' },
];
function matches(job: DownloadJob, view: string) {
  return (
    view === 'all' ||
    (view === 'active' && isActive(job)) ||
    (view === 'queued' && ['QUEUED', 'PAUSED'].includes(job.state)) ||
    (view === 'completed' && ['COMPLETED', 'ASSEMBLING'].includes(job.state)) ||
    (view === 'failed' && job.state === 'FAILED') ||
    job.category === view
  );
}
function statusDot(state: string) {
  if (
    ['DOWNLOADING', 'PROBING', 'RETRYING', 'EXPORTING', 'COMPLETED', 'ASSEMBLING'].includes(state)
  )
    return 'is-live';
  if (['PAUSED', 'QUEUED', 'WAITING_FOR_NETWORK', 'PAUSING'].includes(state)) return 'is-warn';
  return state === 'FAILED' ? 'is-bad' : '';
}
function JobCard({
  job,
  onDetails,
  action,
  exportFile,
  selected,
  onSelect,
  queue,
}: {
  queue?: DownloadQueue;
  job: DownloadJob;
  onDetails: () => void;
  action: (value: Action) => void;
  exportFile: () => void;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const Icon = categoryIcons[job.category];
  const active = isActive(job);
  const browser = job.engine === 'browser';
  const retryScheduled = !browser && job.state === 'FAILED' && job.queueRetryAt != null;
  const canResume =
    !browser || (!!job.browser?.canResume && !browserNeedsReview(job.browser.danger));
  const ready =
    !browser &&
    (['ASSEMBLING', 'COMPLETED'].includes(job.state) ||
      (job.state === 'FAILED' && Boolean(job.sha256)));
  return (
    <article
      className={`download-card ${job.state === 'FAILED' ? 'has-error' : ''} ${active ? 'is-active' : ''}`}
      data-job-id={job.id}
    >
      <div className={`file-icon ${job.category.toLowerCase()}`}>
        <Icon size={24} strokeWidth={1.6} />
        <input
          className="job-selection"
          type="checkbox"
          aria-label={`Select ${job.filename}`}
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
      </div>
      <div className="download-main">
        <div className="download-name-row">
          <button className="file-name" onClick={onDetails}>
            {job.filename}
          </button>
          <span className={`status ${job.state.toLowerCase()}`}>
            <span className={`ds-dot ${statusDot(job.state)}`} aria-hidden="true" />
            {retryScheduled
              ? 'Retry scheduled'
              : job.state === 'ASSEMBLING'
                ? 'Ready to save'
                : stateLabel(job.state)}
          </span>
        </div>
        <div className="file-meta">
          <span>{hostname(job.url)}</span>
          <span>·</span>
          <span>{job.category}</span>
          {browser && <span className="browser-transport">Original browser transfer</span>}
          {job.media && (
            <span className="browser-transport">
              {job.media.kind.toUpperCase()} ·{' '}
              {Math.max(
                0,
                (job.media.completed ?? 0) -
                  (job.media.audioUrl || job.media.dash?.audioId || job.media.transport === 'mpegts'
                    ? 0
                    : 1),
              )}
              /{job.media.parts ?? '?'} media parts
              {job.media.audioLabel && <> · {job.media.audioLabel}</>}
            </span>
          )}
          {job.priority > 0 && (
            <>
              <span>·</span>
              <span className="priority-high">High priority</span>
            </>
          )}
          {job.scheduledAt && job.state === 'QUEUED' && (
            <>
              <span>·</span>
              <span>{new Date(job.scheduledAt).toLocaleString()}</span>
            </>
          )}
          {queue && (
            <>
              <span>·</span>
              <span
                className={
                  job.state === 'QUEUED' && queueStatus(queue).tone !== 'live' ? 'queue-hint' : ''
                }
              >
                {queue.name}
                {job.state === 'QUEUED' && queueStatus(queue).tone !== 'live'
                  ? ` — ${queueStatus(queue).label.toLowerCase()}`
                  : ''}
              </span>
            </>
          )}
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label={`${job.filename} progress`}
          aria-valuenow={Math.round(percent(job))}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percent(job)}%` }} />
        </div>
        <div className="download-bottom">
          <span className="download-size">
            {bytes(job.downloaded)} <span className="muted">/ {bytes(job.total)}</span>
          </span>
          <div>
            {active && (
              <>
                <span className="transfer-speed">
                  <ArrowDown size={12} />
                  {bytes(job.speed)}/s
                </span>
                <span className="muted transfer-eta">{eta(job)} left</span>
                {!browser && (
                  <span className="muted transfer-connections">
                    {job.connections} connection{job.connections === 1 ? '' : 's'}
                  </span>
                )}
              </>
            )}
            {!active && (
              <span className="muted">
                {(retryScheduled
                  ? `Automatic retry ${(job.queueRetries ?? 0) + 1} after ${new Date(job.queueRetryAt!).toLocaleString()}`
                  : null) ||
                  job.error ||
                  job.note ||
                  (job.exported
                    ? 'Saved to your device'
                    : job.state === 'ASSEMBLING'
                      ? 'Verified locally · save to your device'
                      : `${percent(job).toFixed(1)}% transferred`)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="row-date" title={new Date(job.createdAt).toLocaleString()}>
        <span>Added</span>
        {addedAt(job.createdAt)}
      </div>
      <div className="row-actions">
        {job.media?.recording &&
          !job.media.recording.finished &&
          job.segments.length > (job.media.transport === 'mpegts' ? 0 : 1) &&
          ['DOWNLOADING', 'PAUSED', 'FAILED', 'WAITING_FOR_NETWORK'].includes(job.state) && (
            <button
              className="ds-btn is-outline is-small"
              onClick={() => action('finish-recording')}
              aria-label={`Finish recording ${job.filename}`}
            >
              Finish recording
            </button>
          )}
        {retryScheduled && (
          <button
            className="ds-icon-btn is-small"
            onClick={() => action('pause')}
            aria-label={`Stop automatic retries for ${job.filename}`}
            title="Stop automatic retries"
          >
            <Pause size={16} />
          </button>
        )}
        {active && job.state !== 'PAUSING' && job.state !== 'EXPORTING' && (
          <button
            className="ds-icon-btn is-small"
            onClick={() => action('pause')}
            aria-label={`Pause ${job.filename}`}
            title="Pause"
          >
            <Pause size={16} />
          </button>
        )}
        {['PAUSED', 'WAITING_FOR_NETWORK', 'CANCELED'].includes(job.state) &&
          !job.pageFile &&
          canResume &&
          (!browser || job.state !== 'CANCELED') && (
            <button
              className="ds-icon-btn is-small is-accent"
              onClick={() => action(job.state === 'CANCELED' ? 'redownload' : 'resume')}
              aria-label={`Resume ${job.filename}`}
              title="Resume"
            >
              <Play size={16} />
            </button>
          )}
        {job.state === 'QUEUED' && (
          <button
            className="ds-icon-btn is-small is-accent"
            onClick={() => action('start')}
            aria-label={`Start ${job.filename}`}
            title="Start now"
          >
            <Play size={16} />
          </button>
        )}
        {job.state === 'FAILED' && !ready && canResume && (
          <button
            className="ds-icon-btn is-small"
            onClick={() => action('retry')}
            aria-label={
              job.permissionOrigin
                ? `Grant website access for ${job.filename}`
                : `Retry ${job.filename}`
            }
            title={
              job.permissionOrigin ? `Grant access to ${job.permissionOrigin} and retry` : 'Retry'
            }
          >
            <RefreshCw size={16} />
          </button>
        )}
        {ready && (
          <button
            className="ds-icon-btn is-small is-accent"
            onClick={exportFile}
            aria-label={`Save ${job.filename}`}
            title="Save file"
          >
            <Download size={16} />
          </button>
        )}
        {job.state === 'COMPLETED' &&
          (browser
            ? !job.browser?.missing && !job.browser?.erased
            : job.savedDownloadId != null) && (
            <button
              className="ds-icon-btn is-small is-accent"
              aria-label={`Show ${job.filename} in folder`}
              title="Show in folder"
              onClick={() => action('show')}
            >
              <FolderDown size={16} />
            </button>
          )}
        {browser && ['PAUSED', 'FAILED', 'CANCELED'].includes(job.state) && !canResume && (
          <button
            className="ds-icon-btn is-small"
            aria-label={`Review browser download ${job.filename}`}
            title="Review original download in Chrome"
            onClick={() => action('review-browser')}
          >
            <CircleAlert size={16} />
          </button>
        )}
        <button
          className="ds-icon-btn is-small"
          onClick={onDetails}
          aria-label={`Details for ${job.filename}`}
          title="Details and actions"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </article>
  );
}
export function App() {
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [savedToast, setSavedToast] = useState('');
  const toastSince = useRef(Date.now());
  const toastSeen = useRef(new Set<string>());
  useEffect(() => {
    for (const job of snapshot.jobs) {
      const key = `${job.id}:${job.exportedAt}`;
      if (!job.exported || !job.exportedAt || job.exportedAt < toastSince.current) continue;
      if (toastSeen.current.has(key)) continue;
      toastSeen.current.add(key);
      setSavedToast(job.filename);
    }
  }, [snapshot.jobs]);
  useEffect(() => {
    if (!savedToast) return;
    const timer = setTimeout(() => setSavedToast(''), 6000);
    return () => clearTimeout(timer);
  }, [savedToast]);
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [add, setAdd] = useState(new URLSearchParams(location.hash.slice(1)).has('add'));
  const [initialUrl, setInitialUrl] = useState(
    new URLSearchParams(location.hash.slice(1)).get('add') ?? '',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(
    new URLSearchParams(location.hash.slice(1)).get('error') ?? '',
  );
  const [initialMedia, setInitialMedia] = useState<'hls' | 'dash' | undefined>();
  const [mobileNav, setMobileNav] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const display = useDisplayOptions();
  const [offers, setOffers] = useState<NativeOffer[]>([]);
  const [captureAccess, setCaptureAccess] = useState(false);
  const [batch, setBatch] = useState<string | null>(null);
  const [queuesOpen, setQueuesOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState('all');
  const [selection, setSelection] = useState(new Set<string>());
  const [bulkTime, setBulkTime] = useState<string | null>(null);
  useEffect(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    const check = () => {
      void chrome.permissions
        .contains({ origins: captureOrigins })
        .then(setCaptureAccess)
        .catch(() => setCaptureAccess(false));
    };
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [snapshot.settings.interception]);
  const sidebarRef = useRef<HTMLElement>(null);
  const [palette, setPalette] = useState(false);
  const [captureDismissed, dismissCapture] = useDismissed('capture');
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // Chrome keeps Ctrl+K for its own address-bar search, so the palette opens with / instead.
      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest('input,textarea,select,[contenteditable="true"]');
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const jobs = snapshot.jobs;
  const active = jobs.filter(isActive);
  const speed = active.reduce((n, j) => n + j.speed, 0);
  const completed = jobs.filter((j) => ['COMPLETED', 'ASSEMBLING'].includes(j.state));
  const selectedJob = jobs.find((j) => j.id === selected);
  const run = (fn: () => Promise<unknown>) => {
    setError('');
    void fn().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  useEffect(() => {
    if (!globalThis.chrome?.runtime?.id) return;
    let mounted = true;
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes.nativeOffers)
        setOffers(nativeOffers(changes.nativeOffers.newValue));
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session
      .get('nativeOffers')
      .then((stored) => {
        if (mounted) setOffers(nativeOffers(stored.nativeOffers));
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  async function dismissOffer(id: number) {
    const stored = await chrome.storage.session.get('nativeOffers');
    await chrome.storage.session.set({
      nativeOffers: nativeOffers(stored.nativeOffers).filter((offer) => offer.id !== id),
    });
  }
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: light)');
    const update = () => {
      document.documentElement.dataset.theme =
        snapshot.settings.theme === 'system'
          ? query.matches
            ? 'light'
            : 'dark'
          : snapshot.settings.theme;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [snapshot.settings.theme]);
  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has('add')) {
        setInitialUrl(params.get('add') ?? '');
        setAdd(true);
      }
      if (params.has('error')) setError(params.get('error') ?? 'Could not add this download.');
      if (params.has('settings')) setView('settings');
      if (params.has('add') || params.has('error') || params.has('settings'))
        history.replaceState(null, '', location.pathname + location.search);
    };
    handler();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const changeView = (value: string) => {
    setView(value);
    setStatusFilter('all');
    setMobileNav(false);
    sidebarRef.current?.scrollTo({ top: 0 });
  };
  const visible = jobs
    .filter(
      (j) =>
        matches(j, view) &&
        (queueFilter === 'all' || (j.queueId ?? 'default') === queueFilter) &&
        (statusFilter === 'all' || j.state === statusFilter) &&
        (j.filename + ' ' + hostname(j.url)).toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.filename.localeCompare(b.filename)
        : sort === 'size'
          ? (b.total ?? 0) - (a.total ?? 0)
          : sort === 'priority'
            ? b.priority - a.priority || a.order - b.order
            : b.createdAt - a.createdAt,
    );
  const selectAll = () => setSelection(new Set(visible.map((job) => job.id)));
  const selectedJobs = jobs.filter((job) => selection.has(job.id));
  const bulk = (action: Action) =>
    run(async () => {
      if (
        ['cancel', 'remove'].includes(action) &&
        !window.confirm(
          `${action === 'remove' ? 'Remove' : 'Cancel'} ${selectedJobs.length} selected downloads and delete their staged data? Exported files are retained.`,
        )
      )
        return;
      for (const job of selectedJobs) await manager.action(job.id, action);
      setSelection(new Set());
    });
  const openSettings = (anchor?: string) => {
    changeView('settings');
    if (anchor)
      setTimeout(
        () => window.dispatchEvent(new CustomEvent('flux:settings-tab', { detail: anchor })),
        80,
      );
  };
  const paletteItems: PaletteItem[] = [
    ...navigation.map(({ id, label, Icon }) => ({
      id: `go-${id}`,
      group: 'Go to' as const,
      label,
      hint: `${jobs.filter((j) => matches(j, id)).length}`,
      icon: <Icon size={16} aria-hidden="true" />,
      keywords: 'page view downloads',
      run: () => changeView(id),
    })),
    ...(Object.entries(categoryIcons) as [Category, typeof File][]).map(([category, Icon]) => ({
      id: `go-${category}`,
      group: 'Go to' as const,
      label: category,
      hint: 'File category',
      icon: <Icon size={16} aria-hidden="true" />,
      keywords: 'files type category',
      run: () => changeView(category),
    })),
    {
      id: 'go-settings',
      group: 'Go to',
      label: 'Settings',
      icon: <Settings2 size={16} aria-hidden="true" />,
      keywords: 'preferences options',
      run: () => openSettings(),
    },
    ...(
      [
        ['settings-allowance', 'Download allowance', 'limit traffic data cap'],
        ['settings-transfers', 'Transfers and connections', 'speed connections retries timeout'],
        ['settings-schedule', 'Schedule', 'hours time window night'],
        ['settings-saving', 'Saving files', 'folder destination category auto save'],
        [
          'settings-browser',
          'Browser integration',
          'capture intercept websites hosts notifications',
        ],
        ['settings-appearance', 'Appearance', 'theme dark light display'],
        ['settings-storage', 'Storage', 'disk quota cache clear'],
      ] as const
    ).map(([anchor, label, keywords]) => ({
      id: anchor,
      group: 'Settings' as const,
      label,
      hint: 'Settings',
      icon: <SlidersHorizontal size={16} aria-hidden="true" />,
      keywords,
      run: () => openSettings(anchor),
    })),
    {
      id: 'act-add',
      group: 'Actions',
      label: 'Add download',
      icon: <Plus size={16} aria-hidden="true" />,
      keywords: 'new link url',
      run: () => {
        setInitialUrl('');
        setAdd(true);
      },
    },
    {
      id: 'act-batch',
      group: 'Actions',
      label: 'Add multiple links',
      icon: <Link2 size={16} aria-hidden="true" />,
      keywords: 'batch paste list',
      run: () => setBatch(''),
    },
    {
      id: 'act-queues',
      group: 'Actions',
      label: 'Manage queues',
      icon: <Layers size={16} aria-hidden="true" />,
      keywords: 'queue schedule',
      run: () => setQueuesOpen(true),
    },
    {
      id: 'act-folder',
      group: 'Actions',
      label: 'Choose download folder',
      icon: <FolderOpen size={16} aria-hidden="true" />,
      keywords: 'save destination',
      run: () => run(() => manager.chooseDownloadFolder()),
    },
    {
      id: 'act-pause-all',
      group: 'Actions',
      label: 'Pause all',
      icon: <Pause size={16} aria-hidden="true" />,
      run: () => run(() => manager.pauseAll()),
    },
    {
      id: 'act-resume-all',
      group: 'Actions',
      label: 'Resume all',
      icon: <Play size={16} aria-hidden="true" />,
      run: () => run(() => manager.resumeAll()),
    },
    {
      id: 'act-theme',
      group: 'Actions',
      label: 'Toggle theme',
      icon: <Sun size={16} aria-hidden="true" />,
      keywords: 'dark light appearance',
      run: () =>
        run(() =>
          manager.updateSettings({
            ...snapshot.settings,
            theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
          }),
        ),
    },
    ...jobs.map((job) => {
      const Icon = categoryIcons[job.category];
      return {
        id: `job-${job.id}`,
        group: 'Downloads' as const,
        label: job.filename,
        hint: `${stateLabel(job.state)} · ${hostname(job.url)}`,
        icon: <Icon size={16} aria-hidden="true" />,
        run: () => setSelected(job.id),
      };
    }),
  ];
  const summary = [
    `${jobs.length} ${jobs.length === 1 ? 'file' : 'files'}`,
    jobs.length ? `${bytes(jobs.reduce((n, j) => n + (j.total || j.downloaded), 0))} total` : '',
    `${active.length} active`,
    jobs.some((j) => j.state === 'QUEUED')
      ? `${jobs.filter((j) => j.state === 'QUEUED').length} queued`
      : '',
    jobs.some((j) => j.state === 'FAILED')
      ? `${jobs.filter((j) => j.state === 'FAILED').length} failed`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const nextHour = () => {
    const at = new Date(Date.now() + 3600000);
    at.setMinutes(0, 0, 0);
    return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  /** Holds the selected files until a chosen time, then the queue starts them. */
  const scheduleSelected = (at: number) =>
    run(async () => {
      if (!Number.isFinite(at)) throw new Error('Choose a start time.');
      for (const job of selectedJobs) {
        if (job.engine === 'browser' || ['COMPLETED', 'ASSEMBLING'].includes(job.state)) continue;
        if (isActive(job)) await manager.action(job.id, 'pause');
        await manager.updateJob(job.id, { scheduledAt: at });
        if (job.state !== 'QUEUED') await manager.action(job.id, 'resume');
      }
      setBulkTime(null);
      setSelection(new Set());
    });
  const moveToQueue = (queueId: string) =>
    run(async () => {
      for (const job of selectedJobs) {
        if (job.engine === 'browser' || job.queueId === queueId) continue;
        // Options can only change while a transfer is stopped; it resumes from its queue.
        const wasActive = isActive(job);
        if (wasActive) await manager.action(job.id, 'pause');
        await manager.updateJob(job.id, { queueId });
        if (wasActive) await manager.action(job.id, 'resume');
      }
      setSelection(new Set());
    });
  const title = navigation.find((item) => item.id === view)?.label || view;
  return (
    <div
      className="app-shell"
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes('text/uri-list') ||
          event.dataTransfer.types.includes('text/plain')
        )
          event.preventDefault();
      }}
      onDrop={(event) => {
        const text =
          event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
        if (/https?:\/\//i.test(text)) {
          event.preventDefault();
          setBatch(text);
        }
      }}
      onPaste={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('input,textarea,[contenteditable="true"]')) return;
        const text = event.clipboardData.getData('text/plain');
        if (/^https?:\/\//i.test(text.trim())) {
          event.preventDefault();
          setBatch(text);
        }
      }}
    >
      <aside ref={sidebarRef} className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            changeView('all');
          }}
        >
          <span className="brand-mark">
            <Zap size={24} fill="currentColor" strokeWidth={1.5} />
          </span>
          <span>
            flux<span className="brand-dot">.</span>
          </span>
        </a>
        <p className="sidebar-caption">Downloads</p>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, Icon, tone }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'selected' : ''}`}
              onClick={() => changeView(id)}
            >
              {tone ? (
                <span className="nav-dot" aria-hidden="true">
                  <span className={`ds-dot ${tone}`} />
                </span>
              ) : (
                <Icon size={16} />
              )}
              <span>{label}</span>
              {(id === 'all' || jobs.some((j) => matches(j, id))) && (
                <span className="nav-count">{jobs.filter((j) => matches(j, id)).length}</span>
              )}
            </button>
          ))}
        </nav>
        {snapshot.settings.categories && (
          <details className="sidebar-group" open>
            <summary className="sidebar-caption category-caption">
              File types
              <ChevronRight size={14} aria-hidden="true" />
            </summary>
            <nav aria-label="File categories">
              {(Object.entries(categoryIcons) as [Category, typeof File][]).map(
                ([category, Icon]) => (
                  <button
                    key={category}
                    className={`nav-item category-nav ${view === category ? 'selected' : ''}`}
                    onClick={() => changeView(category)}
                  >
                    <Icon size={16} />
                    <span>{category}</span>
                    {jobs.some((j) => j.category === category) && (
                      <span className="nav-count">
                        {jobs.filter((j) => j.category === category).length}
                      </span>
                    )}
                  </button>
                ),
              )}
            </nav>
          </details>
        )}
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'settings' ? 'selected' : ''}`}
            onClick={() => changeView('settings')}
          >
            <Settings2 size={16} />
            <span>Settings</span>
          </button>
          <div className="sidebar-engine">
            <span className="ds-dot is-live" aria-hidden="true" />
            Local engine
            <span>{active.length ? `${active.length} active` : 'Idle'}</span>
          </div>

          <p className="sidebar-credit">
            created by <strong>Vexor</strong>
          </p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="ds-icon-btn mobile-menu"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label="Toggle navigation"
          >
            <LayoutGrid size={16} />
          </button>
          <nav className="topbar-crumbs" aria-label="Breadcrumb">
            {view !== 'settings' && (
              <>
                <span>
                  {['all', 'active', 'queued', 'completed', 'failed'].includes(view)
                    ? 'Downloads'
                    : 'File types'}
                </span>
                <ChevronRight size={14} aria-hidden="true" />
              </>
            )}
            <strong>{view === 'settings' ? 'Settings' : title}</strong>
          </nav>
          <div className="topbar-right">
            <button
              className="topbar-search"
              onClick={() => setPalette(true)}
              aria-label="Search and quick access"
              aria-keyshortcuts="/"
            >
              <Search size={16} aria-hidden="true" />
              <span>Search</span>
              <span className="topbar-keys" aria-hidden="true">
                <kbd>/</kbd>
              </span>
            </button>
            <button
              className="ds-icon-btn"
              title="Toggle theme"
              aria-label="Toggle theme"
              onClick={() =>
                run(() =>
                  manager.updateSettings({
                    ...snapshot.settings,
                    theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
                  }),
                )
              }
            >
              {snapshot.settings.theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </header>
        <div className={`main-content ${view === 'settings' ? '' : 'fit-page'}`}>
          {savedToast && (
            <div className="ds-toast" role="status">
              <CircleCheck size={16} aria-hidden="true" />
              <div className="ds-toast-body">
                <strong>Download complete</strong>
                <span title={savedToast}>{savedToast}</span>
              </div>
              <button
                className="ds-icon-btn is-small"
                aria-label="Dismiss"
                onClick={() => setSavedToast('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {(error || snapshot.error) && (
            <div className="ds-notice is-error is-spaced" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span className="ds-notice-text">{error || snapshot.error}</span>
              <button
                className="ds-icon-btn is-small"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view !== 'settings' &&
            !(snapshot.settings.interception && captureAccess) &&
            !captureDismissed && (
              <section className="ds-alert is-spaced" aria-label="Automatic download capture">
                <ShieldCheck size={16} aria-hidden="true" />
                <div className="ds-alert-body">
                  <strong>Let Flux handle your downloads</strong>
                  <p>
                    Enable automatic capture and approve website access so clicking a file starts
                    Flux instead of Chrome’s default downloader.
                  </p>
                </div>
                <div className="ds-alert-actions">
                  <button
                    className="ds-btn is-outline is-small"
                    onClick={() => run(() => manager.enableAutomaticCapture())}
                  >
                    Enable automatic downloads
                  </button>
                  <button
                    className="ds-icon-btn is-small"
                    aria-label="Dismiss banner"
                    onClick={dismissCapture}
                  >
                    <X size={16} />
                  </button>
                </div>
              </section>
            )}
          {view !== 'settings' && <SaveSetup snapshot={snapshot} manager={manager} run={run} />}
          {offers.length > 0 && (
            <section
              className="native-offers"
              aria-label="Browser download offers"
              aria-live="polite"
            >
              {offers.map((offer) => (
                <article className="ds-alert is-spaced" key={offer.id}>
                  <ArrowDownToLine size={16} aria-hidden="true" />
                  <div className="ds-alert-body">
                    <strong title={offer.filename}>{offer.filename}</strong>
                    <p>
                      Chrome is already downloading this file. Reviewing in Flux starts a separate
                      transfer; cancel the browser download manually before switching.
                    </p>
                  </div>
                  <div className="ds-alert-actions">
                    <button
                      className="ds-btn is-outline is-small"
                      onClick={() => {
                        setInitialUrl(offer.url);
                        setAdd(true);
                      }}
                    >
                      Review link
                    </button>
                    <button
                      className="ds-icon-btn is-small"
                      aria-label={`Dismiss offer for ${offer.filename}`}
                      onClick={() => run(() => dismissOffer(offer.id))}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}
          {!!snapshot.settings.trafficLimit && (
            <div className="ds-notice is-spaced" role="status">
              Download allowance: {bytes(snapshot.traffic?.used ?? 0)} /{' '}
              {bytes(snapshot.settings.trafficLimit)}
              {snapshot.traffic?.resetsAt
                ? ` · resets ${new Date(snapshot.traffic.resetsAt).toLocaleString()}`
                : ''}
            </div>
          )}
          {view === 'settings' ? (
            <Settings manager={manager} snapshot={snapshot} run={run} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {title}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>{summary}</p>
                </div>
                <button
                  className="ds-btn is-primary"
                  onClick={() => {
                    setInitialUrl('');
                    setAdd(true);
                  }}
                >
                  <Plus size={16} /> Add download
                </button>
              </div>
              <div className="workspace-actions" aria-label="Download tools">
                <div className="tool-group is-joined" role="group" aria-label="Add links">
                  <button className="ds-btn is-outline is-small" onClick={() => setBatch('')}>
                    <Link2 size={16} /> Add multiple links
                  </button>
                </div>
                <div className="tool-group is-end" role="group" aria-label="Manage">
                  <button
                    className="ds-icon-btn"
                    title="Manage queues"
                    aria-label="Manage queues"
                    onClick={() => setQueuesOpen(true)}
                  >
                    <Layers size={16} />
                  </button>
                  <button
                    className="ds-icon-btn"
                    title={
                      snapshot.destination
                        ? 'Folder: ' + snapshot.destination.name
                        : 'Choose download folder'
                    }
                    aria-label={
                      snapshot.destination
                        ? 'Folder: ' + snapshot.destination.name
                        : 'Choose download folder'
                    }
                    onClick={() => run(() => manager.chooseDownloadFolder())}
                  >
                    <FolderOpen size={16} />
                  </button>
                  <button
                    className="ds-icon-btn"
                    title="Export link list"
                    aria-label="Export link list"
                    disabled={!jobs.length}
                    onClick={() =>
                      run(() => exportDownloadList(selectedJobs.length ? selectedJobs : jobs))
                    }
                  >
                    <Upload size={16} />
                  </button>
                </div>
              </div>
              <section className="stats-grid" aria-label="Transfer statistics">
                <div className="stat-card">
                  <div className="stat-label">
                    <span>Current speed</span>
                    <Zap size={17} />
                  </div>
                  <div className="stat-value accent-text">
                    {bytes(speed)}
                    <small>/s</small>
                  </div>
                  <span className="stat-foot">
                    <span className={`live-dot ${active.length ? 'live' : ''}`} />
                    {active.length ? 'Live transfer speed' : 'Ready when you are'}
                  </span>
                  <svg className="stat-art wave" viewBox="0 0 120 40" aria-hidden="true">
                    <path d="M0 30 C15 10 25 34 40 22 S65 6 80 18 S105 8 120 14" />
                  </svg>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    <span>In progress</span>
                    <Clock3 size={17} />
                  </div>
                  <div className="stat-value">
                    {active.length}
                    <small>downloads</small>
                  </div>
                  <span className="stat-foot">
                    {active.reduce((n, j) => n + j.connections, 0)} active connections
                  </span>
                  <span className="stat-art bars" aria-hidden="true">
                    <i /> <i /> <i /> <i /> <i /> <i />
                  </span>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    <span>Completed</span>
                    <CircleCheckBig size={17} />
                  </div>
                  <div className="stat-value">
                    {completed.length}
                    <small>files</small>
                  </div>
                  <span className="stat-foot">
                    {bytes(completed.reduce((n, j) => n + j.downloaded, 0))} downloaded
                  </span>
                  <span className="stat-art bars" aria-hidden="true">
                    <i /> <i /> <i /> <i /> <i /> <i />
                  </span>
                </div>
                <div className="stat-card">
                  <div className="stat-label">
                    <span>Local storage</span>
                    <Database size={17} />
                  </div>
                  <div className="stat-value">
                    {snapshot.storage ? bytes(snapshot.storage.usage) : '—'}
                  </div>
                  <span className="stat-foot">
                    {snapshot.storage
                      ? `${bytes(snapshot.storage.quota)} browser quota`
                      : 'Stored privately in your browser'}
                  </span>
                  <span className="stat-meter" aria-hidden="true">
                    <i
                      style={{
                        width: `${snapshot.storage ? Math.min(100, (snapshot.storage.usage / Math.max(1, snapshot.storage.quota)) * 100) : 0}%`,
                      }}
                    />
                    <b>
                      {snapshot.storage
                        ? Math.round(
                            (snapshot.storage.usage / Math.max(1, snapshot.storage.quota)) * 100,
                          )
                        : 0}
                      %
                    </b>
                  </span>
                </div>
              </section>
              <section
                className="downloads-section"
                data-compact={display.value.compact}
                data-metadata={display.value.metadata}
                data-size={display.value.size}
                data-speed={display.value.speed}
                data-eta={display.value.eta}
                data-connections={display.value.connections}
              >
                <div className="section-heading">
                  <div className="downloads-title">
                    <h2>{view === 'all' ? 'Your downloads' : title}</h2>
                    <span className="count-badge">{visible.length}</span>
                  </div>
                  <div className="toolbar">
                    <DisplayOptions {...display} />
                    <button
                      className="ds-btn is-outline is-small"
                      onClick={() => run(() => manager.pauseAll())}
                      disabled={!active.length && !jobs.some((job) => job.queueRetryAt != null)}
                    >
                      <Pause size={16} /> Pause all
                    </button>
                    <button
                      className="ds-btn is-outline is-small"
                      onClick={() => run(() => manager.resumeAll())}
                      disabled={
                        !jobs.some((j) =>
                          ['PAUSED', 'FAILED', 'WAITING_FOR_NETWORK'].includes(j.state),
                        )
                      }
                    >
                      <Play size={16} /> Resume all
                    </button>
                  </div>
                </div>
                <div className="list-controls">
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      placeholder="Search downloads…"
                      aria-label="Search downloads"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    {search && (
                      <button
                        className="ds-icon-btn is-small"
                        aria-label="Clear search"
                        onClick={() => setSearch('')}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <div className="filter-controls">
                    <Select
                      aria-label="Filter by queue"
                      value={queueFilter}
                      onChange={(event) => setQueueFilter(event.target.value)}
                    >
                      <option value="all">All queues</option>
                      <option value="default">Default queue</option>
                      {snapshot.settings.queues.map((queue) => (
                        <option key={queue.id} value={queue.id}>
                          {queue.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      icon={<ListFilter size={16} />}
                      aria-label="Filter by status"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="all">All statuses</option>
                      {[
                        'DOWNLOADING',
                        'QUEUED',
                        'PAUSED',
                        'ASSEMBLING',
                        'COMPLETED',
                        'FAILED',
                        'CANCELED',
                      ].map((state) => (
                        <option key={state} value={state}>
                          {stateLabel(state)}
                        </option>
                      ))}
                    </Select>
                    <Select
                      icon={<SlidersHorizontal size={16} />}
                      aria-label="Sort downloads"
                      value={sort}
                      onChange={(event) => setSort(event.target.value)}
                    >
                      <option value="newest">Newest first</option>
                      <option value="name">Name</option>
                      <option value="size">File size</option>
                      <option value="priority">Priority & queue</option>
                    </Select>
                  </div>
                </div>
                {!!visible.length && (
                  <div className="bulk-toolbar" aria-label="Selected downloads">
                    <label className="bulk-select-all">
                      <input
                        type="checkbox"
                        aria-label="Select all visible downloads"
                        checked={visible.every((job) => selection.has(job.id))}
                        onChange={(event) =>
                          event.target.checked ? selectAll() : setSelection(new Set())
                        }
                      />
                      <span>{selectedJobs.length} selected</span>
                    </label>
                    {!!selectedJobs.length && (
                      <>
                        <span className="bulk-divider" />
                        <div className="bulk-actions" role="group" aria-label="Selected actions">
                          <button
                            className="ds-btn is-ghost is-small"
                            onClick={() => bulk('start')}
                          >
                            <Play size={16} /> Start now
                          </button>
                          <button
                            className="ds-btn is-ghost is-small"
                            onClick={() => bulk('pause')}
                          >
                            <Pause size={16} /> Pause selected
                          </button>
                          <button
                            className="ds-btn is-ghost is-small"
                            onClick={() => bulk('resume')}
                          >
                            <RefreshCw size={16} /> Resume selected
                          </button>
                          <button
                            className="ds-btn is-ghost is-small"
                            onClick={() => bulk('cancel')}
                          >
                            <X size={16} /> Cancel selected
                          </button>
                        </div>
                        <span className="bulk-divider" />
                        <div className="bulk-actions" role="group" aria-label="Queue and schedule">
                          <Select
                            size="sm"
                            aria-label="Move selected to queue"
                            value=""
                            onChange={(event) =>
                              event.target.value === 'new'
                                ? setQueuesOpen(true)
                                : moveToQueue(event.target.value)
                            }
                          >
                            <option value="" disabled>
                              Move to queue
                            </option>
                            <option value="default">Default queue</option>
                            {snapshot.settings.queues.map((queue) => (
                              <option key={queue.id} value={queue.id}>
                                {queue.name}
                              </option>
                            ))}
                            <option value="new">New queue</option>
                          </Select>
                          {bulkTime === null ? (
                            <button
                              className="ds-btn is-outline is-small"
                              onClick={() => setBulkTime(nextHour())}
                            >
                              <Clock3 size={16} /> Start at
                            </button>
                          ) : (
                            <span className="bulk-time">
                              <DateTimePicker
                                aria-label="Start selected at"
                                value={bulkTime}
                                onChange={setBulkTime}
                              />
                              <button
                                className="ds-btn is-outline is-small"
                                disabled={!bulkTime}
                                onClick={() => scheduleSelected(new Date(bulkTime).getTime())}
                              >
                                Set
                              </button>
                              <button
                                className="ds-btn is-ghost is-small"
                                onClick={() => setBulkTime(null)}
                              >
                                Cancel
                              </button>
                            </span>
                          )}
                        </div>
                        <button
                          className="ds-btn is-ghost is-danger is-small bulk-remove"
                          onClick={() => bulk('remove')}
                        >
                          <Trash2 size={16} /> Remove selected
                        </button>
                      </>
                    )}
                  </div>
                )}
                <div className="download-list">
                  {!snapshot.ready ? (
                    <div className="empty-state">
                      <LoaderCircle className="spin" size={30} />
                      <h3>Opening your workspace</h3>
                      <p>Restoring download records from this browser.</p>
                    </div>
                  ) : visible.length ? (
                    visible.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        selected={selection.has(job.id)}
                        queue={snapshot.settings.queues.find((queue) => queue.id === job.queueId)}
                        onSelect={(checked) =>
                          setSelection((previous) => {
                            const next = new Set(previous);
                            if (checked) next.add(job.id);
                            else next.delete(job.id);
                            return next;
                          })
                        }
                        onDetails={() => setSelected(job.id)}
                        action={(value) => run(() => manager.action(job.id, value))}
                        exportFile={() => run(() => manager.exportFile(job.id))}
                      />
                    ))
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <FolderDown size={36} strokeWidth={1.3} />
                      </div>
                      <h3>
                        {search || statusFilter !== 'all'
                          ? 'No matching downloads'
                          : view === 'all'
                            ? 'Your next download starts here'
                            : `No ${title.toLowerCase()} yet`}
                      </h3>
                      <p>
                        {search || statusFilter !== 'all'
                          ? 'Try another search or choose a different filter.'
                          : 'Add a direct file link. Flux takes care of the rest.'}
                      </p>
                      {!search && statusFilter === 'all' && (
                        <button
                          className="ds-btn is-outline"
                          onClick={() => {
                            setInitialUrl('');
                            setAdd(true);
                          }}
                        >
                          <Plus size={16} /> Add your first download
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      {palette && <CommandPalette items={paletteItems} onClose={() => setPalette(false)} />}
      {add && (
        <AddDownload
          key={initialUrl}
          initialUrl={initialUrl}
          initialMedia={initialMedia}
          manager={manager}
          onClose={() => {
            setAdd(false);
            setInitialMedia(undefined);
            if (location.hash === '#add')
              history.replaceState(null, '', location.pathname + location.search);
          }}
        />
      )}
      {batch !== null && (
        <BatchDownloads manager={manager} initialText={batch} onClose={() => setBatch(null)} />
      )}
      {queuesOpen && <Queues manager={manager} onClose={() => setQueuesOpen(false)} />}
      {selectedJob && (
        <Details job={selectedJob} manager={manager} onClose={() => setSelected(null)} run={run} />
      )}{' '}
    </div>
  );
}
