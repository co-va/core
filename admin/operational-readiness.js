// Core owns the target operational coverage catalogue. This is not AdminToolReadiness.
export const COVERAGE_VERSION = 1;
export const MECHANISMS = [
  [
    "workspace",
    "Рабочие пространства",
    "Профиль → рабочие пространства",
    [
      [
        "workspace.profile",
        "Создание, изменение и выбор пространства",
        "start.profile"
      ],
      [
        "workspace.multiple",
        "Работа в нескольких пространствах без смешивания данных"
      ]
    ]
  ],
  [
    "workspace-relations",
    "Условия деятельности",
    "Профиль → рабочее пространство (целевое место)",
    [
      [
        "relations.types",
        "Владение, аренда и найм как отношения участника с пространством"
      ],
      [
        "relations.terms",
        "Стоимость, период, доступ и финансовые последствия"
      ]
    ]
  ],
  [
    "participants",
    "Участники",
    "Место в UI требует согласования",
    [
      [
        "participants.identities",
        "Владелец, ассистент, продавец и исполнитель с единой идентичностью"
      ],
      [
        "participants.attribution",
        "Фиксация фактических участников каждой операции"
      ]
    ]
  ],
  [
    "permissions",
    "Права и полномочия",
    "Место в UI требует согласования",
    [
      [
        "permissions.scope",
        "Полномочия по участнику и пространству"
      ],
      [
        "permissions.enforcement",
        "Серверная проверка доступа и изоляции данных"
      ]
    ]
  ],
  [
    "resources",
    "Ресурсы",
    "Операционный домен → Ресурсы (если самостоятельный процесс)",
    [
      [
        "resources.catalog",
        "Ресурс, количество, состояние и доступность"
      ],
      [
        "resources.conflicts",
        "Блокировка пересечений и занятости ресурсов независимо от исполнителя"
      ]
    ]
  ],
  [
    "time",
    "Время и смены",
    "Журнал → Месяц → График; смены — место требует согласования",
    [
      [
        "time.timeline",
        "Шкала времени и слоты Professional",
        "journal.timeline"
      ],
      [
        "time.schedule",
        "Рабочие дни Professional",
        "journal.graph"
      ],
      [
        "time.shifts",
        "Смены и фактически отработанное время участников независимо от Журнала"
      ]
    ]
  ],
  [
    "contacts",
    "Контакты",
    "Контакты",
    [
      [
        "contacts.prof",
        "Рабочий контур контактов Professional",
        "start.contacts"
      ],
      [
        "contacts.core",
        "Единая идентичность, история и изоляция контактов в Core/User"
      ]
    ]
  ],
  [
    "services",
    "Услуги",
    "Сервис → Услуги",
    [
      [
        "catalog.prof",
        "Каталог услуг и товаров Professional (общий критерий)",
        "start.service"
      ],
      [
        "services.core",
        "Серверное сохранение цены, длительности и условий услуги"
      ],
      [
        "services.execution",
        "Сквозное оказание услуги, завершение и расчёт"
      ]
    ]
  ],
  [
    "service-stages",
    "Этапы исполнения",
    "Сервис → услуга; Журнал → запись (целевые места)",
    [
      [
        "stages.plan",
        "План этапов, длительность, исполнители и ресурсы"
      ],
      [
        "stages.actual",
        "Фактическое исполнение, параллельность и изменение этапов"
      ]
    ]
  ],
  [
    "products",
    "Товары",
    "Сервис → Товары; Склад",
    [
      [
        "catalog.prof",
        "Каталог услуг и товаров Professional (общий критерий)",
        "start.service"
      ],
      [
        "products.identity",
        "Серверная связь товарной и складской единицы без дублей"
      ],
      [
        "products.price",
        "Цена продажи, остаток, единицы и история изменений"
      ]
    ]
  ],
  [
    "sales",
    "Продажи",
    "Продажа из Журнала; самостоятельная E/F Продажи",
    [
      [
        "sales.outside",
        "Продажа вне записи и её оплата Professional",
        "start.sale-outside"
      ],
      [
        "sales.standalone",
        "Рабочий цикл торговли без Журнала, в том числе обезличенная продажа"
      ],
      [
        "sales.settlement",
        "Оплата, возврат, складское движение и участник продажи"
      ]
    ]
  ],
  [
    "records",
    "Журнал и онлайн-запись",
    "Журнал → День / Месяц / Список; Настройки → Онлайн-запись",
    [
      [
        "records.prof",
        "Журнал Professional",
        "start.journal"
      ],
      [
        "records.user",
        "Авторизованный сквозной путь записи User"
      ],
      [
        "records.core",
        "Единый Record/Time: доступность, изменения, история и конфликты"
      ]
    ]
  ],
  [
    "inventory",
    "Склад",
    "Склад → Остатки / Движения / Заказ поставщику / Инвентаризация",
    [
      [
        "inventory.stock",
        "Поступление, расход, продажа, перемещение и остатки"
      ],
      [
        "inventory.count",
        "Инвентаризация и сверка истории"
      ],
      [
        "inventory.supply",
        "Поставщики, закупки и складская стоимость"
      ]
    ]
  ],
  [
    "compensation",
    "Условия оплаты и вознаграждения",
    "Место в UI требует согласования",
    [
      [
        "compensation.rules",
        "Оклад, процент, сдельная и почасовая модели"
      ],
      [
        "compensation.accrual",
        "Начисление по фактическому участию, корректировка и выплата"
      ]
    ]
  ],
  [
    "obligations",
    "Финансовые обязательства",
    "Финансы (точное место требует согласования)",
    [
      [
        "obligations.record",
        "Обязательства по аренде, оплате труда, долгу и срокам"
      ],
      [
        "obligations.settle",
        "Погашение, остаток, просрочка и история"
      ]
    ]
  ],
  [
    "finance",
    "Финансовые операции",
    "Финансы → Касса / ДДС / Z-отчёт",
    [
      [
        "finance.prof",
        "Финансовый контур Professional",
        "start.finance"
      ],
      [
        "finance.core",
        "Единый серверный учёт платежей, возвратов и движений без дублей"
      ],
      [
        "finance.reconcile",
        "Сверка операций и остатков с фактическими продажами и услугами"
      ]
    ]
  ],
  [
    "cost",
    "Себестоимость",
    "Склад / Сервис / Финансы (точное место требует согласования)",
    [
      [
        "cost.materials",
        "Фактический расход материалов и стоимость"
      ],
      [
        "cost.time",
        "Стоимость времени участников и ресурсов"
      ],
      [
        "cost.operation",
        "Себестоимость услуги и товара с сохранением исторического расчёта"
      ]
    ]
  ],
  [
    "configuration",
    "Конфигурация инструментов",
    "Меню / Настройки (точное место требует согласования)",
    [
      [
        "config.visibility",
        "Независимое включение/скрытие инструментов без потери данных"
      ],
      [
        "config.retail",
        "Торговля без Журнала и настройка основного рабочего контура"
      ],
      [
        "config.entitlement",
        "Отдельные права тарифа и коммерческая готовность без подмены покрытия"
      ]
    ]
  ]
];
const SHA = /^[a-f0-9]{40}$/;
const validSha = value => typeof value === 'string' && SHA.test(value);
const matches = (pattern, path) => typeof path === 'string' && (pattern.endsWith('/**') ? path.startsWith(pattern.slice(0,-3) + '/') : pattern === path);
export function closureEvidence(item, comparison, byId) {
  const closure = item?.closure;
  if (!closure || closure.state !== 'locked') return { accepted: false, state: closure?.state === 'verifying' ? 'checking' : 'unknown' };
  const required = [...(item.requires || []), ...[...byId.values()].filter(row=>row.parent===item.id).map(row=>row.id)];
  if (!validSha(closure.baselineSha) || !closure.approvedBy || !closure.approvedAt ||
      !Array.isArray(closure.evidence) || !closure.evidence.length ||
      !Object.keys(item.acceptance || {}).length || Object.values(item.acceptance).some(v=>!v || v==='не проверено') ||
      !Array.isArray(item.paths) || !item.paths.length || required.some(id=>byId.get(id)?.closure?.state!=='locked')) {
    return { accepted: false, state: 'unknown' };
  }
  // Accepted history is independent from a new candidate. No diff is not a pass.
  const base = { accepted: true, baselineSha: closure.baselineSha, approvedAt: closure.approvedAt, evidence: closure.evidence };
  if (required.length || item.external?.length) return {...base,state:'unverified'};
  if (!comparison || !['ahead','identical'].includes(comparison.status) || !Array.isArray(comparison.files) || comparison.files.length>=300) return {...base,state:'unverified'};
  const changed = comparison.files.filter(f=>item.paths.some(p=>matches(p,f.filename)||matches(p,f.previous_filename)));
  return {...base,state:changed.length?'changed':'accepted',changed:changed.map(f=>f.filename)};
}
export function coverageSnapshot(registry, comparisons = {}) {
  if (!Array.isArray(registry?.items) || registry.schemaVersion !== 1 ||
      registry.repository !== 'co-va/professional' || registry.branch !== 'staging') throw Error('Неизвестный формат реестра Professional');
  const byId = new Map(registry.items.map(item=>[item.id,item]));
  if (byId.size !== registry.items.length) throw Error('Дубли ID в реестре Professional');
  const unique = new Map();
  const summarize = rows => {
    const confirmed = rows.filter(row=>row.accepted).length;
    return {confirmed,total:rows.length,percent:rows.length?Math.floor(100*confirmed/rows.length):null,
      changed:rows.filter(row=>row.state==='changed').length,
      unverified:rows.filter(row=>row.state==='unverified').length,
      currentConfirmed:rows.filter(row=>row.state==='accepted').length};
  };
  const mechanisms = MECHANISMS.map(([id,label,location,criteria])=>{
    const rows=criteria.map(([key,title,ref])=>{
      if (!unique.has(key)) {
        const item=byId.get(ref);
        unique.set(key,{key,title,ref,...closureEvidence(item,comparisons[item?.closure?.baselineSha],byId)});
      }
      return unique.get(key);
    });
    return {id,label,location,rows,...summarize(rows)};
  });
  return {mechanisms,...summarize([...unique.values()])};
}
const API = 'https://api.github.com/repos/co-va/professional';
const RAW = 'https://raw.githubusercontent.com/co-va/professional';
async function readJson(url, fetcher) {
  const response=await fetcher(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Источник недоступен ('+response.status+')');
  return response.json();
}
export async function loadOperationalReadiness(fetcher=fetch) {
  const head=await readJson(API+'/git/ref/heads/staging',fetcher);
  const sha=head?.object?.sha;
  if(!validSha(sha)) throw Error('Версия Professional не определена');
  const registry=await readJson(RAW+'/'+sha+'/RELEASE_CLOSURE_REGISTRY.json',fetcher);
  if(!Array.isArray(registry?.items)) throw Error('Реестр Professional не получен');
  const refs=new Set(MECHANISMS.flatMap(m=>m[3].map(c=>c[2]).filter(Boolean)));
  const bases=[...new Set(registry.items.filter(i=>refs.has(i.id)&&i.closure?.state==='locked'&&validSha(i.closure.baselineSha)).map(i=>i.closure.baselineSha))];
  const comparisons=Object.fromEntries(await Promise.all(bases.map(async base=>{
    if(base===sha) return [base,{status:'identical',files:[]}];
    try {return [base,await readJson(API+'/compare/'+base+'...'+sha,fetcher)];}
    catch {return [base,null];}
  })));
  return {sha,...coverageSnapshot(registry,comparisons)};
}

/* #942: exact, narrowly scoped evidence from existing Core CI; never equate a
 * successful sub-scenario with full operational criterion or owner acceptance. */
export const CORE_SCENARIOS = [
  {
    "id": "workspace.capacity",
    "criteria": [
      "workspace.profile",
      "workspace.multiple"
    ],
    "title": "Лимиты пространств DEMO/LIVE, скрытие и добавление",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/demo-workplace-capacity.test.mjs"
  },
  {
    "id": "workspace.booking",
    "criteria": [
      "workspace.multiple",
      "records.core"
    ],
    "title": "Адресная онлайн-запись и изоляция пространств",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/booking-direct-workplace-link.test.mjs"
  },
  {
    "id": "access.history",
    "criteria": [
      "permissions.enforcement",
      "contacts.core"
    ],
    "title": "Проверка доступа к истории по действующему участию",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/history-authorization.test.mjs"
  },
  {
    "id": "access.readiness",
    "criteria": [
      "config.entitlement",
      "permissions.enforcement"
    ],
    "title": "Раздельные права тарифа, режимы и готовность инструментов",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/admin-readiness-policy.test.mjs"
  },
  {
    "id": "contacts.reimport",
    "criteria": [
      "contacts.core",
      "contacts.prof"
    ],
    "title": "Импорт контактов: повторы, различия, UEI, Email и сохранение данных",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "service.history",
    "criteria": [
      "services.core"
    ],
    "title": "Исторические цены услуг и сохранение снимков записи",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "service.public",
    "criteria": [
      "services.core",
      "workspace.multiple"
    ],
    "title": "Условия услуги по пространствам, длительность, публичная видимость",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/procedure-booking-contract.test.mjs"
  },
  {
    "id": "record.server",
    "criteria": [
      "records.core"
    ],
    "title": "Серверный контракт записи, доступности и расчёта",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/booking-server-autonomy.test.mjs"
  },
  {
    "id": "record.delete",
    "criteria": [
      "records.core"
    ],
    "title": "История удаления записи с исходными данными и автором",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/record-deletion-audit.test.mjs"
  },
  {
    "id": "record.import",
    "criteria": [
      "records.core"
    ],
    "title": "Импорт записей: несколько услуг, история, повтор без дублей",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "inventory.units",
    "criteria": [
      "inventory.stock",
      "products.price"
    ],
    "title": "Единицы расхода и продажи целой упаковки",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/inventory-package-units.test.mjs"
  },
  {
    "id": "inventory.resource",
    "criteria": [
      "inventory.stock",
      "cost.materials"
    ],
    "title": "Контракт складской карточки, конверсия единиц и перемещение",
    "job": "check",
    "step": "Domain regression tests",
    "command": "npm test",
    "test": "tests/inventory-universal-card.test.mjs"
  },
  {
    "id": "inventory.order",
    "criteria": [
      "inventory.stock"
    ],
    "title": "Порядок позиций склада и ограничения PostgreSQL",
    "job": "staging-smoke",
    "step": "Verify inventory rank invariants with real PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-inventory-positions.mjs"
  },
  {
    "id": "inventory.supplier",
    "criteria": [
      "inventory.supply",
      "products.price"
    ],
    "title": "Импорт прайса поставщика, обновление цен и изоляция",
    "job": "check",
    "step": "Verify supplier pricelist import runtime",
    "command": "node tests/inventory-counterparty-runtime.test.mjs"
  },
  {
    "id": "finance.import",
    "criteria": [
      "finance.core",
      "finance.reconcile"
    ],
    "title": "Импорт ДДС: кошельки, возврат, отмена и повтор без дублей",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "finance.record",
    "criteria": [
      "finance.core",
      "finance.reconcile",
      "services.execution"
    ],
    "title": "Историческая оплата, связь платежа с записью и единственный расчёт",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "finance.deposit",
    "criteria": [
      "finance.core",
      "finance.reconcile"
    ],
    "title": "Депозит: внесение, списание, срок действия, коррекция и повторный импорт",
    "job": "staging-smoke",
    "step": "Verify canonical Deposit Excel import with real PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-deposit-excel.mjs"
  },
  {
    "id": "materials.link",
    "criteria": [
      "cost.materials",
      "inventory.stock"
    ],
    "title": "Привязка исторического расхода к записи и услуге",
    "job": "staging-smoke",
    "step": "Verify canonical data transfer with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-data-transfer.mjs"
  },
  {
    "id": "history.isolation",
    "criteria": [
      "permissions.enforcement",
      "contacts.core"
    ],
    "title": "Изоляция истории, атомарное удаление и откат",
    "job": "staging-smoke",
    "step": "Verify owner-scoped History with PostgreSQL",
    "command": "docker compose -f docker-compose.staging.yml exec -T backend node scripts/check-history.mjs"
  }
];
const CORE_API = 'https://api.github.com/repos/co-va/core';
const CORE_RAW = 'https://raw.githubusercontent.com/co-va/core';
export function coreAuditSnapshot(sha, run, jobs, pkg, workflow) {
  if (!validSha(sha) || run?.head_sha !== sha || run.path !== '.github/workflows/check.yml'
      || !Array.isArray(jobs) || typeof workflow !== 'string') throw Error('Нет доказательств для данной версии Core');
  const lines=workflow.split(/\r?\n/);
  const tests=new Set(String(pkg?.scripts?.test||'').split(' && ').map(s=>s.trim()));
  const scenarios=CORE_SCENARIOS.map(s=>{
    const workflowMatches=lines.some((line,i)=>line.trim()==='- name: '+s.step && lines[i+1]?.trim()==='run: '+s.command);
    const registered=workflowMatches && (!s.test || tests.has('node '+s.test));
    const job=jobs.filter(j=>j.name===s.job && j.head_sha===sha).sort((a,b)=>b.id-a.id)[0];
    const step=job?.steps?.find(x=>x.name===s.step);
    const state=!registered?'unknown':step?.conclusion==='failure'?'failed':
      job?.conclusion==='success' && step?.conclusion==='success'?'passed':'unknown';
    return {...s,state,url:job?.html_url || 'https://github.com/co-va/core/actions/runs/'+run.id};
  });
  return {sha,runId:run.id,scenarios,passed:scenarios.filter(s=>s.state==='passed').length,total:scenarios.length,
    failed:scenarios.filter(s=>s.state==='failed').length};
}
async function readCoreText(url, fetcher) {
  const response=await fetcher(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Источник недоступен ('+response.status+')');
  return response.text();
}
export async function loadCoreAudit(fetcher=fetch) {
  const head=await readJson(CORE_API+'/git/ref/heads/main',fetcher);
  const sha=head?.object?.sha;
  if(!validSha(sha)) throw Error('Версия Core не определена');
  const checks=await readJson(CORE_API+'/commits/'+sha+'/check-runs?per_page=100',fetcher);
  const check=(checks.check_runs||[]).filter(c=>c.name==='check' && c.head_sha===sha && c.app?.slug==='github-actions')
    .sort((a,b)=>b.id-a.id)[0];
  const match=/^https:\/\/github\.com\/co-va\/core\/actions\/runs\/(\d+)\/job\/\d+$/.exec(check?.details_url||'');
  if(!match) throw Error('Проверки Core не найдены');
  const base=CORE_API+'/actions/runs/'+match[1];
  const [run,jobs,pkg,workflow]=await Promise.all([
    readJson(base,fetcher),readJson(base+'/jobs?per_page=100',fetcher),
    readJson(CORE_RAW+'/'+sha+'/package.json',fetcher),readCoreText(CORE_RAW+'/'+sha+'/.github/workflows/check.yml',fetcher)
  ]);
  return coreAuditSnapshot(sha,run,jobs.jobs,pkg,workflow);
}
const auditFor = (audit,keys) => (audit?.scenarios||[]).filter(s=>s.criteria.some(k=>keys.includes(k)));

const stateLabel = {accepted:'Принято',changed:'Изменено · нужна проверка',unverified:'Актуальность не подтверждена',checking:'В проверке',unknown:'Не подтверждено'};
export function readinessMarkup(snapshot, escapeHtml, selected='', coreAudit=null) {
  const e=escapeHtml;
  const coreSummary=coreAudit ? '<div class="admin-overview-chart-summary"><strong>'+coreAudit.passed+' / '+coreAudit.total+'</strong><span>Подключённые сценарии Core: автоматические проверки пройдены</span></div><p class="admin-overview-empty">Core/main: '+e(coreAudit.sha.slice(0,12))+' · ошибок проверки: '+coreAudit.failed+' · <a href="https://github.com/co-va/core/actions/runs/'+Number(coreAudit.runId)+'" target="_blank" rel="noopener noreferrer">Результаты CI</a>. Это проверенные части критериев, не готовность всей платформы.</p>' : '<p class="admin-overview-empty">Автопроверки Core: данные не получены.</p>';
  const summary=snapshot ? '<div class="admin-overview-chart-summary"><strong>'+snapshot.confirmed+' / '+snapshot.total+'</strong><span>Полная приёмка критериев ('+snapshot.percent+'%)</span></div><p class="admin-overview-empty">Professional/staging: '+e(snapshot.sha.slice(0,12))+' · актуальность подтверждена: '+snapshot.currentConfirmed+' · изменено: '+snapshot.changed+' · актуальность не проверена: '+snapshot.unverified+'. Не является процентом готовности действующего релиза.</p>' : '<p class="admin-overview-empty">Данные технического реестра недоступны. Проценты не определены.</p>';
  const rows=(snapshot?.mechanisms || MECHANISMS.map(([id,label,location,criteria])=>({id,label,location,rows:criteria.map(([key,title,ref])=>({key,title,ref,state:'unknown'})),percent:null}))).map((m,i)=>{
    const open=selected===m.id;
    const checks=auditFor(coreAudit,m.rows.map(c=>c.key));
    const count=checks.filter(s=>s.state==='passed').length;
    const checked=checks.length?' · '+count+'/'+checks.length+' автопроверок':'';
    return '<button type="button" class="admin-overview-person" data-operational-mechanism="'+e(m.id)+'" aria-expanded="'+open+'"><span><strong>'+String(i+1).padStart(2,'0')+' · '+e(m.label)+'</strong></span><span class="admin-overview-person-status">'+(m.percent===null?'—':m.confirmed+'/'+m.total+' принято')+checked+' '+(open?'−':'+')+'</span></button>'+
      (open?'<div class="admin-overview-detail"><div class="admin-overview-detail-heading"><strong>'+e(m.location)+'</strong></div><div class="admin-overview-detail-list">'+m.rows.map(c=>'<div class="admin-overview-person"><span><strong>'+e(c.title)+'</strong><small>'+e(stateLabel[c.state])+(c.baselineSha?' · '+e(c.baselineSha.slice(0,12)):'')+'</small>'+(c.ref?'<small><a href="https://github.com/co-va/professional/blob/'+(snapshot?.sha||'staging')+'/RELEASE_CLOSURE_REGISTRY.json" target="_blank" rel="noopener noreferrer">'+e(c.ref)+'</a></small>':'')+(c.approvedAt?'<small>Приёмка: '+e(c.approvedAt)+'</small>':'')+(c.changed?.length?'<small>'+e(c.changed.join(', '))+'</small>':'')+auditFor(coreAudit,[c.key]).map(s=>'<small><a href="'+e(s.url)+'" target="_blank" rel="noopener noreferrer">'+e(s.title)+'</a> · '+(s.state==='passed'?'PASS':s.state==='failed'?'FAIL':'Не подтверждено')+'</small>').join('')+'</span></div>').join('')+'</div></div>':'');
  }).join('');
  return '<div class="admin-overview"><div class="admin-heading"><h2>Операционная готовность</h2></div><section class="admin-overview-panel"><div class="admin-overview-panel-head"><h3>Услуги и продажи</h3><div class="admin-overview-period"><button type="button" data-operational-back>Обзор</button><button type="button" data-operational-refresh>Обновить</button></div></div>'+coreSummary+summary+'<p class="admin-overview-empty">Карта '+COVERAGE_VERSION+' · 18 механизмов. Автопроверки Core показывают частичные доказательства. User и сквозные сценарии без доказательств пока не подтверждены. Процент не управляет доступом к инструментам.</p><div class="admin-overview-detail-list">'+rows+'</div></section></div>';
}
export function renderOperationalReadiness(content, {escapeHtml,isCurrent,onBack,load=loadOperationalReadiness,loadCore=loadCoreAudit}) {
  if (!content) return;
  let selected='', snapshot=null, coreAudit=null, request=0;
  const render=()=>{
    if(!isCurrent()) return;
    content.innerHTML=readinessMarkup(snapshot,escapeHtml,selected,coreAudit);
    content.querySelector('[data-operational-refresh]')?.addEventListener('click',refresh);
    content.querySelector('[data-operational-back]')?.addEventListener('click',()=>onBack?.());
    content.querySelectorAll('[data-operational-mechanism]').forEach(button=>button.addEventListener('click',()=>{
      selected=selected===button.dataset.operationalMechanism?'':button.dataset.operationalMechanism;
      render();
    }));
  };
  async function refresh(){
    const id=++request;
    snapshot=null; coreAudit=null; render();
    const control=content.querySelector('[data-operational-refresh]');
    if(control) {control.disabled=true;control.textContent='Загрузка…';}
    const [professional,core]=await Promise.allSettled([load(),loadCore()]);
    if(id===request&&isCurrent()) {
      if(professional.status==='fulfilled') snapshot=professional.value;
      if(core.status==='fulfilled') coreAudit=core.value;
    }
    if(id===request&&isCurrent()) render();
  }
  render(); void refresh();
}
