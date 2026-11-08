import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The extension must come up with only its manifest permissions. Optional ones (such as
 * notifications) do not exist until the user grants them, so touching them while the background
 * file loads stops the whole service worker: nothing answers and no page opens.
 */
let context: BrowserContext;
let profile: string;
let extensionId: string;
const extensionPath = resolve('dist');
const executablePath = process.env.CHROME_PATH;

test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'flux-startup-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: executablePath ? undefined : 'chromium',
    executablePath,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      ...(executablePath
        ? []
        : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]),
      '--enable-unsafe-extension-debugging',
      '--no-proxy-server',
    ],
  });
  if (executablePath) {
    const session = await context.browser()!.newBrowserCDPSession();
    extensionId = (await session.send('Extensions.loadUnpacked', { path: extensionPath })).id;
  } else {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;
  }
});
test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('the background answers every kind of message right after install', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const ask = (message: object) =>
    page.evaluate(async (payload) => {
      const silent = new Promise<'no reply'>((done) => setTimeout(() => done('no reply'), 3000));
      return Promise.race([chrome.runtime.sendMessage(payload), silent]);
    }, message);
  for (const message of [
    { type: 'snapshot' },
    { type: 'integration-status' },
    { type: 'configure-offers' },
  ])
    expect(await ask(message), JSON.stringify(message)).not.toBe('no reply');
});

test('the popup shows its downloads instead of waiting for ever', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByText('No downloads yet')).toBeVisible({ timeout: 5000 });
});

test('the manager opens', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect(page.getByText('All downloads').first()).toBeVisible({ timeout: 5000 });
});
