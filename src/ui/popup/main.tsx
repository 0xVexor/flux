import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  Settings,
  Zap,
  ArrowUpRight,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  Plus,
} from 'lucide-react';
import type { Snapshot, DownloadJob } from '../../domain/model';
import { bytes, eta, hostname, isActive, percent, stateLabel } from '../components/format';
import { captureOrigins } from '../../shared/capture';
import { browserNeedsReview } from '../../domain/browser-download';
import { QueueChooser, type QueueChoice } from './QueueChooser';
import { NoticeView } from './NoticeView';
import { readNotice, type DownloadNotice } from '../../shared/notices';
import { AddDownload } from '../manager/AddDownload';
import type { ManagerAPI } from '../../application/contracts';
import { categoryIcons } from '../components/category-icons';
import '../theme.css';
import '../ds.css';
import './popup-minimal.css';
const SPARK_POINTS = 24;
/** How long the "download complete" popup stays before it closes itself. */
const SAVED_POPUP_MS = 3000;
/** Thin line of recent transfer speed; flat while idle. */
function Spark({ samples }: { samples: number[] }) {
  const { line, area } = useMemo(() => {
    const max = Math.max(...samples, 1);
    const flat = max <= 1;
    const path = samples
      .map((value, index) => {
        const x = (index / (SPARK_POINTS - 1)) * 200;
        const y = flat ? 52 : 56 - (value / max) * 46;
        return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    return { line: path, area: `${path} L200 70 L0 70 Z` };
  }, [samples]);
  return (
    <svg className="pm-spark" viewBox="0 0 200 70" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="pm-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#pm-spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
/** The dot in front of a row's details says what the download is doing at a glance. */
function stateDot(job: DownloadJob) {
  if (isActive(job)) return 'is-live';
  if (job.state === 'FAILED') return 'is-bad';
  if (job.state === 'PAUSED' || job.state === 'WAITING_FOR_NETWORK') return 'is-warn';
  return '';
}
function Popup() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const read = useCallback(async () => {
    try {
      if (!globalThis.chrome?.runtime?.id)
        throw new Error('Open Flux from its Chrome extension toolbar icon.');
      // Never sit on "Loading" for ever: if the background does not answer, say so.
      const result = (await Promise.race([
        chrome.runtime.sendMessage({ type: 'snapshot' }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Flux did not answer. Reload the extension and try again.')),
            6000,
          ),
        ),
      ])) as Snapshot;
      if (!result || !Array.isArray(result.jobs))
        throw new Error('Open the manager to restore your downloads.');
      setSnapshot(result);
      document.documentElement.dataset.theme =
        result.settings.theme === 'system'
          ? matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : result.settings.theme;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  const [notice, setNotice] = useState(0);
  const [finished, setFinished] = useState<DownloadNotice | null>(null);
  useEffect(() => {
    if (!globalThis.chrome?.storage?.session) return;
    // Set by the background when a download finished, is ready to save, or failed.
    const show = (value: unknown) => {
      const item = readNotice(value);
      if (item && Date.now() - item.at < 15000) setFinished(item);
    };
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes.downloadNotice) show(changes.downloadNotice.newValue);
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session.get('downloadNotice').then((stored) => show(stored.downloadNotice));
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  useEffect(() => {
    if (finished?.kind !== 'saved') return;
    const timer = setTimeout(() => window.close(), SAVED_POPUP_MS);
    return () => clearTimeout(timer);
  }, [finished]);
  const [choice, setChoice] = useState<QueueChoice | null>(null);
  useEffect(() => {
    if (!globalThis.chrome?.storage?.session) return;
    // Captured downloads wait here until the user picks their queue.
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes.queueChoice)
        setChoice((changes.queueChoice.newValue as QueueChoice | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session
      .get('queueChoice')
      .then((stored) => setChoice((stored.queueChoice as QueueChoice | undefined) ?? null));
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  useEffect(() => {
    void read();
    if (!globalThis.chrome?.storage?.session) return;
    // Set by the background when a download was just added from a page.
    const show = (value: unknown) => {
      const item = value as { count?: number; at?: number } | undefined;
      if (item?.count && item.at && Date.now() - item.at < 15000) setNotice(item.count);
    };
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes.popupNotice) {
        show(changes.popupNotice.newValue);
        void read();
      }
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session.get('popupNotice').then((stored) => show(stored.popupNotice));
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [read]);
  const active = snapshot?.jobs.filter(isActive) ?? [];
  const waiting =
    snapshot?.jobs.filter(
      (job) => job.state === 'QUEUED' || (job.state === 'FAILED' && job.queueRetryAt != null),
    ).length ?? 0;
  useEffect(() => {
    if (!active.length && !waiting && !notice) return;
    const timer = setInterval(() => void read(), 1000);
    return () => clearInterval(timer);
  }, [active.length, waiting, notice, read]);
  async function grant(job: DownloadJob) {
    setError('');
    try {
      // The popup may close while Chrome shows the prompt; the background then resumes the job.
      if (!(await chrome.permissions.request({ origins: [`${job.permissionOrigin}/*`] })))
        throw new Error('Website access was declined.');
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function open(add = false, hash = '') {
    try {
      if (!globalThis.chrome?.runtime?.id) {
        location.href = `../manager.html${hash || (add ? '#add' : '')}`;
        return;
      }
      const result = await chrome.runtime.sendMessage({
        type: 'open-manager',
        add,
        ...(hash ? { hash } : {}),
      });
      if (result?.error) throw new Error(result.error);
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function enableCapture() {
    setError('');
    setBusy('capture');
    try {
      if (!(await chrome.permissions.request({ origins: captureOrigins })))
        throw new Error('Website access was declined.');
      const reply = await chrome.runtime.sendMessage({ type: 'enable-capture' });
      if (reply?.error) throw new Error(reply.error);
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }
  async function command(job: DownloadJob) {
    setBusy(job.id);
    setError('');
    try {
      const review =
        job.engine === 'browser' &&
        !isActive(job) &&
        (!job.browser?.canResume || browserNeedsReview(job.browser.danger));
      const result = await chrome.runtime.sendMessage({
        type: review ? 'native-command' : 'command',
        id: job.id,
        action: review ? 'review-browser' : isActive(job) ? 'pause' : 'resume',
      });
      if (result?.error) throw new Error(result.error);
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }
  const pending =
    snapshot?.jobs.filter(
      (job) =>
        isActive(job) ||
        ['PAUSED', 'QUEUED', 'WAITING_FOR_NETWORK'].includes(job.state) ||
        (job.state === 'FAILED' && job.queueRetryAt != null),
    ) ?? [];
  const jobs = pending;
  const capture =
    choice?.items.length === 1 &&
    choice.items[0]?.url &&
    (snapshot?.settings.confirmCapture || choice.items[0].duplicateOf)
      ? choice.items[0]
      : null;
  const batch = !!snapshot && !capture && !!choice?.items.length;
  // The Add Download window needs only a few manager calls; the engine stays in the manager tab.
  const captureApi = useMemo(
    () =>
      snapshot && capture
        ? ({
            subscribe: () => () => undefined,
            getSnapshot: () => snapshot,
            add: async (input: unknown) => {
              const reply = await chrome.runtime.sendMessage({
                type: 'capture-confirm',
                id: capture.id,
                input,
              });
              if (reply?.error) throw new Error(reply.error);
            },
            chooseDownloadFolder: async () => {
              await chrome.runtime.sendMessage({ type: 'open-manager', add: false });
            },
          } as unknown as ManagerAPI)
        : null,
    [snapshot, capture?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    document.documentElement.classList.toggle('capture-mode', !!capture || batch);
  }, [capture, batch]);
  async function discardCapture() {
    if (!capture) return;
    await chrome.runtime
      .sendMessage({ type: 'queue-choice', ids: [capture.id], queueId: 'default', mode: 'cancel' })
      .catch(() => undefined);
    window.close();
  }
  const speed = active.reduce((n, j) => n + j.speed, 0);
  const history = useRef<number[]>(Array(SPARK_POINTS).fill(0));
  const [samples, setSamples] = useState<number[]>(history.current);
  useEffect(() => {
    history.current = [...history.current.slice(1), speed];
    setSamples(history.current);
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  if (finished && !choice?.items.length)
    return (
      <NoticeView
        key={finished.at}
        notice={finished}
        onClose={() => window.close()}
        onOpenManager={() => void open()}
        onRetry={() => {
          void chrome.runtime
            .sendMessage({ type: 'command', id: finished.id, action: 'retry' })
            .finally(() => window.close());
        }}
      />
    );
  if (snapshot && batch && choice)
    return (
      <QueueChooser
        choice={choice}
        snapshot={snapshot}
        onDone={(added) => {
          if (added) setNotice(added);
          void read();
        }}
      />
    );
  if (capture && captureApi)
    return (
      <AddDownload
        key={capture.id}
        manager={captureApi}
        initialUrl={capture.url}
        initialFilename={capture.filename}
        duplicateOf={capture.duplicateOf}
        embedded={{ onCancel: () => void discardCapture() }}
        onClose={() => window.close()}
      />
    );
  const resumeLabel = (job: DownloadJob) =>
    isActive(job)
      ? 'Pause'
      : job.engine === 'browser' &&
          (!job.browser?.canResume || browserNeedsReview(job.browser.danger))
        ? 'Review in Chrome'
        : 'Resume';
  return (
    <div className="pm">
      <header className="pm-head">
        <a
          className="pm-brand"
          href="../manager.html"
          onClick={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <Zap size={20} fill="currentColor" className="pm-bolt" />
          <span className="pm-word">
            flux
            <i className="pm-period" aria-hidden="true" />
          </span>
        </a>
        <button
          className="ds-icon-btn"
          aria-label="Open full manager"
          title="Open full manager"
          onClick={() => void open()}
        >
          <ArrowUpRight size={16} />
        </button>
        <button
          className="ds-icon-btn"
          aria-label="Open settings"
          title="Settings"
          onClick={() => void open(false, '#settings')}
        >
          <Settings size={16} />
        </button>
      </header>
      {active.length ? (
        <section className="pm-speed" aria-label="Transfer speed">
          <Spark samples={samples} />
          <span className="pm-eyebrow">Transfer speed</span>
          <div className="pm-speed-line">
            <span className="pm-speed-value">{bytes(speed)}</span>
            <span className="pm-speed-unit">/s</span>
          </div>
          <p>
            <span className="ds-dot is-live" />
            {`${active.length} active${waiting ? ` · ${waiting} waiting` : ''}`}
          </p>
        </section>
      ) : (
        <section className="pm-speed is-idle" aria-label="Transfer speed">
          <span className="ds-dot" />
          {waiting ? `Idle · ${waiting} waiting` : 'Idle'}
        </section>
      )}
      <section className="pm-list" aria-label="Current downloads">
        <div className="pm-label">
          <span>Downloads</span>
          <span className="ds-badge">{pending.length}</span>
        </div>
        {!!notice && (
          <div className="ds-notice" role="status">
            <ArrowDown size={16} />
            {notice === 1 ? 'Download added' : `${notice} downloads added`}
          </div>
        )}
        {error && (
          <div className="ds-notice is-error" role="alert">
            <CircleAlert size={16} /> {error}
          </div>
        )}
        {!snapshot && !error ? (
          <div className="pm-empty">
            <LoaderCircle className="spin" size={16} />
            <p>Loading</p>
          </div>
        ) : !jobs.length ? (
          <div className="pm-empty">
            <p>No downloads yet</p>
            <small>Click a download link on any page and Flux picks it up, or press Add.</small>
          </div>
        ) : (
          <div className="pm-scroll">
            {jobs.map((job) => {
              const Icon = categoryIcons[job.category];
              return (
                <div className="pm-row" key={job.id}>
                  <Icon size={20} strokeWidth={1.5} className="pm-ficon" />
                  <div className="pm-main">
                    <strong title={job.filename}>{job.filename}</strong>
                    <span className="pm-meta">
                      <span className={`ds-dot ${stateDot(job)}`} />
                      <span className="pm-meta-text">
                        {bytes(job.downloaded)}
                        {job.total ? ` of ${bytes(job.total)}` : ''}
                        {isActive(job)
                          ? ` · ${bytes(job.speed)}/s · ${eta(job)} left`
                          : ` · ${stateLabel(job.state)}`}
                      </span>
                    </span>
                    {(isActive(job) || percent(job) > 0) && (
                      <span className="ds-bar pm-bar" aria-hidden="true">
                        <i style={{ width: `${percent(job)}%` }} />
                      </span>
                    )}
                    {job.permissionOrigin && (
                      <button className="ds-link" onClick={() => void grant(job)}>
                        Allow access to {hostname(job.permissionOrigin)}
                      </button>
                    )}
                  </div>
                  <button
                    className="ds-icon-btn is-small"
                    aria-label={`${resumeLabel(job)} ${job.filename}`}
                    title={resumeLabel(job)}
                    onClick={() => void command(job)}
                    disabled={
                      busy === job.id || job.state === 'PAUSING' || job.state === 'EXPORTING'
                    }
                  >
                    {busy === job.id ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : isActive(job) ? (
                      <Pause size={16} />
                    ) : resumeLabel(job) === 'Review in Chrome' ? (
                      <ExternalLink size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <footer className="pm-foot">
        {snapshot ? (
          <div className="pm-status">
            <span className={`ds-dot ${snapshot.settings.interception ? 'is-live' : ''}`} />
            <span>{snapshot.settings.interception ? 'Capturing downloads' : 'Capture is off'}</span>
            {!snapshot.settings.interception && (
              <button
                className="ds-link"
                onClick={() => void enableCapture()}
                disabled={busy === 'capture'}
              >
                Turn on
              </button>
            )}
          </div>
        ) : (
          <span />
        )}
        <button className="ds-btn is-primary is-small" onClick={() => void open(true)}>
          <Plus size={16} /> Add download
        </button>
      </footer>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Popup />);
