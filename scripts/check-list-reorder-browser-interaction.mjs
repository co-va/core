import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium, webkit, devices } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
const chromeBin = String(process.env.CHROME_BIN || '').trim();
const browserCases = chromeBin
  ? [
      ['desktop-chromium', chromium, { viewport: { width: 1280, height: 900 } }],
      ['mobile-chromium', chromium, devices['iPhone 13 Pro Max']],
    ]
  : [
      ['desktop-chromium', chromium, { viewport: { width: 1280, height: 900 } }],
      ['mobile-chromium', chromium, devices['iPhone 13 Pro Max']],
      ['mobile-webkit', webkit, devices['iPhone 13 Pro Max']],
    ];

for (const [name, engine, contextOptions] of browserCases) {
  const browser = await engine.launch({
    headless:true,
    ...(chromeBin ? { executablePath: chromeBin } : {}),
  });
  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/tests/list-reorder-browser.html`);
    await page.locator('html[data-list-reorder-ready="true"]').waitFor();

    const first = page.locator('[data-procedure="one"]');
    if (contextOptions.hasTouch) await first.tap();
    else await first.click();
    assert.equal(await page.locator('[data-opened]').textContent(), 'one', `${name}: short tap/click did not open entry`);

    await page.locator('[data-opened]').evaluate((node) => { node.textContent = ''; });

    const handle = first.locator('[data-reorder-handle]');
    const handleBox = await handle.boundingBox();
    const box3 = await page.locator('[data-procedure="three"]').boundingBox();
    assert.ok(handleBox && box3, `${name}: missing list geometry`);
    const x = handleBox.x + handleBox.width / 2;
    const y1 = handleBox.y + handleBox.height / 2;
    const y3 = box3.y + box3.height / 2;

    if (contextOptions.hasTouch) {
      await page.evaluate(async ({x,y1,y3}) => {
        const target = document.elementFromPoint(x, y1)?.closest?.('[data-reorder-handle]');
        if (!target) throw new Error('missing reorder handle');
        const pid = 41;
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerId:pid, pointerType:'touch', clientX:x, clientY:y1, isPrimary:true }));
        target.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, cancelable:true, pointerId:pid, pointerType:'touch', clientX:x, clientY:y3, isPrimary:true }));
        target.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:pid, pointerType:'touch', clientX:x, clientY:y3, isPrimary:true }));
        target.click();
      }, {x,y1,y3});
    } else {
      await page.mouse.move(x,y1);
      await page.mouse.down();
      await page.mouse.move(x,y3,{steps:8});
      await page.mouse.up();
    }

    await page.waitForTimeout(50);
    assert.notEqual(await page.locator('[data-order]').textContent(), '', `${name}: grip drag did not reorder`);
    assert.equal(await page.locator('[data-opened]').textContent(), '', `${name}: grip drag leaked a row click`);
    if (contextOptions.hasTouch) await page.locator('[data-procedure="two"]').tap();
    else await page.locator('[data-procedure="two"]').click();
    assert.equal(await page.locator('[data-opened]').textContent(), 'two', `${name}: row tap stopped working after reorder`);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    console.log(`${name}: PASS (row tap opens, grip drag reorders without click conflict)`);
  } finally {
    await browser.close();
  }
}
