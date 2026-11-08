import { Repository } from '../storage/repository';
import { validateUrl, safeError, trustedSender } from '../shared/security';
import { defaultSettings, runningStates, type Settings } from '../domain/model';
import { filenameFromHeaders, folderSegments, uniqueFilename } from '../shared/files';
import { noticeDetail, noticeTitle, readNotice, type DownloadNotice } from '../shared/notices';
import { showPageToast, toastPalettes } from '../shared/page-toast';
import { downloadsRelativePath, sanitizeFilename } from '../shared/files';
import { createJob } from '../application/jobs';
import {
  PAGE_FILE_LIMIT,
  PAGE_TRANSFER_TTL,
  PAGE_TRANSFER_SLOTS,
  pageTransferKey,
  type PageTransferGrant,
} from '../application/page-transfer';
import { nextQueueBoundary, queueAvailable } from '../application/queue';
import { allQueues, newQueueId } from '../domain/queues';
import { RequestLedger } from './request-ledger';
import { captureOrigins, eligibleLink, excludedHost } from '../shared/capture';
import { probe, HttpError } from '../engine/network/http';
import { HostPermissionError } from '../engine/network/policy';
import {
  browserReference,
  createBrowserJob,
  updateBrowserJob,
  browserNeedsReview,
} from '../domain/browser-download';
import type { DownloadJob, NewDownload } from '../domain/model';
import { hasPendingTransfer } from '../domain/retry';
const repository = new Repository();
const ownOrigin = `chrome-extension://${chrome.runtime.id}`;
const ledger = new RequestLedger(ownOrigin);
const nativeFallbacks = new Map<string, number>();
interface BrowserLinkHint {
  source: string;
  topHost: string;
  kind: 'blob' | 'data';
  at: number;
}
let hintWrites: Promise<unknown> = Promise.resolve();
function mutateHints<T>(operation: () => Promise<T>) {
  const task = hintWrites.then(operation);
  hintWrites = task.catch(() => undefined);
  return task;
}
async function browserLinkHints() {
  const stored = await chrome.storage.session.get('browserLinkHints');
  const entries: [string, BrowserLinkHint][] = [];
  if (stored.browserLinkHints && typeof stored.browserLinkHints === 'object')
    for (const [prefix, hint] of Object.entries(stored.browserLinkHints)) {
      const item = hint as BrowserLinkHint;
      if (
        /^flux-[a-f\d-]{36}--$/.test(prefix) &&
        item &&
        typeof item.source === 'string' &&
        typeof item.topHost === 'string' &&
        ['blob', 'data'].includes(item.kind) &&
        Number.isFinite(item.at) &&
        Date.now() - item.at < 15 * 60000
      )
        entries.push([prefix, item]);
    }
  return Object.fromEntries(entries.slice(-64));
}
let nativeWrites: Promise<unknown> = Promise.resolve();
let nativeIndex: Promise<Map<number, string>> | null = null;
const nativeSamples = new Map<number, { at: number; bytes: number }>();
function browserIndex() {
  if (!nativeIndex) {
    const pending = repository
      .getJobs()
      .then(
        (jobs) =>
          new Map(
            jobs
              .filter((job) => job.engine === 'browser' && job.browser)
              .map((job) => [job.browser!.id, job.id]),
          ),
      );
    nativeIndex = pending;
    void pending.catch(() => {
      if (nativeIndex === pending) nativeIndex = null;
    });
  }
  return nativeIndex;
}
function mutateNative<T>(operation: () => Promise<T>) {
  const task = nativeWrites.then(operation);
  nativeWrites = task.catch(() => undefined);
  return task;
}
async function notifyNative(job?: DownloadJob, removed?: string) {
  await chrome.runtime.sendMessage({ type: 'native-update', job, removed }).catch(() => undefined);
}
async function syncNative(
  id: number,
  create = false,
  attribution?: { source: string; filename: string },
) {
  const index = await browserIndex();
  const key = index.get(id);
  const existing = key ? await repository.getJob(key) : undefined;
  if (!existing && !create) return;
  const rawItem = (await chrome.downloads.search({ id }))[0];
  const item =
    rawItem && attribution
      ? {
          ...rawItem,
          referrer: rawItem.referrer || attribution.source,
          filename: attribution.filename,
        }
      : rawItem;
  if (!item || (existing?.browser && existing.browser.startedAt !== item.startTime)) {
    if (existing?.browser) {
      existing.browser.erased = true;
      existing.browser.canResume = false;
      if (['DOWNLOADING', 'PAUSED'].includes(existing.state)) {
        existing.state = 'FAILED';
        existing.error = 'The original transfer is missing or changed in Chrome download history.';
      }
      await repository.putJob(existing);
      await notifyNative(existing);
    }
    return;
  }
  const job = existing ? updateBrowserJob(existing, item) : createBrowserJob(item);
  if (job.state !== 'DOWNLOADING') nativeSamples.delete(id);
  await repository.putJob(job);
  index.set(id, job.id);
  await notifyNative(job);
  return job;
}
async function nativeCommand(id: string, action: string) {
  const job = await repository.getJob(id);
  if (job?.engine !== 'browser' || !job.browser)
    throw new Error('This browser transfer is no longer tracked.');
  const item = (await chrome.downloads.search({ id: job.browser.id }))[0];
  const matches = item && item.startTime === job.browser.startedAt;
  if (action === 'refresh') return { job: await syncNative(job.browser.id) };
  if (action === 'remove') {
    if (matches && item.state === 'in_progress') await chrome.downloads.cancel(item.id);
    await repository.deleteJob(job.id);
    (await browserIndex()).delete(job.browser.id);
    await notifyNative(undefined, job.id);
    return { removed: job.id };
  }
  if (action === 'review-browser') {
    await chrome.tabs.create({ url: 'chrome://downloads/' });
    return {};
  }
  if (!matches)
    throw new Error(
      'The original Chrome transfer is missing or its identity changed. Review Chrome download history.',
    );
  if (action === 'pause') {
    if (item.state === 'in_progress' && !item.paused) await chrome.downloads.pause(item.id);
  } else if (['resume', 'retry', 'start'].includes(action)) {
    if (browserNeedsReview(item.danger))
      throw new Error('Review the browser security warning in Chrome before continuing.');
    if (item.paused || item.state === 'interrupted') {
      if (!item.canResume)
        throw new Error(
          'Chrome cannot resume the original request. Start the download again on its website.',
        );
      await chrome.downloads.resume(item.id);
    }
  } else if (action === 'cancel') {
    if (item.state === 'in_progress') await chrome.downloads.cancel(item.id);
  } else if (action === 'show') {
    if (item.state !== 'complete' || item.exists === false)
      throw new Error('The browser file is not available to show.');
    chrome.downloads.show(item.id);
  } else
    throw new Error(
      'This option applies to Flux engine transfers. The original browser request keeps its own transfer settings.',
    );
  return { job: await syncNative(job.browser.id) };
}
chrome.downloads.onChanged.addListener((change) => {
  void mutateNative(() => syncNative(change.id)).catch((error) => console.error(safeError(error)));
});
chrome.downloads.onErased.addListener((id) => {
  void mutateNative(() => syncNative(id)).catch((error) => console.error(safeError(error)));
});
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // Chrome drops the filename given to downloads.download() once this listener exists,
  // so Flux's own saves pass their category path through session storage.
  if (item.byExtensionId === chrome.runtime.id) {
    const key = `save:${item.url}`;
    void chrome.storage.session.get(key).then(
      (stored) => {
        const path = typeof stored[key] === 'string' ? (stored[key] as string) : undefined;
        suggest(path ? { filename: path, conflictAction: 'uniquify' } : undefined);
        void chrome.storage.session.remove(key);
      },
      () => suggest(),
    );
    return true;
  }
  const basename = item.filename.split(/[\\/]/).pop() ?? '';
  const marker = basename.match(/^(flux-[a-f\d-]{36}--)(.*)$/);
  if (!marker) {
    let suggested = false;
    const finish = (value?: chrome.downloads.FilenameSuggestion) => {
      if (!suggested) {
        suggested = true;
        suggest(value);
      }
    };
    void repository.getSettings().then(
      (settings) =>
        finish(
          settings.autoSave && basename
            ? { filename: downloadsRelativePath(basename, settings), conflictAction: 'uniquify' }
            : undefined,
        ),
      (error) => {
        finish();
        console.error(safeError(error));
      },
    );
    return true;
  }
  let suggested = false;
  const finish = (value?: chrome.downloads.FilenameSuggestion) => {
    if (!suggested) {
      suggested = true;
      suggest(value);
    }
  };
  void (async () => {
    const hint = await mutateHints(async () => {
      const hints = await browserLinkHints();
      const hint = hints[marker[1]!];
      delete hints[marker[1]!];
      await chrome.storage.session.set({ browserLinkHints: hints });
      return hint;
    });
    if (!hint) {
      finish();
      return;
    }
    const filename = sanitizeFilename(marker[2] || 'download');
    const settings = await repository.getSettings();
    finish({
      filename: settings.autoSave ? downloadsRelativePath(filename, settings) : filename,
      conflictAction: 'uniquify',
    });
    const source = validateUrl(hint.source);
    if (
      !settings.interception ||
      excludedHost(source.hostname, settings.excludedHosts) ||
      excludedHost(hint.topHost, settings.excludedHosts) ||
      !item.url.startsWith(hint.kind + ':')
    )
      return;
    await mutateNative(() => syncNative(item.id, true, { source: source.href, filename }));
    await wakeManager();
  })().catch((error) => {
    finish();
    console.error(safeError(error));
  });
  return true;
});
function rememberBrowserFallback(url: string) {
  for (const [key, at] of nativeFallbacks) if (Date.now() - at > 60000) nativeFallbacks.delete(key);
  while (nativeFallbacks.size >= 64) nativeFallbacks.delete(nativeFallbacks.keys().next().value!);
  nativeFallbacks.set(url, Date.now());
}
const onRequestSeen = (details: chrome.webRequest.OnBeforeRequestDetails) => {
  try {
    validateUrl(details.url);
    ledger.recordRequest(details.url, details.method, details.initiator, details.tabId);
  } catch {
    /* Ineligible destinations never enter capture metadata. */
  }
  return undefined;
};
const onHeadersSeen = (details: chrome.webRequest.OnHeadersReceivedDetails) => {
  if (details.statusCode < 300 || details.statusCode >= 400) return undefined;
  const location = details.responseHeaders?.find(
    (header) => header.name.toLowerCase() === 'location',
  )?.value;
  if (location) ledger.recordRedirect(details.url, location, details.initiator);
  return undefined;
};
let webRequestFor = '';
/**
 * Host access is optional and granted per site. Chrome reports an error when a webRequest
 * listener filters on sites the extension cannot access, so listen only on granted origins
 * and update the listeners whenever access changes.
 */
