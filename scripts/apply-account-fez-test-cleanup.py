from pathlib import Path

path = Path('tests/booking-account-ui.test.mjs')
text = path.read_text()
old = """const globalProfileBlock = accountShell.slice(accountShell.indexOf('async function renderGlobalProfile('), accountShell.indexOf('async function renderGlobalProfileSettings('));
const globalHomeFezBlock = accountShell.slice(accountShell.indexOf('async function renderGlobalHome('), accountShell.indexOf('function relationshipSearchText('));
const globalContactsBlock = accountShell.slice(accountShell.indexOf('async function renderGlobalContacts('), accountShell.indexOf('function selectedGlobalRelationship('));
const globalHistoryBlock = accountShell.slice(accountShell.indexOf('async function renderGlobalHistory('), accountShell.indexOf('async function renderGlobalHistoryDetail('));
assert.match(globalProfileBlock, /bindWorkspaceInteraction\\(root, state, handlers\\)/);
assert.match(globalHomeFezBlock, /bindWorkspaceInteraction\\(root, state, handlers\\)/);
assert.match(globalContactsBlock, /bindWorkspaceInteraction\\(root, state, handlers\\)/);
assert.match(globalHistoryBlock, /bindWorkspaceInteraction\\(root, state, handlers\\)/);
const contactDetailBlock2 = accountShell.slice(accountShell.indexOf('async function renderGlobalContactDetail('), accountShell.indexOf('async function renderGlobalHistory('));
assert.match(contactDetailBlock2, /await renderGlobalContacts\\(root, state, handlers\\)/);
assert.match(contactDetailBlock2, /mountV2ZLayer\\(root, v2ZLayer/);
const historyDetailBlock2 = accountShell.slice(accountShell.indexOf('async function renderGlobalHistoryDetail('), accountShell.indexOf('export async function renderGlobalAccount('));
assert.match(historyDetailBlock2, /bindWorkspaceInteraction\\(root, state, handlers, \\{/);
assert.match(historyDetailBlock2, /onZRight:/);
"""
new = """const globalProfileBlock = accountShell.slice(accountShell.indexOf('async function renderGlobalProfile('), accountShell.indexOf('async function renderGlobalProfileSettings('));
const globalContactsBlock = accountShell.slice(accountShell.indexOf('async function renderGlobalContacts('), accountShell.indexOf('function selectedGlobalRelationship('));
assert.match(globalProfileBlock, /bindWorkspaceInteraction\\(root, state, handlers\\)/);
assert.match(globalContactsBlock, /bindWorkspaceInteraction\\(root, state, handlers\\)/);
const contactDetailBlock2 = accountShell.slice(accountShell.indexOf('async function renderGlobalContactDetail('), accountShell.indexOf('export async function renderGlobalAccount('));
assert.match(contactDetailBlock2, /await renderGlobalContacts\\(root, state, handlers\\)/);
assert.match(contactDetailBlock2, /mountV2ZLayer\\(root, v2ZLayer/);
"""
if text.count(old) != 1:
    raise SystemExit(f'expected one stale FEZ block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
print('Account FEZ regression expectations updated')
