from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

path = Path('tests/booking-account-ui.test.mjs')
text = path.read_text()

text = replace_once(
    text,
    "assert.match(accountShell, /v2HorizontalRail\\(/);",
    "assert.doesNotMatch(accountShell, /v2HorizontalRail\\(/, 'Retired Overview rail must stay physically absent from the end-user account shell.');",
    'retired Overview rail assertion',
)

text = replace_once(
    text,
    "assert.match(accountShell, /GLOBAL_ACCOUNT_ROOTS = Object\\.freeze\\(\\[[\\s\\S]*?id: 'profile', label: 'Профиль'[\\s\\S]*?id: 'journal', label: 'Журнал'[\\s\\S]*?id: 'contacts', label: 'Контакты'[\\s\\S]*?id: 'history', label: 'История'/);",
    "assert.match(accountShell, /GLOBAL_ACCOUNT_ROOTS = Object\\.freeze\\(\\[[\\s\\S]*?id: 'profile', label: 'Профиль'[\\s\\S]*?id: 'journal', label: 'Журнал'[\\s\\S]*?id: 'contacts', label: 'Контакты'/);\nassert.doesNotMatch(accountShell, /id: 'history', label: 'История'/, 'Standalone History root must stay physically absent.');",
    'root set assertion',
)

text = replace_once(
    text,
    "assert.match(accountShell, /async function renderGlobalHistoryDetail\\(/);",
    "assert.doesNotMatch(accountShell, /async function renderGlobalHistoryDetail\\(/, 'Standalone History detail renderer must stay physically absent.');",
    'standalone History detail assertion',
)

text = text.replace(
    "accountShell.indexOf('async function renderGlobalHistory'),",
    "accountShell.indexOf('export async function renderGlobalAccount'),",
)
if text.count("accountShell.indexOf('async function renderGlobalHistory'),") != 0:
    raise SystemExit('stale renderGlobalHistory slice boundary remains')

text = replace_once(
    text,
    "assert.doesNotMatch(accountShell, /label: 'Обзор'\\s*\\},\\s*\\{ id: 'history'/);\nassert.match(accountShell, /async function renderGlobalHome\\([\\s\\S]*?futureRequests\\(state\\.accountRecords \\|\\| \\[\\]\\)/);\nassert.match(accountShell, /async function renderGlobalContacts\\([\\s\\S]*?const relationships = Array\\.isArray\\(state\\.relationships\\)/);\nassert.match(accountShell, /async function renderGlobalHistory\\([\\s\\S]*?state\\.accountRecords/);\nconst globalHomeBlock = accountShell.slice(\n  accountShell.indexOf('async function renderGlobalHome'),\n  accountShell.indexOf('function contactsBody'),\n);\nassert.doesNotMatch(globalHomeBlock, /relationshipCard\\(/);\nassert.doesNotMatch(globalHomeBlock, /v2Section\\('Инвестиции'/);\nassert.doesNotMatch(globalHomeBlock, /v2Section\\('Предложения инвестиций'/);",
    "assert.doesNotMatch(accountShell, /id: 'home', label: 'Обзор'/, 'Standalone Overview root must stay physically absent.');\nassert.doesNotMatch(accountShell, /async function renderGlobalHome\\(/, 'Standalone Overview renderer must stay physically absent.');\nassert.match(accountShell, /async function renderGlobalContacts\\([\\s\\S]*?const relationships = Array\\.isArray\\(state\\.relationships\\)/);\nassert.doesNotMatch(accountShell, /async function renderGlobalHistory\\(/, 'Standalone History renderer must stay physically absent.');\nassert.doesNotMatch(accountShell, /state\\.accountTab === 'home'|state\\.accountTab === 'history'|state\\.accountTab === 'history-detail'/, 'Retired Overview/History routes must stay physically absent.');\nassert.doesNotMatch(booking, /tab:\\s*'home'|\\? 'contact-detail' : 'home'/, 'Booking must not route back to retired Overview.');",
    'retired Overview/History test block',
)

path.write_text(text)
print('Retired Account root regression expectations updated')