async function registerWebRequestListeners() {
  const { origins = [] } = await chrome.permissions.getAll();
  const urls = origins
    .filter((origin) => origin.startsWith('http://') || origin.startsWith('https://'))
    .sort();
  const key = urls.join('|');
  if (key === webRequestFor) return;
  chrome.webRequest.onBeforeRequest.removeListener(onRequestSeen);
  chrome.webRequest.onHeadersReceived.removeListener(onHeadersSeen);
  webRequestFor = key;
  if (!urls.length) return;
  chrome.webRequest.onBeforeRequest.addListener(onRequestSeen, { urls });
  chrome.webRequest.onHeadersReceived.addListener(onHeadersSeen, { urls }, ['responseHeaders']);
}
let webRequestReady: Promise<void> = registerWebRequestListeners().catch((e) =>
  console.error(safeError(e)),
);
function refreshWebRequestListeners() {
  webRequestReady = webRequestReady
    .then(registerWebRequestListeners)
    .catch((e) => console.error(safeError(e)));
}
async function resolveRedirect(from: string, location: string | null, signal?: AbortSignal) {
  const source = validateUrl(from);
  if (!(await chrome.permissions.contains({ origins: [`${source.origin}/*`] })))
    throw new HostPermissionError(source.origin);
  await webRequestReady;
  const destination = location ?? (await ledger.waitForRedirect(source.href));
  if (signal?.aborted) throw new DOMException('Paused', 'AbortError');
  if (!destination)
    throw new Error('The redirect destination could not be read. Retry the download.');
  const target = validateUrl(new URL(destination, source).href);
  if (source.protocol === 'https:' && target.protocol === 'http:')
    throw new Error('An insecure HTTPS-to-HTTP redirect was blocked.');
  if (!(await chrome.permissions.contains({ origins: [`${target.origin}/*`] })))
    throw new HostPermissionError(target.origin);
  return target.href;
}
let enqueueing: Promise<unknown> = Promise.resolve();
/** `allowDuplicate` is used when the user chose to download another copy. */
function enqueue(url: string, filename?: string, hold = false, allowDuplicate = false) {
  const task = enqueueing.then(async () => {
    const settings = await repository.getSettings();
    const jobs = await repository.getJobs();
    // Auto-saved jobs finish as COMPLETED within seconds, so also treat a recent
    // job for the same URL as the existing one; a repeated click must not duplicate it.
    // The same file can arrive under another address (a redirect), so the name counts too.
    const wanted = (filename ?? filenameFromHeaders(null, url)).toLowerCase();
    const existing = allowDuplicate
      ? undefined
      : jobs.find(
          (job) =>
            job.engine !== 'browser' &&
            (job.url === url || job.filename.toLowerCase() === wanted) &&
            (hasPendingTransfer(job, settings) ||
              (Date.now() - job.createdAt < 30000 && !['FAILED', 'CANCELED'].includes(job.state))),
        );
    if (existing) return { job: existing, created: false };
    const job = createJob({ url, filename, useBrowserCookies: true }, settings);
    if (hold) {
      job.state = 'PAUSED';
      job.capturePending = true;
    }
    await repository.putJob(job);
    return { job, created: true };
  });
  enqueueing = task.catch(() => undefined);
  return task;
}
/** The manager tab owns the engine; keep one open in the background without taking focus. */
const managerUrl = () => chrome.runtime.getURL('manager.html');
async function hasOffscreenEngine() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}
/** Runs the engine in a hidden page so downloads continue without a manager tab. */
async function startOffscreenEngine(handoff = false) {
  if (await hasOffscreenEngine()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html' + (handoff ? '?handoff=1' : ''),
    reasons: ['WORKERS' as chrome.offscreen.Reason],
    justification: 'Runs Flux downloads in the background when no manager tab is open.',
  });
}
/** Makes sure some page is running the engine: a manager tab, or else the hidden page. */
async function ensureEngine() {
  const tabs = await chrome.tabs.query({ url: managerUrl() + '*' });
  if (tabs.length) return;
  try {
    await startOffscreenEngine();
  } catch (error) {
    console.warn('[flux:engine] hidden engine unavailable, opening a tab', safeError(error));
    await chrome.tabs.create({ url: managerUrl(), active: false });
  }
}
async function wakeManager() {
  await ensureEngine();
  await chrome.runtime.sendMessage({ type: 'queue-wake' }).catch(() => undefined);
}
/** Sends a command to the engine, starting it first when nothing is running it. */
async function commandEngine(message: object) {
  const attempt = () => chrome.runtime.sendMessage(message).catch(() => undefined);
  const first = await attempt();
  if (first) return first;
  await ensureEngine();
  // The engine answers only after it has loaded the jobs, so give it a few seconds.
  for (let tries = 0; tries < 24; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const reply = await attempt();
    if (reply) return reply;
  }
  return { ok: false, error: 'Flux could not start its download engine. Open the manager.' };
}
/** After the last manager tab closes, unfinished work moves to the hidden engine. */
chrome.tabs.onRemoved.addListener(() => {
  void (async () => {
    if ((await chrome.tabs.query({ url: managerUrl() + '*' })).length) return;
    const jobs = await repository.getJobs();
    const unfinished = jobs.some(
      (job) =>
        job.engine !== 'browser' &&
        !job.capturePending &&
        (job.state === 'QUEUED' || (runningStates.has(job.state) && job.state !== 'ASSEMBLING')),
    );
    if (unfinished) await startOffscreenEngine(true);
  })().catch((error) => console.warn('[flux:engine]', safeError(error)));
});
/** Shows the toolbar popup so the user sees the transfer start instead of switching tabs. */
async function announce(count: number) {
  await chrome.storage.session
    .set({ popupNotice: { count, at: Date.now() } })
    .catch(() => undefined);
  await chrome.action.openPopup().catch(() => undefined);
}
/**
 * The same file was asked for again. Hold the new request and open the Add window so the user
 * can rename it or cancel, instead of starting the file twice.
 */
