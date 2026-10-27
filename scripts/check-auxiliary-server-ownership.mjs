import fs from 'node:fs';

function text(path) { return fs.readFileSync(path, 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const core = text('core.js');
const runtime = text('core/runtime/auxiliary-state.js');
const persistence = text('core/business-persistence.js');
const finance = text('core/finance/data.js');
const wallets = text('core/finance/cash/data.js');
const cashEntities = text('core/finance/cash/entities.js');
const auxiliaryService = text('server/src/auxiliary-state/auxiliary-state.service.ts');
const auxiliaryController = text('server/src/auxiliary-state/auxiliary-state.controller.ts');
const tags = text('settings/tags/data.js');
const products = text('core/service/products/data.js');
const schema = text('server/prisma/schema.prisma');
const moduleFile = text('server/src/auxiliary-state/auxiliary-state.module.ts');

assert(core.includes('loadAuxiliaryState'), 'Core must load server-owned Finance and auxiliary state before workspace render.');
assert(runtime.includes("'/auxiliary-state'")
  && runtime.includes('`/auxiliary-state/${encodeURIComponent(key)}`')
  && runtime.includes('apiRequest(path)'), 'Auxiliary runtime must read the canonical auxiliary server owner, including scoped reads.');
assert(auxiliaryController.includes("@Controller('auxiliary-state')") && auxiliaryController.includes("@Get(':scope')"), 'Scoped auxiliary reads must remain inside the canonical auxiliary server owner.');
assert(!/localStorage|readLegacy|\/migrate/.test(runtime), 'Auxiliary runtime must not contain transition paths.');
assert(runtime.includes("apiRequest('/finance')") && runtime.includes('hydrateFinanceFromServer'), 'Finance startup must hydrate the dedicated canonical Finance owner.');
assert(runtime.includes('hydrateWalletsFromServer') && runtime.includes('hydrateCashEntitiesFromServer') && runtime.includes('hydrateTagsFromServer') && runtime.includes('hydrateProductsFromServer'), 'Auxiliary startup must hydrate Wallets, cash entities, Tags and Products from the auxiliary owner.');
assert(persistence.includes("/auxiliary-state/${encodeURIComponent(key)}"), 'Auxiliary writes must target the dedicated server owner.');
assert(finance.includes('hydrateFinanceFromServer') && !finance.includes('queueAuxiliaryDataset'), 'Finance browser state must be a server-hydrated read cache, not an auxiliary writer.');
assert(wallets.includes('hydrateWalletsFromServer') && wallets.includes("queueAuxiliaryDataset('wallets'"), 'Wallets must use server-hydrated runtime state and server writes.');
assert(cashEntities.includes('hydrateCashEntitiesFromServer')
  && cashEntities.includes("queueAuxiliaryDataset('investments'")
  && cashEntities.includes("queueAuxiliaryDataset('loans'"), 'Investment and loan entities must use server-hydrated auxiliary state and server writes.');
assert(auxiliaryService.includes("'investments'") && auxiliaryService.includes("'loans'"), 'Auxiliary server owner must accept investment and loan entity datasets.');
assert(auxiliaryService.includes("'cardAppearanceTemplates'") && runtime.includes('hydrateCardAppearanceTemplates') && runtime.includes('cardAppearanceTemplates'), 'Centralized card appearance templates must be server-owned auxiliary data and hydrate before UI rendering.');
assert(tags.includes('hydrateTagsFromServer') && tags.includes("queueAuxiliaryDataset('tags'"), 'Tags must use server-hydrated runtime state and server writes.');
assert(products.includes('hydrateProductsFromServer') && products.includes("queueAuxiliaryDataset('products'") && products.includes("queueAuxiliaryDataset('productHistory'"), 'Products and product history must use server-hydrated runtime state and server writes.');
assert(schema.includes('model BusinessAuxiliaryState'), 'Server must own a dedicated auxiliary business state.');
assert(!/migrationVerifiedAt|verifyMigration|\bmigrate\(|bootstrap/.test(auxiliaryService), 'Auxiliary server owner must not contain a runtime transition bridge.');
assert(schema.includes('model FinanceOperation') && schema.includes('model FinanceLedgerEntry'), 'Finance money persistence must be outside BusinessAuxiliaryState.');
assert(/imports:\s*\[[^\]]*AuthModule[^\]]*\]/s.test(moduleFile), 'AuxiliaryStateModule must provide JwtService to JwtAuthGuard through AuthModule.');
assert(/imports:\s*\[[^\]]*SaasAccessModule[^\]]*\]/s.test(moduleFile), 'AuxiliaryStateModule must use the canonical SaaS capability owner for investment role access.');
console.log('auxiliary server ownership check: OK');
