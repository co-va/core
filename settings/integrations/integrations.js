import {
  beginEmailConnection,
  disconnectEmail,
  getEmailConnection,
} from '../../core/integrations/email.js';
import {
  connectTelegramBot,
  disconnectTelegramBot,
  getTelegramBotConnection,
} from '../../core/integrations/telegram.js';
import {
  button,
  emptyState,
  field,
  infoUI,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  openDocumentViewer,
  page,
  workspaceHeaderContext,
} from '../../ui/ui.js';

const TELEGRAM_SETUP_GUIDE = `1. Откройте Telegram.\n\nВ поиске найдите официального бота @BotFather и откройте его.\n\n2. Создайте нового бота.\n\nОтправьте BotFather команду /newbot.\n\n3. Укажите название.\n\nBotFather попросит написать название бота. Введите любое понятное вам название. Это название будут видеть пользователи в Telegram.\n\n4. Создайте username.\n\nBotFather попросит придумать уникальное имя пользователя. Username обязательно должен заканчиваться на bot. Если выбранное имя занято, Telegram попросит выбрать другое.\n\n5. Получите токен.\n\nПосле создания BotFather пришлёт токен бота — длинную строку из цифр и символов.\n\n6. Скопируйте токен.\n\nСкопируйте его целиком. Не изменяйте токен и не передавайте его другим людям: он даёт доступ к управлению ботом.\n\n7. Вернитесь в приложение.\n\nОткройте Интеграции → Telegram, вставьте токен в поле «Токен Telegram-бота» и нажмите «Подключить».\n\n8. Готово.\n\nПосле подключения бот принимает и отправляет сообщения через Telegram.`;

const EMAIL_SETUP_GUIDE = `1. Вставьте рабочую почту\n\n2. Нажмите «Подключить»\n\n3. Подтвердите подключение в вашем почтовом сервисе\n\n4. Готово`;

function telegramSubtitle(state = {}) {
  if (state?.error) return 'Связь недоступна';
  if (!state?.connected) return 'Не подключён';
  return state?.inboundActive ? 'Подключён' : 'Связь недоступна';
}

function telegramMiniCard(state = {}, { interactive = false } = {}) {
  const connected = Boolean(state?.connected);
  const bot = String(state?.botUsername || '').trim();
  return miniCard({
    title: 'Telegram',
    value: connected && bot ? bot : '',
    subtitle: telegramSubtitle(state),
    interactive,
    data: interactive ? 'data-integration-open="telegram"' : '',
    aria: interactive ? 'Открыть Telegram' : '',
  });
}

function emailSubtitle(state = {}) {
  if (state?.error || (state?.connected && state?.connectionAvailable === false)) return 'Связь недоступна';
  return state?.connected ? 'Подключён' : 'Не подключён';
}

function emailMiniCard(state = {}, { interactive = false } = {}) {
  const email = String(state?.email || state?.suggestedEmail || '').trim();
  return miniCard({
    title: 'Email',
    value: email,
    subtitle: emailSubtitle(state),
    interactive,
    data: interactive ? 'data-integration-open="email"' : '',
    aria: interactive ? 'Открыть Email' : '',
  });
}

function telegramInfoDocument(state = {}) {
  if (state?.error) {
    return {
      title: 'Связь недоступна',
      content: 'Сейчас приложение не может проверить состояние подключения. Повторно вводить токен не нужно.\n\nПопробуйте открыть интеграцию позже.',
    };
  }

  if (!state?.connected) {
    return { title: 'Как подключить Telegram', content: TELEGRAM_SETUP_GUIDE };
  }

  const bot = String(state?.botUsername || '').trim();
  if (state?.inboundActive) {
    return {
      title: 'Подключено',
      content: `${bot ? `Бот ${bot} подключён.` : 'Бот подключён.'}\n\nБот принимает и отправляет сообщения через Telegram.\n\nЧтобы подключить другого бота, сначала отключите текущего.`,
    };
  }

  return {
    title: 'Связь недоступна',
    content: `${bot ? `Бот ${bot} подключён, но сейчас не удаётся подтвердить связь.` : 'Бот подключён, но сейчас не удаётся подтвердить связь.'}\n\nПовторно вводить токен не нужно.\n\nЕсли связь долго не восстановится, отключите бота и подключите его заново.`,
  };
}

