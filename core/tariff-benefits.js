// Customer-facing explanations, derived only from tools actually included in the Core tariff.
 // Shared by the public website and Admin: no parallel catalog or hand-entered promises.
const BENEFITS = [
  { keys: ['tool.online-booking'], title: 'Самостоятельная онлайн-запись', detail: 'Люди выбирают удобное время без переписки.' },
  { keys: ['tool.journal'], title: 'Записи и расписание', detail: 'Рабочий день, встречи и изменения собраны в одном месте.' },
  { keys: ['tool.timetable'], title: 'Рабочий график', detail: 'Планируйте дни и время работы.' },
  { keys: ['tool.people'], title: 'Контакты под рукой', detail: 'Нужная информация о людях не теряется.' },
  { keys: ['tool.services'], title: 'Услуги и цены', detail: 'Прайс доступен в одном месте.' },
  { keys: ['tool.documents'], title: 'Документы и согласия', detail: 'Меньше бумажной рутины.' },
  { keys: ['tool.notifications'], title: 'Уведомления', detail: 'Получайте сообщения о событиях в приложении.' },
  { keys: ['tool.tags'], title: 'Порядок в контактах', detail: 'Группируйте людей с помощью ярлыков.' },
  { keys: ['tool.loyalty.deposit'], title: 'Депозиты', detail: 'Следите за внесёнными средствами и остатками.' },
  { keys: ['tool.loyalty.personal-account'], title: 'Личные счета', detail: 'Учитывайте средства каждого человека.' },
  { keys: ['tool.loyalty.certificate'], title: 'Сертификаты', detail: 'Ведите подарочные сертификаты.' },
  { keys: ['tool.loyalty.subscription'], title: 'Абонементы', detail: 'Контролируйте оплаченные посещения.' },
  { keys: ['tool.loyalty.referral'], title: 'Рекомендации', detail: 'Работайте с реферальной программой.' },
  { keys: ['tool.loyalty.bonus'], title: 'Бонусная программа', detail: 'Управляйте бонусами для постоянных посетителей.' },
  { keys: ['tool.finance.cash'], title: 'Деньги под контролем', detail: 'Ведите кассу и движения по кошелькам.' },
  { keys: ['tool.finance.dds'], title: 'Доходы и расходы', detail: 'Смотрите движение денег по статьям.' },
  { keys: ['tool.finance.investment'], title: 'Займы и инвестиции', detail: 'Учитывайте связанные финансовые операции.' },
  { keys: ['tool.finance.z-report'], title: 'Итоги работы', detail: 'Сводите финансовые результаты в отчёте.' },
  { keys: ['tool.inventory'], title: 'Остатки материалов', detail: 'Знайте, что есть в наличии и сколько осталось.' },
  { keys: ['tool.integrations'], title: 'Подключения', detail: 'Работайте с доступными интеграциями.' },
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
