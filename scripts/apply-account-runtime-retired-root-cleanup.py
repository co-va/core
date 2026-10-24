from pathlib import Path

path = Path('tests/account-shell-runtime-browser.html')
text = path.read_text()

old = """await edgeOpen(6);
await selectRoot('history',16);
ok(shell() === initialShell, 'history navigation rebuilt the whole account shell');
ok(Boolean(root.querySelector('[data-account-history]')), 'History root stopped rendering account history');

await edgeOpen(7);
await selectRoot('journal',17);
ok(shell() === initialShell, 'History → Journal rebuilt the whole account shell');

"""
if text.count(old) != 1:
    raise SystemExit(f'history navigation block: expected 1, found {text.count(old)}')
text = text.replace(old, '', 1)

old = """mark('legacy-booking-home');
state.accountTab = 'home';
state.accountDeckActive = 'journal';
state.accountDeckOpen = false;
await renderGlobalAccount(root,state,callbacks);
await wait(120);
ok(root.querySelector('[data-v2-header] .v2-header__title')?.textContent.trim() === 'Обзор', 'Explicit legacy home no longer renders Overview; booking return changed inside PR3');
ok(!root.querySelector('[data-account-journal-root]'), 'Explicit legacy home was redirected to Journal; PR4 leaked into PR3');

// Repeat visible-root navigation to expose handler accumulation after the migration.
for (const [index,id] of ['profile','journal','contacts','journal','history','journal'].entries()) {
"""
new = """mark('retired-home-fallback');
state.accountTab = 'home';
state.accountDeckActive = 'journal';
state.accountDeckOpen = false;
await renderGlobalAccount(root,state,callbacks);
await wait(120);
ok(root.querySelector('[data-v2-header] .v2-header__title')?.textContent.trim() === 'Журнал', 'Retired home state must fall back to Journal');
ok(Boolean(root.querySelector('[data-account-journal-root]')), 'Retired home state did not fall back to Journal');
state.accountTab = 'journal';

// Repeat visible-root navigation to expose handler accumulation after the migration.
for (const [index,id] of ['profile','journal','contacts','journal','profile','journal'].entries()) {
"""
if text.count(old) != 1:
    raise SystemExit(f'legacy home/runtime loop block: expected 1, found {text.count(old)}')
text = text.replace(old, new, 1)

for marker in ["selectRoot('history'", "data-account-history", "['profile','journal','contacts','journal','history','journal']"]:
    if marker in text:
        raise SystemExit(f'retired runtime marker remains: {marker}')

path.write_text(text)
print('Account runtime retired root scenarios removed')