async function holdDuplicate(existing: DownloadJob, url: string) {
  // A second click while the question is still open adds nothing new.
  if (!existing.capturePending) {
    const jobs = await repository.getJobs();
    const name = uniqueFilename(
      existing.filename,
      jobs.map((job) => job.filename),
    );
    const entry = await enqueue(url, name, true, true);
    await mutateChoice(async (choice) => {
      if (choice.items.some((item) => item.id === entry.job.id)) return;
      choice.items.push({
        id: entry.job.id,
        filename: entry.job.filename,
        url: entry.job.url,
        duplicateOf: existing.id,
      });
      choice.at = Date.now();
    });
  }
  await chrome.action.openPopup().catch(() => undefined);
}
interface QueueChoice {
  items: { id: string; filename: string; url?: string; duplicateOf?: string }[];
  at: number;
}
let choiceWrites: Promise<unknown> = Promise.resolve();
function mutateChoice<T>(operation: (choice: QueueChoice) => Promise<T>) {
  const task = choiceWrites.then(async () => {
    const stored = (await chrome.storage.session.get('queueChoice')) as {
      queueChoice?: QueueChoice;
    };
    const choice: QueueChoice =
      stored.queueChoice && Array.isArray(stored.queueChoice.items)
        ? stored.queueChoice
        : { items: [], at: Date.now() };
    const result = await operation(choice);
    await chrome.storage.session.set({ queueChoice: choice });
    await chrome.action.setBadgeText({
      text: choice.items.length ? String(choice.items.length) : '',
    });
    if (choice.items.length) await chrome.action.setBadgeBackgroundColor({ color: '#d2b477' });
    return result;
  });
  choiceWrites = task.catch(() => undefined);
  return task;
}
/** Moves held captures into a queue and lets the engine pick them up. */
/** What the batch dialog may set on every file in the group. Anything else is ignored. */
interface ReleaseOptions {
  priority?: number;
  maxConnections?: number;
  mode?: 'auto' | 'manual';
  speedLimit?: number;
  scheduledAt?: number | null;
  useBrowserCookies?: boolean;
}
function readReleaseOptions(value: unknown): ReleaseOptions {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  const options: ReleaseOptions = {};
  if ([-2, 0, 2].includes(v.priority as number)) options.priority = v.priority as number;
  if ([1, 2, 4, 8, 16].includes(v.maxConnections as number))
    options.maxConnections = v.maxConnections as number;
  if (v.mode === 'auto' || v.mode === 'manual') options.mode = v.mode;
  if (typeof v.speedLimit === 'number' && Number.isFinite(v.speedLimit) && v.speedLimit >= 0)
    options.speedLimit = Math.min(Math.round(v.speedLimit), 1e12);
  if (v.scheduledAt === null) options.scheduledAt = null;
  else if (typeof v.scheduledAt === 'number' && Number.isFinite(v.scheduledAt) && v.scheduledAt > 0)
    options.scheduledAt = v.scheduledAt;
  if (typeof v.useBrowserCookies === 'boolean') options.useBrowserCookies = v.useBrowserCookies;
  return options;
}
/** `saveSubfolder` sends the whole group to one folder inside the download folder. */
async function releaseJobs(
  ids: string[],
  queueId: string,
  mode: 'now' | 'paused',
  saveSubfolder?: string,
  options: ReleaseOptions = {},
) {
  const settings = await repository.getSettings();
  if (queueId !== 'default' && !settings.queues.some((queue) => queue.id === queueId))
    throw new Error('That queue no longer exists.');
  // Parts are sanitized and ".." is dropped, so the folder stays inside the download folder.
  const folder = saveSubfolder ? folderSegments(saveSubfolder).slice(0, 4).join('/') : '';
  for (const id of ids) {
    const job = await repository.getJob(id);
    if (!job?.capturePending) continue;
    job.capturePending = false;
    job.queueId = queueId;
    if (folder) job.saveSubfolder = folder;
    if (options.priority !== undefined) job.priority = options.priority;
    // Connection settings only apply to plain files, not to playlists.
    if (!job.media && options.maxConnections !== undefined)
      job.maxConnections = options.maxConnections;
    if (!job.media && options.mode !== undefined) job.mode = options.mode;
    if (options.speedLimit !== undefined) job.speedLimit = options.speedLimit;
    if (options.scheduledAt !== undefined) job.scheduledAt = options.scheduledAt;
    if (options.useBrowserCookies !== undefined) job.useBrowserCookies = options.useBrowserCookies;
    job.state = mode === 'paused' ? 'PAUSED' : 'QUEUED';
    await repository.putJob(job);
  }
  await wakeManager();
}
/** New captures either wait for a queue choice in the popup or start right away. */
async function routeCaptured(jobs: DownloadJob[], count = jobs.length) {
  const settings = await repository.getSettings();
  const held = jobs.filter((job) => job.capturePending);
  if (held.length && (settings.confirmCapture || (settings.askQueue && settings.queues.length))) {
    await mutateChoice(async (choice) => {
      const known = new Set(choice.items.map((item) => item.id));
      choice.items.push(
        ...held
          .filter((job) => !known.has(job.id))
          .map((job) => ({ id: job.id, filename: job.filename, url: job.url })),
      );
      choice.at = Date.now();
    });
    // If the popup cannot open (no focused window), the badge count still asks for a click.
    await chrome.action.openPopup().catch(() => undefined);
    return;
  }
  await releaseJobs(
    held.map((job) => job.id),
    newQueueId(await repository.getSettings()),
    'now',
  );
  await announce(count);
}
async function openManager(hash = '') {
  const url = chrome.runtime.getURL('manager.html');
  const tabs = await chrome.tabs.query({ url: url + '*' });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true, ...(hash ? { url: url + hash } : {}) });
    if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else await chrome.tabs.create({ url: url + hash });
}
async function applyCaptureConfiguration() {
  const settings = await repository.getSettings();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (!settings.interception) {
    if (registered.some((s) => s.id === 'flux-offers'))
      await chrome.scripting.unregisterContentScripts({ ids: ['flux-offers'] });
    const tabs = await chrome.tabs.query({ url: captureOrigins });
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id)
        .map((tab) => chrome.tabs.sendMessage(tab.id!, { type: 'capture-config-changed' })),
    );
    return;
  }
  const permissions = await chrome.permissions.getAll();
  const matches = (permissions.origins ?? []).filter(
    (origin) =>
      /^https?:\/\//.test(origin) &&
      !settings.excludedHosts.some((host) => {
        try {
          return new URL(origin.replace('*', '')).hostname === host;
        } catch {
          return false;
        }
      }),
  );
  if (!matches.length) return;
  if (registered.some((s) => s.id === 'flux-offers'))
    await chrome.scripting.updateContentScripts([
      { id: 'flux-offers', matches, js: ['content.js'], runAt: 'document_start', allFrames: true },
    ]);
  else
    await chrome.scripting.registerContentScripts([
      {
        id: 'flux-offers',
        js: ['content.js'],
        matches,
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.allSettled(
    tabs
      .filter((tab) => {
        try {
          return !!tab.id && !!tab.url && !!validateUrl(tab.url);
        } catch {
          return false;
        }
      })
      .map(async (tab) => {
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id!, allFrames: true },
            files: ['content.js'],
            injectImmediately: true,
          })
          .catch(() =>
            chrome.scripting.executeScript({
              target: { tabId: tab.id! },
              files: ['content.js'],
              injectImmediately: true,
            }),
          );
        await chrome.tabs.sendMessage(tab.id!, { type: 'capture-config-changed' });
      }),
  );
}
let configuring = Promise.resolve();
function configureOffers() {
  configuring = configuring.catch(() => undefined).then(applyCaptureConfiguration);
  return configuring;
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'flux-download',
      title: 'Download with Flux',
      // With "selection", right-clicking a link inside selected text also reports that selection.
      contexts: ['link', 'selection'],
      targetUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
  void configureOffers().catch((e) => console.error(safeError(e)));
});
chrome.permissions.onAdded.addListener(() => {
  watchNotificationClicks();
  refreshWebRequestListeners();
  void configureOffers().catch((e) => console.error(safeError(e)));
  // Access granted from the popup (which may close during the prompt) resumes waiting jobs.
  void (async () => {
    const jobs = await repository.getJobs();
    for (const job of jobs) {
      if (!job.permissionOrigin || !['PAUSED', 'FAILED'].includes(job.state)) continue;
      if (!(await chrome.permissions.contains({ origins: [`${job.permissionOrigin}/*`] })))
        continue;
      await chrome.runtime
        .sendMessage({ type: 'manager-command', id: job.id, action: 'retry' })
        .catch(() => undefined);
    }
  })().catch((e) => console.error(safeError(e)));
});
chrome.permissions.onRemoved.addListener(() => {
  refreshWebRequestListeners();
  void configureOffers().catch((e) => console.error(safeError(e)));
});
/** Links inside the page's current text selection, in document order. */
async function selectedLinks(tab: chrome.tabs.Tab | undefined, frameId = 0) {
  if (!tab?.id) return [];
  const result = await chrome.scripting
    .executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: () => {
        const selection = getSelection();
        const links: string[] = [];
        for (let index = 0; selection && index < selection.rangeCount; index++) {
          const range = selection.getRangeAt(index);
          const root = range.commonAncestorContainer;
          const element = root instanceof Element ? root : root.parentElement;
          const enclosing = element?.closest<HTMLAnchorElement>('a[href]');
          const anchors = enclosing
            ? [enclosing]
            : Array.from(element?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []);
          for (const anchor of anchors) if (range.intersectsNode(anchor)) links.push(anchor.href);
        }
        return links.slice(0, 500);
      },
    })
    .catch(() => []);
  return result.flatMap((entry) => (Array.isArray(entry.result) ? (entry.result as string[]) : []));
}
async function downloadFromMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const settings = await repository.getSettings();
  const candidates = [
    ...(info.selectionText ? await selectedLinks(tab, info.frameId) : []),
    ...(info.linkUrl ? [info.linkUrl] : []),
  ].flatMap((value) => {
    try {
      return [validateUrl(value).href];
    } catch {
      return [];
    }
  });
  const unique = [...new Set(candidates)];
  // A selection often spans navigation links too; prefer recognized file links when there are any.
  const files = unique.filter((url) => eligibleLink(url, settings));
  const urls = unique.length > 1 && files.length ? files : unique;
  if (!urls.length) throw new Error('No downloadable links were found in the selection.');
  const jobs: DownloadJob[] = [];
  for (const url of urls) jobs.push((await enqueue(url, undefined, true)).job);
  await routeCaptured(jobs);
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'flux-download') return;
  // openPopup needs the click's user activation, so open it now; it fills in as jobs arrive.
  void chrome.action.openPopup().catch(() => undefined);
  void downloadFromMenu(info, tab).catch((error) =>
    openManager(`#error=${encodeURIComponent(safeError(error))}`),
  );
});
chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await configureOffers();
    const jobs = await repository.getJobs();
    const pending = jobs
      .filter((j) => j.state === 'QUEUED' && j.scheduledAt)
      .map((j) => j.scheduledAt!);
    // Scheduled queues with waiting files must also fire after a browser restart.
    const settings = await repository.getSettings();
    for (const queue of allQueues(settings)) {
      if (!jobs.some((job) => (job.queueId ?? 'default') === queue.id && job.state === 'QUEUED'))
        continue;
      const at = queueAvailable(queue) ? Date.now() : nextQueueBoundary(queue);
      if (at != null) pending.push(at);
    }
    // With automatic recovery, unfinished downloads continue after a browser restart.
    if (
      settings.recovery === 'auto' &&
      jobs.some(
        (job) =>
          job.engine !== 'browser' &&
          !job.capturePending &&
          (job.state === 'QUEUED' || (runningStates.has(job.state) && job.state !== 'ASSEMBLING')),
      )
    )
      await startOffscreenEngine().catch((error) =>
        console.warn('[flux:engine]', safeError(error)),
      );
    if (pending.length)
      await chrome.alarms.create('flux-queue', {
        when: Math.max(Date.now() + 1000, Math.min(...pending)),
      });
  })().catch((e) => console.error(safeError(e)));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  // A schedule must start even when the manager was closed, so reopen it in the background.
  if (alarm.name === 'flux-queue') void wakeManager().catch((e) => console.error(safeError(e)));
});
/**
 * A page started a blob download from script, so no click reached the content script.
 * Ask the page to hand the bytes to Flux, then drop Chrome's copy. False keeps Chrome's download.
 */
