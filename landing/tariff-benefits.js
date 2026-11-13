// Customer-facing explanations, derived only from tools actually included in the Core tariff.
 // Shared by the public website and Admin: no parallel catalog or hand-entered promises.
const BENEFITS = [
  { keys: ['system.profile', 'ui.cabinet.profile', 'ui.cabinet.profile.data'], title: 'Ваш профессиональный профиль', detail: 'Рабочая информация в одном месте.' },
  { keys: ['system.workplace', 'ui.cabinet.profile.workspaces'], title: 'Рабочее пространство', detail: 'Организуйте работу в собственном пространстве.' },
  { keys: ['capacity.workplace.extra'], title: 'Дополнительные рабочие пространства', detail: 'Работайте с несколькими пространствами.' },
  { keys: ['ui.cabinet.settings.data-transfer'], title: 'Перенос данных', detail: 'Переносите информацию без повторного ручного ввода.' },
  { keys: ['ui.cabinet.service.products'], title: 'Товары в прайсе', detail: 'Учитывайте товары рядом с услугами.' },
  { keys: ['tool.online-booking', 'ui.cabinet.settings.online-booking'], title: 'Самостоятельная онлайн-запись', detail: 'Люди выбирают удобное время без переписки.' },
  { keys: ['tool.journal', 'ui.cabinet.journal', 'ui.cabinet.journal.day', 'ui.cabinet.journal.month', 'ui.cabinet.journal.list'], title: 'Записи и расписание', detail: 'Рабочий день, встречи и изменения собраны в одном месте.' },
  { keys: ['tool.timetable', 'ui.cabinet.timetable'], title: 'Рабочий график', detail: 'Планируйте дни и время работы.' },
  { keys: ['tool.people', 'ui.cabinet.people'], title: 'Контакты под рукой', detail: 'Нужная информация о людях не теряется.' },
  { keys: ['tool.services', 'ui.cabinet.service', 'ui.cabinet.service.procedures'], title: 'Услуги и цены', detail: 'Прайс доступен в одном месте.' },
  { keys: ['tool.documents', 'ui.cabinet.settings.documents'], title: 'Документы и согласия', detail: 'Меньше бумажной рутины.' },
  { keys: ['tool.notifications', 'ui.cabinet.settings.notifications'], title: 'Уведомления', detail: 'Получайте сообщения о событиях в приложении.' },
  { keys: ['tool.tags', 'ui.cabinet.settings.tags'], title: 'Порядок в контактах', detail: 'Группируйте людей с помощью ярлыков.' },
  { keys: ['tool.loyalty.deposit', 'ui.cabinet.loyalty.deposit'], title: 'Депозиты', detail: 'Следите за внесёнными средствами и остатками.' },
  { keys: ['tool.loyalty.personal-account', 'ui.cabinet.loyalty.personal-account'], title: 'Личные счета', detail: 'Учитывайте средства каждого человека.' },
  { keys: ['tool.loyalty.certificate', 'ui.cabinet.loyalty.certificate'], title: 'Сертификаты', detail: 'Ведите подарочные сертификаты.' },
  { keys: ['tool.loyalty.subscription', 'ui.cabinet.loyalty.subscription'], title: 'Абонементы', detail: 'Контролируйте оплаченные посещения.' },
  { keys: ['tool.loyalty.referral', 'ui.cabinet.loyalty.referral'], title: 'Рекомендации', detail: 'Работайте с реферальной программой.' },
  { keys: ['tool.loyalty.bonus', 'ui.cabinet.loyalty.bonus'], title: 'Бонусная программа', detail: 'Управляйте бонусами для постоянных посетителей.' },
  { keys: ['tool.finance.cash', 'ui.cabinet.finance.cash', 'ui.cabinet.finance.cash.wallets'], title: 'Деньги под контролем', detail: 'Ведите кассу и движения по кошелькам.' },
  { keys: ['tool.finance.dds', 'ui.cabinet.finance.dds'], title: 'Доходы и расходы', detail: 'Смотрите движение денег по статьям.' },
  { keys: ['tool.finance.investment', 'ui.cabinet.finance.cash.investments'], title: 'Займы и инвестиции', detail: 'Учитывайте связанные финансовые операции.' },
  { keys: ['tool.finance.z-report', 'ui.cabinet.finance.z-report'], title: 'Итоги работы', detail: 'Сводите финансовые результаты в отчёте.' },
  { keys: ['tool.inventory', 'ui.cabinet.inventory.stock', 'ui.cabinet.inventory'], title: 'Остатки материалов', detail: 'Знайте, что есть в наличии и сколько осталось.' },
  { keys: ['ui.cabinet.inventory.movements'], title: 'Движение материалов', detail: 'Учитывайте поступление и расход.' },
  { keys: ['ui.cabinet.inventory.order'], title: 'Заказ материалов', detail: 'Планируйте пополнение запасов.' },
  { keys: ['ui.cabinet.inventory.stocktake'], title: 'Инвентаризация', detail: 'Сверяйте фактические и учётные остатки.' },
  { keys: ['tool.integrations', 'ui.cabinet.settings.integrations'], title: 'Подключения', detail: 'Работайте с доступными интеграциями.' },
];

const TARIFF_HEADLINES = {
  'tariff.start': 'Начните бесплатно — без ограничения срока',
  'tariff.start-plus': 'Больше возможностей для ежедневной работы',
  'tariff.pro': 'Управляйте процессами в одном месте',
};

export function tariffHeadline(key) {
  return TARIFF_HEADLINES[key] || '';
}

export function tariffBenefits(tier) {
  const keys = new Set((Array.isArray(tier?.tools) ? tier.tools : []).map((tool) => String(tool?.key || '')));
  return BENEFITS.filter((benefit) => benefit.keys.some((key) => keys.has(key)))
    .map(({ title, detail }) => ({ title, detail }));
}

export function tariffNewBenefits(tier, previous) {
  const earlier = new Set(tariffBenefits(previous).map((item) => item.title));
  return tariffBenefits(tier).filter((item) => !earlier.has(item.title));
}
