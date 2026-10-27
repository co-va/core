import fs from 'node:fs';

const booking = fs.readFileSync('online-booking/booking.js', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');
const personalData = fs.readFileSync('online-booking/personal-data.js', 'utf8');
const consentSettings = fs.readFileSync('online-booking/consent-settings.js', 'utf8');
const settings = fs.readFileSync('settings/online-booking/online-booking.js', 'utf8');
const notificationSettings = fs.readFileSync('settings/notifications/notifications.js', 'utf8');
const serverSync = fs.readFileSync('online-booking/server-sync.js', 'utf8');
const chatUi = fs.readFileSync('ui/chat/index.js', 'utf8');
const chatRuntime = fs.readFileSync('core/chat/runtime.js', 'utf8');
const chatCss = fs.readFileSync('ui/chat/chat.css', 'utf8');
const settingsUi = fs.readFileSync('ui/settings/index.js', 'utf8');
const settingsCss = fs.readFileSync('ui/settings/settings.css', 'utf8');
const receiptUi = fs.readFileSync('ui/receipt/index.js', 'utf8');
const receiptCss = fs.readFileSync('ui/receipt/receipt.css', 'utf8');
const formsUi = fs.readFileSync('ui/forms/index.js', 'utf8');
const formsCss = fs.readFileSync('ui/forms/forms.css', 'utf8');
const uiFacade = fs.readFileSync('ui/ui.js', 'utf8');
const styleCss = fs.readFileSync('css/style.css', 'utf8');
const accountMobileCss = fs.readFileSync('ui/booking/account-mobile.css', 'utf8');
const referenceUi = fs.readFileSync('ui/reference/reference.js', 'utf8');
const referenceHtml = fs.readFileSync('ui/reference/index.html', 'utf8');
const referenceCss = fs.readFileSync('ui/reference/reference.css', 'utf8');
const rootHtml = fs.readFileSync('index.html', 'utf8');
const v2Ui = fs.readFileSync('ui/v2/index.js', 'utf8');
const v2Css = fs.readFileSync('ui/v2/v2.css', 'utf8');
const sharedProfile = fs.readFileSync('ui/profile/index.js', 'utf8');
const recordRuntime = fs.readFileSync('ui/record/runtime.js', 'utf8');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const expectLegacyShellRemoved = () => {
  expect(!fs.existsSync('ui/shell/index.js'), 'Legacy ui/shell/index.js must be removed after V2 migration.');
  expect(!fs.existsSync('ui/shell/shell.css'), 'Legacy ui/shell/shell.css must be removed after V2 migration.');
};
expectLegacyShellRemoved();

expect(booking.includes("from '../core/booking-settings/index.js'"), 'Public booking must consume canonical booking settings.');
expect(booking.includes('v2Shell({'), 'Booking workflow must use the shared V2 App Shell.');
expect(booking.includes('v2Header({'), 'Booking workflow must use the shared V2 H / A-B-C-D header.');
expect(!booking.includes('bookingThemeStyle') && !booking.includes('booking-shape--') && !booking.includes('booking-choice-style--'), 'Public booking must use the shared application appearance and must not retain the retired local appearance system.');
expect(!booking.includes('bookingScreen('), 'Booking workflow must not return to the legacy separate booking screen shell.');
expect(booking.includes('recordWorkplaceCards('), 'Public workplace choices must use the canonical Shared Record workplace entity-card owner.');
expect(booking.includes('recordProcedureList('), 'Public procedures must use the canonical Shared Record procedure-list owner.');
expect(booking.includes('recordTimeRows('), 'Public booking time must use the canonical Shared Record horizontal time-row owner.');
expect(booking.includes('initCalendar('), 'Public booking date must use the existing shared Calendar.');
expect(!booking.includes("type: 'date'"), 'Public booking must not use native technical date controls.');

expect(booking.includes('renderLegalSticker') && booking.includes('renderAccountEntry') && booking.includes('renderAccountDetails'), 'Identity/legal flow must use Auth Sticker -> Registration H+Z -> Legal Sticker.');
expect(!booking.includes('function renderPassword('), 'Retired pre-V2 separate password page must not return.');
expect(booking.includes("state.identityDestination = 'booking';") && booking.includes('nextBookingStep(root, state);'), 'Welcome must preserve the proven booking entry path; UI refactors must not reorder identity/business logic.');
expect(booking.includes("if (!state.accountTerms) await loadAccountTerms(state);") && booking.includes('renderLegalSticker(root, state);'), 'A new Account must collect registration data before the V2 Legal Sticker checkpoint.');
expect(booking.includes("accountTerms: currentAccountTermsFact(state)"), 'Account registration must submit platform terms acceptance at the legal checkpoint.');
expect(booking.includes("label: 'Телефон или email'") && booking.includes("name: 'identifier'"), 'Auth Sticker must accept phone or email through one identifier field.');
expect(booking.includes("label: 'Пароль'") && booking.includes('data-booking-register') && booking.includes('data-booking-forgot'), 'Auth Sticker must contain password, registration and recovery entry points.');
expect(booking.includes("prepareAccount(state.tenantId, { identifier })"), 'Account entry must resolve the global identifier before login.');
expect(booking.includes("prepareAccount(state.tenantId, { email, phone })"), 'New Account contacts must be checked before legal confirmation.');
expect(booking.includes("loginAccount(state.tenantId, identifier, password)"), 'Auth Sticker login must use the entered phone/email identifier.');
expect(!booking.includes('registrationMode'), 'Legacy registration consent mode must not return.');
expect(!booking.includes('renderRegistrationAgreements'), 'Tenant consent must not be modeled as registration agreements.');
expect(!booking.includes('saveRegistrationConsents'), 'Tenant consent must not be saved as registration consent.');
expect(booking.includes('getAccountPlatformState(state.tenantId)') && booking.includes('refreshTenantConsentState(state)'), 'Existing Account legal gate must check both platform terms and Tenant consent state.');
expect(booking.includes("if (!platformState?.accepted) {") && booking.includes("if (!consentState.pdnActive) {") && booking.includes('renderLegalSticker(root, state);'), 'Platform terms and Tenant legal state must remain independent gates that use the V2 Legal Sticker checkpoint.');
expect(!booking.includes('if (payload.personExisted)'), 'Person matching must not decide whether booking continues or Profile opens.');
expect(!booking.includes('data-booking-workplaces-next') && !booking.includes('data-booking-dates-next') && !booking.includes('data-booking-times-next'), 'Workplace, date and time must auto-advance without artificial C «Далее» actions.');
expect(booking.includes("state.workplaceKey = node.dataset.bookingWorkplace || '';") && booking.includes('renderProcedures(root, state);'), 'Choosing a workplace must immediately open services.');
expect(booking.includes('onDateSelect: (date) => {') && booking.includes('state.date = date;') && booking.includes('renderTimes(root, state);'), 'Choosing a date must immediately open time.');
expect(booking.includes('state.from = slot.from;') && booking.includes('state.to = slot.to;') && booking.includes('renderConfirmation(root, state);'), 'Choosing a time slot must immediately open confirmation.');
expect(booking.includes("layer?.querySelector('[data-booking-confirm]')") && booking.includes('await continueAfterIdentity(root, state);'), 'Bottom «Подтвердить» must revalidate identity/legal state before the final server write.');
expect(booking.includes('async function finalizeBookingRequest') && booking.includes('createBookingRequest(state.tenantId'), 'Only the post-identity/legal finalizer may create the booking request.');
expect(booking.includes('slotStillAvailable') && booking.includes('await refreshContext(state);'), 'Final booking write must recheck the selected slot against refreshed availability.');
expect(booking.includes('d: null'), 'Online booking Header D must stay absent; booking must not create a parallel chat entry.');

expect(booking.includes('renderWorkplaces') && booking.includes('renderProcedures') && booking.includes('renderDates') && booking.includes('renderTimes') && booking.includes('renderConfirmation'), 'Booking itself must preserve workplace -> services -> date -> time -> confirmation.');
expect(booking.includes("step: 'workplaces'") && booking.includes("step: 'procedures'") && booking.includes("step: 'dates'") && booking.includes("step: 'times'") && booking.includes("step: 'confirmation'"), 'Booking must preserve the canonical V2 Z-stack steps.');
expect(booking.includes("step: 'workplaces'") && booking.includes("step: 'procedures'") && booking.includes("step: 'dates'") && booking.includes("step: 'times'") && booking.includes("step: 'confirmation'"), 'Online booking must keep the canonical booking step sequence while UI owners remain shared.');
expect(booking.includes('mountV2ZLayer(root') && booking.includes("className: 'booking-step-z'") && booking.includes('stack: true'), 'Online booking steps after Z1 must use the shared physical Z-layer stack.');
expect(!booking.includes('data-booking-workplaces-back') && !booking.includes('data-booking-dates-back') && !booking.includes('data-booking-times-back') && !booking.includes('data-booking-confirm-back'), 'V2 booking flow must not restore legacy back buttons.');
expect(booking.includes('function backFromFirstBookingStep') && booking.includes("tab: state.bookingOrigin === 'profile' ? 'contact-detail' : 'journal'") && booking.includes('renderWelcome(root, state);'), 'The first booking swipe boundary must return known Accounts to their contact profile or Journal and reserve Welcome for unidentified first entry.');
expect(!booking.slice(booking.indexOf('function backFromFirstBookingStep'), booking.indexOf('function renderWelcome')).includes('renderAccountEntry(root, state);'), 'Backing out of booking must never force Auth Sticker.');
expect(/function renderWelcome[\s\S]*if \(state\.account\)[\s\S]*continueAfterIdentity\(root, state\)[\s\S]*renderAccountEntry\(root, state\)/.test(booking), 'Welcome must gate unidentified users into identity before booking and never repeat for a known Account.');
expect(/async function continueAfterIdentity[\s\S]*hasBookingSelection[\s\S]*nextBookingStep\(root, state\)/.test(booking), 'Identity/legal gate must start booking only after Account and required consent state are valid.');

expect(!booking.includes('renderAccountHome(') && !booking.includes("import { renderAccount,"), 'Online booking must not retain the removed tenant account UI owner.');
const globalAccountHomeBlock = booking.slice(booking.indexOf('async function renderGlobalClientHome'), booking.indexOf('async function continueGlobalIdentity'));
expect(!globalAccountHomeBlock.includes("params.set('entry', 'account')") && !globalAccountHomeBlock.includes('onOpenRelationship:') && !globalAccountHomeBlock.includes('onOpenRecord:'), 'Global account must not bridge Contacts or History into the legacy tenant account contour.');
expect(globalAccountHomeBlock.includes('onStartBooking: (tenantId, options = {})') && globalAccountHomeBlock.includes("new CustomEvent('cova:account-booking-start'"), 'Leaving the global account for a tenant must be reserved for the explicit App Q booking action.');
expect(booking.includes("exitBookingContext(state, { tab: 'contact-detail', tenantId: state.tenantId })")
  && booking.includes("tab: state.entry === 'chat' ? 'messages' : 'contact-detail'"),
  'Tenant flows may return only through the existing global account owner; the UI refactor must not create a second account contour.');
expect(!booking.includes('step: 15'), 'Public booking must not hardcode a 15 minute slot step.');
expect(settings.includes("from '../../core/booking-settings/index.js'"), 'Online booking settings must use canonical booking settings owner.');
expect(!/\b(?:appShell|appHeader)\s*\(/.test(settings) && !settings.includes('app-content--book-shell'), 'Online booking settings must not create a second full-screen shell inside Shared Z.');
expect(settings.includes('workspaceHeaderContext({') && !settings.includes('data-online-booking-back') && settings.includes('data-online-booking-welcome-save') && settings.includes("variant: 'q'"), 'Online booking must use the single Shared V2 workspace and Q Header C while return navigation remains gesture-owned.');
expect(settings.includes("title: 'Онлайн-запись'") && settings.includes("data: 'data-online-booking-settings'"), 'Online booking Z1 A must own its settings while C remains absent.');
expect(settings.includes("openSharedProfileSettingsMenu({") && settings.includes("label: 'Приветствие'") && !settings.includes("label: 'Настройки уведомлений'"), 'Online booking A must own only Welcome; notification delivery settings belong to Notifications.');
expect(!settings.includes('Внешний вид') && !settings.includes('renderAppearance') && !settings.includes('BOOKING_SHAPES') && !settings.includes('BOOKING_CHOICE_STYLES'), 'Legacy online-booking appearance customization must stay removed.');
expect(!fs.existsSync('ui/booking/index.js') && !fs.existsSync('ui/booking/account-theme.css'), 'Legacy online-booking appearance code and stylesheet must stay physically removed.');
expect(settings.includes("actionBlock(button('Сохранить'") && settings.includes('setWelcomeSaveVisible') && settings.includes("save?.closest('.modal-actions')"), 'Welcome Q bottom Save must appear only after a draft change.');
expect(!settings.includes('BOOKING_SLOT_STEPS.map') && !settings.includes('<span>Шаг записи</span>') && !settings.includes('data-online-booking-slot-step'), 'Online booking Z1 must not expose a slot-step control while step configuration is inactive; time candidates stay natural until the feature is explicitly configured.');
expect(notificationSettings.includes("data: 'data-notification-delivery-settings-open'")
  && notificationSettings.includes("label: 'Порядок отправки'")
  && notificationSettings.includes("label: 'Канал 1'")
  && notificationSettings.includes("label: 'Канал 2'")
  && !notificationSettings.includes("label: 'Канал 3'")
  && notificationSettings.includes('Push — всегда')
  && notificationSettings.includes("className: 'modal--form-sheet'"),
  'Notifications A/X must own one compact delivery policy; Push stays outside the Telegram/Email order.');
expect(!settings.includes("icon: 'info'") && !settings.includes('data-online-booking-slot-info') && !settings.includes('openSlotStepInfo'), 'Online booking must not expose slot-step help while step configuration is inactive.');
expect(serverSync.includes("apiRequest('/business-state')"), 'Open Book must refresh from canonical server business state.');
expect(v2Ui.includes('v2Header') && v2Ui.includes('v2Shell') && v2Ui.includes('v2CardDeck') && !v2Ui.includes('v2FDeck'), 'Shared ui/v2 must own one CardDeck geometry for F/E inside V2 H/Z.');
expect(v2Css.includes('.v2-z') && v2Css.includes('border-radius:var(--v2-z-radius) 0 0 0'), 'Shared V2 CSS must keep only the Z upper-left corner rounded.');
expect(!accountShell.includes('accountBottomNavigation') && !accountShell.includes('bindBottomNavigation'), 'The migrated end-user contour must not use bottom navigation.');
expect(chatUi.includes('messageComposer') && chatUi.includes('messageThread') && chatUi.includes('bindMessageAttachments') && chatUi.includes('initMessageComposer'), 'Shared ui/chat must own messenger rendering, attachments and growing composer behavior.');
expect(chatUi.includes('message-composer--plain') && chatUi.includes('message-composer--with-attachments'), 'Shared ui/chat composer must own both plain and attachment layouts.');
expect(settingsUi.includes('settingsPanel') && settingsUi.includes('settingToggle'), 'Shared ui/settings must own settings panels and toggles.');
expect(receiptUi.includes('readOnlyReceipt'), 'Shared ui/receipt must own read-only receipt sheets.');
expect(formsUi.includes('formView') && formsUi.includes('formError'), 'Shared ui/forms must own reusable form shells and form errors.');
expect(!uiFacade.includes('messageComposer') && !uiFacade.includes('messageThread') && !uiFacade.includes('settingsPanel') && !uiFacade.includes('settingToggle') && !uiFacade.includes('readOnlyReceipt'), 'Migrated owners must be imported directly, not re-exported through ui/ui.js.');
expect(accountShell.includes("from '../core/chat/runtime.js'") && accountShell.includes("from '../ui/settings/index.js'") && accountShell.includes("from '../ui/receipt/index.js'"), 'End-user account must consume neutral Core Chat runtime plus direct Settings and Receipt owners.');
expect(booking.includes("from '../ui/forms/index.js'"), 'End-user booking must consume Shared Forms directly.');
expect(settings.includes('openSharedProfileSettingsMenu') && notificationSettings.includes("className: 'modal--form-sheet'"), 'Professional settings must keep the Shared A owner while notification delivery uses Notifications X.');
expect(chatCss.includes('.message-composer{position:fixed') && chatCss.includes('.message-thread{'), 'Shared ui/chat CSS must own composer and thread geometry.');
expect(settingsCss.includes('.app-settings-panel') && settingsCss.includes('.app-setting-toggle'), 'Shared ui/settings CSS must own settings geometry.');
expect(receiptCss.includes('.read-only-sheet'), 'Shared ui/receipt CSS must own receipt geometry.');
expect(formsCss.includes('.form-error'), 'Shared ui/forms CSS must own reusable error presentation.');
expect(styleCss.includes('--app-max-width:390px'), 'Book must use one shared 390px application width for profile and account surfaces.');
expect(!accountMobileCss.includes('--app-max-width:'), 'Account shell must inherit the shared Book application width instead of redefining it.');
expect(!accountMobileCss.includes('max-width:none'), 'Account application must never disable its phone-width limit.');
expect(!accountShell.includes("document.createElement('style')") && !accountShell.includes('<style>'), 'Account features must not own local CSS.');
expect(!accountShell.includes('bookingThemeStyle'), 'Authenticated end-user surfaces must not inject representative booking theme styles into Shared V2.');
expect(!accountShell.includes('booking-shape--') && !accountShell.includes('booking-choice-style--'), 'Authenticated end-user surfaces must not select local shape or choice-style variants for Shared UI.');
expect(!accountShell.includes('accountThemeClasses'), 'Authenticated end-user surfaces must not own a local shell theme classifier.');
expect(accountShell.includes('if (!canReuseScene) {') && accountShell.includes('root.innerHTML = v2Shell({') && accountShell.includes('if (z) z.innerHTML = body;'), 'Authenticated end-user surfaces must mount the canonical Shared V2 shell once and then reuse its persistent FEZ scene without a local visual wrapper.');
expect(chatRuntime.includes("messageComposer({ attachments: true, attachmentTrigger: 'external' })") && chatRuntime.includes("kind: 'attachment'"), 'Core Chat runtime must own the shared composer and Header D attachment control.');
expect(!accountShell.includes('messageComposer(') && !accountShell.includes('messageThread(') && !accountShell.includes('bindMessageAttachments('), 'End-user account shell must not duplicate Chat runtime behavior.');
expect(accountShell.includes('function openGlobalContactHistoryLayer') && accountShell.includes("data: 'data-global-contact-booking'"), 'Contact-scoped history must keep record detail and repeat booking without a standalone History root.');
expect(accountShell.includes('async function renderGlobalContactDetail') && accountShell.includes("state.accountTab = 'contact-detail'"), 'Global Contacts F must own contact Z3 instead of navigating to a second account contour.');
expect(!accountShell.includes('export async function renderAccount(')
  && !accountShell.includes('async function renderHome(')
  && !accountShell.includes('async function renderRepresentatives(')
  && !accountShell.includes('async function renderRepresentative(')
  && !accountShell.includes('async function renderHistory(')
  && !accountShell.includes('async function renderMessages('),
  'The legacy two-folder tenant account UI must be physically absent; Profile / Journal / Contacts is the sole end-user account root set.');
expect(!accountShell.includes('async function renderGlobalHistoryDetail') && !accountShell.includes('async function renderGlobalHistory(') && !accountShell.includes('onOpenRelationship: callbacks.onOpenRelationship'), 'Standalone Global History must stay physically absent; record history belongs to entity-scoped views and must not restore the old relationship bridge.');
expect(consentSettings.includes("tenantId = state?.tenantId") && consentSettings.includes('getAccountConsentState(scopeTenantId)') && consentSettings.includes('revokeAccountConsent(scopeTenantId, consent.documentId)'), 'Consent settings must be the single tenant-scoped owner used from both contact settings and Profile aggregation.');
expect(accountShell.includes('state.accountSelectedChatTenantId') && accountShell.includes('selectedTenantId'), 'End-user Chat must live inside the global account and select a contact without a tenant-account bridge.');
expect(accountShell.includes("id:'controls',label:'Согласия / Уведомления'") && accountShell.includes('openSharedProfileSettingsMenu({'), 'End-user Profile settings must expose the combined Consents / Notifications entry through the Shared Profile menu owner.');
expect(accountShell.includes("id:'photo',label:'Фото'") && accountShell.includes("id:'delete',label:'Удалить профиль',variant:'critical'"), 'End-user Profile settings must expose separate Photo and critical Profile deletion actions through the Shared Profile menu owner.');
expect(accountShell.includes('data-account-profile-card') && accountShell.includes('openAccountPersonalDataZ(root, state'), 'End-user personal-data editing must start from the Profile entity card, not Header A settings.');
expect(consentSettings.includes('revokeAccountConsent'), 'Account consent settings must use the canonical server-backed revoke flow.');
expect(recordRuntime.includes('recordWorkplaceCards') && recordRuntime.includes('recordProcedureList') && recordRuntime.includes('recordTimeRows') && recordRuntime.includes('recordConfirmationMiniCard'), 'Shared Record UI must be the sole owner of canonical booking step controls.');

expect(!fs.existsSync('ui/navigation/navigation.js'), 'Legacy bottom navigation owner must be physically removed.');
expect(!fs.existsSync('ui/navigation/navigation.css'), 'Legacy bottom navigation stylesheet must be physically removed.');
expect(!rootHtml.includes('ui/navigation/navigation.css'), 'Book must not load removed bottom navigation styles.');
expect(rootHtml.includes('ui/chat/chat.css'), 'Book must load canonical Shared Chat styles.');
expect(rootHtml.includes('ui/settings/settings.css'), 'Book must load canonical Shared Settings styles.');
expect(rootHtml.includes('ui/receipt/receipt.css'), 'Book must load canonical Shared Receipt styles.');
expect(rootHtml.includes('ui/forms/forms.css'), 'Book must load canonical Shared Forms styles.');

expect(referenceHtml.includes('reference.css') && referenceHtml.includes('reference-controls'), 'The Book UI reference must keep lab controls outside the 390px application shell.');
expect(referenceCss.includes('.ui-reference-toolbar') && referenceCss.includes('position:fixed'), 'Reference-only controls must remain outside the Book phone surface.');
expect(referenceUi.includes('v2Shell({') && referenceUi.includes('v2Header({'), 'The UI reference must use the canonical V2 shell/header, not a legacy shell.');
expect(referenceUi.includes("['profile', 'Карточка — без S']") && referenceUi.includes("['profile-media', 'Карточка — с S']") && referenceUi.includes("['chat', 'Чат']") && referenceUi.includes("['form', 'Форма']"), 'Reference must expose multiple UI screen forms and S/no-S states.');
expect(referenceUi.includes("'Сохранить', 'Далее', 'Готово', 'Добавить', 'Создать'"), 'Reference must expose canonical B label fit checks.');
expect(referenceUi.includes('modal(') && referenceUi.includes('mountModal('), 'Reference must exercise the real shared modal component.');
expect(referenceUi.includes("button('Фото'") && referenceUi.includes("button('Изменить пароль'") && referenceUi.includes("button('Согласия / Уведомления'") && referenceUi.includes("button('Выход'") && referenceUi.includes("button('Удалить профиль'"), 'Reference profile settings must include all approved actions.');
const photoIndex = referenceUi.indexOf("button('Фото'");
const passwordIndex = referenceUi.indexOf("button('Изменить пароль'");
const consentIndex = referenceUi.indexOf("button('Согласия / Уведомления'");
const logoutIndex = referenceUi.indexOf("button('Выход'");
const deleteIndex = referenceUi.indexOf("button('Удалить профиль'");
expect(photoIndex >= 0 && photoIndex < passwordIndex && passwordIndex < consentIndex && consentIndex < logoutIndex && logoutIndex < deleteIndex, 'Reference profile settings must keep the approved action order.');
expect(referenceUi.includes("button('Фото', { variant: 'outline'") && referenceUi.includes("button('Изменить пароль', { variant: 'outline'") && referenceUi.includes("button('Согласия / Уведомления', { variant: 'outline'") && referenceUi.includes("button('Выход', { variant: 'danger'") && referenceUi.includes("button('Удалить профиль', { variant: 'critical'"), 'Reference profile settings must keep the approved button variants.');
expect(referenceUi.includes("data: 'data-reference-profile-card'") && referenceUi.includes("openPersonalDataReference"), 'Reference personal-data editing must originate from the Profile card.');
expect(referenceUi.includes("variant: 'x'") && referenceUi.includes('data-reference-settings-menu') && referenceUi.includes('data-reference-personal-z'), 'Reference Header A settings must use X while Profile personal-data editing stays on stacked Z2.');
const endUserProfileCard = accountShell.slice(accountShell.indexOf('function profileSummary'), accountShell.indexOf('function bindGlobalRelationships'));
expect(endUserProfileCard.includes('entityVisualCard({') && endUserProfileCard.includes('ACCOUNT_PROFILE_CARD_APPEARANCE') && endUserProfileCard.includes("value:'name'") && endUserProfileCard.includes("value:'phone'") && !endUserProfileCard.includes('entity-card--hero') && !/className\s*:\s*['\"][^'\"]*account-profile-card/.test(endUserProfileCard), 'End-user Profile Z1 must use one canonical Entity Visual Card with one-line full name and phone.');
expect(accountShell.includes('openSharedProfileSettingsMenu({') && !accountShell.includes('openGlobalProfileSettingsZ') && !accountShell.includes('data-account-profile-settings-z'), 'End-user Header A settings must consume the Shared X-menu owner; legacy settings Z must be physically absent.');
expect(personalData.includes("v2Section('Личные данные', fields)") && personalData.includes("datePicker({label:'Дата рождения'") && personalData.includes('initDatePickers(layer)') && !personalData.includes('birthDateField') && !personalData.includes('openBirthDatePicker') && !personalData.includes('data-account-birth-') && !personalData.includes('ui-select__control') && !personalData.includes('accordion(') && !personalData.includes('initAccordions'), 'End-user personal-data Z2 must use flat Shared UI owners, including the Shared full Date Picker, and must not retain local date/select or accordion rendering.');
expect(!accountShell.includes("document.createElement('input')") && !accountShell.includes('new FileReader(') && accountShell.includes('openSharedPhotoAction(') && sharedProfile.includes('selectPhotoFile()'), 'End-user Profile must consume the Shared photo owner instead of owning file input logic.');
expect(sharedProfile.includes('openSharedProfileSettingsMenu') && sharedProfile.includes('openSharedPhotoAction') && sharedProfile.includes('openSharedPasswordAction') && !sharedProfile.includes('openSharedConsentDocument'), 'Both profile contours must share one Profile UI owner for profile actions; document UI must remain owned by ui/documents.');
expect(!referenceUi.includes('apiRequest(') && !referenceUi.includes('fetch(') && !referenceUi.includes('localStorage') && !referenceUi.includes('sessionStorage') && !referenceUi.includes("from '../../core/") && !referenceUi.includes("from '../core/"), 'Reference must remain free of API, persistence and business-layer dependencies.');

if (failures.length) {
  failures.forEach((message) => console.error(`booking account architecture: ${message}`));
  process.exit(1);
}
console.log('booking account architecture check: OK');
