from pathlib import Path

path = Path('scripts/check-ui-v2-architecture.mjs')
text = path.read_text()

old = "expect(account.includes('GLOBAL_ACCOUNT_ROOTS') && account.includes(\"id: 'profile', label: 'Профиль'\") && account.includes(\"id: 'journal', label: 'Журнал'\") && account.includes(\"id: 'contacts', label: 'Контакты'\") && account.includes(\"id: 'history', label: 'История'\") && account.includes('initV2WorkspaceInteraction(root') && account.includes('GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === id)'), 'Changing the active end-user F folder must route through the Shared workspace owner and immediately change Z to the selected Profile / Journal / Contacts / History face.');"
new = "expect(account.includes('GLOBAL_ACCOUNT_ROOTS') && account.includes(\"id: 'profile', label: 'Профиль'\") && account.includes(\"id: 'journal', label: 'Журнал'\") && account.includes(\"id: 'contacts', label: 'Контакты'\") && !account.includes(\"id: 'history', label: 'История'\") && account.includes('initV2WorkspaceInteraction(root') && account.includes('GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === id)'), 'Changing the active end-user F folder must route through the Shared workspace owner and immediately change Z to the selected Profile / Journal / Contacts face.');"
if text.count(old) != 1:
    raise SystemExit(f'workspace root guard: expected 1 match, found {text.count(old)}')
text = text.replace(old, new, 1)

old = "  && account.includes(\"id: 'contacts', label: 'Контакты'\")\n  && account.includes(\"id: 'history', label: 'История'\")\n  && !account.includes(\"id: 'home', label: 'Обзор'\")\n  && !account.includes(\"id: 'representatives'\"),\n  'End-user F owner must expose exactly Profile / Journal / Contacts / History and no legacy Overview/two-folder deck.');"
new = "  && account.includes(\"id: 'contacts', label: 'Контакты'\")\n  && !account.includes(\"id: 'history', label: 'История'\")\n  && !account.includes(\"id: 'home', label: 'Обзор'\")\n  && !account.includes(\"id: 'representatives'\"),\n  'End-user F owner must expose exactly Profile / Journal / Contacts and no retired History/Overview/two-folder deck.');"
if text.count(old) != 1:
    raise SystemExit(f'exact root guard: expected 1 match, found {text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text)
print('Account root architecture guard updated')
