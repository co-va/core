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
const stateLabel = {accepted:'Принято',changed:'Изменено · нужна проверка',unverified:'Актуальность не подтверждена',checking:'В проверке',unknown:'Не подтверждено'};
export function readinessMarkup(snapshot, escapeHtml, selected='') {
  const e=escapeHtml;
  const summary=snapshot ? '<div class="admin-overview-chart-summary"><strong>'+snapshot.percent+'%</strong><span>'+snapshot.confirmed+' / '+snapshot.total+' критериев имеют доказательства приёмки</span></div><p class="admin-overview-empty">Professional/staging: '+e(snapshot.sha.slice(0,12))+' · актуальность подтверждена: '+snapshot.currentConfirmed+' · изменено: '+snapshot.changed+' · актуальность не проверена: '+snapshot.unverified+'. Не является процентом готовности действующего релиза.</p>' : '<p class="admin-overview-empty">Данные технического реестра недоступны. Проценты не определены.</p>';
  const rows=(snapshot?.mechanisms || MECHANISMS.map(([id,label,location,criteria])=>({id,label,location,rows:criteria.map(([key,title,ref])=>({key,title,ref,state:'unknown'})),percent:null}))).map((m,i)=>{
    const open=selected===m.id;
    return '<button type="button" class="admin-overview-person" data-operational-mechanism="'+e(m.id)+'" aria-expanded="'+open+'"><span><strong>'+String(i+1).padStart(2,'0')+' · '+e(m.label)+'</strong></span><span class="admin-overview-person-status">'+(m.percent===null?'—':m.percent+'%')+' '+(open?'−':'+')+'</span></button>'+
      (open?'<div class="admin-overview-detail"><div class="admin-overview-detail-heading"><strong>'+e(m.location)+'</strong></div><div class="admin-overview-detail-list">'+m.rows.map(c=>'<div class="admin-overview-person"><span><strong>'+e(c.title)+'</strong><small>'+e(stateLabel[c.state])+(c.baselineSha?' · '+e(c.baselineSha.slice(0,12)):'')+'</small>'+(c.ref?'<small><a href="https://github.com/co-va/professional/blob/'+(snapshot?.sha||'staging')+'/RELEASE_CLOSURE_REGISTRY.json" target="_blank" rel="noopener noreferrer">'+e(c.ref)+'</a></small>':'')+(c.approvedAt?'<small>Приёмка: '+e(c.approvedAt)+'</small>':'')+(c.changed?.length?'<small>'+e(c.changed.join(', '))+'</small>':'')+'</span></div>').join('')+'</div></div>':'');
  }).join('');
  return '<div class="admin-overview"><div class="admin-heading"><h2>Операционная готовность</h2></div><section class="admin-overview-panel"><div class="admin-overview-panel-head"><h3>Услуги и продажи</h3><div class="admin-overview-period"><button type="button" data-operational-back>Обзор</button><button type="button" data-operational-refresh>Обновить</button></div></div>'+summary+'<p class="admin-overview-empty">Карта '+COVERAGE_VERSION+' · 18 механизмов. Core, User и сквозные сценарии без доказательств пока не подтверждены. Процент не управляет доступом к инструментам.</p><div class="admin-overview-detail-list">'+rows+'</div></section></div>';
}
export function renderOperationalReadiness(content, {escapeHtml,isCurrent,onBack,load=loadOperationalReadiness}) {
  if (!content) return;
  let selected='', snapshot=null, request=0;
  const render=()=>{
    if(!isCurrent()) return;
    content.innerHTML=readinessMarkup(snapshot,escapeHtml,selected);
    content.querySelector('[data-operational-refresh]')?.addEventListener('click',refresh);
    content.querySelector('[data-operational-back]')?.addEventListener('click',()=>onBack?.());
    content.querySelectorAll('[data-operational-mechanism]').forEach(button=>button.addEventListener('click',()=>{
      selected=selected===button.dataset.operationalMechanism?'':button.dataset.operationalMechanism;
      render();
    }));
  };
  async function refresh(){
    const id=++request;
    snapshot=null; render();
    const control=content.querySelector('[data-operational-refresh]');
    if(control) {control.disabled=true;control.textContent='Загрузка…';}
    try {const next=await load();if(id===request&&isCurrent()) snapshot=next;}
    catch { /* unavailable stays unknown, never reuse stale evidence as current */ }
    if(id===request&&isCurrent()) render();
  }
  render(); void refresh();
}
