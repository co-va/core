from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


shell_path = Path('online-booking/account-shell.js')
shell = shell_path.read_text()

# Imports used only by the retired standalone Overview/History roots.
shell = replace_once(shell, "  v2HorizontalRail,\n", "", "remove v2HorizontalRail import")
shell = replace_once(shell, "  v2RailCard,\n", "", "remove v2RailCard import")

# Retired standalone History list helpers. Shared entity history/receipt helpers stay.
start = shell.index("function historyEntry(request, index) {")
end = shell.index("function historyDetailBody(state, request) {")
shell = shell[:start] + shell[end:]

start = shell.index("function selectHistoryRequest(state, request, returnTab = 'history') {")
end = shell.index("function notificationMessages(feed = {}) {")
shell = shell[:start] + shell[end:]

# Retired Overview-only helpers.
start = shell.index("function nowMoment() {")
end = shell.index("const ACTION_STATUS_LABELS = Object.freeze({")
shell = shell[:start] + shell[end:]

start = shell.index("function futureRequests(requests = []) {")
end = shell.index("const GLOBAL_ACCOUNT_ROOTS = Object.freeze([")
shell = shell[:start] + shell[end:]

shell = replace_once(
    shell,
    "const GLOBAL_ACCOUNT_ROOTS = Object.freeze([\n  { id: 'profile', label: 'Профиль' },\n  { id: 'journal', label: 'Журнал' },\n  { id: 'contacts', label: 'Контакты' },\n  { id: 'history', label: 'История' },\n]);",
    "const GLOBAL_ACCOUNT_ROOTS = Object.freeze([\n  { id: 'profile', label: 'Профиль' },\n  { id: 'journal', label: 'Журнал' },\n  { id: 'contacts', label: 'Контакты' },\n]);",
    "remove History root card",
)
shell = replace_once(
    shell,
    "  if (state.accountTab === 'contacts' || state.accountTab === 'contact-detail') return 'contacts';\n  if (state.accountTab === 'history' || state.accountTab === 'history-detail') return 'history';\n  return 'journal';",
    "  if (state.accountTab === 'contacts' || state.accountTab === 'contact-detail') return 'contacts';\n  return 'journal';",
    "remove History root mapping",
)

start = shell.index("function globalHomeHeader(state) {")
end = shell.index("function accountInvestments(state, status = '') {")
shell = shell[:start] + shell[end:]

start = shell.index("async function renderGlobalHome(root, state, handlers) {")
end = shell.index("function relationshipSearchText(relationship = {}) {")
shell = shell[:start] + shell[end:]

start = shell.index("async function renderGlobalHistory(root, state, handlers) {")
end = shell.index("export async function renderGlobalAccount(root, state, callbacks = {}) {")
shell = shell[:start] + shell[end:]

shell = replace_once(
    shell,
    "  if (state.accountTab === 'contacts') return renderGlobalContacts(root, state, handlers);\n  if (state.accountTab === 'history-detail') return renderGlobalHistoryDetail(root, state, handlers);\n  if (state.accountTab === 'history') return renderGlobalHistory(root, state, handlers);\n  if (state.accountTab === 'home') return renderGlobalHome(root, state, handlers);\n  return renderGlobalJournal(root, state, handlers);",
    "  if (state.accountTab === 'contacts') return renderGlobalContacts(root, state, handlers);\n  return renderGlobalJournal(root, state, handlers);",
    "remove retired root render branches",
)

# Guard against leaving the retired standalone architecture behind.
for marker in [
    "renderGlobalHistory",
    "renderGlobalHistoryDetail",
    "renderGlobalHome",
    "globalHomeHeader",
    "history-detail",
    "data-account-history",
    "data-account-upcoming",
    "accountHistoryRequest",
    "{ id: 'history', label: 'История' }",
    "state.accountTab === 'home'",
]:
    if marker in shell:
        raise SystemExit(f"retired marker still present in account-shell.js: {marker}")

shell_path.write_text(shell)

booking_path = Path('online-booking/booking.js')
booking = booking_path.read_text()
booking = replace_once(
    booking,
    "    else if (state.account && state.identityDestination === 'booking') exitBookingContext(state, {\n      tab: 'home',\n      tenantId: state.tenantId,\n    });",
    "    else if (state.account && state.identityDestination === 'booking') exitBookingContext(state, {\n      tab: 'journal',\n      tenantId: state.tenantId,\n    });",
    "replace retired booking home destination",
)
booking_path.write_text(booking)

# No standalone Overview/Home or History routes may survive outside tests/docs either.
for path in Path('.').rglob('*.js'):
    if '.git' in path.parts:
        continue
    text = path.read_text(errors='ignore')
    for marker in ["tab: 'home'", "accountTab === 'home'", "accountTab === 'history'", "accountTab === 'history-detail'"]:
        if marker in text:
            raise SystemExit(f"retired route marker {marker!r} still present in {path}")

print('Account root cleanup applied')
