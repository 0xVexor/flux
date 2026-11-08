import { useMemo, useState } from 'react';
import { ClipboardPaste, FileUp, WandSparkles } from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import { buildNumberPattern, parseDownloadList } from '../../application/lists';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { newQueueId } from '../../domain/queues';

export function BatchDownloads({
  manager,
  initialText = '',
  sessionOrigin,
  onClose,
}: {
  manager: ManagerAPI;
  initialText?: string;
  sessionOrigin?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [queueId, setQueueId] = useState(() => newQueueId(manager.getSnapshot().settings));
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [sample, setSample] = useState('');
  const [lastNumber, setLastNumber] = useState('');
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [excluded, setExcluded] = useState(new Set<string>());
  async function paste() {
    try {
      setText((await navigator.clipboard.readText()).trim());
      setExcluded(new Set());
      setResult('');
      setError('');
    } catch {
      setError('Clipboard access is unavailable. Paste your links into the box with Ctrl+V.');
    }
  }
  const parsed = useMemo(() => {
    try {
      return { items: parseDownloadList(text), error: '' };
    } catch (cause) {
      return { items: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [text]);
  const visible = parsed.items.filter(
    (item) =>
      !filter || `${item.filename ?? ''} ${item.url}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const selected = visible.filter((item) => !excluded.has(item.url));
  async function add() {
    setError('');
    setBusy(true);
    try {
      const outcome = await manager.addBatch(
        selected.map((item) => ({
          ...item,
          queueId,
          startPaused: paused,
          useBrowserCookies: !!sessionOrigin && new URL(item.url).origin === sessionOrigin,
        })),
      );
      setResult(`${outcome.added} added; ${outcome.skipped} already queued.`);
      setText('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Add multiple downloads"
      description="Paste a link on each line, review your selection, then add them together."
      onClose={onClose}
      wide
    >
      <div className="dialog-form batch-dialog">
        <div className="dialog-body">
          {sessionOrigin && (
            <p className="small muted">
              Browser session authorized for selected downloads from {sessionOrigin}. Other origins
              receive no session credentials.
            </p>
          )}
          <section className="batch-block">
            <label htmlFor="batch-links" className="batch-label">
              Download links
            </label>
            <textarea
              id="batch-links"
              aria-label="Download links"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult('');
                setExcluded(new Set());
              }}
              rows={7}
              placeholder={'https://example.com/file.zip\nhttps://example.com/another-file.pdf'}
              spellCheck={false}
            />
            <div className="batch-toolbar">
              <div className="batch-actions">
                <button
                  type="button"
                  className="ds-btn is-outline is-small"
                  onClick={() => void paste()}
                >
                  <ClipboardPaste size={16} /> Paste from clipboard
                </button>
                <label className="ds-btn is-outline is-small">
                  <FileUp size={16} /> Import file
                  <input
                    type="file"
                    accept=".txt,.json,text/plain,application/json"
                    aria-label="Import text or JSON file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2 * 1024 * 1024) {
                        setError('Choose a list smaller than 2 MiB.');
                        return;
                      }
                      void file.text().then(
                        (value) => {
                          setText(value);
                          setExcluded(new Set());
                          setResult('');
                        },
                        () => setError('Could not read the selected list.'),
                      );
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="ds-btn is-ghost is-small"
                  aria-expanded={seriesOpen}
                  onClick={() => setSeriesOpen(!seriesOpen)}
                >
                  <WandSparkles size={16} /> Generate a numbered series
                </button>
              </div>
              <span className="batch-hint">One link per line · TXT or JSON up to 2 MiB</span>
            </div>
            {seriesOpen && (
              <fieldset className="series-panel">
                <legend className="sr-only">Numbered series</legend>
                <label className="series-link">
                  First link of the series
                  <input
                    value={sample}
                    onChange={(event) => setSample(event.target.value)}
                    placeholder="https://example.com/video-01.mp4"
                  />
                </label>
                <label className="series-last">
                  Last number
                  <input
                    type="number"
                    min={0}
                    value={lastNumber}
                    onChange={(event) => setLastNumber(event.target.value)}
                    placeholder="20"
                  />
                </label>
                <button
                  className="ds-btn is-outline series-go"
                  type="button"
                  disabled={!sample.trim() || !lastNumber}
                  onClick={() => {
                    try {
                      setText(buildNumberPattern(sample, Number(lastNumber)));
                      setExcluded(new Set());
                      setResult('');
                      setError('');
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                  }}
                >
                  Generate links
                </button>
                <p className="series-help">
                  Example: video-01.mp4 to video-20.mp4. You can also paste a pattern such as
                  file[001:010].zip.
                </p>
              </fieldset>
            )}
          </section>
          {!!visible.length && (
            <section className="batch-block" aria-label="Review links">
              <div className="batch-review-heading">
                <h3>
                  Review <span className="count-badge">{visible.length}</span>
                </h3>
                <button
                  type="button"
                  className="ds-btn is-ghost is-small"
                  onClick={() =>
                    setExcluded(
                      selected.length === visible.length
                        ? new Set(visible.map((item) => item.url))
                        : new Set(),
                    )
                  }
                >
                  {selected.length === visible.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="batch-preview" aria-label="Download list preview">
                {visible.map((item) => (
                  <label className="batch-item" key={item.url}>
                    <input
                      type="checkbox"
                      checked={!excluded.has(item.url)}
                      onChange={(event) =>
                        setExcluded((previous) => {
                          const next = new Set(previous);
                          if (event.target.checked) next.delete(item.url);
                          else next.add(item.url);
                          return next;
                        })
                      }
                    />
                    <span title={item.url}>
                      {item.filename ||
                        new URL(item.url).pathname.split('/').pop() ||
                        new URL(item.url).hostname}
                      <small>{new URL(item.url).hostname}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}
          <section className="batch-block batch-options">
            <label htmlFor="batch-queue">
              Download queue
              <Select
                id="batch-queue"
                value={queueId}
                onChange={(event) => setQueueId(event.target.value)}
              >
                <option value="default">Default queue</option>
                {manager.getSnapshot().settings.queues.map((queue) => (
                  <option key={queue.id} value={queue.id}>
                    {queue.name}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Filter links
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder=".zip, filename, or hostname"
              />
            </label>
            <label className="batch-paused">
              <input
                type="checkbox"
                checked={paused}
                onChange={(event) => setPaused(event.target.checked)}
              />
              <span>
                <strong>Add paused</strong>
                <small>Links wait in the list until you start them.</small>
              </span>
            </label>
          </section>
          {parsed.error && (
            <p className="error-message" role="alert">
              {parsed.error}
            </p>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {result && (
            <p className="notice" role="status">
              {result}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <span className="footer-summary">{selected.length} selected</span>
          <button className="ds-btn is-outline" onClick={onClose}>
            Close
          </button>
          <button
            className="ds-btn is-primary"
            disabled={busy || !selected.length || !!parsed.error}
            onClick={() => void add()}
          >
            {busy ? 'Adding…' : 'Add selected downloads'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
