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
export function developmentMarkup({activity=null,mode=0,open=new Set(),snapshot=null,audits=[],loading=false,stale=false},e){
  const selected=ACTIVITIES.find(a=>a.id===activity);
  const scenario=selected?scenarioMechanisms(activity,mode):[];
  const graph=ACTIVITIES.map(a=>'<section class="admin-overview-panel development-activity"><div class="admin-overview-panel-head"><h3>'+e(a.name)+'</h3></div>'+
    own.map((name,i)=>{const active=a.id===activity&&mode===i;
      return '<button type="button" class="admin-overview-person development-mode" data-dm-activity="'+e(a.id)+'" data-dm-mode="'+i+'" aria-expanded="'+active+'"'+(active?' aria-controls="development-scenario"':'')+'>'+row(name,active?'Выбрано':'',null,'<span class="development-disclosure" aria-hidden="true">'+(active?'▾':'▸')+'</span>',e)+'</button>';
    }).join('')+'</section>').join('');
  let number=0;
  const numbered=scenario.map(m=>({...m,number:++number,views:m.criteria.map(c=>criterionView(c,snapshot,audits))}));
  const plan=plannedQueue(numbered,snapshot);
  const firstKey=[...plan.ranks.keys()][0];
  const nextMechanism=numbered.find(m=>m.criteria.some(c=>c.key===firstKey));
  const nextIndex=nextMechanism?.criteria.findIndex(c=>c.key===firstKey)??-1;
  const nextCriterion=nextIndex>=0?nextMechanism.criteria[nextIndex]:null;
  const nextView=nextIndex>=0?nextMechanism.views[nextIndex]:null;
  const nextDecision=nextCriterion?ownerDecision(nextCriterion,mode,nextView):'';
  const focus=nextCriterion&&snapshot?'<section class="admin-overview-panel"><div class="admin-overview-panel-head"><h3>Ближайшая задача</h3></div><div class="development-criterion-details development-focus"><section><h5>'+e(nextMechanism.number+'.'+(nextIndex+1)+' '+(plainTitles[nextCriterion.key]||(mode===0&&soloTitles[nextCriterion.key])||nextCriterion.title))+'</h5><p>'+e(nextDecision||shortAction(nextCriterion,nextView))+'</p><p><strong>'+e(nextDecision?'Решение владельца':'Исполнитель: AI')+'</strong></p></section></div></section>':'';
  const list='<div class="development-branches">'+sections.map(([section,keys])=>{
    const members=numbered.filter(m=>m.section===section);
    if(!members.length)return '';
    const groupId='group:'+keys[0],expanded=open.has(groupId);
    const allViews=members.flatMap(m=>m.views.map(v=>({...v,blocking:m.applicability==='Основной'})));
    const groupStatus=developmentProgress(allViews,!!snapshot);
    return '<section class="admin-overview-panel development-group"><button class="admin-overview-person development-group-head" type="button" data-dm-toggle="'+e(groupId)+'" aria-expanded="'+expanded+'">'+row(section,progressSummary(allViews,!!snapshot),groupStatus,disclosure(expanded),e)+'</button>'+
      (expanded?'<div class="development-mechanisms">'+members.map(m=>{
        const status=developmentProgress(m.views,!!snapshot),key='mechanism:'+m.id,show=open.has(key),links=relatedSummary(m,numbered,snapshot);
        const ranks=m.criteria.map(c=>plan.ranks.get(c.key)).filter(Boolean).sort((a,b)=>a-b);
        const taskLabel=snapshot&&ranks.length?' · Задачи '+ranks.join(', '):'';
        return '<div class="development-mechanism"><button class="admin-overview-person" type="button" data-dm-toggle="'+e(key)+'" aria-expanded="'+show+'">'+row(m.number+'. '+m.label,m.applicability+' · '+progressSummary(m.views,!!snapshot)+taskLabel,status,disclosure(show),e)+'</button>'+
          (show?'<div class="development-criteria">'+(links.business.length?'<p class="development-related"><strong>Связанные механизмы:</strong> '+e(links.business.join(' · '))+'</p>':'')+m.criteria.map((c,i)=>{
            const v=m.views[i],criterionId='criterion:'+m.id+':'+c.key,details=open.has(criterionId),technicalId='technical:'+criterionId,technical=open.has(technicalId);
            const title=plainTitles[c.key]||(mode===0&&soloTitles[c.key])||c.title;
            const decision=ownerDecision(c,mode,v);
            const task=plan.tasks.get(c.key),taskOrder=snapshot?queueLabel(task,plan):'';
            const prerequisites=task.dependencies.map(k=>plan.tasks.get(k)).filter(t=>t&&t.view.status!=='ready'&&!t.view.deferred);
            const verified=[...v.history,...v.evidence.map(x=>(x.state==='passed'?'':x.state==='historical'?'Ранее: ':'Не пройдено: ')+x.title)];
            return '<div class="development-criterion"><button type="button" class="admin-overview-person development-criterion-head" data-dm-toggle="'+e(criterionId)+'" aria-expanded="'+details+'">'+row(m.number+'.'+(i+1)+' '+title,[taskOrder,decision?'Нужно решение':criterionSummary(v,!!snapshot)].filter(Boolean).join(' · '),developmentProgress([v],!!snapshot),disclosure(details),e)+'</button>'+
              (details?'<div class="development-criterion-details"><section><h5>Результат</h5><p>'+e(briefResult(c,v))+'</p></section>'+(prerequisites.length?'<section><h5>Сначала</h5><p>'+e(prerequisites.map(t=>queueLabel(t,plan)+' · '+t.number+' '+(plainTitles[t.key]||t.criterion.title)).join(' / '))+'</p></section>':'')+
                (decision?'<section><h5>Нужно твоё решение</h5><p>'+e(decision)+'</p></section>':'<section><h5>Что дальше</h5><p>'+e(shortAction(c,v))+'</p><p>'+e(v.status==='ready'?'':'Исполнитель: AI')+'</p></section>')+
                '<button type="button" class="admin-overview-person" data-dm-toggle="'+e(technicalId)+'" aria-expanded="'+technical+'">'+row('Технические подробности','',null,disclosure(technical),e)+'</button>'+
                (technical?(links.technical.length?'<section><h5>Зависимости из реестра</h5><p>'+e(links.technical.join(' · '))+'</p></section>':'')+'<section><h5>Реализация</h5><p>'+e(v.found)+'</p></section><section><h5>Результат проверок</h5>'+(verified.length?'<ul>'+verified.map(h=>'<li>'+e(h)+'</li>').join('')+'</ul>':'<p>Подтверждённых результатов нет.</p>')+'</section><section><h5>'+(v.status==='ready'?'Результат':v.status==='unfinished'?'Конкретная проблема':'До подтверждения')+'</h5><p>'+e(v.next)+'</p></section>':'')+'</div>':'')+'</div>';
          }).join('')+'</div>':'')+'</div>';
      }).join('')+'</div>':'')+'</section>';
  }).join('')+'</div>';
  const context=contexts[mode]||contexts[0];
  return '<div class="admin-overview development-map'+(selected?' is-scenario':'')+'"><div class="admin-heading admin-overview-heading"><div><h2>Карта развития</h2><p>Покрытие профессии · закрытые и оставшиеся задачи</p></div></div>'+
    (!selected?'<div class="development-root"><div class="admin-overview-app-head"><h3>Единое покрытие платформы</h3></div></div><div class="development-activities">'+graph+'</div>':'')+
    '<p class="development-message" role="status"'+(!loading&&!stale?' hidden':'')+'>'+ (loading?'Загрузка данных готовности…':stale?'Не все сведения получены.':'')+'</p>'+
    (selected?'<section id="development-scenario" class="development-scenario"><div class="admin-overview-app-head development-scenario-head"><h3>'+e(selected.name)+' <span class="admin-overview-head-suffix">/ '+e(own[mode])+'</span></h3><button class="admin-overview-close" type="button" data-dm-close aria-label="Вернуться к выбору деятельности">×</button></div><div class="development-canvas">'+
      '<details class="admin-overview-panel development-context"><summary><strong>Описание условий работы</strong></summary><dl class="development-conditions"><dt>Рабочее пространство</dt><dd><ul>'+context.places.map(p=>'<li>'+e(p)+'</li>').join('')+'</ul></dd><dt>Участники</dt><dd>'+e(context.roles)+'</dd><dt>Финансы</dt><dd>'+e(context.finance)+'</dd></dl></details>'+focus+'<p class="development-plan-note">Номер — место в карте. Задача — предварительный порядок выполнения с учётом известных связей.</p><div class="development-map-tree"><div class="development-tree-root">'+e(selected.name)+' · '+e(own[mode])+'</div>'+list+'</div></div></section>':'')+'</div>';
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
  let state={activity:null,mode:0,open:new Set(),snapshot:null,audits:[],loading:true,stale:false},request=0;
  const draw=(anchor=null)=>{
    if(!isCurrent())return;
    const canvas=content.querySelector('.development-canvas');
    const top=canvas?.scrollTop||0,left=canvas?.scrollLeft||0;
    const anchorKey=anchor?.dataset.dmToggle,offset=anchor?.getBoundingClientRect().top;
    const template=content.ownerDocument.createElement('template');template.innerHTML=developmentMarkup(state,escapeHtml);
    const root=content.querySelector('.development-map');
    if(root)patchDevelopmentNode(root,template.content.firstElementChild);
    else content.replaceChildren(template.content);
    const nextCanvas=content.querySelector('.development-canvas');
    if(nextCanvas&&canvas===nextCanvas){
      nextCanvas.scrollTop=top;nextCanvas.scrollLeft=left;
      if(anchorKey&&Number.isFinite(offset)){
        const button=[...nextCanvas.querySelectorAll('[data-dm-toggle]')].find(el=>el.dataset.dmToggle===anchorKey);
        if(button)nextCanvas.scrollTop+=button.getBoundingClientRect().top-offset;
      }
    }
  };
  content.onclick=event=>{
    if(!isCurrent())return;
    const button=event.target.closest('button');
    if(!button||!content.contains(button))return;
    if(button.hasAttribute('data-dm-activity')){
      state.activity=button.dataset.dmActivity;state.mode=Number(button.dataset.dmMode);
      state.open=new Set(sections.map(([,keys])=>'group:'+keys[0]));draw();return;
    }
    if(button.hasAttribute('data-dm-close')){state.activity=null;state.open=new Set();draw();return;}
    const id=button.dataset.dmToggle;if(!id)return;
    if(state.open.has(id))state.open.delete(id);else state.open.add(id);
    draw(button);
  };
  async function refresh(){
    const id=++request;
    const results=await Promise.allSettled([load(),loadCore(),loadUser()]);
    if(id!==request||!isCurrent())return;
    if(results[0].status==='fulfilled')state.snapshot=results[0].value;
    state.audits=[1,2].map((n,i)=>results[n].status==='fulfilled'?results[n].value:state.audits[i]);
    state.loading=false;state.stale=results.some(r=>r.status!=='fulfilled');draw();
  }
  draw();void refresh();
}