function emailInfoDocument(state = {}) {
  if (state?.error) {
    return { title: 'Связь недоступна', content: 'Сейчас не удалось проверить состояние подключения.\n\nПопробуйте открыть интеграцию позже.' };
  }
  if (!state?.connected) return { title: 'Как подключить почту', content: EMAIL_SETUP_GUIDE };
  const email = String(state?.email || '').trim();
  if (state?.connectionAvailable === false) {
    return { title: 'Связь недоступна', content: `${email ? `Почта ${email} подключена,` : 'Почта подключена,'} но сейчас связь недоступна.\n\nПовторно подключать её не нужно. Попробуйте позже.` };
  }
  return {
    title: 'Подключено',
    content: `${email ? `Рабочая почта ${email} подключена.` : 'Рабочая почта подключена.'}\n\nПисьма отправляются с этого адреса. Ответы приходят в этот почтовый ящик.`,
  };
}

function telegramActionError(error, connected) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/токен/i.test(message) && !/шифрован/i.test(message)) return message;
  return connected
    ? 'Не удалось отключить Telegram. Повторите действие.'
    : 'Не удалось подключить Telegram. Проверьте токен и повторите действие.';
}

function emailActionError(error, connected) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/почт|подключ/i.test(message) && !/ключ|oauth|smtp|api/i.test(message)) return message;
  return connected ? 'Не удалось отключить почту. Повторите действие.' : 'Не удалось подключить почту. Повторите действие.';
}

function telegramXContent(state = {}) {
  const connected = Boolean(state?.connected);
  const bot = String(state?.botUsername || '').trim();
  const help = infoUI('', {
    actionOnly: true,
    aria: connected ? 'Информация о подключении Telegram' : 'Как подключить Telegram',
    data: 'data-telegram-help',
  });

  if (state?.error) {
    return `<div class="modal-title modal-title--action"><h2>Telegram</h2>${help}</div>${emptyState('Связь недоступна', 'Не удалось проверить состояние подключения.')}`;
  }

  return `<div class="modal-title modal-title--action"><h2>Telegram</h2>${help}</div>
    <form class="form-grid" data-telegram-integration-form>
      ${connected
        ? field({ label: 'Telegram-бот', name: 'telegramBot', value: bot || 'Бот подключён', disabled: true })
        : field({ label: 'Токен Telegram-бота', name: 'telegramBotToken', type: 'password', placeholder: 'Вставьте токен из BotFather', autocomplete: 'off' })}
      ${button(connected ? 'Отключить' : 'Подключить', { type: 'submit', data: 'data-telegram-action', variant: connected ? 'danger' : '', disabled: !connected })}
      <div class="muted" data-telegram-integration-status aria-live="polite"></div>
    </form>`;
}

function emailXContent(state = {}) {
  const connected = Boolean(state?.connected);
  const help = infoUI('', {
    actionOnly: true,
    aria: connected ? 'Информация о подключении почты' : 'Как подключить почту',
    data: 'data-email-help',
  });
  if (state?.error) {
    return `<div class="modal-title modal-title--action"><h2>Email</h2>${help}</div>${emptyState('Связь недоступна', 'Не удалось проверить состояние подключения.')}`;
  }
  const email = String(state?.email || state?.suggestedEmail || '').trim();
  return `<div class="modal-title modal-title--action"><h2>Email</h2>${help}</div>
    <form class="form-grid" data-email-integration-form>
      ${field({ label: 'Рабочая почта', name: 'workingEmail', type: 'email', value: email, placeholder: 'name@example.ru', autocomplete: 'email', disabled: connected })}
      ${button(connected ? 'Отключить' : 'Подключить', { type: 'submit', data: 'data-email-action', variant: connected ? 'danger' : '', disabled: !connected && !email })}
      <div class="muted" data-email-integration-status aria-live="polite"></div>
    </form>`;
}

function bindTelegramX(layer, baseRoot, state = {}) {
  const connected = Boolean(state?.connected);
  const help = layer.querySelector('[data-telegram-help] [data-info-trigger]');
  help?.addEventListener('click', () => {
    const info = telegramInfoDocument(state);
    openDocumentViewer({ title: info.title, content: info.content });
  });
  if (state?.error) return;
  const form = layer.querySelector('[data-telegram-integration-form]');
  const input = form?.querySelector('[name="telegramBotToken"]');
  const action = form?.querySelector('[data-telegram-action]');
  const status = form?.querySelector('[data-telegram-integration-status]');
  if (!connected && input && action) {
    const sync = () => { action.disabled = !String(input.value || '').trim(); };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!action) return;
    action.disabled = true;
    if (status) status.textContent = '';
    try {
      const next = connected ? await disconnectTelegramBot() : await connectTelegramBot(String(input?.value || '').trim());
      await renderIntegrations(baseRoot);
      layer.v2Close?.();
      openTelegram(baseRoot, next);
    } catch (error) {
      action.disabled = false;
      if (status) status.textContent = telegramActionError(error, connected);
    }
  });
}

