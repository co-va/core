from pathlib import Path

path = Path('tests/booking-account-ui.test.mjs')
text = path.read_text()

old = "assert.match(accountShell, /async function renderGlobalHistoryDetail/);\nassert.match(accountShell, /actionBlock\\(button\\('Записаться', \\{[\\s\\S]*?data: 'data-global-history-repeat'/);"
new = "assert.doesNotMatch(accountShell, /async function renderGlobalHistoryDetail/, 'Standalone History detail renderer must stay physically absent.');\nassert.doesNotMatch(accountShell, /data-global-history-repeat/, 'Standalone History repeat action must stay physically absent; repeat booking is contact-scoped.');"
if text.count(old) != 1:
    raise SystemExit(f'expected one stale History tail block, found {text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text)
print('Retired History regression tail removed')
