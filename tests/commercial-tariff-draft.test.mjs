import assert from 'node:assert/strict';
import { normalizeTariffDraft, tariffOfferOnDate } from '../server/src/saas-admin/tariff-draft-config.ts';

const config = normalizeTariffDraft({
  free: false,
  priceMinor: 100000,
  referencePriceMinor: 150000,
  periods: [
    {months:1,giftDays:0,discountPercent:0,discountMinor:0},
    {months:6,giftDays:180,discountPercent:50,discountMinor:0},
    {months:12,giftDays:360,discountPercent:0,discountMinor:200000},
  ],
  campaign: {
    enabled:true,periodMonths:6,discountType:'percent',discountValue:50,
    giftDays:30,startsOn:'2027-01-01',endsOn:'2027-12-31',
    repeatEveryMonths:3,durationDays:7,
  },
});
const ordinary = tariffOfferOnDate(config, 6, '2027-02-01');
assert.equal(ordinary.subtotalMinor, 600000);
assert.equal(ordinary.totalMinor, 300000);
assert.equal(ordinary.accessDays, 360);
assert.equal(ordinary.bonusDays, 180);
assert.equal(ordinary.campaignActive, false);
const promo = tariffOfferOnDate(config, 6, '2027-04-02');
assert.equal(promo.subtotalMinor, 600000);
assert.equal(promo.totalMinor, 150000);
assert.equal(promo.accessDays, 390);
assert.equal(promo.bonusDays, 210);
assert.equal(promo.campaignActive, true);
assert.equal(tariffOfferOnDate(config, 6, '2027-04-08').campaignActive, false);
assert.equal(tariffOfferOnDate(config, 6, '2028-01-02').campaignActive, false);
assert.equal(tariffOfferOnDate(config, 1, '2027-04-02').totalMinor, 100000);
assert.equal(tariffOfferOnDate(config, 12, '2027-04-02').totalMinor, 1000000);
assert.equal(tariffOfferOnDate(config, 12, '2027-04-02').accessDays, 720);
assert.throws(() => normalizeTariffDraft({...config, periods:[...config.periods.slice(0,2),config.periods[1]]}),
  /Периоды должны быть уникальными/);
assert.throws(() => normalizeTariffDraft({...config,campaign:{...config.campaign,startsOn:'2027-02-30'}}),
  /неверная дата/);
assert.throws(() => normalizeTariffDraft({...config,campaign:{...config.campaign,endsOn:'2026-01-01'}}),
  /Конец акции/);
const service = await import('node:fs/promises');
const source = await service.readFile(new URL('../server/src/saas-admin/commercial-catalog.service.ts',import.meta.url),'utf8');
const order = await service.readFile(new URL('../server/src/saas-admin/commercial-tenant.service.ts',import.meta.url),'utf8');
assert.match(source,/CommercialTariffPublishedTerms/,'published terms are distinct from editable drafts');
const publicOffers=source.slice(source.indexOf('  async tariffOffers()'),source.indexOf('  async updateTariffSettings('));
assert.doesNotMatch(publicOffers,/\.\.\.tier/,'public offers must not expose draft configuration');
assert.match(publicOffers,/key: tier\.key, name: tier\.name/,'public offer explicitly enumerates safe fields');
assert.match(source,/TARIFF_DRAFT_SAVED/,'draft saving is audited');
assert.match(source,/TARIFF_DRAFT_PUBLICATION/,'activation is audited');
assert.match(order,/const totalMinor = 'totalMinor' in period/,'orders use the final published quote');
assert.match(order,/discountMinor, totalMinor,/,'discounted totals are snapshotted');
console.log('Tariff draft validation, date-window offers, discounts and order snapshot: PASS');
