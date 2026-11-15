import { BadRequestException } from '@nestjs/common';

// Admin editor configuration is a DRAFT. It is not an order or a grant of access.
export type TariffDraftPeriod = {
  months: 1 | 6 | 12;
  giftDays: number;
  discountPercent: number;
  discountMinor: number;
};
export type TariffDraftCampaign = {
  enabled: boolean;
  periodMonths: 1 | 6 | 12;
  discountType: 'percent' | 'rub';
  discountValue: number;
  giftDays: number;
  startsOn: string;
  endsOn: string;
  repeatEveryMonths: number;
  durationDays: number;
};
export type TariffDraftConfig = {
  free: boolean;
  priceMinor: number;
  referencePriceMinor: number;
  periods: TariffDraftPeriod[];
  campaign: TariffDraftCampaign;
};

const MONTHS = [1, 6, 12] as const;
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(label + ': неверный объект');
  }
  return value as Record<string, unknown>;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(label + ': требуется логическое значение');
  return value;
}
function int(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new BadRequestException(label + ': некорректное число');
  }
  return value;
}
function date(value: unknown, label: string): string {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) ||
    Number.isNaN(Date.parse(value + 'T12:00:00Z')) ||
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(label + ': неверная дата');
  }
  return value;
}
function periodMonth(value: unknown): 1 | 6 | 12 {
  if (value === 1 || value === 6 || value === 12) return value;
  throw new BadRequestException('Период должен быть 1, 6 или 12 месяцев');
}
export function normalizeTariffDraft(value: unknown): TariffDraftConfig {
  const obj = object(value, 'Тариф');
  const free = bool(obj.free, 'Тип тарифа');
  const priceMinor = int(obj.priceMinor, 'Цена продажи', 100_000_000);
  const referencePriceMinor = int(obj.referencePriceMinor, 'Цена до скидки', 100_000_000);
  if (!free && priceMinor === 0) {
    // An unpriced paid tier may be edited, but is never eligible for publication.
  }
  if (!Array.isArray(obj.periods) || obj.periods.length !== MONTHS.length) {
    throw new BadRequestException('Нужны условия для 1, 6 и 12 месяцев');
  }
  const periods: TariffDraftPeriod[] = obj.periods.map((raw) => {
    const row = object(raw, 'Условия периода');
    return {
      months: periodMonth(row.months),
      giftDays: int(row.giftDays, 'Подарочные дни', 3650),
      discountPercent: int(row.discountPercent, 'Процент скидки', 100),
      discountMinor: int(row.discountMinor, 'Скидка в рублях', 100_000_000),
    };
  });
  if (new Set(periods.map((p) => p.months)).size !== 3) {
    throw new BadRequestException('Периоды должны быть уникальными');
  }
  periods.sort((a, b) => a.months - b.months);
  const campaignRaw = object(obj.campaign, 'Акция');
  const enabled = bool(campaignRaw.enabled, 'Акция');
  const discountType = campaignRaw.discountType;
  if (discountType !== 'percent' && discountType !== 'rub') {
    throw new BadRequestException('Вид скидки акции должен быть процентами или рублями');
  }
  const startsOn = date(campaignRaw.startsOn, 'Начало акции');
  const endsOn = date(campaignRaw.endsOn, 'Окончание акции');
  if (enabled && !startsOn) throw new BadRequestException('Для включённой акции требуется дата начала');
  if (startsOn && endsOn && endsOn < startsOn) {
    throw new BadRequestException('Конец акции не может быть раньше начала');
  }
  const repeatEveryMonths = int(campaignRaw.repeatEveryMonths, 'Повтор акции', 120);
  const durationDays = int(campaignRaw.durationDays, 'Длительность акции', 366);
  if (durationDays < 1) throw new BadRequestException('Акция должна длиться не менее дня');
  const discountValue = int(campaignRaw.discountValue, 'Скидка акции',
    discountType === 'percent' ? 100 : 100_000_000);
  return {
    free, priceMinor, referencePriceMinor, periods,
    campaign: {
      enabled,
      periodMonths: periodMonth(campaignRaw.periodMonths),
      discountType,
      discountValue,
      giftDays: int(campaignRaw.giftDays, 'Подарочные дни акции', 3650),
      startsOn, endsOn, repeatEveryMonths, durationDays,
    },
  };
}
