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
  'workspace.profile':['Переключение рабочего пространства подтверждено 15.11.2026.','Проверить оставшиеся действия управления пространством.'],
  'workspace.multiple':['Переключение пространств подтверждено 15.11.2026.','Проверить независимость данных.'],
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
  const found=c.work?.finding||'Целевое требование. Текущая реализация ещё не обследована.';
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
  let next=c.work?.next||'Сопоставить требование с существующей реализацией и проверить рабочий сценарий.';
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
  return {key:c.key,status,found:latest?.result||found,next,history:[...(historic?[historic[0]]:[]),...confirmed.map(x=>x.date+': '+x.result)],candidate:status==='ready'?candidate?.result:null,deferred:priority?.kind==='deferred',evidence:[...new Map(checks.filter(x=>['passed','historical','failed'].includes(x.state)).map(x=>[x.id,x])).values()].map(x=>({title:x.title,state:x.state}))};
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
  const working=active.some(v=>['ready','partial','pending','disputed'].includes(v.status)||v.status==='unfinished'&&v.blocking===false);
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
export function developmentMarkup({activity=null,mode=0,open=new Set(),snapshot=null,audits=[],loading=false,stale=false},e){
  const selected=ACTIVITIES.find(a=>a.id===activity);
  const scenario=selected?scenarioMechanisms(activity,mode):[];
  const graph=ACTIVITIES.map(a=>'<section class="admin-overview-panel development-activity"><div class="admin-overview-panel-head"><h3>'+e(a.name)+'</h3></div>'+
    own.map((name,i)=>{const active=a.id===activity&&mode===i;
      return '<button type="button" class="admin-overview-person development-mode" data-dm-activity="'+e(a.id)+'" data-dm-mode="'+i+'" aria-expanded="'+active+'"'+(active?' aria-controls="development-scenario"':'')+'>'+row(name,active?'Выбрано':'',null,'<span class="development-disclosure" aria-hidden="true">'+(active?'▾':'▸')+'</span>',e)+'</button>';
    }).join('')+'</section>').join('');
  const list=sections.map(([section,keys])=>{
    const members=scenario.filter(m=>m.section===section);
    if(!members.length)return '';
    const groupId='group:'+keys[0];
    const expanded=open.has(groupId);
    const groupStatus=developmentProgress(members.flatMap(m=>m.criteria.map(c=>({...criterionView(c,snapshot,audits),blocking:m.applicability==='Основной'}))),!!snapshot);
    return '<section class="admin-overview-panel development-group"><button class="admin-overview-person development-group-head" type="button" data-dm-toggle="'+e(groupId)+'" aria-expanded="'+expanded+'">'+row(section,members.length+' '+(members.length===1?'механизм':members.length<5?'механизма':'механизмов'),groupStatus,'<span class="development-disclosure" aria-hidden="true">'+(expanded?'▾':'▸')+'</span>',e)+'</button>'+
      (expanded?'<div class="development-mechanisms">'+scopeGroups.map(([heading,applicability])=>{
        const rows=members.filter(m=>m.applicability===applicability);
        if(!rows.length)return '';
        return '<div class="development-applicability"><h4>'+e(heading)+'</h4>'+rows.map(m=>{
          const views=m.criteria.map(c=>criterionView(c,snapshot,audits));const status=developmentProgress(views,!!snapshot);const key='mechanism:'+m.id;const show=open.has(key);
          return '<div class="development-mechanism"><button class="admin-overview-person" type="button" data-dm-toggle="'+e(key)+'" aria-expanded="'+show+'">'+row(m.label,m.priority+' · '+activityLabel(m.id),status,'<span class="development-disclosure" aria-hidden="true">'+(show?'▾':'▸')+'</span>',e)+'</button>'+
            (show?'<div class="development-criteria">'+m.criteria.map((c,i)=>{const v=views[i];return '<div class="development-criterion"><div class="development-criterion-head"><strong>'+e(c.title)+'</strong>'+mark(developmentProgress([v],!!snapshot),e)+'</div>'+'<p>'+e(v.found)+'</p>'+v.history.map(h=>'<p>'+e(h)+'</p>').join('')+v.evidence.map(x=>'<p>'+e(x.state==='passed'?'Проверено: ':x.state==='historical'?'Ранее проверено: ':'Пакет проверки не пройден: ')+e(x.title)+'</p>').join('')+(v.candidate?'<p>Новое изменение: '+e(v.candidate)+'</p>':'')+'<p><strong>Осталось:</strong> '+e(v.next)+'</p></div>';}).join('')+'</div>':'')+'</div>';
        }).join('')+'</div>';
      }).join('')+'</div>':'')+'</section>';
  }).join('');
  const context=contexts[mode]||contexts[0];
  return '<div class="admin-overview development-map"><div class="admin-heading admin-overview-heading"><div><h2>Карта развития</h2><p>Что необходимо для работы, что уже реализовано и что осталось.</p></div></div>'+
    '<div class="development-root"><div class="admin-overview-app-head"><h3>Единое покрытие платформы</h3></div></div>'+
    '<div class="development-activities">'+graph+'</div>'+
    (loading?'<p class="development-message" role="status">Загрузка данных готовности…</p>':stale?'<p class="development-message" role="status">Не все сведения о готовности получены. Прежние подтверждения сохранены.</p>':'')+
    (selected?'<section id="development-scenario" class="development-scenario"><div class="admin-overview-app-head development-scenario-head"><h3>'+e(selected.name)+' <span class="admin-overview-head-suffix">/ '+e(own[mode])+'</span></h3><button class="admin-overview-close" type="button" data-dm-close aria-label="Свернуть подробности">×</button></div>'+
      '<section class="admin-overview-panel"><div class="admin-overview-panel-head"><h3>Описание условий работы</h3></div><dl class="development-conditions"><dt>Рабочее пространство</dt><dd><ul>'+context.places.map(p=>'<li>'+e(p)+'</li>').join('')+'</ul></dd><dt>Участники</dt><dd>'+e(context.roles)+'</dd><dt>Финансы</dt><dd>'+e(context.finance)+'</dd></dl></section>'+list+'</section>':'')+'</div>';
}
export function renderDevelopmentMap(content,{escapeHtml,isCurrent,load=loadOperationalReadiness,loadCore=loadCoreAudit,loadUser=loadUserAudit}){
  if(!content)return;
  let state={activity:null,mode:0,open:new Set(),snapshot:null,audits:[],loading:false,stale:false},request=0;
  const draw=()=>{
    if(!isCurrent())return;
    content.innerHTML=developmentMarkup(state,escapeHtml);
    content.querySelectorAll('[data-dm-activity]').forEach(b=>b.addEventListener('click',()=>{
      const activity=b.dataset.dmActivity,mode=Number(b.dataset.dmMode);
      state.activity=state.activity===activity&&state.mode===mode?null:activity;state.mode=mode;state.open=new Set();draw();
      if(state.activity)content.querySelector('#development-scenario')?.scrollIntoView({block:'start',behavior:'auto'});
    }));
    content.querySelector('[data-dm-close]')?.addEventListener('click',()=>{state.activity=null;state.open=new Set();draw();content.querySelector('.development-root')?.scrollIntoView({block:'start',behavior:'auto'});});
    content.querySelectorAll('[data-dm-toggle]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.dmToggle;if(state.open.has(id))state.open.delete(id);else state.open.add(id);draw();[...content.querySelectorAll('[data-dm-toggle]')].find(el=>el.dataset.dmToggle===id)?.focus({preventScroll:true});}));
  };
  async function refresh(){
    const id=++request;state.loading=true;draw();
    const results=await Promise.allSettled([load(),loadCore(),loadUser()]);
    if(id!==request||!isCurrent())return;
    if(results[0].status==='fulfilled')state.snapshot=results[0].value;
    state.audits=[1,2].map((n,i)=>results[n].status==='fulfilled'?results[n].value:state.audits[i]);
    state.loading=false;state.stale=results.some(r=>r.status!=='fulfilled');draw();
  }
  draw();void refresh();
}
