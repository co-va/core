import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, source) => fs.writeFileSync(path, source);

function replaceOnce(path, source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: ${label}: expected 1 match, found ${count}`);
  return source.replace(from, to);
}

// End-user runtime: V is independent from Header; A is a non-interactive photo control.
{
  const path = 'tests/account-shell-runtime-browser.html';
  let source = read(path);
  source = replaceOnce(path, source,
`ok(Boolean(root.querySelector('[data-v2-header] .v2-header__v')), 'Contact V must expose additional actions when settings/documents are available');
ok(Boolean(root.querySelector('[data-v2-header] .v2-header__slot--a .v2-header__control:disabled')), 'Contact A must remain visual-only and non-interactive');`,
`ok(Boolean(root.querySelector('[data-v2-v-host] [data-v2-v]')), 'Contact V must expose additional actions through the independent Shared V host');
const contactA = root.querySelector('[data-v2-header] .v2-header__slot--a .v2-header__control');
ok(Boolean(contactA) && contactA.tagName !== 'BUTTON', 'Contact A must remain photo-only and non-interactive');`,
  'end-user A/V regression');
  write(path, source);
}

// Professional runtime: every old data-v2-workspace-a settings click becomes Shared V.
{
  const path = 'tests/professional-core-runtime-browser.html';
  let source = read(path);
  const selector = '[data-v2-workspace-a]';
  const selectorCount = source.split(selector).length - 1;
  if (selectorCount < 10) throw new Error(`${path}: expected legacy A/settings selectors, found only ${selectorCount}`);

  source = replaceOnce(path, source,
`ok(Boolean(cashOperationA?.querySelector('.v2-header__settings-tag')), 'Cash operation Z3 A must show settings gear');`,
`ok(!shell()?.querySelector('[data-v2-header] .v2-header__settings-tag'), 'Cash operation Z3 A must remain photo-only without a settings gear');`,
  'cash operation A settings badge regression');

  source = replaceOnce(path, source,
`ok(Boolean(cashChatD) && !cashChatD.disabled,
  'Cash View Q must keep global Chat D visible and clickable');`,
`ok(Boolean(cashChatD) && shell()?.querySelector('[data-v2-header]')?.inert === true,
  'Cash View Q must keep global Chat D visible under the veil but non-interactive');`,
  'Q D tap-through regression');

  source = source.replaceAll(selector, '[data-v2-v]');
  if (source.includes(selector)) throw new Error(`${path}: legacy workspace A settings selector remains`);
  write(path, source);
}

// Modal fixture: A is visual-only avatar metadata; it has no action handler.
{
  const path = 'tests/modal-hit-targets-browser.html';
  let source = read(path);
  source = replaceOnce(path, source,
`let headerACount = 0;
let headerCCount = 0;`,
`let headerCCount = 0;`,
  'remove A action counter');
  source = replaceOnce(path, source,
`  a: { kind: 'settings', aria: 'A', data: 'data-test-header-a' },`,
`  a: { kind: 'avatar', label: 'A', initials: 'A' },`,
  'photo-only A fixture');
  source = replaceOnce(path, source,
`host.querySelector('[data-test-header-a]').addEventListener('click', () => {
  headerACount += 1;
  host.querySelector('[data-test-header-a-count]').textContent = String(headerACount);
});
`,
``,
  'remove A click handler');
  write(path, source);
}

// Browser modal test: any Header zone tapped through a Q veil only dismisses Q; C/D never fire.
{
  const path = 'scripts/check-modal-browser-interaction.mjs';
  let source = read(path);
  source = replaceOnce(path, source,
`    // X veil: tapping Header A while X is active must only dismiss the X.
    await tapOrClick(page.locator('[data-test-settings]'));
    await page.locator('[data-modal]').waitFor();
    await activateSelector('[data-test-header-a]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-a-count]').textContent(), '0', \`${'${name}'}: Header A fired through X veil\`);`,
`    // X veil: tapping the visual-only Header A zone must only dismiss the X.
    await tapOrClick(page.locator('[data-test-settings]'));
    await page.locator('[data-modal]').waitFor();
    await activateSelector('.v2-header__slot--a .v2-header__control');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });`,
  'X veil A regression');

  source = replaceOnce(path, source,
`    // Q keeps contextual Header C active. This isolated fixture does not load the Messenger owner,
    // so raw Header D remains locally addressable and must not destroy Q.
    await tapOrClick(page.locator('[data-test-open-q]'));
    await page.locator('[data-test-q-content]').waitFor();
    assert.equal(await page.locator('[data-modal]').count(), 1, \`${'${name}'}: Q missing or duplicated\`);
    await activateSelector('[data-test-header-c]');
    assert.equal(await page.locator('[data-test-header-c-count]').textContent(), '1', \`${'${name}'}: Q-owned Header C did not fire\`);
    assert.equal(await page.locator('[data-modal]').count(), 1, \`${'${name}'}: Q-owned Header C dismissed Q\`);
    await activateSelector('[data-test-header-d]');
    assert.equal(await page.locator('[data-test-header-d-count]').textContent(), '1', \`${'${name}'}: raw fixture Header D did not fire\`);
    assert.equal(await page.locator('[data-modal]').count(), 1, \`${'${name}'}: raw fixture Header D destroyed Q\`);
    assert.equal(await page.locator('[data-test-q-content]').count(), 1, \`${'${name}'}: Q was lost after raw fixture Header D\`);
    await activateSelector('[data-test-header-a]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-a-count]').textContent(), '0', \`${'${name}'}: Header A fired through Q veil\`);`,
`    // Q owns its own Header. APP Header A/C/D remain visible under the veil but are fully inert.
    const openQ = async () => {
      await tapOrClick(page.locator('[data-test-open-q]'));
      await page.locator('[data-test-q-content]').waitFor();
      assert.equal(await page.locator('[data-modal]').count(), 1, \`${'${name}'}: Q missing or duplicated\`);
      assert.equal((await page.locator('[data-v2-q-header]').textContent()).trim(), 'Q', \`${'${name}'}: Q title is not owned by Q Header\`);
    };

    await openQ();
    await activateSelector('[data-test-header-c]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-c-count]').textContent(), '0', \`${'${name}'}: Header C fired through Q veil\`);

    await openQ();
    await activateSelector('[data-test-header-d]');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-test-header-d-count]').textContent(), '0', \`${'${name}'}: Header D fired through Q veil\`);

    await openQ();
    await activateSelector('.v2-header__slot--a .v2-header__control');
    await page.locator('[data-modal]').waitFor({ state: 'detached' });`,
  'Q Header tap-through regression');

  source = source.replace('veil ownership, Q C/D, 10 sheet variants', 'veil ownership, inert APP Header under Q, 10 sheet variants');
  write(path, source);
}

// End-user static regression: A is photo-only and settings live in independent Shared V.
{
  const path = 'tests/booking-account-ui.test.mjs';
  let source = read(path);
  source = replaceOnce(path, source,
`assert.match(v2Ui, /role === 'a' && slot\\.settingsTag/);
assert.doesNotMatch(v2Ui, /kind === 'avatar' && slot\\.settingsTag/);
assert.match(v2Css, /\\.v2-header__settings-tag\\{position:absolute;right:-2px;bottom:-2px/);`,
`assert.match(v2Ui, /function avatarControl/);
assert.match(v2Ui, /export \\{ v2V \\} from '\\.\\/v\\.js'/);
assert.match(v2Ui, /bindV2VContext/);
assert.doesNotMatch(v2Ui, /settingsTag/);
assert.doesNotMatch(v2Css, /\\.v2-header__settings-tag/);`,
  'booking account A/V static contract');
  write(path, source);
}

console.log('Shared UI browser regressions aligned.');
