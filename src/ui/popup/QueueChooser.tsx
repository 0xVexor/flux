import { useState } from 'react';
import { ArrowDownToLine, CircleAlert, LoaderCircle, X, Zap } from 'lucide-react';
import type { Snapshot } from '../../domain/model';
import { categoryOf } from '../../shared/files';
import { categoryIcons } from '../components/category-icons';
import { FolderChoice, folderValue } from '../components/FolderChoice';
import { queueStatus } from '../components/queue-status';
import { Select } from '../components/Select';
import { newQueueId } from '../../domain/queues';
import { DateTimePicker } from '../components/DateTimePicker';
import { MoreOptions } from '../components/MoreOptions';
import '../ds.css';

export interface QueueChoice {
  items: { id: string; filename: string; url?: string; duplicateOf?: string }[];
  at: number;
}

/** An hour from now, on the hour, in the form a date and time picker uses. */
function soonLocal() {
  const at = new Date(Date.now() + 3600000);
  at.setMinutes(0, 0, 0);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function hostOf(url?: string) {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

/**
 * Several downloads were captured at once. Pick which ones to keep, where they go and which
 * queue they join, before any of them starts.
 */
export function QueueChooser({
  choice,
  snapshot,
  onDone,
}: {
  choice: QueueChoice;
  snapshot: Snapshot;
  onDone: (added: number) => void;
}) {
  const items = choice.items;
  // Files that arrive while this is open are selected by default.
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [queueId, setQueueId] = useState(() => newQueueId(snapshot.settings));
  const [folderChoice, setFolderChoice] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const settings = snapshot.settings;
  const [connections, setConnections] = useState(String(settings.maxConnections));
  const [mode, setMode] = useState<string>(settings.mode);
  const [speed, setSpeed] = useState('0');
  const [unit, setUnit] = useState('MB');
  const [priority, setPriority] = useState('0');
  const [scheduled, setScheduled] = useState(false);
  const [start, setStart] = useState(soonLocal);
  const [cookies, setCookies] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = items.filter((item) => !skipped.has(item.id));
  const count = chosen.length;
  const queues = snapshot.settings.queues;

  function toggle(id: string) {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function send(action: 'now' | 'paused' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      if (action !== 'cancel' && scheduled && !start) throw new Error('Choose a start time.');
      const keep = action === 'cancel' ? items : chosen;
      const reply = await chrome.runtime.sendMessage({
        type: 'queue-choice',
        ids: keep.map((item) => item.id),
        discardIds: items.filter((item) => !keep.includes(item)).map((item) => item.id),
        queueId,
        mode: action,
        saveSubfolder: folderValue(folderChoice, newFolder),
        options: {
          maxConnections: Number(connections),
          mode,
          speedLimit: Math.max(0, Number(speed) || 0) * (unit === 'MB' ? 1024 * 1024 : 1024),
          priority: Number(priority),
          scheduledAt: scheduled ? new Date(start).getTime() : null,
          useBrowserCookies: cookies,
        },
      });
      if (reply?.error) throw new Error(reply.error);
      onDone(action === 'cancel' ? 0 : keep.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  const title = items.length === 1 ? 'Add download' : 'Add downloads';
  return (
    <section className="embedded-dialog queue-chooser" aria-label={title}>
      <header className="modal-header">
        <h2>
          <Zap size={20} aria-hidden="true" />
          {title}
        </h2>
        <button
          type="button"
          className="ds-icon-btn is-small"
          aria-label="Close dialog"
          disabled={busy}
          onClick={() => void send('cancel')}
        >
          <X size={16} />
        </button>
      </header>
      <div className="add-form form-stack">
        <div className="batch-head">
          <span>
            {count} of {items.length} selected
          </span>
          {items.length > 1 && (
            <button
              type="button"
              className="ds-link"
              onClick={() =>
                setSkipped(count === items.length ? new Set(items.map((i) => i.id)) : new Set())
              }
            >
              {count === items.length ? 'Select none' : 'Select all'}
            </button>
          )}
        </div>
        <ul className="batch-files">
          {items.map((item) => {
            const Icon = categoryIcons[categoryOf(item.filename)];
            const host = hostOf(item.url);
            return (
              <li key={item.id}>
                <label className="batch-row" title={item.url ?? item.filename}>
                  <input
                    type="checkbox"
                    checked={!skipped.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <Icon size={20} strokeWidth={1.5} className="batch-icon" />
                  <span className="batch-name">
                    <strong>{item.filename}</strong>
                    {host && <small>{host}</small>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <FolderChoice
          settings={snapshot.settings}
          destination={snapshot.destination}
          choice={folderChoice}
          onChoice={setFolderChoice}
          typed={newFolder}
          onTyped={setNewFolder}
        />
        <div className="row">
          <label htmlFor="batch-queue">Queue</label>
          <Select
            id="batch-queue"
            value={queueId}
            onChange={(event) => setQueueId(event.target.value)}
          >
            <option value="default">Default queue · starts right away</option>
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>
                {queue.name} · {queueStatus(queue).label}
              </option>
            ))}
          </Select>
        </div>
        <MoreOptions>
          <div className="row">
            <label htmlFor="batch-connections">Connections per file</label>
            <Select
              id="batch-connections"
              value={connections}
              onChange={(event) => setConnections(event.target.value)}
            >
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="row">
            <label htmlFor="batch-mode">Connection mode</label>
            <Select id="batch-mode" value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="auto">Adaptive (recommended)</option>
              <option value="manual">Manual</option>
            </Select>
          </div>
          <div className="row">
            <label htmlFor="batch-speed">Speed limit for each file</label>
            <div className="speed-row">
              <input
                id="batch-speed"
                type="number"
                min="0"
                value={speed}
                onChange={(event) => setSpeed(event.target.value)}
              />
              <Select
                size="sm"
                aria-label="Speed unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              >
                <option value="KB">KB/s</option>
                <option value="MB">MB/s</option>
              </Select>
              <span className="muted small">(0 = unlimited)</span>
            </div>
          </div>
          <div className="row">
            <label htmlFor="batch-priority">Priority</label>
            <Select
              id="batch-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="2">High</option>
              <option value="0">Normal</option>
              <option value="-2">Low</option>
            </Select>
          </div>
          <div className="checks">
            <label className="check">
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(event) => setScheduled(event.target.checked)}
              />
              Schedule download
            </label>
          </div>
          {scheduled && (
            <div className="row">
              <label htmlFor="batch-time">Start time</label>
              <DateTimePicker
                id="batch-time"
                value={start}
                onChange={setStart}
                aria-label="Start time"
              />
            </div>
          )}
          <div className="row">
            <span className="row-label">Use browser cookies</span>
            <span
              className="switch-static"
              title="Use the session only on each download's own site; other hosts receive no cookies."
            >
              <input
                type="checkbox"
                checked={cookies}
                onChange={(event) => setCookies(event.target.checked)}
                aria-label="Use browser cookies"
              />
            </span>
          </div>
        </MoreOptions>
        {error && (
          <div className="ds-notice is-error" role="alert">
            <CircleAlert size={16} /> {error}
          </div>
        )}
        <footer className="modal-footer add-footer">
          <button
            type="button"
            className="ds-btn is-ghost"
            disabled={busy}
            onClick={() => void send('cancel')}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ds-btn is-outline"
            disabled={busy || !count}
            onClick={() => void send('paused')}
          >
            Add paused
          </button>
          <button
            type="button"
            className="ds-btn is-primary"
            disabled={busy || !count}
            onClick={() => void send('now')}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}
            {queueId === 'default' ? `Download ${count}` : `Add ${count} to queue`}
          </button>
        </footer>
      </div>
    </section>
  );
}