async function takeOverBlob(item: chrome.downloads.DownloadItem, settings: Settings) {
  try {
    const origin = new URL(item.url.slice(5)).origin;
    const host = new URL(origin).hostname;
    if (excludedHost(host, settings.excludedHosts)) return false;
    if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return false;
    // Downloads that Flux itself deferred to Chrome after a failed hand-off must stay there.
    const hints = Object.values(await browserLinkHints());
    if (
      hints.some((hint) => Date.now() - hint.at < 30000 && new URL(hint.source).origin === origin)
    )
      return false;
    const tabs = (await chrome.tabs.query({})).filter((tab) => {
      try {
        return tab.id !== undefined && new URL(tab.url ?? '').origin === origin;
      } catch {
        return false;
      }
    });
    if (!tabs.length) return false;
    let filename = '';
    for (let attempt = 0; attempt < 10 && !filename; attempt++) {
      const current = (await chrome.downloads.search({ id: item.id }))[0];
      filename = current?.filename?.split(/[\\/]/).pop() ?? '';
      if (!filename) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const tab of tabs) {
      const reply = await chrome.tabs
        .sendMessage(tab.id!, {
          type: 'fetch-blob',
          url: item.url,
          filename: filename || 'download',
        })
        .catch(() => null);
      if (reply?.ok !== true) continue;
      const current = (await chrome.downloads.search({ id: item.id }))[0];
      if (current?.state === 'in_progress') await chrome.downloads.cancel(item.id);
      else if (current?.state === 'complete' && current.exists !== false)
        await chrome.downloads.removeFile(item.id).catch(() => undefined);
      await chrome.downloads.erase({ id: item.id }).catch(() => undefined);
      await wakeManager();
      return true;
    }
  } catch {
    /* Chrome keeps the download whenever the hand-off cannot be completed. */
  }
  return false;
}
chrome.downloads.onCreated.addListener((item) => {
  // Hold an in-flight transfer at once: small files on a fast network finish before the checks
  // below, which would leave Chrome's copy saved next to Flux's.
  const earlyHold =
    item.state === 'in_progress' &&
    !item.byExtensionId &&
    (item.url.startsWith('http://') || item.url.startsWith('https://'))
      ? chrome.downloads.pause(item.id).then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
  void (async () => {
    // Flux's own category saves are blob:chrome-extension:// downloads; never track them.
    if (item.byExtensionId || item.url.startsWith(`blob:${ownOrigin}/`)) return;
    const settings = await repository.getSettings();
    if (!settings.interception) {
      console.info('[flux:capture] skipped: capture is off');
      return;
    }
    if (item.url.startsWith('blob:') && (await takeOverBlob(item, settings))) return;
    const fallbackAt = nativeFallbacks.get(item.url);
    const requiresBrowser = fallbackAt !== undefined && Date.now() - fallbackAt < 60000;
    if (requiresBrowser) nativeFallbacks.delete(item.url);
    const reference = browserReference(item);
    const url = reference.url;
    if (excludedHost(url.hostname, settings.excludedHosts)) {
      console.info('[flux:capture] skipped: host excluded', url.hostname);
      return;
    }
    const sourceTab = ledger.sourceTab(item.url);
    if (item.referrer) {
      try {
        if (excludedHost(new URL(item.referrer).hostname, settings.excludedHosts)) return;
      } catch {
        /* Referrer is only an exclusion hint. */
      }
    }
    // Generated downloads lack a reliable tab ID; do not bypass a possible parent exclusion.
    if (reference.sourceKind !== 'http' && sourceTab === undefined && settings.excludedHosts.length)
      return;
    if (sourceTab !== undefined && sourceTab >= 0) {
      const tab = await chrome.tabs.get(sourceTab).catch(() => null);
      if (!tab || (tab.url && excludedHost(new URL(tab.url).hostname, settings.excludedHosts)))
        return;
    }
    const filename = item.filename
      ? sanitizeFilename(item.filename.split(/[\\/]/).pop() ?? 'download')
      : filenameFromHeaders(null, url.href);
    const mimeEligible =
      /^(application\/(octet-stream|pdf|zip|x-|vnd\.)|audio\/|video\/|image\/)/i.test(item.mime);
    if (
      !requiresBrowser &&
      !eligibleLink(url.href, settings) &&
      !eligibleLink(`https://filename.invalid/${encodeURIComponent(filename)}`, settings) &&
      !mimeEligible
    ) {
      console.info('[flux:capture] skipped: not an eligible file', { mime: item.mime, filename });
      return;
    }
    console.info('[flux:capture] candidate', {
      mime: item.mime,
      state: item.state,
      sourceKind: reference.sourceKind,
      recentGet: ledger.isRecentGet(item.url, settings.excludedHosts),
      hasAccess: await chrome.permissions.contains({ origins: [`${url.origin}/*`] }),
    });
    if (
      item.state === 'in_progress' &&
      !requiresBrowser &&
      reference.sourceKind === 'http' &&
      item.danger === 'safe' &&
      ledger.isRecentGet(item.url, settings.excludedHosts) &&
      (await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))
    ) {
      let paused = false;
      let canceled = false;
      let queued: Awaited<ReturnType<typeof enqueue>> | undefined;
      try {
        if (!(await earlyHold)) await chrome.downloads.pause(item.id);
        paused = true;
        const current = (await chrome.downloads.search({ id: item.id }))[0];
        if (!current || current.state !== 'in_progress') return;
        const resource = await probe(url.href, AbortSignal.timeout(25000), fetch, false, {
          credentialOrigin: url.origin,
          resolveRedirect,
        });
        if (/^(text\/html|application\/(json|problem\+json))/i.test(resource.mime))
          throw new Error('The website requires its original browser request.');
        if (item.totalBytes > 0 && resource.size !== null && item.totalBytes !== resource.size)
          throw new Error('The public URL does not match the browser download.');
        queued = await enqueue(
          url.href,
          filename === 'download' ? resource.filename : filename,
          true,
        );
        await chrome.downloads.cancel(item.id);
        canceled = true;
        // Flux owns the file now; do not leave a "Canceled" row in the Chrome download list.
        await chrome.downloads.erase({ id: item.id }).catch(() => undefined);
        if (queued.created) await routeCaptured([queued.job], 1);
        else await holdDuplicate(queued.job, url.href);
        return;
      } catch (error) {
        if (queued?.created && !canceled) await repository.deleteJob(queued.job.id);
        if (paused && !canceled) {
          const current = (await chrome.downloads.search({ id: item.id }))[0];
          if (current?.state === 'in_progress' && current.paused)
            await chrome.downloads.resume(item.id);
        }
        if (canceled) {
          await openManager(
            `#error=${encodeURIComponent('Download captured but queue activation failed. Resume the retained job in Flux. ' + safeError(error))}`,
          );
          return;
        }
        console.info('[flux:capture] kept in Chrome:', safeError(error));
        // Keep the original browser download when a GET cannot be reproduced safely.
      }
    }
    await mutateNative(() => syncNative(item.id, true));
    await wakeManager();
  })()
    .catch((error) => {
      if (error instanceof Error && !error.message.includes('blocked'))
        console.error(safeError(error));
    })
    .finally(async () => {
      // Anything Flux did not take over continues in Chrome.
      if (!(await earlyHold)) return;
      const current = (await chrome.downloads.search({ id: item.id }))[0];
      if (current?.state === 'in_progress' && current.paused)
        await chrome.downloads.resume(item.id).catch(() => undefined);
    });
});
/**
 * A download finished, is ready to save, or failed. It always shows in the toolbar popup; if the
 * user turned system notifications on (and allowed them) it is also a system notification.
 */
