// Read-only operational finance view on top of the existing CommercialOrder
// and CommercialPayment records. Does not invent bank settlement or a wallet.
const STATUS = {
  PENDING: 'Ожидает оплаты',
  PAID: 'Оплачено',
  ZERO: 'Без оплаты',
  DRAFT: 'Черновик',
  CANCELLED: 'Отменено',
  CANCELED: 'Отменено',
  REFUNDED: 'Возврат',
};
const TARIFFS = {
  'tariff.start': 'Start',
  'tariff.start-plus': 'Start+',
  'tariff.pro': 'Pro',
  'tariff.records.start': 'Start · User',
  'tariff.records.start-plus': 'Start+ · User',
  'tariff.records.pro': 'Pro · User',
};
const date = (value) => value
  ? new Intl.DateTimeFormat('ru-RU', {day:'2-digit',month:'2-digit',year:'2-digit'}).format(new Date(value))
  : '—';
const price = (amount, currency = 'RUB') =>
  new Intl.NumberFormat('ru-RU', {
    style:'currency',currency,maximumFractionDigits:2,
  }).format(Number(amount || 0) / 100);

export function renderCommercialFinance(content, data, {
  escapeHtml, tenantName, onTenant,
} = {}) {
  if (!content || !data || !escapeHtml) return;
  const safe = (value) => escapeHtml(String(value ?? ''));
  const summary = data.summary || {};
  const setup = data.paymentSetup || {};
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const tenant = (id) => safe(tenantName?.(id) || id);
  const status = (value) => safe(STATUS[value] || value || '—');
  content.innerHTML = `
    <div class="admin-finance">
      <div class="admin-heading"><h2>Финансы</h2></div>
      <div class="admin-finance-metrics">
        <section class="admin-stat"><span>Счета к оплате</span>
          <strong>${price(summary.pendingMinor)}</strong>
          <span>${Number(summary.pendingOrders || 0)} счетов</span>
        </section>
        <section class="admin-stat"><span>Платежи, подтверждённые в Core</span>
          <strong>${price(summary.confirmedMinor)}</strong>
          <span>${Number(summary.confirmedPayments || 0)} платежей</span>
        </section>
        <section class="admin-stat"><span>Не распределены по счёту / кошельку</span>
          <strong>${Number(summary.paymentsWithoutWallet || 0)}</strong>
          <span>Из подтверждённых платежей</span>
        </section>
      </div>
      <section class="admin-card admin-finance-info">
        <h3>Приём денег</h3>
        <div class="admin-finance-status-grid">
          <div><span>Ссылка для оплаты</span><strong>${setup.paymentUrlConfigured ? 'Настроена' : 'Не настроена'}</strong></div>
          <div><span>Реквизиты и инструкция</span><strong>${setup.instructionsConfigured ? 'Настроены' : 'Не настроены'}</strong></div>
          <div><span>Сверка с банком</span><strong>Не подключена</strong></div>
        </div>
        <p>Платёж перечисляется по указанным реквизитам или ссылке — не во внутренний кошелёк платформы. Статус «Оплачено» означает подтверждение в Core, а не доказательство поступления по банковской выписке.</p>
      </section>
      <section class="admin-card admin-finance-ledger">
        <h3>Счета <span>${orders.length ? '(последние ' + orders.length + ')' : ''}</span></h3>
        <div class="admin-finance-table-scroll">
          <table class="admin-table admin-finance-table">
            <thead><tr><th>Дата</th><th>Пользователь</th><th>Тариф</th><th>Сумма</th><th>Статус</th><th>Чек</th></tr></thead>
            <tbody>
              ${orders.length ? orders.map((order) => `
                <tr>
                  <td>${date(order.createdAt)}</td>
                  <td><button type="button" class="admin-finance-tenant" data-finance-tenant="${safe(order.tenantId)}">${tenant(order.tenantId)}</button></td>
                  <td>${safe(TARIFFS[order.tariffKey] || (order.tariffKey ? order.tariffKey : 'Прежний счёт'))}
                    ${order.periodMonths ? `<small>${Number(order.periodMonths)} мес. · ${Number(order.accessDays || 0)} дней</small>` : ''}
                  </td>
                  <td class="admin-finance-amount">${price(order.totalMinor,order.currency)}</td>
                  <td>${status(order.status)}</td>
                  <td>${order.receiptUrl && /^https:\/\//i.test(order.receiptUrl)
                    ? `<a href="${safe(order.receiptUrl)}" target="_blank" rel="noopener noreferrer">Чек</a>` : '—'}</td>
                </tr>`).join('') : '<tr><td colspan="6">Пока нет счетов</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
      <section class="admin-card admin-finance-ledger">
        <h3>Платежи <span>${payments.length ? '(последние ' + payments.length + ')' : ''}</span></h3>
        <div class="admin-finance-table-scroll">
          <table class="admin-table admin-finance-table">
            <thead><tr><th>Дата</th><th>Пользователь</th><th>Сумма</th><th>Источник</th><th>Куда зачислено</th><th>Статус</th></tr></thead>
            <tbody>${payments.length ? payments.map((payment) => `
              <tr>
                <td>${date(payment.occurredAt)}</td>
                <td><button type="button" class="admin-finance-tenant" data-finance-tenant="${safe(payment.tenantId)}">${tenant(payment.tenantId)}</button></td>
                <td class="admin-finance-amount">${price(payment.amountMinor,payment.currency)}</td>
                <td>${payment.provider === 'MANUAL' ? 'Ручное подтверждение' : safe(payment.provider)}</td>
                <td>${payment.walletKey ? safe(payment.walletKey) : 'Не назначено'}</td>
                <td>${payment.status === 'SUCCEEDED' ? 'Подтверждено в Core' : status(payment.status)}</td>
              </tr>`).join('') : '<tr><td colspan="6">Платежей пока нет</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
  content.querySelectorAll('[data-finance-tenant]').forEach((button) => {
    button.addEventListener('click', () => onTenant?.(button.dataset.financeTenant));
  });
}