function bindEmailX(layer, baseRoot, state = {}) {
  const connected = Boolean(state?.connected);
  const help = layer.querySelector('[data-email-help] [data-info-trigger]');
  help?.addEventListener('click', () => {
    const info = emailInfoDocument(state);
    openDocumentViewer({ title: info.title, content: info.content });
  });
  if (state?.error) return;
  const form = layer.querySelector('[data-email-integration-form]');
  const input = form?.querySelector('[name="workingEmail"]');
  const action = form?.querySelector('[data-email-action]');
  const status = form?.querySelector('[data-email-integration-status]');
  if (!connected && input && action) {
    const sync = () => { action.disabled = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.value || '').trim()); };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
  }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!action) return;
    action.disabled = true;
    if (status) status.textContent = '';
    if (connected) {
      try {
        await disconnectEmail();
        await renderIntegrations(baseRoot);
        layer.v2Close?.();
      } catch (error) {
        action.disabled = false;
        if (status) status.textContent = emailActionError(error, true);
      }
      return;
    }

    const popup = window.open('', 'email-integration', 'popup,width=520,height=720');
    if (!popup) {
      action.disabled = false;
      if (status) status.textContent = 'Разрешите открытие окна для подключения почты.';
      return;
    }
    try {
      try {
        popup.document.title = 'Подключение Email';
        popup.document.body.textContent = 'Открываем подключение почты…';
      } catch {}
      const started = await beginEmailConnection(String(input?.value || '').trim());
      const onMessage = async (message) => {
        if (message?.source !== popup || message?.data?.type !== 'va-tools:email-integration') return;
        window.removeEventListener('message', onMessage);
        if (!message.data.connected) {
          action.disabled = false;
          if (status) status.textContent = 'Подключение не завершено.';
          return;
        }
        const next = await getEmailConnection();
        if (!next?.connected) {
          action.disabled = false;
          if (status) status.textContent = 'Подключение не завершено.';
          return;
        }
        await renderIntegrations(baseRoot);
        layer.v2Close?.();
      };
      window.addEventListener('message', onMessage);
      window.setTimeout(() => window.removeEventListener('message', onMessage), 10 * 60 * 1000);
      popup.location.href = started.authorizationUrl;
      if (status) status.textContent = 'Подтвердите подключение в открывшемся окне.';
    } catch (error) {
      popup.close();
      action.disabled = false;
      if (status) status.textContent = emailActionError(error, false);
    }
  });
}

function openTelegram(root, state = null) {
  const resolved = state || { error: 'Загрузка' };
  const layer = mountModal(document.body, modal(telegramXContent(resolved), { variant: 'x', title: 'Telegram', className: 'modal--form-sheet', xRole: 'editor' }));
  if (!layer) return null;
  bindTelegramX(layer, root, resolved);
  if (state) return layer;
  void getTelegramBotConnection().then((next) => { layer.v2Close?.(); openTelegram(root, next); }).catch(() => {});
  return layer;
}

function openEmail(root, state = null) {
  const resolved = state || { error: 'Загрузка' };
  const layer = mountModal(document.body, modal(emailXContent(resolved), { variant: 'x', title: 'Email', className: 'modal--form-sheet', xRole: 'editor' }));
  if (!layer) return null;
  bindEmailX(layer, root, resolved);
  if (state) return layer;
  void getEmailConnection().then((next) => { layer.v2Close?.(); openEmail(root, next); }).catch(() => {});
  return layer;
}

function renderIntegrationCards(root, telegramState = {}, emailState = {}) {
  const host = root.querySelector('[data-integrations-list]');
  if (!host) return;
  host.innerHTML = miniCardRail([
    telegramMiniCard(telegramState, { interactive: true }),
    emailMiniCard(emailState, { interactive: true }),
  ]);
  host.querySelector('[data-integration-open="telegram"]')?.addEventListener('click', () => openTelegram(root, telegramState));
  host.querySelector('[data-integration-open="email"]')?.addEventListener('click', () => openEmail(root, emailState));
}

async function renderIntegrations(root) {
  root.innerHTML = page([workspaceHeaderContext({ title: 'Интеграции' }), '<div data-integrations-list></div>']);
  const host = root.querySelector('[data-integrations-list]');
  if (host) host.innerHTML = emptyState('Загрузка', 'Проверяем интеграции.');
  const [telegramResult, emailResult] = await Promise.allSettled([getTelegramBotConnection(), getEmailConnection()]);
  const telegramState = telegramResult.status === 'fulfilled'
    ? telegramResult.value
    : { error: telegramResult.reason instanceof Error ? telegramResult.reason.message : String(telegramResult.reason || 'Не удалось проверить состояние подключения') };
  const emailState = emailResult.status === 'fulfilled' ? emailResult.value : { error: 'Не удалось проверить состояние подключения' };
  renderIntegrationCards(root, telegramState, emailState);
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

export function render(root) { void renderIntegrations(root); }
export { renderIntegrations };