/** Shows the notice as a toast on the active tab. False when that tab is off limits. */
async function showNoticeOnPage(notice: DownloadNotice, theme: Settings['theme']) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('http')) return false;
  if (!(await chrome.permissions.contains({ origins: [`${new URL(tab.url).origin}/*`] })))
    return false;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: showPageToast,
    args: [
      {
        kind: notice.kind,
        title: noticeTitle[notice.kind],
        filename: notice.filename,
        detail: noticeDetail(notice),
        id: notice.id,
        autoCloseMs: notice.kind === 'saved' ? 5000 : 0,
      },
      theme,
      toastPalettes,
    ],
  });
  return true;
}
async function announceDownload(notice: DownloadNotice) {
  await chrome.storage.session.set({ downloadNotice: notice });
  const settings = await repository.getSettings();
  if (
    settings.notifications &&
    (await chrome.permissions.contains({ permissions: ['notifications'] }))
  ) {
    watchNotificationClicks();
    await chrome.notifications
      ?.create(`flux-${notice.kind}-${notice.id ?? notice.at}`, {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: noticeTitle[notice.kind],
        message: `${notice.filename}
${noticeDetail(notice)}`,
      })
      .catch((error) => console.warn('[flux:notice] system notification failed', safeError(error)));
  }
  // On the page the user is looking at, when Flux may run there; otherwise in the toolbar popup.
  if (await showNoticeOnPage(notice, settings.theme).catch(() => false)) return;
  // Prefer the last normal browser window; DevTools or app windows have no toolbar.
  const window = await chrome.windows
    .getLastFocused({ windowTypes: ['normal'] })
    .catch(() => undefined);
  await chrome.action
    .openPopup(window?.id !== undefined ? { windowId: window.id } : undefined)
    .catch((error) => console.warn('[flux:notice] could not open the popup', safeError(error)));
}
/**
 * Clicking a system notification opens the manager. `chrome.notifications` does not exist until
 * the user grants the optional permission, so this must never run unguarded at startup: reading
 * it from nothing throws, and a throw while the file loads stops everything defined after it.
 */
