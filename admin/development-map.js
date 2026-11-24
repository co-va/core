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
const places=['Собственное помещение','Арендованное помещение','Арендованное рабочее место','Пространство работодателя','Выездная / дистанционная работа'];
const optional=new Set(['resources','orders','logistics','service-stages','loyalty','marketing','analytics','planning','integration','quality']);
export function scenarioMechanisms(activity,mode) {
  const act=ACTIVITIES.find(a=>a.id===activity);
  if(!act||!Number.isInteger(mode)||mode<0||mode>2)return [];
  // Same mechanism can be relevant in several scenarios; assistant/help is independent of rental.
  const ids=new Set([...both,...act.ids,...team,...growth]);
  return sections.flatMap(([name,keys])=>keys.filter(k=>ids.has(k)).map(k=>({ ...byId.get(k),section:name,
    applicability: mode===2&&['obligations','tax','planning','cost','inventory','marketing','analytics','loyalty','orders','logistics'].includes(k)?'По полномочиям':
      optional.has(k)||mode===0&&team.includes(k)||activity==='services'&&['products','sales','inventory'].includes(k)||activity==='trade'&&k==='time'&&mode===0?'При необходимости':'Основной',
    priority: ['marketing','analytics','planning'].includes(k)?'Позднее · Pro (предложение)':
      ['loyalty','quality','orders','logistics','resources','service-stages','integration'].includes(k)||mode===0&&team.includes(k)?'Следующий этап':'Первостепенно'
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
const statusLabels={ready:'Готово',partial:'Частично готово',pending:'Нужно проверить',unfinished:'Нужно доделать',unknown:'Не обследовано',disputed:'Уточнить приёмку',deferred:'Отложено'};
export function criterionView(c,snapshot,audits=[]){
  const row=snapshot?.mechanisms?.flatMap(m=>m.rows).find(r=>r.key===c.key);
  const found=c.work?.finding||'Целевое требование. Текущая реализация ещё не обследована.';
  const historic=historical[c.key];
  const events=eventsFor(snapshot,c.key);
  const confirmed=events.filter(x=>x.kind==='confirmed-action'||x.kind==='accepted'&&x.ownerConfirmed===true&&proved(x)&&x.remaining==='');
  const resolution=events.filter(x=>x.kind==='disputed'||x.kind==='accepted'&&x.ownerConfirmed===true&&proved(x)&&x.remaining===''||x.kind==='regression'&&x.environment==='deployed'&&proved(x)&&x.remaining.trim()).at(-1);
  const latest=events.at(-1);
  const candidate=events.filter((x,i)=>['candidate','implemented'].includes(x.kind)&&(!resolution||i>events.indexOf(resolution))).at(-1);
  const checks=audits.flatMap(x=>x?.scenarios||[]).filter(x=>x.criteria?.includes(c.key));
  let status=c.work?.state==='finish'?'unfinished':c.work?.state==='verify'?'pending':'unknown';
  let next=c.work?.next||'Сопоставить требование с существующей реализацией и проверить рабочий сценарий.';
  if(row?.state==='accepted'){status='ready';next='Принято. Не повторять проверку без основания.';}
  else if(row?.accepted){status='partial';next='Прежняя приёмка сохранена; проверить влияние изменений.';}
  if(historic){status=c.key==='catalog.prof'?'disputed':'partial';next=historic[1];}
  if(confirmed.length&&status!=='ready'&&status!=='disputed'){status='partial';next=latest?.remaining||next;}
  if(candidate&&status!=='ready'&&status!=='disputed'){status='pending';next=candidate.remaining||next;}
  if(checks.some(x=>x.state==='failed')&&status!=='ready'&&status!=='disputed'){status='unfinished';}
  if(resolution?.kind==='accepted'){status='ready';next='Вопрос принят. Проверять только затронутые изменения.';}
  if(resolution?.kind==='disputed'){status='disputed';next=resolution.remaining||'Уточнить приёмку.';}
  if(resolution?.kind==='regression'){status='unfinished';next=resolution.remaining;}
  const priority=events.filter(x=>['deferred','resume'].includes(x.kind)&&x.ownerConfirmed===true).at(-1);
  return {status,label:statusLabels[status],found:latest?.result||found,next,history:[...(historic?[historic[0]]:[]),...confirmed.map(x=>x.date+': '+x.result)],candidate:status==='ready'?candidate?.result:null,deferred:priority?.kind==='deferred'};
}
const aggregate=views=>views.every(v=>v.status==='ready')?'ready':views.every(v=>v.status==='unknown')?'unknown':views.some(v=>v.status==='ready'||v.status==='partial')?'partial':views.some(v=>v.status==='unfinished')?'unfinished':views.some(v=>v.status==='disputed')?'disputed':'pending';
const icon=status=>status==='ready'?'✓':status==='unfinished'?'!':status==='partial'?'◐':status==='disputed'?'?':'○';
const mark=(status,e)=>'<span class="dm-status dm-status--'+status+'"><span aria-hidden="true">'+icon(status)+'</span> '+e(statusLabels[status])+'</span>';
export function developmentMarkup({activity='services',mode=0,open=new Set(),snapshot=null,audits=[],loading=false,stale=false,zoom=1},e){
  const scenario=scenarioMechanisms(activity,mode);
  const graph=ACTIVITIES.map(a=>'<div class="dm-branch"><div class="dm-activity">'+e(a.name)+'</div><div class="dm-modes">'+own.map((name,i)=>'<button type="button" class="dm-mode'+(a.id===activity&&mode===i?' is-selected':'')+'" data-dm-activity="'+a.id+'" data-dm-mode="'+i+'" aria-pressed="'+(a.id===activity&&mode===i)+'">'+e(name)+'</button>').join('')+'</div></div>').join('');
  const list=sections.map(([section])=>{
    const rows=scenario.filter(m=>m.section===section);
    if(!rows.length)return '';
    return '<section class="dm-group"><h3>'+e(section)+'</h3><div class="dm-mechanisms">'+rows.map(m=>{
      const views=m.criteria.map(c=>criterionView(c,snapshot,audits));const status=aggregate(views);const expanded=open.has(m.id);
      return '<article class="dm-mechanism"><button class="dm-mechanism-head" type="button" data-dm-toggle="'+m.id+'" aria-expanded="'+expanded+'"><span class="dm-mechanism-title">'+e(m.label)+'</span><span class="dm-chevron" aria-hidden="true">'+(expanded?'−':'+')+'</span><span class="dm-meta">'+e(m.applicability)+' · '+e(m.priority)+'</span>'+mark(status,e)+'</button>'+
        (expanded?'<div class="dm-criteria">'+m.criteria.map((c,i)=>{const v=views[i];return '<div class="dm-criterion"><div class="dm-criterion-head"><strong>'+e(c.title)+'</strong>'+mark(v.status,e)+'</div>'+ (v.deferred?'<p class="dm-deferred">Отложено по решению владельца</p>':'') +'<p>'+e(v.found)+'</p>'+v.history.map(h=>'<p class="dm-history">'+e(h)+'</p>').join('')+(v.candidate?'<p>Новое изменение: '+e(v.candidate)+'</p>':'')+'<p class="dm-next"><strong>Осталось:</strong> '+e(v.next)+'</p></div>';}).join('')+'</div>':'')+'</article>';
    }).join('')+'</div></section>';
  }).join('');
  const selected=ACTIVITIES.find(a=>a.id===activity);
  return '<section class="dm"><div class="admin-heading dm-heading"><div><h2>Карта развития</h2><p>Что необходимо для работы, что уже реализовано и что осталось.</p></div><div class="dm-actions"><button type="button" data-dm-zoom="-1" aria-label="Уменьшить масштаб">−</button><button type="button" data-dm-zoom="0" aria-label="Сбросить масштаб">'+Math.round(zoom*100)+'%</button><button type="button" data-dm-zoom="1" aria-label="Увеличить масштаб">+</button><button type="button" data-dm-refresh '+(loading?'disabled':'')+'>'+(loading?'Обновление…':'Обновить')+'</button></div></div>'+
    (stale?'<p class="dm-notice">Не все сведения о готовности получены. Прежние подтверждения не отменены.</p>':'')+
    '<div class="dm-viewport"><div class="dm-map" style="--dm-scale:'+zoom+'"><div class="dm-root">Единое покрытие платформы</div><div class="dm-fork">'+graph+'</div><div class="dm-context"><h3>'+e(selected.name)+' / '+e(own[mode])+'</h3><div class="dm-condition"><strong>Условия работы</strong><div>'+places.map(p=>'<span>'+e(p)+'</span>').join('')+'</div><p>Помощники и сотрудники могут участвовать при любом подходящем условии. Механизмы общие; конкретные полномочия и расходы зависят от условий.</p></div><p class="dm-caption">Основной / при необходимости / по полномочиям — применимость. Приоритеты предварительные, не состав тарифов. Новые требования включены в карту, но ещё не обследованы.</p></div>'+list+'</div></div></section>';
}
export function renderDevelopmentMap(content,{escapeHtml,isCurrent,load=loadOperationalReadiness,loadCore=loadCoreAudit,loadUser=loadUserAudit}){
  if(!content)return;
  let state={activity:'services',mode:0,open:new Set(),snapshot:null,audits:[],loading:false,stale:false,zoom:1},request=0;
  const draw=()=>{
    if(!isCurrent())return;
    const prior=content.querySelector('.dm-viewport');
    const pos=prior?{left:prior.scrollLeft,top:prior.scrollTop}:null;
    content.innerHTML=developmentMarkup(state,escapeHtml);
    const viewport=content.querySelector('.dm-viewport');
    if(pos&&viewport){viewport.scrollLeft=pos.left;viewport.scrollTop=pos.top;}
    content.querySelectorAll('[data-dm-activity]').forEach(b=>b.addEventListener('click',()=>{state.activity=b.dataset.dmActivity;state.mode=Number(b.dataset.dmMode);state.open=new Set();draw();}));
    content.querySelectorAll('[data-dm-toggle]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.dmToggle;if(state.open.has(id))state.open.delete(id);else state.open.add(id);draw();content.querySelector('[data-dm-toggle="'+id+'"]')?.focus({preventScroll:true});}));
    content.querySelectorAll('[data-dm-zoom]').forEach(b=>b.addEventListener('click',()=>{const step=Number(b.dataset.dmZoom);state.zoom=step?Math.max(0.9,Math.min(1.8,Math.round((state.zoom+step*.1)*10)/10)):1;draw();}));
    content.querySelector('[data-dm-refresh]')?.addEventListener('click',refresh);
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
