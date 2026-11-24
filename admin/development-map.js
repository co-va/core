// One development map. Existing mechanism/criterion IDs are reused; extensions are target coverage,
// not claims that functions already exist. The registry remains the source of later acceptance.
import { MECHANISMS, loadOperationalReadiness, loadCoreAudit, loadUserAudit, workQueue } from './operational-readiness.js';

const extension = [
  ['orders','Заказы','Оформление, исполнение и выдача заказов',[
    ['orders.quote','Предварительный расчёт, согласование цены и состава'],
    ['orders.lifecycle','Заказ, сроки, изменение, резервирование, исполнение и отмена']]],
  ['logistics','Логистика','Доставка и выдача',[
    ['logistics.fulfilment','Самовывоз, доставка, получение и подтверждение передачи']]],
  ['quality','Качество и обслуживание','Работа после услуги или продажи',[
    ['quality.claims','Претензии, гарантия, исправление и обмен'],
    ['quality.feedback','Отзывы, оценка результата и обратная связь']]],
  ['tax','Налоговый и обязательный учёт','Обязательства и внешние системы',[
    ['tax.receipts','Фискальные документы и необходимые интеграции'],
    ['tax.reporting','Налоги и обязательная отчётность в применимой юрисдикции']]],
  ['planning','Финансовое планирование','План и факт',[
    ['planning.budget','Бюджет, план доходов и расходов, прогноз денежных потоков'],
    ['planning.profit','Рентабельность и точки безубыточности']]],
  ['loyalty','Лояльность','Условия отношений с покупателями и получателями услуг',[
    ['loyalty.programs','Скидки, бонусы, персональные условия и правила действия'],
    ['loyalty.balances','Депозиты, личные счета, абонементы и история использования']]],
  ['marketing','Маркетинг','Привлечение и удержание',[
    ['marketing.audiences','Сегментация, источники и аудитории'],
    ['marketing.campaigns','Кампании, предложения, каналы и воронки']]],
  ['communications','Коммуникации','Взаимодействие с участниками',[
    ['communications.notifications','Подтверждения, напоминания и уведомления о событиях'],
    ['communications.channels','Каналы связи, предпочтения и история коммуникаций']]],
  ['analytics','Аналитика','Результаты деятельности',[
    ['analytics.performance','Выручка, загрузка, продажи, эффективность сотрудников'],
    ['analytics.customers','Повторные обращения, удержание, сегменты и показатели']]],
  ['documents','Документы и согласия','Правовые и рабочие документы',[
    ['documents.contracts','Договоры, версии, документы о работе и история'],
    ['documents.consents','Согласия, отзыв, основания обработки и история подписания']]],
  ['integration','Интеграции и обмен данными','Перенос и взаимодействие систем',[
    ['integration.transfer','Импорт, экспорт, сопоставление, повторы и конфликты'],
    ['integration.external','Подключение внешних сервисов и обмен данными']]]
];
const extraCriteria={
  workspace:[['workspace.hours','Режим работы пространства, исключения и закрытие']],
  'workspace-relations':[['relations.lifecycle','Начало, изменение и завершение аренды и найма, ответственность за расходы']],
  participants:[['participants.lifecycle','Приглашение, подключение, изменение роли и прекращение участия']],
  resources:[['resources.maintenance','Инструменты, оборудование, обслуживание, ремонт и срок использования']],
  time:[['time.absence','Перерывы, отсутствие, замены и доступность участников']],
  contacts:[['contacts.relationships','Роли, история взаимодействий и актуальность контактных данных']],
  services:[['services.offer','Условия оказания, состав, варианты и дополнительные работы']],
  products:[['products.offer','Характеристики, маркировка, ассортимент и доступность']],
  sales:[['sales.exchange','Обмен, скидки, частичная оплата, отмена и история расчётов']],
  records:[['records.visit','Посещение, неявка, повтор, групповые и повторяющиеся записи']],
  inventory:[['inventory.returns','Возвраты, списания, резерв, минимум и планирование закупок']],
  compensation:[['compensation.adjustments','Условия по периодам, доплаты, удержания и история изменений']],
  obligations:[['obligations.expenses','Расходы за пространство, коммунальные услуги, оборудование, аренду и другие регулярные обязательства']],
  finance:[['finance.cash','Касса, смены кассы, способы оплаты, закрытие дня и отчётность']],
  cost:[['cost.overhead','Распределение постоянных и переменных накладных расходов']],
  configuration:[['config.lifecycle','Настройка и изменение рабочего процесса без миграции данных']]
};
const sections=[
  ['Организация деятельности',['workspace','workspace-relations','participants','permissions','resources','time']],
  ['Рабочая деятельность',['contacts','services','service-stages','products','sales','records','orders','logistics','inventory','quality']],
  ['Экономика деятельности',['compensation','obligations','finance','cost','tax','planning']],
  ['Развитие деятельности',['loyalty','marketing','communications','analytics']],
  ['Обеспечение деятельности',['documents','configuration','integration']]
];
export const DEVELOPMENT_CATALOG = [...MECHANISMS.map(([id,label,location,criteria])=>({id,label,location,criteria:[...criteria.map(([key,title,ref,work])=>({key,title,ref,work})),...(extraCriteria[id]||[]).map(([key,title])=>({key,title}))]})),...extension.map(([id,label,location,criteria])=>({id,label,location,criteria:criteria.map(([key,title])=>({key,title}))}))];
const byId=new Map(DEVELOPMENT_CATALOG.map(m=>[m.id,m]));
const both=['workspace','workspace-relations','contacts','finance','obligations','cost','tax','documents','configuration','communications','integration','quality'];
const service=['services','time','records','service-stages','resources','inventory','products','sales','orders','logistics'];
const trade=['products','sales','inventory','time','resources','orders','logistics'];
const team=['participants','permissions','compensation'];
const growth=['loyalty','marketing','analytics','planning'];
const own=['Самостоятельная работа','Работа с сотрудниками','Работа по найму'];
export const ACTIVITIES=[{id:'services',name:'Оказание услуг',ids:service},{id:'trade',name:'Продажа товаров',ids:trade}];
const activityMechanismIds=activity=>new Set([...both,...activity.ids,...team,...growth]);
export function mechanismActivities(id){return ACTIVITIES.filter(activity=>activityMechanismIds(activity).has(id));}
const optional=new Set(['resources','orders','logistics','service-stages','loyalty','marketing','analytics','planning','integration','quality']);
export function scenarioMechanisms(activity,mode) {
  const act=ACTIVITIES.find(a=>a.id===activity);
  if(!act||!Number.isInteger(mode)||mode<0||mode>2)return [];
  // Same mechanism can be relevant in several scenarios; assistant/help is independent of rental.
  const ids=activityMechanismIds(act);
  return sections.flatMap(([name,keys])=>keys.filter(k=>ids.has(k)).map(k=>({ ...byId.get(k),section:name,
    applicability: mode===2&&['obligations','tax','planning','cost','inventory','marketing','analytics','loyalty','orders','logistics'].includes(k)?'По полномочиям':
      optional.has(k)||mode===0&&team.includes(k)||activity==='services'&&['products','sales','inventory'].includes(k)||activity==='trade'&&k==='time'&&mode===0?'При необходимости':'Основной',
    priority: ['marketing','analytics','planning'].includes(k)?'Позднее':
      ['loyalty','quality','orders','logistics','resources','service-stages','integration'].includes(k)||mode===0&&team.includes(k)?'Второстепенно':'Первостепенно'
  })));
}
const historical={
  'workspace.profile':['Переключение ранее подтверждено. Тест Core/staging bf40e75: создание, изменение, повторное чтение, порядок и мягкое удаление — PASS (run 45463704289/job 138693035571).','Проверить эти действия в Professional, включая повторный вход.'],
  'workspace.multiple':['Переключение ранее подтверждено. Тест Core/staging bf40e75: изменение одного из двух пространств не изменяет другое — PASS (run 45463704289/job 138693035571).','Подтвердить отдельные графики, записи и услуги двух пространств в одном рабочем сценарии.'],
  'workspace.hours':['Тест Core/staging bf40e75: разные часы двух пространств сохраняются — PASS (run 45463704289/job 138693035571).','Проверить исключения графика и закрытие времени для записи.'],
  'time.schedule':['График подтверждён 15.11.2026.','Проверить только оставшиеся сценарии.'],
  'records.prof':['Создание и редактирование записи подтверждены 15.11.2026.','Проверить неподтверждённые действия, а не заново весь Журнал.'],
  'services.execution':['Изменение услуги и оплата подтверждены 15.11.2026.','Проверить расход и историю завершения.'],
  'finance.prof':['Оплата записи подтверждена 15.11.2026.','Сверить остальные финансовые операции.'],
  'products.price':['Раздельная конечная и складская цена ранее подтверждена.','Проверить оставшиеся условия и историю.'],
  'catalog.prof':['Ранее зафиксированная приёмка Сервиса оспорена владельцем 24.11.2026.','Уточнить объём принятого без повторной проверки подтверждённых действий.']
};
const validSha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const eventsFor=(snapshot,key)=>{
  const source=snapshot?.registry?.operationalProgress;
  if(!Array.isArray(source))return [];
  return source.filter(x=>x?.criterion===key&&typeof x.result==='string'&&x.result.trim()&&typeof x.remaining==='string'&&typeof x.id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.date||''));
};
const proved=x=>x?.versions&&Object.values(x.versions).length&&Object.values(x.versions).every(validSha)&&Array.isArray(x.checks)&&x.checks.length&&x.checks.every(y=>typeof y==='string'&&y.trim());
const statusLabels={ready:'Готово',working:'В работе',unfinished:'Требует доработки',notStarted:'Не начато'};
export function criterionView(c,snapshot,audits=[]){
  const row=snapshot?.mechanisms?.flatMap(m=>m.rows).find(r=>r.key===c.key);
  const found=c.work?.finding||'Реализация не проверена.';
  const historic=historical[c.key];
  const events=eventsFor(snapshot,c.key);
  const confirmed=events.filter(x=>x.kind==='confirmed-action'||x.kind==='accepted'&&x.ownerConfirmed===true&&proved(x)&&x.remaining==='');
  const resolution=events.filter(x=>x.kind==='disputed'||x.kind==='accepted'&&x.ownerConfirmed===true&&proved(x)&&x.remaining===''||x.kind==='regression'&&x.environment==='deployed'&&proved(x)&&x.remaining.trim()).at(-1);
  const latest=events.at(-1);
  const candidate=events.filter((x,i)=>['candidate','implemented'].includes(x.kind)&&(!resolution||i>events.indexOf(resolution))).at(-1);
  const sources=[...audits,snapshot?.professionalAudit].filter(Boolean);
  const checks=sources.flatMap(x=>x.scenarios||[]).filter(x=>x.criteria?.includes(c.key));
  // An audit recommendation is not evidence that an existing operation fails.
  let status=['finish','verify'].includes(c.work?.state)?'pending':'unknown';
  if(checks.some(x=>['passed','historical'].includes(x.state)))status='partial';
  let next=c.work?.next||'Проверить наличие и работу указанного действия.';
  if(row?.state==='accepted'){status='ready';next='Принято. Не повторять проверку без основания.';}
  else if(row?.accepted){status='partial';next='Прежняя приёмка сохранена; проверить влияние изменений.';}
  if(historic&&(status!=='ready'||c.key==='catalog.prof')){status=c.key==='catalog.prof'?'disputed':'partial';next=historic[1];}
  if(confirmed.length&&status!=='ready'&&status!=='disputed'){status='partial';next=latest?.remaining||next;}
  if(candidate&&status!=='ready'&&status!=='disputed'){status='pending';next=candidate.remaining||next;}
  // A failed batch can contain many tests. Only a specifically attributed failure
  // is a defect of this criterion; a batch failure requires investigation.
  const failed=checks.filter(x=>x.state==='failed');
  const specificFailure=failed.some(x=>x.step&&sources.some(a=>a.scenarios?.includes(x)&&a.scenarios.filter(s=>s.step===x.step&&s.job===x.job).length===1)&&!['Domain regression tests','Local UI browser smoke','Verify canonical data transfer with PostgreSQL'].includes(x.step));
  if(failed.length&&status!=='ready'&&status!=='disputed'){status=specificFailure?'unfinished':'pending';next=specificFailure?'Не пройдена проверка: '+failed.find(x=>x.step)?.title+'. '+next:'Не пройден общий пакет проверок; определить конкретный сбой. '+next;}
  if(resolution?.kind==='accepted'){status='ready';next='Вопрос принят. Проверять только затронутые изменения.';}
  if(resolution?.kind==='disputed'){status='disputed';next=resolution.remaining||'Уточнить приёмку.';}
  if(resolution?.kind==='regression'){status='unfinished';next=resolution.remaining;}
  const priority=events.filter(x=>['deferred','resume'].includes(x.kind)&&x.ownerConfirmed===true).at(-1);
  if(candidate&&resolution?.kind==='accepted'&&status==='ready'){status='pending';next=candidate.remaining||next;}
  const notStarted=latest?.kind==='not-started'&&latest.ownerConfirmed===true&&status==='unknown';
  if(notStarted)status='notStarted';
  return {key:c.key,status,found:latest?.result||found,next,history:[...(historic?[historic[0]]:[]),...confirmed.map(x=>x.date+': '+x.result)],candidate:status==='ready'?candidate?.result:null,hasCandidate:!!candidate,deferred:priority?.kind==='deferred',evidence:[...new Map(checks.filter(x=>['passed','historical','failed'].includes(x.state)).map(x=>[x.id,x])).values()].map(x=>({title:x.title,state:x.state}))};
}
// Percent is the fraction of distinct, currently accepted criteria, not an estimate of code completion.
export function developmentProgress(views,sourceAvailable=true){
  const unique=[...new Map(views.map((v,i)=>[v.key??i,v])).values()];
  const active=unique.filter(v=>!v.deferred);
  if(!active.length)return null;
  if(!sourceAvailable)return {status:null,percent:null};
  const accepted=unique.filter(v=>v.status==='ready').length;
  const allReady=accepted===unique.length;
  const allNotStarted=unique.every(v=>v.status==='notStarted');
  const unfinished=active.some(v=>v.status==='unfinished'&&v.blocking!==false);
  const working=active.some(v=>['ready','partial','disputed'].includes(v.status)||v.status==='unfinished'&&v.blocking===false||v.status==='pending'&&(v.history?.length||v.evidence?.some(x=>['passed','historical'].includes(x.state))||v.hasCandidate));
  const status=allReady?'ready':unfinished?'unfinished':working?'working':allNotStarted?'notStarted':null;
  const percent=allReady?100:allNotStarted?0:accepted>0?Math.min(99,Math.round(100*accepted/unique.length)):null;
  return {status,percent};
}
const mark=(progress,e)=>{
  if(!progress)return '';
  const {status,percent}=progress;
  return '<span class="development-progress is-'+(status||'neutral')+'"><span class="development-progress-head">'+(status?'<span>'+e(statusLabels[status])+'</span>':'')+'<span class="development-percent">'+(percent===null?'—':percent+'%')+'</span></span><span class="development-progress-track" '+(percent===null?'role="img" aria-label="Степень готовности не определена"':'role="progressbar" aria-label="Подтверждённая готовность" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percent+'"')+'>'+(percent===null?'':'<span class="development-progress-fill" style="width:'+percent+'%"></span>')+'</span></span>';
};
const activityLabel=id=>{const uses=mechanismActivities(id);return uses.length>1?'Общий механизм · '+uses.map(a=>a.name).join(' / '):'Только '+(uses[0]?.name.toLowerCase()||'не определено');};
const scopeGroups=[['Основные механизмы','Основной'],['Дополнительные механизмы','При необходимости'],['По полномочиям','По полномочиям']];
const contexts=[
  {places:['Собственное помещение','Аренда помещения или рабочего места','Выездная / дистанционная работа'],roles:'Работает сам. Может привлекать помощников.',finance:'Собственные доходы, расходы и обязательства.'},
  {places:['Собственное помещение','Аренда помещения или рабочих мест','Выездная / дистанционная работа'],roles:'Организует работу сотрудников и может работать сам.',finance:'Доходы и расходы деятельности, выплаты сотрудникам.'},
  {places:['Пространство работодателя','Выездная / дистанционная работа по заданию работодателя'],roles:'Работает в пределах предоставленных полномочий. Может взаимодействовать с помощниками.',finance:'Личное вознаграждение; операции работодателя — по полномочиям.'}
];
function row(title,sub,status,extra,e){
  return '<span><strong>'+e(title)+'</strong>'+(sub?'<small>'+e(sub)+'</small>':'')+'</span><span class="development-row-end">'+(status?mark(status,e):'')+extra+'</span>';
}
const disclosure=open=>'<span class="development-disclosure" aria-hidden="true">'+(open?'▾':'▸')+'</span>';
function progressSummary(views,available){
  if(!available)return 'Данные не получены';
  const unique=[...new Map(views.map(v=>[v.key,v])).values()];
  const ready=unique.filter(v=>v.status==='ready').length;
  const partial=unique.filter(v=>v.status!=='ready'&&(v.status==='partial'||v.history?.length||v.evidence?.some(x=>x.state==='passed'||x.state==='historical'))).length;
  const unknown=unique.length-ready-partial;
  return [ready?'Принято '+ready+' из '+unique.length:'',partial?'Проверено частично '+partial+' из '+unique.length:'',unknown?'Без полной проверки '+unknown:''].filter(Boolean).join(' · ');
}
function criterionSummary(v,available){
  if(!available)return 'Данные не получены';
  if(v.status==='ready')return 'Закрыто';
  if(v.deferred)return 'Отложено';
  if(v.status==='unfinished')return 'Исправить';
  if(v.status==='notStarted')return 'Реализовать';
  if(v.status==='disputed')return 'Согласовать';
  if(v.status==='partial')return 'Частично проверено';
  return 'Проверить';
}
const plainTitles={'workspace.profile':'Добавить и изменить место работы','workspace.multiple':'Работать в нескольких местах','workspace.hours':'Настроить часы работы'};
const soloTitles={'relations.types':'Своё или арендованное место','relations.terms':'Оплата аренды','relations.lifecycle':'Начало и окончание аренды'};
function ownerDecision(c,mode,v){
  if(mode!==0||v.status==='ready'||v.deferred)return '';
  if(c.key==='relations.types')return 'Какие условия пользования местом нужны специалисту?';
  if(c.key==='relations.terms')return 'Как рассчитывается аренда: за время, за период или другим способом?';
  if(c.key==='relations.lifecycle')return 'Как учитывать начало, изменение и окончание аренды?';
  return '';
}
function briefResult(c,v){
  if(v.status==='ready')return 'Вопрос закрыт.';
  if(c.key==='workspace.profile')return 'На тестовой базе: создание, изменение, сохранение, порядок и удаление работают.';
  if(c.key==='workspace.multiple')return 'На тестовой базе: изменение одного места не затрагивает другое.';
  if(c.key==='workspace.hours')return 'На тестовой базе: разные часы сохраняются.';
  if(v.status==='unfinished')return 'Выявлен сбой.';
  if(v.status==='notStarted')return 'Реализация отсутствует.';
  if(v.status==='disputed')return 'Результат не согласован.';
  if(v.status==='partial')return 'Часть действий проверена, вопрос не закрыт.';
  return 'Итог пока не подтверждён.';
}
function shortAction(c,v){
  if(v.status==='ready')return 'Закрыто';
  if(c.key==='workspace.profile')return 'Проверить сохранение, повторный вход, изменение и удаление места в Professional.';
  if(c.key==='workspace.multiple')return 'Проверить независимые графики, услуги и записи двух мест.';
  if(c.key==='workspace.hours')return 'Проверить исключения графика и закрытие времени для записи.';
  return v.status==='disputed'?'Согласовать результат':v.status==='unfinished'?'Исправить конкретный сбой':'Проверить указанную возможность';
}
// Existing catalogue IDs; these are business relationships to consider together,
// not verified hard prerequisites or new mechanisms.
const relatedMechanisms={
  workspace:['workspace-relations','time','services','records'],
  'workspace-relations':['workspace','obligations','finance'],
  participants:['permissions','time','compensation'],
  permissions:['participants','workspace'],
  resources:['workspace','time','inventory'],
  time:['workspace','records','services'],
  contacts:['records','loyalty','communications'],
  services:['workspace','time','records','inventory','cost'],
  records:['workspace','time','contacts','services','finance','inventory'],
  sales:['products','inventory','finance'],
  inventory:['products','services','sales','cost','finance'],
  obligations:['workspace-relations','finance','cost'],
  finance:['records','sales','obligations','cost'],
  cost:['services','inventory','finance','obligations'],
};
function relatedSummary(m,numbered,snapshot){
  const linked=numbered.filter(x=>(relatedMechanisms[m.id]||[]).includes(x.id));
  const business=linked.map(x=>x.number+'. '+x.label);
  const registry=snapshot?.registry?.items||[];
  const items=new Map(registry.map(x=>[x.id,x]));
  const refs=new Set(m.criteria.map(c=>c.ref).filter(Boolean));
  const required=[...new Set([...refs].flatMap(ref=>items.get(ref)?.requires||[]))];
  const technical=required.map(id=>items.get(id)?.label||id);
  return {business,technical};
}
// Proposed execution sequence, not acceptance or a claim of exhaustive dependencies.
// Existing criterion IDs only. The structural number is independent of the queue.
const plannedPrerequisites={
  'workspace.multiple':['workspace.profile','workspace.hours','time.schedule','services.core','records.core'],
  'workspace.hours':['workspace.profile'],
  'relations.terms':['relations.types'],
  'relations.lifecycle':['relations.types','relations.terms'],
  'time.schedule':['workspace.profile','workspace.hours'],
  'time.timeline':['workspace.profile','time.schedule'],
  'contacts.prof':['contacts.core'],
  'services.core':['workspace.profile'],
  'catalog.prof':['services.core'],
  'records.core':['workspace.profile','time.schedule','contacts.core','services.core'],
  'records.prof':['records.core','contacts.prof','time.timeline'],
  'records.user':['records.core'],
  'services.execution':['records.prof','finance.core'],
  'finance.prof':['finance.core'],
  'finance.reconcile':['finance.core'],
  'inventory.count':['inventory.stock'],
  'inventory.supply':['inventory.stock','products.identity'],
  'products.price':['products.identity'],
  'sales.settlement':['finance.core','products.price','inventory.stock'],
  'sales.standalone':['sales.settlement'],
  'cost.materials':['inventory.stock','services.core'],
  'cost.operation':['cost.materials','cost.time','finance.core'],
  'obligations.settle':['obligations.record','finance.core'],
  'obligations.expenses':['relations.terms','obligations.record'],
};
export function plannedQueue(numbered,snapshot){
  const tasks=new Map();
  for(const m of numbered)for(const [i,c] of m.criteria.entries()){
    if(!tasks.has(c.key))tasks.set(c.key,{key:c.key,number:m.number+'.'+(i+1),criterion:c,view:m.views[i],main:m.applicability==='Основной',priority:m.priority});
    else if(m.applicability==='Основной')tasks.get(c.key).main=true;
  }
  const refs=new Map();
  for(const t of tasks.values())if(t.criterion.ref){const a=refs.get(t.criterion.ref)||[];a.push(t.key);refs.set(t.criterion.ref,a);}
  const registry=new Map((snapshot?.registry?.items||[]).map(r=>[r.id,r]));
  function referencedKeys(ref,seen=new Set()){
    if(!ref||seen.has(ref))return [];
    seen.add(ref);
    return (registry.get(ref)?.requires||[]).flatMap(id=>[...(refs.get(id)||[]),...referencedKeys(id,seen)]);
  }
  for(const t of tasks.values())t.dependencies=[...new Set([...(plannedPrerequisites[t.key]||[]),...referencedKeys(t.criterion.ref)])].filter(k=>k!==t.key&&tasks.has(k));
  const pending=[...tasks.values()].filter(t=>t.view.status!=='ready'&&!t.view.deferred);
  const priority=t=>t.main?0:t.priority==='Первостепенно'?1:t.priority==='Второстепенно'?2:3;
  pending.sort((a,b)=>priority(a)-priority(b));
  const ranks=new Map(),visiting=new Set(),cycles=new Set();
  function visit(t){
    if(!t||t.view.status==='ready'||t.view.deferred||ranks.has(t.key))return;
    if(visiting.has(t.key)){cycles.add(t.key);return;}
    visiting.add(t.key);
    for(const k of t.dependencies)visit(tasks.get(k));
    visiting.delete(t.key);
    if(!ranks.has(t.key))ranks.set(t.key,ranks.size+1);
  }
  for(const t of pending)visit(t);
  return {tasks,ranks,cycles};
}
function queueLabel(t,plan){
  const rank=plan.ranks.get(t.key);
  if(!rank)return '';
  return 'Задача '+rank;
}
// One ordinary full-width list at a time, independent of the five-section index.
export function developmentWindowLayout(width=920,height=610,count=1){
  return {capacity:1,columns:1,rows:1,listRows:Math.max(1,Math.floor((height-100)/44)),detailRows:Math.max(1,Math.floor((height-100)/88)),paneWidth:Math.max(1,width)};
}
const criterionTitle=(c,mode)=>plainTitles[c.key]||(mode===0&&soloTitles[c.key])||c.title;
function statusText(v,available){return !available?'Данные не получены':v.status==='ready'?'Готово':v.status==='unfinished'?'Требует доработки':v.status==='notStarted'?'Не начато':v.status==='partial'?'Частично проверено':v.status==='disputed'?'Согласовать':v.deferred?'Отложено':'Не проверено';}
function compactSummary(views,available){
  if(!available)return 'Данные не получены';
  const unique=[...new Map(views.map(v=>[v.key,v])).values()];
  const accepted=unique.filter(v=>v.status==='ready').length;
  const partial=unique.filter(v=>v.status!=='ready'&&(v.status==='partial'||v.history?.length||v.evidence?.some(x=>x.state==='passed'||x.state==='historical'))).length;
  return [accepted?'Принято '+accepted:'',partial?'Частично '+partial:'',unique.length-accepted-partial?'Проверить '+(unique.length-accepted-partial):''].filter(Boolean).join(' · ');
}
function splitDetail(value,max){
  const words=String(value||'').split(/\s+/).filter(Boolean),parts=[];let line='';
  for(const word of words){if(line&&(line+' '+word).length>max){parts.push(line);line='';}if(word.length>max){if(line){parts.push(line);line='';}for(let i=0;i<word.length;i+=max)parts.push(word.slice(i,i+max));}else line+=(line?' ':'')+word;}
  if(line)parts.push(line);return parts.length?parts:['—'];
}
function windowPane(id,title,rows,limit,page,e,detail=false){
  const pages=Math.max(1,Math.ceil(rows.length/limit)),current=Math.max(0,Math.min(page||0,pages-1));
  return '<section class="admin-users-section development-window'+(detail?' is-detail':'')+'" data-dm-window="'+e(id)+'"><header class="development-window-head"><h2 class="admin-users-section-title">'+e(title)+'</h2><div class="development-window-pages"><button type="button" class="admin-tool-registry-expand" data-dm-page="'+e(id)+'" data-page="'+(current-1)+'" aria-label="Предыдущая страница"'+(!current?' disabled':'')+'>‹</button><span>'+ (current+1)+' / '+pages+'</span><button type="button" class="admin-tool-registry-expand" data-dm-page="'+e(id)+'" data-page="'+(current+1)+'" aria-label="Следующая страница"'+(current+1>=pages?' disabled':'')+'>›</button></div></header><div class="admin-card"><table class="admin-table admin-tool-register-table development-table'+(detail?' development-detail-table':'')+'"><thead><tr><th scope="col">'+(detail?'Результат / действие':'Наименование')+'</th>'+(detail?'':'<th scope="col">Готовность</th>')+'</tr></thead><tbody>'+rows.slice(current*limit,(current+1)*limit).join('')+'</tbody></table></div></section>';
}
function selectRow({key,label,sub='',progress=null,active=false,kind},e){
  return '<tr'+(active?' class="is-selected"':'')+'><td><button type="button" class="development-table-choice" data-dm-select="'+e(kind)+'" data-dm-key="'+e(key)+'" aria-pressed="'+active+'" title="'+e(label+(sub?' — '+sub:''))+'"><strong>'+e(label)+'</strong>'+(sub?'<small>'+e(sub)+'</small>':'')+'</button></td><td>'+(progress?mark(progress,e):'—')+'</td></tr>';
}
function detailRows(items,layout,e){
  const max=Math.max(55,Math.floor((layout.paneWidth-24)/7.2)*3);
  return items.flatMap(item=>splitDetail(item.value,max).map((part,i)=>'<tr><td><strong>'+e(item.label+(i?' · продолжение':''))+'</strong><p>'+e(part)+'</p>'+(item.go&&i===0?'<button type="button" class="development-detail-link" data-dm-go="'+e(item.go)+'">Открыть</button>':'')+'</td></tr>'));
}
export function developmentMarkup({activity=null,mode=0,group=null,mechanism=null,criterion=null,level='mechanisms',detailMode='result',pages={},width=920,height=610,snapshot=null,audits=[],loading=false,stale=false},e){
  const selected=ACTIVITIES.find(a=>a.id===activity);
  const header='<div class="admin-heading admin-overview-heading"><div><h2>Карта развития</h2></div></div>';
  if(!selected){
    const choices=ACTIVITIES.map(a=>'<section class="admin-users-section development-choice-window"><h2 class="admin-users-section-title">'+e(a.name)+'</h2><div class="admin-card"><table class="admin-table admin-tool-register-table development-table"><tbody>'+own.map((name,i)=>'<tr><td><button type="button" class="development-table-choice" data-dm-activity="'+e(a.id)+'" data-dm-mode="'+i+'"><strong>'+e(name)+'</strong></button></td></tr>').join('')+'</tbody></table></div></section>').join('');
    return '<div class="admin-overview development-map">'+header+'<div class="development-home"><div class="development-tree-root">Единое покрытие платформы</div><div class="development-activities">'+choices+'</div></div></div>';
  }
  const numbered=scenarioMechanisms(activity,mode).map((m,i)=>({...m,number:i+1,views:m.criteria.map(c=>criterionView(c,snapshot,audits))}));
  const plan=plannedQueue(numbered,snapshot),m=numbered.find(x=>x.id===mechanism),index=m?.criteria.findIndex(c=>c.key===criterion)??-1,c=index>=0?m.criteria[index]:null,v=index>=0?m.views[index]:null;
  const first=[...plan.ranks.keys()][0],firstTask=plan.tasks.get(first),firstLabel=firstTask?'Задача '+plan.ranks.get(first)+' · '+firstTask.number+' '+criterionTitle(firstTask.criterion,mode):'';
  const context=contexts[mode]||contexts[0],groups=sections.map(([name,ids])=>({name,id:ids[0],members:numbered.filter(x=>x.section===name)})).filter(x=>x.members.length);
  const selectedGroup=groups.find(x=>x.id===group),members=selectedGroup?selectedGroup.members:numbered;
  const groupRows=[selectRow({key:'all',label:'Все механизмы',sub:compactSummary(numbered.flatMap(x=>x.views),!!snapshot),progress:developmentProgress(numbered.flatMap(x=>x.views),!!snapshot),active:!group,kind:'group'},e),...groups.map(g=>{const views=g.members.flatMap(x=>x.views.map(v=>({...v,blocking:x.applicability==='Основной'})));return selectRow({key:g.id,label:g.name,sub:compactSummary(views,!!snapshot),progress:developmentProgress(views,!!snapshot),active:group===g.id,kind:'group'},e);})];
  const mechanismRows=members.map(x=>{const ranks=x.criteria.map(c=>plan.ranks.get(c.key)).filter(Boolean).sort((a,b)=>a-b);return selectRow({key:x.id,label:x.number+'. '+x.label,sub:[compactSummary(x.views,!!snapshot),snapshot&&ranks.length?'№ '+ranks.join(', '):''].filter(Boolean).join(' · '),progress:developmentProgress(x.views,!!snapshot),active:m?.id===x.id,kind:'mechanism'},e);});
  const criterionRows=m?m.criteria.map((x,i)=>{const view=m.views[i],rank=plan.ranks.get(x.key);return selectRow({key:x.key,label:m.number+'.'+(i+1)+' '+criterionTitle(x,mode),sub:[snapshot&&rank?'Задача '+rank:'',statusText(view,!!snapshot)].filter(Boolean).join(' · '),progress:developmentProgress([view],!!snapshot),active:c?.key===x.key,kind:'criterion'},e);}):[];
  const descriptors=[{id:'groups',title:'Разделы',rows:groupRows},{id:'mechanisms',title:selectedGroup?.name||'Все механизмы',rows:mechanismRows}];
  if(m)descriptors.push({id:'criteria',title:m.number+'. '+m.label,rows:criterionRows});
  let detailItems=[],detailTitle='Результат';
  if(detailMode==='context'){
    detailTitle='Условия работы';detailItems=[{label:'Места работы',value:context.places.join(' · ')},{label:'Участники',value:context.roles},{label:'Финансы',value:context.finance}];
  }else if(c){
    const task=plan.tasks.get(c.key),decision=ownerDecision(c,mode,v);
    detailTitle=m.number+'.'+(index+1)+' · '+(detailMode==='technical'?'Доказательства':'Результат');
    if(detailMode==='technical'){
      detailItems=[{label:'Реализация',value:v.found},...v.history.map(value=>({label:'Ранее проверено',value})),...v.evidence.map(x=>({label:x.state==='failed'?'Не пройдено':'Проверка',value:x.title})),{label:'Осталось',value:v.next}];
      const tech=relatedSummary(m,numbered,snapshot).technical;if(tech.length)detailItems.push({label:'Зависимости реестра',value:tech.join(' · ')});
    }else{
      detailItems=[{label:'Результат',value:briefResult(c,v)},{label:decision?'Решение владельца':'Следующее действие',value:decision||shortAction(c,v)}];
      for(const key of task.dependencies){const dep=plan.tasks.get(key);if(dep&&dep.view.status!=='ready'&&!dep.view.deferred)detailItems.push({label:'Сначала · '+queueLabel(dep,plan),value:dep.number+' '+criterionTitle(dep.criterion,mode),go:dep.key});}
      for(const related of numbered.filter(x=>(relatedMechanisms[m.id]||[]).includes(x.id)))detailItems.push({label:'Связанный механизм',value:related.number+' '+related.label,go:'mechanism:'+related.id});
    }
  }
  if(detailItems.length)descriptors.push({id:'detail',title:detailTitle,detail:true});
  const current=descriptors.find(x=>x.id===level)||descriptors[0];
  const layout=developmentWindowLayout(width,height);
  const grid=windowPane(current.id,current.title,current.detail?detailRows(detailItems,layout,e):current.rows,current.detail?layout.detailRows:layout.listRows,pages[current.id],e,!!current.detail);
  const sectionIndex='<div class="development-section-index" aria-label="Разделы деятельности">'+groups.map(g=>'<button type="button" class="development-section-choice'+(group===g.id?' is-selected':'')+'" data-dm-select="group" data-dm-key="'+e(g.id)+'" aria-pressed="'+(group===g.id)+'"><strong>'+e(g.name)+'</strong>'+mark(developmentProgress(g.members.flatMap(x=>x.views.map(v=>({...v,blocking:x.applicability==='Основной'}))),!!snapshot),e)+'</button>').join('')+'</div>';
  const nav=descriptors.map(x=>'<button type="button" class="development-nav-step'+(x.id===level?' is-active':'')+'" data-dm-level="'+e(x.id)+'">'+e(x.id==='groups'?'Разделы':x.id==='mechanisms'?'Механизмы':x.id==='criteria'?'Состав':detailMode==='context'?'Условия':'Результат')+'</button>').join('<span aria-hidden="true"> › </span>');
  return '<div class="admin-overview development-map is-scenario">'+
    '<div class="development-scenario-head"><strong>'+e(selected.name)+' / '+e(own[mode])+'</strong><button class="admin-overview-close" type="button" data-dm-close aria-label="К выбору деятельности">×</button></div>'+
    sectionIndex+'<div class="development-control-row"><nav aria-label="Уровни карты">'+nav+'</nav><div class="development-control-actions"><button type="button" class="development-nav-step" data-dm-context>Условия работы</button>'+(c?'<button type="button" class="development-nav-step" data-dm-technical>'+ (detailMode==='technical'?'Результат':'Доказательства')+'</button>':'')+'</div></div>'+
    '<div class="development-next-row">'+(snapshot&&firstTask?'<button type="button" class="development-nav-step" data-dm-go="'+e(first)+'" title="'+e(firstLabel)+'">'+e(firstLabel)+'</button>':'<span>'+e(loading?'Получение результатов…':stale?'Не все данные получены':'План задач')+'</span>')+'</div>'+
    '<div class="development-windows">'+grid+'</div></div>';
}
// Patch only changed nodes. Retain the canvas, scroll container, and all untouched branches.
export function patchDevelopmentNode(current,next){
  if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
  if(current.nodeType===3||current.nodeType===8){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
  for(const a of [...current.attributes])if(!next.hasAttribute(a.name)&&!(current.tagName==='DETAILS'&&a.name==='open'))current.removeAttribute(a.name);
  for(const a of [...next.attributes])if(current.getAttribute(a.name)!==a.value)current.setAttribute(a.name,a.value);
  const prev=[...current.childNodes],fresh=[...next.childNodes];
  for(let i=0;i<fresh.length;i++){
    if(i<prev.length)patchDevelopmentNode(prev[i],fresh[i]);
    else current.append(fresh[i].cloneNode(true));
  }
  for(let i=fresh.length;i<prev.length;i++)prev[i].remove();
}
export function renderDevelopmentMap(content,{escapeHtml,isCurrent,load=loadOperationalReadiness,loadCore=loadCoreAudit,loadUser=loadUserAudit}){
  if(!content)return;
  let state={activity:null,mode:0,group:null,mechanism:null,criterion:null,level:'mechanisms',detailMode:'result',pages:{},width:Math.max(1,content.clientWidth),height:Math.max(1,content.clientHeight-220),snapshot:null,audits:[],loading:true,stale:false};
  let request=0,observer;
  const draw=()=>{
    if(!isCurrent()){observer?.disconnect();return;}
    const template=content.ownerDocument.createElement('template');template.innerHTML=developmentMarkup(state,escapeHtml);
    const root=content.querySelector('.development-map');
    if(root)patchDevelopmentNode(root,template.content.firstElementChild);
    else content.replaceChildren(template.content);
  };
  const measure=()=>{
    if(!isCurrent()){observer?.disconnect();return;}
    const box=content.querySelector('.development-windows'),width=Math.max(1,box?.clientWidth||content.clientWidth),height=Math.max(1,box?.clientHeight||content.clientHeight-220);
    if(width!==state.width||height!==state.height){state.width=width;state.height=height;draw();}
  };
  function resetSelection(){state.group=null;state.mechanism=null;state.criterion=null;state.level='mechanisms';state.detailMode='result';state.pages={};}
  function openTask(key){
    const numbered=scenarioMechanisms(state.activity,state.mode),m=key.startsWith('mechanism:')?numbered.find(x=>x.id===key.slice(10)):numbered.find(x=>x.criteria.some(c=>c.key===key));
    if(!m)return;
    state.group=sections.find(([name])=>name===m.section)?.[1][0]||null;
    state.mechanism=m.id;state.criterion=key.startsWith('mechanism:')?null:key;state.level=state.criterion?'detail':'criteria';state.detailMode='result';state.pages={};
    const groupMembers=numbered.filter(x=>x.section===m.section),layout=developmentWindowLayout(state.width,state.height,state.criterion?4:3);
    state.pages.mechanisms=Math.floor(groupMembers.findIndex(x=>x.id===m.id)/layout.listRows);
    if(state.criterion)state.pages.criteria=Math.floor(m.criteria.findIndex(c=>c.key===state.criterion)/layout.listRows);
  }
  content.onclick=event=>{
    if(!isCurrent())return;
    const button=event.target.closest('button');if(!button||!content.contains(button))return;
    if(button.hasAttribute('data-dm-activity')){state.activity=button.dataset.dmActivity;state.mode=Number(button.dataset.dmMode);resetSelection();}
    else if(button.hasAttribute('data-dm-close')){state.activity=null;resetSelection();}
    else if(button.hasAttribute('data-dm-page'))state.pages={...state.pages,[button.dataset.dmPage]:Math.max(0,Number(button.dataset.page)||0)};
    else if(button.hasAttribute('data-dm-level'))state.level=button.dataset.dmLevel;
    else if(button.hasAttribute('data-dm-context')){state.detailMode='context';state.level='detail';state.pages={...state.pages,detail:0};}
    else if(button.hasAttribute('data-dm-technical')){state.detailMode=state.detailMode==='technical'?'result':'technical';state.level='detail';state.pages={...state.pages,detail:0};}
    else if(button.hasAttribute('data-dm-go'))openTask(button.dataset.dmGo);
    else if(button.dataset.dmSelect==='group'){state.group=button.dataset.dmKey==='all'?null:button.dataset.dmKey;state.mechanism=null;state.criterion=null;state.detailMode='result';state.level='mechanisms';state.pages={...state.pages,mechanisms:0,criteria:0,detail:0};}
    else if(button.dataset.dmSelect==='mechanism'){state.mechanism=button.dataset.dmKey;state.criterion=null;state.detailMode='result';state.level='criteria';state.pages={...state.pages,criteria:0,detail:0};}
    else if(button.dataset.dmSelect==='criterion'){state.criterion=button.dataset.dmKey;state.detailMode='result';state.level='detail';state.pages={...state.pages,detail:0};}
    else return;
    draw();measure();
  };
  async function refresh(){
    const id=++request,results=await Promise.allSettled([load(),loadCore(),loadUser()]);
    if(id!==request||!isCurrent())return;
    if(results[0].status==='fulfilled')state.snapshot=results[0].value;
    state.audits=[1,2].map((n,i)=>results[n].status==='fulfilled'?results[n].value:state.audits[i]);state.loading=false;state.stale=results.some(r=>r.status!=='fulfilled');draw();
  }
  draw();measure();
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(measure);observer.observe(content);}
  void refresh();
}
