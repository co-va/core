from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

booking_path = Path('online-booking/booking.js')
booking = booking_path.read_text()
booking = replace_once(
    booking,
    "      tab: state.bookingOrigin === 'profile' ? 'contact-detail' : 'home',",
    "      tab: state.bookingOrigin === 'profile' ? 'contact-detail' : 'journal',",
    "remove final Overview route from first-step booking return",
)
if "'home'" in booking or '"home"' in booking:
    raise SystemExit('retired home route still present in booking.js')
booking_path.write_text(booking)

guard_path = Path('scripts/check-booking-account-architecture.mjs')
guard = guard_path.read_text()

guard = replace_once(
    guard,
    "expect(booking.includes('function backFromFirstBookingStep') && booking.includes(\"tab: state.bookingOrigin === 'profile' ? 'contact-detail' : 'home'\") && booking.includes('renderWelcome(root, state);'), 'The first booking swipe boundary must return known Accounts to their profile/home and reserve Welcome for unidentified first entry.');",
    "expect(booking.includes('function backFromFirstBookingStep') && booking.includes(\"tab: state.bookingOrigin === 'profile' ? 'contact-detail' : 'journal'\") && booking.includes('renderWelcome(root, state);'), 'The first booking swipe boundary must return known Accounts to their contact profile or Journal and reserve Welcome for unidentified first entry.');",
    "update first booking return guard",
)

guard = replace_once(
    guard,
    "expect(accountShell.includes('async function renderGlobalHistoryDetail') && accountShell.includes(\"actionBlock(button('Записаться'\") && accountShell.includes(\"data: 'data-global-history-repeat'\"), 'Global History must own record detail and repeat booking as the bottom Z action.');",
    "expect(accountShell.includes('function openGlobalContactHistoryLayer') && accountShell.includes(\"data: 'data-global-contact-booking'\"), 'Contact-scoped history must keep record detail and repeat booking without a standalone History root.');",
    "replace Global History detail ownership guard",
)

guard = replace_once(
    guard,
    "  'The legacy two-folder tenant account UI must be physically absent; Profile / Overview / Contacts / History is the sole end-user account owner.');",
    "  'The legacy two-folder tenant account UI must be physically absent; Profile / Journal / Contacts is the sole end-user account root set.');",
    "update root ownership message",
)

guard = replace_once(
    guard,
    "expect(accountShell.includes('async function renderGlobalHistoryDetail') && !accountShell.includes('onOpenRelationship: callbacks.onOpenRelationship'), 'Global History must own record detail locally and must not restore the old relationship bridge.');",
    "expect(!accountShell.includes('async function renderGlobalHistoryDetail') && !accountShell.includes('async function renderGlobalHistory(') && !accountShell.includes('onOpenRelationship: callbacks.onOpenRelationship'), 'Standalone Global History must stay physically absent; record history belongs to entity-scoped views and must not restore the old relationship bridge.');",
    "replace standalone Global History guard",
)

guard_path.write_text(guard)
print('Retired Account root tails removed')
