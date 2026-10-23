import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('PLAYWRIGHT_MODULE is required');

const moduleDir = dirname(modulePath);
execFileSync(process.execPath, [join(moduleDir, 'cli.js'), 'install', 'chromium'], {
  stdio: 'inherit',
  timeout: 180_000,
  env: { ...process.env, PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '30000' },
});

const { chromium } = await import(pathToFileURL(modulePath).href);
const base = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
const cases = [
  ['tests/fez-runtime-browser.html', 'fezRuntime', 'fezRuntimeStage'],
  ['tests/account-shell-runtime-browser.html', 'accountRuntime', 'accountRuntimeStage'],
  ['tests/professional-core-runtime-browser.html', 'professionalRuntime', 'professionalRuntimeStage'],
  ['tests/documents-runtime-browser.html', 'documentsRuntime', 'documentsRuntimeStage'],
  ['tests/data-transfer-runtime-browser.html', 'dataTransferRuntime', 'dataTransferRuntimeStage'],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  timeout: 15_000,
});

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
  });

  for (const [path, resultKey, stageKey] of cases) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/${path}`, { waitUntil: 'commit', timeout: 15_000 });
    await page.waitForFunction(
      (key) => ['pass', 'fail'].includes(document.documentElement.dataset[key] || ''),
      resultKey,
      { timeout: 30_000 },
    );
    const state = await page.evaluate(({ resultKey, stageKey }) => ({
      result: document.documentElement.dataset[resultKey] || '',
      stage: document.documentElement.dataset[stageKey] || '',
      detail: document.querySelector('#result')?.textContent || '',
    }), { resultKey, stageKey });
    assert.deepEqual(errors, [], `${path}: browser errors: ${errors.join(' | ')}`);
    assert.equal(state.result, 'pass', `${path}: ${state.stage || state.detail || 'runtime regression failed'}`);
    console.log(`${path}: PASS`);
    await page.close();
  }
} finally {
  await browser.close();
}
