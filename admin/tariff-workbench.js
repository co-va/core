// Interactive tariff design preview. The preview does not write commercial data.
const drafts = new Map();
const rub = n => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2}).format(Math.max(0, Number(n)||0)) + ' ₽';
const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (n,max=1000000) => Math.min(max,Math.max(0, Number(n)||0));
const iso = () => new Date().toISOString().slice(0,10);
let previewDate = iso(), toolsOpen = false, filter = 'included';
function initial(t) {
  const amount = num(Number(t.priceMinor)/100);
  const periods = {};
  for(const months of [1,6,12]) periods[months] = {
    giftDays: num(t.periods?.find(x=>x.months===months)?.bonusDays||0,3650),
    discount:0, discountRub:0
  };
  return {name:t.name,free:t.key==='tariff.start',price:amount,was:amount,periods,
    publishFrom:'',publishUntil:'',toolOverrides:{}, campaign:{enabled:false,from:'',until:'',repeat:0,length:7,months:6,kind:'percent',discount:50,giftDays:0}};
}
function value(t){if(!drafts.has(t.key))drafts.set(t.key,initial(t));return drafts.get(t.key);}
function monthDate(s,n){
  const d = new Date(s+'T12:00:00Z'); if(!Number.isFinite(d.getTime()))return null;
  const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);
  const limit=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,limit));return d;
}
function active(c,date) {
  if(!c.enabled||!c.from)return false;
  const at=monthDate(date,0),first=monthDate(c.from,0);
  if(!at||!first||at<first||c.until&&date>c.until)return false;
  const step=num(c.repeat,120),length=Math.max(1,num(c.length,366));
  for(let months=0;months<1200;months+=step||1200){
    const start=monthDate(c.from,months);if(!start||start>at)break;
    const end=new Date(start);end.setUTCDate(end.getUTCDate()+length-1);
    if(at<=end)return true;
  }
  return false;
}
function previewReadiness(t, getter) {
  const b=getter(t), d=value(t);
  const rows=(b.rows||[]).map(r=>({...r,included:Object.prototype.hasOwnProperty.call(d.toolOverrides,r.key)?d.toolOverrides[r.key]:r.included}));
  const included=rows.filter(r=>r.included),ready=included.filter(r=>r.status==='READY').length;
  const testing=included.filter(r=>r.status==='TESTING').length;
  return {...b,rows,ready,testing,total:included.length,percent:included.length?Math.round(100*ready/included.length):0};
}
function offer(d,m,date) {
  const p=d.periods[m],before=d.free?0:d.price*m,was=d.free?0:Math.max(d.was,d.price)*m;
  const ordinary=Math.max(0,before*(1-num(p.discount,100)/100)-num(p.discountRub));
  const on=!d.free&&d.campaign.months===m&&active(d.campaign,date);
  const cut=on?(d.campaign.kind==='percent'?ordinary*num(d.campaign.discount,100)/100:num(d.campaign.discount)):0;
  const amount=Math.max(0,ordinary-cut), gift=Math.round(num(p.giftDays,3650)+(on?num(d.campaign.giftDays,3650):0));
  return {amount,was,days:30*m+gift,gift,discount:was>0?Math.round((1-amount/was)*100):0,on};
}
const field=(name,scope,key,val,type='number',more='')=>'<label class="tw-field"><span>'+esc(name)+'</span><input type="'+type+'" data-tw-'+scope+'="'+key+'" value="'+esc(val)+'" '+more+'></label>';
const pick=(name,scope,key,val,opts)=>'<label class="tw-field"><span>'+esc(name)+'</span><select data-tw-'+scope+'="'+key+'">'+opts.map(o=>'<option value="'+esc(o[0])+'" '+(String(val)===String(o[0])?'selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select></label>';
const duration=d=>d%30===0?(d/30)+' мес.':d+' дн.';
export function renderTariffWorkbench({content,tiers,selectedKey,readinessFor,onSelect,onPublish,onTools}){
  const selected=tiers.find(t=>t.key===selectedKey), d=selected&&value(selected);
  const onStage=typeof location!=='undefined'&&/amvera\.tech$/.test(location.hostname);
  const cards=tiers.map(t=>{
    const v=value(t),h=previewReadiness(t,readinessFor),one=offer(v,1,previewDate),six=offer(v,6,previewDate);
    return '<article class="admin-overview-metric tw-card '+(selectedKey===t.key?'is-selected':'')+'">'+
      '<button type="button" class="tw-open" data-tw-open="'+esc(t.key)+'" aria-expanded="'+(selectedKey===t.key)+'">'+
      '<span class="tw-top"><strong>'+esc(v.name)+'</strong><span aria-hidden="true">'+(selectedKey===t.key?'−':'+')+'</span></span>'+
      '<span class="tw-price">'+(v.free?'Бесплатно':v.price<=0?'Цена не задана':rub(one.amount))+(one.was>one.amount?'<s>'+rub(one.was)+'</s>':'')+'</span>'+
      '<span class="tw-muted">'+(v.free?'Без оплаты':'за 30 дней')+(one.discount?' · −'+one.discount+'%':'')+'</span>'+
      '<span class="tw-promise">'+(v.free?'Без ограничения срока':'6 месяцев · '+(v.price<=0?'Цена не задана':rub(six.amount))+(six.gift?' · +'+duration(six.gift)+' в подарок':''))+'</span>'+
      '<span class="tw-muted tw-readiness">'+h.ready+' из '+h.total+' готово · '+(h.percent??0)+'%'+(h.testing?' · '+h.testing+' в проверке':'')+'</span>'+
      '<span class="tw-track"><i style="width:'+(h.percent||0)+'%"></i></span></button>'+
      '<button type="button" class="tw-publish" data-tw-publish="'+esc(t.key)+'" '+(onStage?'disabled title="В предпросмотре публикация не изменяется"':'')+'>'+(t.isSaleable?'Опубликован':'Не опубликован')+'</button></article>';
  }).join('');
  let editor='';
  if(d){
    const h=previewReadiness(selected,readinessFor),c=d.campaign;
    editor='<section class="tw-editor" aria-label="Управление тарифом '+esc(d.name)+'">'+
      '<div class="admin-overview-tariffs-heading tw-section-head">'+
        '<strong>'+esc(d.name)+' <span>/ Ценовые условия</span></strong>'+
        '<div class="tw-head-actions"><small>Интерактивный предпросмотр конструктора · без сохранения</small>'+
        '<button type="button" class="admin-overview-inline-link tw-reset" data-tw-reset>Сбросить изменения '+esc(d.name)+'</button>'+
        '<button type="button" class="tw-close" data-tw-close aria-label="Свернуть тариф">×</button></div></div>'+
      '<section class="tw-panel tw-price-panel"><h4>Цена тарифа</h4><div class="tw-fields tw-fields--pricing">'+
        pick('Тип тарифа','base','free',d.free?'yes':'no',[['yes','Бесплатный'],['no','Платный']])+
        field('Цена продажи за 30 дней, ₽','base','price',d.price,'number','min="0" step="1" '+(d.free?'disabled':''))+
        field('Цена до скидки, ₽','base','was',d.was,'number','min="0" step="1" '+(d.free?'disabled':''))+
      '</div></section>'+
      '<div class="tw-subhead"><strong>Условия по срокам</strong><span>30 дней = 1 месяц; скидка и подарочное время независимы</span></div>'+
      '<div class="tw-period-grid">'+[1,6,12].map(m=>{
        const p=d.periods[m],o=offer(d,m,previewDate);
        return '<section class="tw-panel tw-period"><h4>'+m+' '+(m===1?'месяц':'месяцев')+'</h4>'+
          '<div class="tw-period-fields">'+
            field('Месяцев в подарок','period',m+'-giftMonths',Math.floor(p.giftDays/30),'number','min="0" max="120" step="1"')+
            field('Дополнительно дней','period',m+'-giftRemainder',p.giftDays%30,'number','min="0" max="29" step="1"')+
            field('Скидка, %','period',m+'-discount',p.discount,'number','min="0" max="100" step="1"')+
            field('Скидка, ₽','period',m+'-discountRub',p.discountRub,'number','min="0" step="1"')+
          '</div><div class="tw-result"><strong>'+rub(o.amount)+'</strong><span>'+o.days+' дней доступа'+(o.gift?' · +'+duration(o.gift)+' в подарок':'')+'</span></div>'+
        '</section>';
      }).join('')+'</div>'+
      '<section class="tw-panel tw-publication"><div><h4>Публикация тарифа</h4>'+
        '<p>Показывает или скрывает тариф на сайте. Даты и скидки акции задаются отдельно ниже.</p></div>'+
        '<span class="tw-status">'+(selected.isSaleable?'Опубликован':'Не опубликован')+'</span></section>'+
      '<section class="tw-panel tw-campaign"><div class="tw-campaign-head"><h4>Акция</h4>'+
        '<label class="tw-check"><input type="checkbox" data-tw-campaign="enabled" '+(c.enabled?'checked':'')+'> Включить акцию</label></div>'+
        '<div class="tw-fields tw-fields--campaign">'+
          pick('Для периода','campaign','months',c.months,[[1,'1 месяц'],[6,'6 месяцев'],[12,'12 месяцев']])+
          pick('Вид скидки','campaign','kind',c.kind,[['percent','Проценты'],['rub','Рубли']])+
          field(c.kind==='percent'?'Размер скидки, %':'Размер скидки, ₽','campaign','discount',c.discount,'number','min="0" step="1"')+
          field('Дополнительно дней в подарок','campaign','giftDays',c.giftDays,'number','min="0" step="1"')+
          field('Дата начала акции','campaign','from',c.from,'date')+
          field('Окончание программы акций','campaign','until',c.until,'date')+
          field('Повтор через N месяцев','campaign','repeat',c.repeat,'number','min="0" max="120" step="1"')+
          field('Длительность акции, дней','campaign','length',c.length,'number','min="1" max="366" step="1"')+
        '</div><p class="tw-hint">Если повтор = 0, акция проходит один раз. Скидка акции добавляется к обычным условиям.</p></section>'+
      '<div class="tw-subhead tw-preview-heading"><strong>Предпросмотр для покупателя</strong>'+
        field('На дату','preview','date',previewDate,'date')+'</div>'+
      '<div class="tw-offers-grid">'+[1,6,12].map(m=>{
        const o=offer(d,m,previewDate);
        return '<article class="tw-panel tw-offer"><strong class="tw-offer-period">'+m+' '+(m===1?'месяц':'месяцев')+(o.on?' · Акция':'')+'</strong>'+
          '<span class="tw-offer-price">'+rub(o.amount)+(o.was>o.amount?'<s>'+rub(o.was)+'</s>':'')+'</span>'+
          '<span class="tw-offer-access">'+o.days+' дней доступа</span>'+
          '<small>'+(o.gift?'+'+duration(o.gift)+' в подарок':'Без подарочных дней')+(o.discount?' · −'+o.discount+'%':'')+'</small></article>';
      }).join('')+'</div>'+
      '<details class="tw-tools" '+(toolsOpen?'open':'')+'>'+
        '<summary class="admin-overview-tariffs-heading tw-tools-summary"><strong>Инструменты тарифа <span>/ '+h.ready+' из '+h.total+' готово</span></strong><span class="tw-tools-chevron" aria-hidden="true">⌄</span></summary>'+
        '<div class="admin-overview-detail tw-tools-inner"><div class="tw-tool-actions">'+
          pick('Показывать','filter','value',filter,[['included','Включённые'],['all','Все'],['testing','В проверке'],['not-ready','Не готово']])+
          '<button type="button" class="admin-overview-inline-link" data-tw-tools-nav>Настроить в «Инструментах» ↗</button></div>'+
          h.rows.filter(r=>filter==='all'||filter==='included'&&r.included||filter==='testing'&&r.status==='TESTING'||filter==='not-ready'&&r.status!=='READY').map(r=>
            '<div class="tw-tool-row"><span>'+esc(r.name)+'</span><label><input type="checkbox" data-tw-include="'+esc(r.key)+'" '+(r.included?'checked':'')+' aria-label="Включить '+esc(r.name)+'"></label><small>'+esc(r.status==='READY'?'Готово':r.status==='TESTING'?'В проверке':r.status==='NOT_READY'?'Не готово':'Нет данных')+'</small></div>').join('')+
        '</div></details>'+
      '</section>';
  }
  content.innerHTML='<div class="admin-overview admin-tariff-section tw"><div class="admin-heading"><h2>Тарифы</h2></div>'+
    '<div class="admin-overview-tariffs-heading"><strong>Кабинет <span>/ Professional</span></strong></div>'+
    '<div class="admin-overview-metrics admin-overview-tariff-metrics">'+cards+'</div>'+editor+'</div>';
  function rerender(){renderTariffWorkbench({content,tiers,selectedKey,readinessFor,onSelect,onPublish,onTools});}
  content.querySelectorAll('[data-tw-open]').forEach(el=>el.addEventListener('click',()=>onSelect(el.dataset.twOpen)));
  content.querySelector('[data-tw-close]')?.addEventListener('click',()=>onSelect(''));
  content.querySelectorAll('[data-tw-publish]').forEach(el=>el.addEventListener('click',()=>onPublish(el.dataset.twPublish)));
  content.querySelector('[data-tw-tools-nav]')?.addEventListener('click',onTools);
  content.querySelector('[data-tw-reset]')?.addEventListener('click',()=>{drafts.delete(selectedKey);rerender();});
  const bind=(selector,fn)=>content.querySelectorAll(selector).forEach(el=>el.addEventListener('change',()=>{fn(el);rerender();}));
  if(d){
    bind('[data-tw-base]',el=>{const k=el.dataset.twBase;d[k]=k==='free'?el.value==='yes':k==='price'||k==='was'?num(el.value):el.value;});
    bind('[data-tw-period]',el=>{const [m,key]=el.dataset.twPeriod.split('-');const p=d.periods[m];if(key==='giftMonths')p.giftDays=Math.round(num(el.value,120)*30)+(p.giftDays%30);else if(key==='giftRemainder')p.giftDays=Math.floor(p.giftDays/30)*30+Math.round(num(el.value,29));else p[key]=num(el.value,key==='discount'?100:1000000);});
    bind('[data-tw-include]',el=>{d.toolOverrides[el.dataset.twInclude]=el.checked;toolsOpen=true;});
    bind('[data-tw-campaign]',el=>{const k=el.dataset.twCampaign;d.campaign[k]=k==='enabled'?el.checked:['repeat','length','months','discount','giftDays'].includes(k)?num(el.value):el.value;});
    content.querySelector('[data-tw-preview]')?.addEventListener('change',e=>{previewDate=e.target.value||iso();rerender();});
    content.querySelector('[data-tw-filter]')?.addEventListener('change',e=>{filter=e.target.value;toolsOpen=true;rerender();});
    content.querySelector('.tw-tools')?.addEventListener('toggle',e=>{toolsOpen=e.target.open;});
  }
}
