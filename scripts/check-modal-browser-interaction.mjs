import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// CI installs the pinned browser runner outside the application's dependencies.
const { chromium, webkit, devices } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.BROWSER_TEST_URL || 'http://127.0.0.1:4173';
const results = [];

for (const [name, engine, contextOptions] of [
  ['desktop-chromium', chromium, { viewport: { width: 1280, height: 900 } }],
  ['mobile-chromium', chromium, devices['iPhone 13 Pro Max']],
  ['mobile-webkit', webkit, devices['iPhone 13 Pro Max']],
]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const open = async (suffix = '') => {
      await page.goto(`${base}/tests/modal-hit-targets-browser.html${suffix}`);
      await page.locator('html[data-modal-test-ready="true"]').waitFor();
      await page.locator('[data-v2-app]').waitFor();
      await page.waitForTimeout(300);
    };
    const targetPoints = async (selector) => page.locator(selector).evaluate((node) => {
      const r = node.getBoundingClientRect();
      return [3, r.height / 2, r.height - 3].map((dy) => {
        const x = r.left + r.width / 2;
        const y = r.top + dy;
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: Boolean(hit && (hit === node || node.contains(hit))) };
      });
    });
    const activate = async (point) => {
      if (contextOptions.hasTouch) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
    };
    const activateSelector = async (selector) => {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box, `${name}: missing ${selector}`);
      await activate({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    };
    const closeTopSheet = async () => {
      const before = await page.locator('[data-modal]').count();
      assert.ok(before > 0, `${name}: no modal to close`);
      const top = page.locator('[data-modal]').last();
      const zone = await top.locator('[data-v2-layer-gesture-zone]').boundingBox();
      assert.ok(zone, `${name}: missing swipe strip`);
      const x = zone.x + zone.width / 2;
      const y = zone.y + zone.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 100, { steps: 10 });
      await page.mouse.up();
      await page.waitForFunction((expected) => document.querySelectorAll('[data-modal]').length === expected, before - 1);
    };
    const tapOrClick = async (locator) => {
      if (contextOptions.hasTouch) await locator.tap();
      else await locator.click();
    };
    const chooseTime1015 = async () => {
      const hour10 = page.locator('[data-time-wheel-type="hours"][data-value="10"][data-cycle="2"]');
      const minute15 = page.locator('[data-time-wheel-type="minutes"][data-value="15"][data-cycle="2"]');
      await tapOrClick(hour10);
      await tapOrClick(minute15);
      await page.waitForTimeout(250);
      await tapOrClick(page.locator('[data-time-save]'));
    };

    await open();

    // Shared Z contract: the surface and its Header never vertically scroll;
    // only Z Body owns native vertical scrolling.
    const z = page.locator('[data-v2-z]').first();
    const zHeader = z.locator(':scope > [data-v2-z-header]');
    const zBody = z.locator(':scope > [data-v2-z-body]');
    const headerBefore = await zHeader.boundingBox();
    assert.ok(headerBefore, `${name}: missing Shared Z Header`);
    const bodyCanScroll = await zBody.evaluate((node) => node.scrollHeight > node.clientHeight);
    assert.equal(bodyCanScroll, true, `${name}: Z Body is not the scrollable viewport`);
    await zBody.evaluate((node) => { node.scrollTop = 240; });
    await page.waitForTimeout(80);
    const headerAfter = await zHeader.boundingBox();
    assert.ok(headerAfter, `${name}: Shared Z Header disappeared after body scroll`);
    assert.equal(Math.round(headerAfter.y), Math.round(headerBefore.y), `${name}: Shared Z Header moved during Z Body scroll`);
    assert.equal(await z.evaluate((node) => node.scrollTop), 0, `${name}: outer Z surface scrolled vertically`);
    assert.ok(await zBody.evaluate((node) => node.scrollTop > 0), `${name}: Z Body did not retain vertical scroll`);
    await zBody.evaluate((node) => { node.scrollTop = 0; });

    await tapOrClick(page.locator('[data-test-settings]'));
    await page.waitForTimeout(300);
    const menuSelector = '[data-shared-profile-action="workplaces"]';

    await page.locator('.modal-sheet').evaluate((node) => { node.style.paddingTop = '20px'; });
    assert.equal((await targetPoints(menuSelector))[0].hit, false, `${name}: negative control did not reproduce overlap`);
    await page.locator('.modal-sheet').evaluate((node) => { node.style.removeProperty('padding-top'); });
    const points = await targetPoints(menuSelector);
    assert.ok(points.every((point) => point.hit), `${name}: settings action obscured`);
    await activate(points[0]);
    await page.locator('[data-service-workplace="test-space"]').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-modal]').count(), 1, `${name}: settings handoff left an extra modal`);
    const checkbox = '[data-service-workplace="test-space"]';
    const checkboxPoints = await targetPoints(checkbox);
    if (!checkboxPoints.every((point) => point.hit)) {
      const diagnostic = await page.locator(checkbox).evaluate((node) => {
        const rect = (value) => value ? ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }) : null;
        const r = node.getBoundingClientRect();
        const label = node.closest('label');
        const sheet = node.closest('.v2-layer');
        const zone = sheet?.querySelector('[data-v2-layer-gesture-zone]');
        const samples = [3, r.height / 2, r.height - 3].map((dy) => {
          const x = r.left + r.width / 2;
          const y = r.top + dy;
          const hit = document.elementFromPoint(x, y);
          return {
            x, y,
            tag: hit?.tagName || '',
            className: typeof hit?.className === 'string' ? hit.className : '',
            data: hit ? [...hit.attributes].filter((attr) => attr.name.startsWith('data-')).map((attr) => `${attr.name}=${attr.value}`) : [],
          };
        });
        return {
          checkbox: rect(r),
          label: rect(label?.getBoundingClientRect()),
          sheet: rect(sheet?.getBoundingClientRect()),
          zone: rect(zone?.getBoundingClientRect()),
          paddingTop: sheet ? getComputedStyle(sheet).paddingTop : '',
          samples,
        };
      });
      console.error(`${name}: workplace checkbox diagnostic ${JSON.stringify(diagnostic)}`);
    }
    assert.ok(checkboxPoints.every((point) => point.hit), `${name}: workplace checkbox obscured`);
    await activate(checkboxPoints[1]);
    assert.equal(await page.locator('[data-test-selection]').textContent(), '1', `${name}: selection did not update`);
    await closeTopSheet();
    assert.equal(await page.locator('.v2-app__stage').evaluate((node) => node.inert), false, `${name}: stage remained locked`);

    await tapOrClick(page.locator('[data-test-settings]'));
    await page.waitForTimeout(300);
    await activate((await targetPoints(menuSelector))[1]);
    await page.waitForTimeout(300);
    assert.equal(await page.locator(checkbox).isChecked(), true, `${name}: selection was lost on reopening`);
    await closeTopSheet();

    // Shared time-range editor: editor X survives picker X and saves only by its Save button.
    await tapOrClick(page.locator('[data-test-time-range]'));
    await page.locator('[data-shared-time-range-form]').waitFor();
    assert.equal(await page.locator('[data-modal]').count(), 1, `${name}: time-range parent X missing`);
    assert.equal(await page.locator('[data-modal]').last().getAttribute('data-v2-x-role'), 'editor', `${name}: time-range X role is not editor`);
    await tapOrClick(page.locator('[data-time-picker="from"] [data-time-open]'));
    await page.locator('.modal--time-picker-sheet').waitFor();
    assert.equal(await page.locator('[data-modal]').count(), 2, `${name}: TimePicker replaced parent X instead of stacking`);
    assert.equal(await page.locator('[data-modal]').last().getAttribute('data-v2-x-role'), 'picker', `${name}: TimePicker X role is not picker`);
    assert.equal(await page.locator('[data-shared-time-range-form]').count(), 1, `${name}: time-range parent X was destroyed`);
    await chooseTime1015();
    await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 1);
    assert.equal(await page.locator('[data-shared-time-range-form]').count(), 1, `${name}: parent X did not survive TimePicker save`);
    assert.equal(await page.locator('[data-time-picker="from"] [data-time-value]').inputValue(), '10:15', `${name}: corrected time was not returned to parent X`);
    await tapOrClick(page.locator('[data-shared-time-range-form] button[type="submit"]'));
    await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 0);
    assert.equal(await page.locator('[data-test-time-result]').textContent(), '10:15-18:00', `${name}: corrected time range did not save`);

    // Real Journal path: action X hands off to editor X; picker stacks over editor;
    // closing editor discards draft; only editor Save commits the time change.
    const openJournalEditorThroughAction = async () => {
      await tapOrClick(page.locator('[data-test-journal-time]'));
      await page.locator('[data-test-open-journal-time-editor]').waitFor();
      assert.equal(await page.locator('[data-modal]').count(), 1, `${name}: Journal action X missing`);
      assert.equal(await page.locator('[data-modal]').last().getAttribute('data-v2-x-role'), 'action', `${name}: Journal first X role is not action`);
      await tapOrClick(page.locator('[data-test-open-journal-time-editor]'));
      await page.locator('[data-day-workplace-time-save]').waitFor();
      assert.equal(await page.locator('[data-modal]').count(), 1, `${name}: action X did not hand off to Journal editor X`);
      assert.equal(await page.locator('[data-modal]').last().getAttribute('data-v2-x-role'), 'editor', `${name}: Journal working-time X role is not editor`);
    };

    await openJournalEditorThroughAction();
    await tapOrClick(page.locator('[data-time-picker="dayWorkplaceFrom"] [data-time-open]'));
    await page.locator('.modal--time-picker-sheet').waitFor();
    assert.equal(await page.locator('[data-modal]').count(), 2, `${name}: Journal TimePicker replaced editor X`);
    assert.equal(await page.locator('[data-modal]').last().getAttribute('data-v2-x-role'), 'picker', `${name}: Journal TimePicker role is not picker`);
    await chooseTime1015();
    await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 1);
    assert.equal(await page.locator('[name="dayWorkplaceFrom"]').inputValue(), '10:15', `${name}: Journal picker value did not return to editor`);
    assert.equal(await page.locator('[data-test-journal-time-result]').textContent(), '09:00-18:00', `${name}: Journal draft was saved before editor Save`);
    await closeTopSheet();
    assert.equal(await page.locator('[data-test-journal-time-result]').textContent(), '09:00-18:00', `${name}: closing Journal editor committed an unsaved draft`);

    await openJournalEditorThroughAction();
    assert.equal(await page.locator('[name="dayWorkplaceFrom"]').inputValue(), '09:00', `${name}: discarded Journal draft leaked into reopened editor`);
    await tapOrClick(page.locator('[data-time-picker="dayWorkplaceFrom"] [data-time-open]'));
    await page.locator('.modal--time-picker-sheet').waitFor();
    await chooseTime1015();
    await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 1);
    await tapOrClick(page.locator('[data-day-workplace-time-save]'));
    await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 0);
    assert.equal(await page.locator('[data-test-journal-time-result]').textContent(), '10:15-18:00', `${name}: Journal Save did not commit corrected time`);

    // X veil: tapping Header A while X is active must only dismiss the X.
    await tapOrClick(page.locator('[data-test-settings]'));
    await page.locator('[data-modal]').waitFor();
    await activateSelector('[data-test-header-a]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-a-count]').textContent(), '0', `${name}: Header A fired through X veil`);

    // The same veil rule must protect interactive Z content. The tap that dismisses
    // the modal is consumed by the veil; a second, separate tap may activate Z.
    await tapOrClick(page.locator('[data-test-settings]'));
    await page.locator('[data-modal]').waitFor();
    await activateSelector('[data-test-under-veil]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-under-veil-count]').textContent(), '0', `${name}: Z action fired through modal veil`);
    await activateSelector('[data-test-under-veil]');
    assert.equal(await page.locator('[data-test-under-veil-count]').textContent(), '1', `${name}: Z action did not fire on the next clean tap after veil dismissal`);

    // Q overlays Y and leaves the visible application Header fully inert. A tap on
    // any Header slot belongs to the Q veil: it may dismiss Q, but it must never
    // activate the underlying Header control in the same pointer sequence.
    const openQ = async () => {
      await tapOrClick(page.locator('[data-test-open-q]'));
      await page.locator('[data-test-q-content]').waitFor();
      assert.equal(await page.locator('[data-modal]').count(), 1, `${name}: Q missing or duplicated`);
      assert.equal(await page.locator('[data-v2-header]').evaluate((node) => node.inert), true, `${name}: Header is not inert while Q is open`);
    };

    await openQ();
    await activateSelector('[data-test-header-c]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-c-count]').textContent(), '0', `${name}: Header C fired through Q veil`);

    await openQ();
    await activateSelector('[data-test-header-d]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-d-count]').textContent(), '0', `${name}: Header D fired through Q veil`);

    await openQ();
    await activateSelector('[data-test-header-a]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-a-count]').textContent(), '0', `${name}: Header A fired through Q veil`);

    // Shared Q owns its own frame and may stack another Q over itself. Closing the
    // top Q must reveal the lower Q while Header and Z remain locked; closing the
    // final Q returns ownership to Z and releases both locks.
    await openQ();
    await tapOrClick(page.locator('[data-test-open-q-child]'));
    await page.locator('[data-test-q-child-content]').waitFor();
    assert.equal(await page.locator('[data-modal]').count(), 2, `${name}: Q -> Q did not produce two Shared Q layers`);
    assert.equal(await page.locator('[data-v2-header]').evaluate((node) => node.inert), true, `${name}: Header unlocked while nested Q is open`);
    assert.equal(await page.locator('.v2-app__stage').evaluate((node) => node.inert), true, `${name}: Z/stage unlocked while nested Q is open`);
    assert.equal(await z.evaluate((node) => node.classList.contains('has-v2-layer')), true, `${name}: base Z lost modal lock while nested Q is open`);

    await tapOrClick(page.locator('[data-modal]').last().locator('[data-v2-z-dismiss]'));
    await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 1);
    assert.equal(await page.locator('[data-test-q-content]').count(), 1, `${name}: closing top Q did not return to lower Q`);
    assert.equal(await page.locator('[data-v2-header]').evaluate((node) => node.inert), true, `${name}: Header unlocked after closing only the top Q`);
    assert.equal(await page.locator('.v2-app__stage').evaluate((node) => node.inert), true, `${name}: Z/stage unlocked after closing only the top Q`);
    assert.equal(await z.evaluate((node) => node.classList.contains('has-v2-layer')), true, `${name}: base Z lock released before the last Q closed`);

    await tapOrClick(page.locator('[data-modal]').last().locator('[data-v2-z-dismiss]'));
    await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 0);
    assert.equal(await page.locator('[data-v2-header]').evaluate((node) => node.inert), false, `${name}: Header remained locked after final Q closed`);
    assert.equal(await page.locator('.v2-app__stage').evaluate((node) => node.inert), false, `${name}: Z/stage remained locked after final Q closed`);
    assert.equal(await z.evaluate((node) => node.classList.contains('has-v2-layer')), false, `${name}: base Z modal lock remained after final Q closed`);

    // Journal selector is a picker X over its editor X, then the selected workplace commits the owning control.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const journalTrigger = page.locator('[data-test-journal-workplace]');
      await tapOrClick(journalTrigger);

      const journalSelect = page.locator('[data-journal-workplace-select]').locator('..').locator('[data-ui-select-trigger]');
      await journalSelect.waitFor();
      assert.equal(await page.locator('[data-modal]').count(), 1, `${name}: Journal parent X missing or duplicated`);

      await tapOrClick(journalSelect);
      await page.locator('[data-ui-selector]').waitFor();
      assert.equal(await page.locator('[data-modal]').count(), 2, `${name}: Journal selector did not stack while parent input remained active`);
      assert.equal(await page.locator('[data-modal]').last().getAttribute('data-v2-x-role'), 'picker', `${name}: selector X role is not picker`);

      const targetValue = cycle % 2 === 0 ? 'beauty' : '__all__';
      await tapOrClick(page.locator(`[data-ui-select-option][data-value="${targetValue}"]`));

      await page.waitForFunction(() => document.querySelectorAll('[data-modal]').length === 0);
      assert.equal(await page.locator('.v2-app__stage').evaluate((node) => node.inert), false, `${name}: Journal stage stayed inert after workplace switch`);
      assert.equal(await page.locator('[data-test-journal-workplace]').isEnabled(), true, `${name}: Journal stopped responding after workplace switch`);
    }

    for (const variant of ['', 'profile-settings', 'photo', 'password', 'consent', 'color', 'time-range', 'form', 'time-picker', 's']) {
      await open(`?variant=${variant}`);
      const hits = await targetPoints('[data-test-target]');
      assert.ok(hits.every((point) => point.hit), `${name}/${variant || 'x'}: content covered by gesture strip`);
      const reserved = await page.locator('.v2-layer').evaluate((sheet) => {
        const css = getComputedStyle(sheet);
        const zone = sheet.querySelector('[data-v2-layer-gesture-zone]').getBoundingClientRect();
        const top = sheet.classList.contains('v2-layer--top');
        return parseFloat(top ? css.paddingBottom : css.paddingTop) >= zone.height;
      });
      assert.ok(reserved, `${name}/${variant || 'x'}: swipe strip has no reserved space`);
    }
    assert.deepEqual(errors, [], `${name}: browser errors`);
    results.push({ name, result: 'PASS' });
    console.log(`${name}: PASS (stable Z Header/Body, X action→editor→picker, Q→Q stack, Journal time discard/save, selectors, veil ownership, inert Q Header, 10 sheet variants)`);
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(results));