let notificationClicksWatched = false;
function watchNotificationClicks() {
  if (notificationClicksWatched || !chrome.notifications) return;
  notificationClicksWatched = true;
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('flux-')) return;
    void chrome.notifications.clear(id);
    void openManager().catch((error) => console.error(safeError(error)));
  });
}
watchNotificationClicks();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  const fromEngine =
    !!sender.url &&
    (sender.url.startsWith(managerUrl()) ||
      sender.url.startsWith(chrome.runtime.getURL('offscreen.html')));
  if (message.type === 'release-engine' && fromEngine) {
    void hasOffscreenEngine()
      .then((has) => (has ? chrome.offscreen.closeDocument() : undefined))
      .then(
        () => respond({ ok: true }),
        (error) => respond({ ok: false, error: safeError(error) }),
      );
    return true;
  }
  if (
    message.type === 'has-origins' &&
    fromEngine &&
    Array.isArray(message.origins) &&
    message.origins.length <= 16 &&
    message.origins.every(
      (origin: unknown) =>
        typeof origin === 'string' &&
        (origin.startsWith('http://') || origin.startsWith('https://')),
    )
  ) {
    void chrome.permissions.contains({ origins: message.origins }).then(
      (ok) => respond({ ok }),
      () => respond({ ok: false }),
    );
    return true;
  }
  if (message.type === 'set-queue-alarm' && fromEngine && Number.isFinite(message.when)) {
    void chrome.alarms.create('flux-queue', { when: message.when }).then(
      () => respond({ ok: true }),
      () => respond({ ok: false }),
    );
    return true;
  }
  if (
    message.type === 'notice-action' &&
    sender.tab &&
    (message.action === 'open' ||
      (message.action === 'retry' && typeof message.id === 'string' && message.id.length <= 80))
  ) {
    // Only the toast we put on a page sends this; a retry goes to the engine like any other.
    void (
      message.action === 'open'
        ? openManager()
        : commandEngine({ type: 'manager-command', id: message.id, action: 'retry' })
    ).then(
      () => respond({ ok: true }),
      (error) => respond({ ok: false, error: safeError(error) }),
    );
    return true;
  }
  if (message.type === 'download-notice' && fromEngine) {
    const notice = readNotice(message);
    if (notice) void announceDownload(notice).catch((error) => console.error(safeError(error)));
    return;
  }
  if (
    message.type === 'prepare-browser-link' &&
    sender.tab &&
    ['blob', 'data'].includes(message.kind)
  ) {
    void (async () => {
      const settings = await repository.getSettings();
      if (!settings.interception || !sender.url || !sender.tab?.url) return {};
      const source = validateUrl(sender.url);
      const top = new URL(sender.tab.url);
      if (
        excludedHost(source.hostname, settings.excludedHosts) ||
        excludedHost(top.hostname, settings.excludedHosts) ||
        !(await chrome.permissions.contains({ origins: [`${source.origin}/*`] }))
      )
        return {};
      return await mutateHints(async () => {
        const prefix = `flux-${crypto.randomUUID()}--`;
        const hints = await browserLinkHints();
        hints[prefix] = {
          source: source.href,
          topHost: top.hostname,
          kind: message.kind,
          at: Date.now(),
        };
        await chrome.storage.session.set({
          browserLinkHints: Object.fromEntries(Object.entries(hints).slice(-64)),
        });
        return { prefix };
      });
    })().then(respond, () => respond({}));
    return true;
  }
  if (message.type === 'begin-blob' && sender.tab) {
    // The page's own blob/data bytes are streamed to the manager under a short-lived token.
    void (async () => {
      const settings = await repository.getSettings();
      if (
        !settings.interception ||
        !sender.url ||
        !sender.tab?.url ||
        !sender.documentId ||
        !Number.isSafeInteger(sender.tab.id) ||
        !Number.isSafeInteger(sender.frameId) ||
        !Number.isSafeInteger(message.size) ||
        message.size < 0 ||
        message.size > PAGE_FILE_LIMIT
      )
        return {};
      const source = validateUrl(sender.url);
      const top = new URL(sender.tab.url);
      if (
        excludedHost(source.hostname, settings.excludedHosts) ||
        excludedHost(top.hostname, settings.excludedHosts) ||
        !(await chrome.permissions.contains({ origins: [`${source.origin}/*`] }))
      )
        return {};
      await wakeManager();
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt++) {
        ready =
          (await chrome.runtime.sendMessage({ type: 'blob-ready' }).catch(() => null))?.ok === true;
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!ready) return {};
      return mutateHints(async () => {
        const stored = await chrome.storage.session.get(null);
        const entries = Object.entries(stored).filter(([key]) =>
          key.startsWith('blobTransfer:'),
        ) as [string, PageTransferGrant][];
        const expired = entries.filter(
          ([, grant]) =>
            !grant || !Number.isFinite(grant.at) || Date.now() - grant.at >= PAGE_TRANSFER_TTL,
        );
        if (expired.length) await chrome.storage.session.remove(expired.map(([key]) => key));
        if (entries.length - expired.length >= PAGE_TRANSFER_SLOTS) return {};
        const token = crypto.randomUUID();
        await chrome.storage.session.set({
          [pageTransferKey(token)]: {
            source: source.href,
            tabId: sender.tab!.id!,
            frameId: sender.frameId!,
            documentId: sender.documentId!,
            size: message.size,
            at: Date.now(),
          } satisfies PageTransferGrant,
        });
        return { token };
      });
    })().then(respond, () => respond({}));
    return true;
  }
  if (message.type === 'capture-link' && sender.tab && typeof message.url === 'string') {
    void (async () => {
      const settings = await repository.getSettings();
      if (!settings.interception) return { ok: false };
      const url = validateUrl(message.url);
      const page = sender.url ? validateUrl(sender.url) : null;
      const topPage = sender.tab?.url ? new URL(sender.tab.url) : null;
      if (
        !page ||
        excludedHost(page.hostname, settings.excludedHosts) ||
        (topPage && excludedHost(topPage.hostname, settings.excludedHosts)) ||
        !eligibleLink(url.href, settings, message.explicitDownload === true)
      )
        throw new Error('This download is excluded from automatic capture.');
      if (
        !(await chrome.permissions.contains({ origins: [`${page.origin}/*`, `${url.origin}/*`] }))
      )
        throw new HostPermissionError(url.origin);
      // Recognized links can still require the page's cookie session. Preserve that request.
      try {
        const resource = await probe(url.href, AbortSignal.timeout(25000), fetch, false, {
          credentialOrigin: url.origin,
          resolveRedirect,
        });
        if (/^text\/html/i.test(resource.mime)) {
          rememberBrowserFallback(url.href);
          return { ok: false, error: 'This file requires the website’s original browser request.' };
        }
      } catch (error) {
        if (error instanceof HttpError && [401, 403].includes(error.status)) {
          rememberBrowserFallback(url.href);
          return { ok: false, error: safeError(error) };
        }
      }
      const entry = await enqueue(
        url.href,
        typeof message.filename === 'string' && message.filename
          ? sanitizeFilename(message.filename)
          : undefined,
        true,
      );
      if (!entry.created) {
        await holdDuplicate(entry.job, url.href);
        return { ok: true, id: entry.job.id, warning: null };
      }
      const warning = await routeCaptured([entry.job], 1).then(
        () => null,
        (error) => safeError(error),
      );
      return { ok: true, id: entry.job.id, warning };
    })().then(respond, (e) => respond({ ok: false, error: safeError(e) }));
    return true;
  }
  if (message.type === 'offer-settings' && sender.tab) {
    void repository.getSettings().then((s) =>
      respond({
        enabled: s.interception,
        excludedHosts: s.excludedHosts,
        extensions: s.fileExtensions,
      }),
    );
    return true;
  }
  if (!trustedSender(sender)) return;
  if (
    message.type === 'queue-choice' &&
    Array.isArray(message.ids) &&
    typeof message.queueId === 'string' &&
    ['now', 'paused', 'cancel'].includes(message.mode)
  ) {
    void (async () => {
      const strings = (value: unknown) =>
        Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
      const ids = strings(message.ids);
      // Files the user unticked are dropped, not started.
      const discard = strings(message.discardIds).filter((id) => !ids.includes(id));
      await mutateChoice(async (choice) => {
        choice.items = choice.items.filter(
          (item) => !ids.includes(item.id) && !discard.includes(item.id),
        );
      });
      for (const id of discard)
        if ((await repository.getJob(id))?.capturePending) await repository.deleteJob(id);
      if (message.mode === 'cancel') {
        for (const id of ids)
          if ((await repository.getJob(id))?.capturePending) await repository.deleteJob(id);
        return { ok: true };
      }
      await releaseJobs(
        ids,
        message.queueId,
        message.mode,
        typeof message.saveSubfolder === 'string' ? message.saveSubfolder : undefined,
        readReleaseOptions(message.options),
      );
      return { ok: true };
    })().then(respond, (error) => respond({ error: safeError(error) }));
    return true;
  }
  if (message.type === 'capture-confirm' && typeof message.id === 'string' && message.input) {
    void (async () => {
      const held = await repository.getJob(message.id);
      if (!held?.capturePending) throw new Error('This download is no longer waiting.');
      const settings = await repository.getSettings();
      const next = createJob(message.input as NewDownload, settings);
      await repository.putJob(next);
      await repository.deleteJob(held.id);
      await mutateChoice(async (choice) => {
        choice.items = choice.items.filter((item) => item.id !== held.id);
      });
      await wakeManager();
      return { ok: true };
    })().then(respond, (error) => respond({ error: safeError(error) }));
    return true;
  }
  if (
    message.type === 'native-command' &&
    typeof message.id === 'string' &&
    typeof message.action === 'string'
  ) {
    void mutateNative(() => nativeCommand(message.id, message.action)).then(
      (result) => respond({ ok: true, ...result }),
      (error) => respond({ error: safeError(error) }),
    );
    return true;
  }
  if (message.type === 'register-native' && Number.isSafeInteger(message.id) && message.id >= 0) {
    void mutateNative(async () => {
      const item = (await chrome.downloads.search({ id: message.id }))[0];
      if (!item || item.byExtensionId !== chrome.runtime.id)
        throw new Error('This request was not started by Flux.');
      if (typeof message.replaces === 'string') {
        const previous = await repository.getJob(message.replaces);
        if (
          !previous ||
          previous.engine === 'browser' ||
          !['PAUSED', 'FAILED', 'WAITING_FOR_NETWORK'].includes(previous.state) ||
          validateUrl(item.url).href !== previous.url
        )
          throw new Error('The stopped Flux transfer does not match this browser request.');
        const job = {
          ...createBrowserJob(item),
          id: previous.id,
          expectedHash: previous.expectedHash,
          note: previous.expectedHash
            ? 'Browser transfer started. The expected SHA-256 will not be verified by Chrome download control.'
            : 'Original browser transfer linked to this download.',
          createdAt: previous.createdAt,
          timeline: [
            ...previous.timeline.slice(-98),
            { at: Date.now(), event: 'Continued with the original browser download subsystem' },
          ],
        };
        await repository.putJob(job);
        (await browserIndex()).set(item.id, job.id);
        await notifyNative(job);
        return { job };
      }
      return { job: await syncNative(item.id, true) };
    }).then(respond, (error) => respond({ error: safeError(error) }));
    return true;
  }
  if (message.type === 'prepare-request' && typeof message.url === 'string') {
    // The explicit request wakes a dormant MV3 worker before fetch can emit headers.
    // Acknowledgement means the synchronous webRequest listeners above are installed.
    void (async () => {
      const url = validateUrl(message.url);
      if (!(await chrome.permissions.contains({ origins: [`${url.origin}/*`] })))
        throw new HostPermissionError(url.origin);
      // The listeners must be installed before the worker's fetch can emit its redirect headers.
      await webRequestReady;
      ledger.prepare(url.href);
      return { url: url.href };
    })().then(respond, (error) =>
      respond({
        error: safeError(error),
        ...(error instanceof HostPermissionError ? { permissionOrigin: error.origin } : {}),
      }),
    );
    return true;
  }
  if (message.type === 'enable-capture') {
    void (async () => {
      if (!(await chrome.permissions.contains({ origins: captureOrigins })))
        throw new Error('Approve website access to enable automatic capture.');
      const settings = await repository.getSettings();
      await repository.putSettings({ ...settings, interception: true });
      await configureOffers();
      await chrome.runtime.sendMessage({ type: 'integration-settings' }).catch(() => undefined);
      return { ok: true };
    })().then(respond, (error) => respond({ error: safeError(error) }));
    return true;
  }
  if (message.type === 'integration-status') {
    void (async () => {
      if (message.reconnect === true) await configureOffers();
      const [settings, access, scripts] = await Promise.all([
        repository.getSettings(),
        chrome.permissions.contains({ origins: captureOrigins }),
        chrome.scripting.getRegisteredContentScripts({ ids: ['flux-offers'] }),
      ]);
      const script = scripts[0];
      return {
        version: chrome.runtime.getManifest().version,
        enabled: settings.interception,
        websiteAccess: access,
        registered:
          !!script && script.js?.includes('content.js') === true && script.allFrames === true,
      };
    })().then(respond, (error) => respond({ error: safeError(error) }));
    return true;
  }
  if (message.type === 'resolve-redirect' && typeof message.url === 'string') {
    void resolveRedirect(
      message.url,
      typeof message.location === 'string' ? message.location : null,
    ).then(
      (url) => respond({ url }),
      (error) =>
        respond({
          error: safeError(error),
          ...(error instanceof HostPermissionError ? { permissionOrigin: error.origin } : {}),
        }),
    );
    return true;
  }
  if (message.type === 'open-manager') {
    void openManager(
      typeof message.hash === 'string' && message.hash.startsWith('#')
        ? message.hash
        : message.add
          ? '#add'
          : '',
    ).then(
      () => respond({ ok: true }),
      (e) => respond({ error: safeError(e) }),
    );
    return true;
  }
  if (message.type === 'snapshot') {
    void (async () => {
      try {
        // An engine page that is still starting may never answer; do not wait for it.
        const snapshot = await Promise.race([
          chrome.runtime.sendMessage({ type: 'manager-snapshot' }),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1500)),
        ]);
        if (snapshot?.ready) return snapshot;
      } catch {
        /* No manager document is open. Durable metadata is authoritative. */
      }
      return {
        jobs: await (async () => {
          const jobs = await repository.getJobs();
          const results = await Promise.allSettled(
            jobs
              .filter(
                (job) =>
                  job.engine === 'browser' &&
                  job.browser &&
                  ['DOWNLOADING', 'PAUSED'].includes(job.state),
              )
              .slice(0, 32)
              .map(async (job) => {
                const item = (await chrome.downloads.search({ id: job.browser!.id }))[0];
                if (!item || item.startTime !== job.browser!.startedAt) return null;
                const next = updateBrowserJob(job, item);
                const now = Date.now();
                const sample = nativeSamples.get(item.id);
                next.speed =
                  next.state === 'DOWNLOADING' && sample
                    ? Math.max(
                        0,
                        ((next.downloaded - sample.bytes) * 1000) / Math.max(1, now - sample.at),
                      )
                    : 0;
                if (next.state === 'DOWNLOADING')
                  nativeSamples.set(item.id, { at: now, bytes: next.downloaded });
                else nativeSamples.delete(item.id);
                while (nativeSamples.size > 128)
                  nativeSamples.delete(nativeSamples.keys().next().value!);
                return next;
              }),
          );
          const updates = new Map(
            results.flatMap((result) =>
              result.status === 'fulfilled' && result.value
                ? [[result.value.id, result.value] as const]
                : [],
            ),
          );
          return jobs.map((j) =>
            j.engine === 'browser'
              ? (updates.get(j.id) ?? j)
              : {
                  ...j,
                  state:
                    runningStates.has(j.state) && !['ASSEMBLING', 'EXPORTING'].includes(j.state)
                      ? 'PAUSED'
                      : j.state,
                  speed: 0,
                  connections: 0,
                },
          );
        })(),
        settings: await repository.getSettings(),
        ready: true,
        error: null,
      };
    })().then(respond, (e) =>
      respond({ jobs: [], settings: defaultSettings, ready: true, error: safeError(e) }),
    );
    return true;
  }
  if (
    message.type === 'command' &&
    typeof message.id === 'string' &&
    ['pause', 'resume', 'retry'].includes(message.action)
  ) {
    void (async () => {
      const job = await repository.getJob(message.id);
      if (job?.engine === 'browser')
        return {
          ok: true,
          ...(await mutateNative(() => nativeCommand(message.id, message.action))),
        };
      return await commandEngine({
        type: 'manager-command',
        id: message.id,
        action: message.action,
      });
    })().then(
      (result) =>
        respond(result ?? { ok: false, error: 'Flux could not reach its download engine.' }),
      (error) => respond({ error: safeError(error) }),
    );
    return true;
  }
  if (message.type === 'configure-offers') {
    void configureOffers().then(
      () => respond({ ok: true }),
      (e) => respond({ error: safeError(e) }),
    );
    return true;
  }
});
