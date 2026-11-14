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
  return {name:t.name,free:amount===0,price:amount,was:amount,periods,
    publishFrom:'',publishUntil:'', campaign:{enabled:false,from:'',until:'',repeat:0,length:7,months:6,kind:'percent',discount:50,giftDays:0}};
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
  const selected=tiers.find(x=>x.key===selectedKey), d=selected&&value(selected);
  const onStage=typeof location!=='undefined'&&/amvera\.tech$/.test(location.hostname);
  const cards=tiers.map(t=>{
    const v=value(t),h=readinessFor(t),one=offer(v,1,previewDate),six=offer(v,6,previewDate);
    return '<article class="admin-overview-metric tw-card '+(selectedKey===t.key?'is-selected':'')+'">'+
      '<button type="button" class="tw-open" data-tw-open="'+esc(t.key)+'" aria-expanded="'+(selectedKey===t.key)+'">'+
      '<span class="tw-top"><strong>'+esc(v.name)+'</strong><span>'+(selectedKey===t.key?'−':'+')+'</span></span>'+
      '<span class="tw-price">'+(v.free?'Бесплатно':rub(one.amount))+(one.was>one.amount?'<s>'+rub(one.was)+'</s>':'')+'</span>'+
      '<span class="tw-muted">'+(v.free?'Без оплаты':'за 30 дней')+(one.discount?' · −'+one.discount+'%':'')+'</span>'+
      '<span class="tw-promise">'+(v.free?'Без ограничения срока':'6 месяцев · '+rub(six.amount)+(six.gift?' · +'+duration(six.gift)+' в подарок':''))+'</span>'+
      '<span class="tw-muted tw-readiness">'+h.ready+' из '+h.total+' готово · '+(h.percent??0)+'%'+(h.testing?' · '+h.testing+' в проверке':'')+'</span>'+
      '<span class="tw-track"><i style="width:'+(h.percent||0)+'%"></i></span></button>'+
      '<button type="button" class="tw-publish" data-tw-publish="'+esc(t.key)+'" '+(onStage?'disabled title="В предпросмотре публикация не изменяется"':'')+'>'+(t.isSaleable?'Опубликован':'Не опубликован')+'</button></article>';
  }).join('');
  let editor='';
  if(d){
    const h=readinessFor(selected),c=d.campaign;
    editor='<section class="admin-overview-detail tw-editor"><header class="tw-title"><div><small>Управление тарифом</small><h3>'+esc(d.name)+'</h3></div><button type="button" class="admin-overview-close" data-tw-close aria-label="Свернуть">×</button></header>'+
    '<section class="tw-panel"><h4>Цена и условия</h4><div class="tw-fields">'+
      pick('Тип тарифа','base','free',d.free?'yes':'no',[['yes','Бесплатный'],['no','Платный']])+
      field('Цена продажи за 30 дней, ₽','base','price',d.price,'number','min="0" step="1" '+(d.free?'disabled':''))+
      field('Цена до скидки, ₽','base','was',d.was,'number','min="0" step="1" '+(d.free?'disabled':''))+
    '</div><p class="tw-note">Старая цена показывается зачёркнутой только когда выше текущей.</p></section>'+
    '<section class="tw-panel"><h4>Условия по срокам</h4><p class="tw-note">Месяц = 30 дней. Подарок и скидку можно сочетать.</p>'+
      [1,6,12].map(m=>{
        const p=d.periods[m],o=offer(d,m,previewDate);
        return '<div class="tw-period"><strong>'+m+' мес.</strong><div class="tw-fields">'+
          field('Дней в подарок','period',m+'-giftDays',p.giftDays,'number','min="0" max="3650" step="1"')+
          field('Скидка, %','period',m+'-discount',p.discount,'number','min="0" max="100" step="1"')+
          field('Скидка, ₽','period',m+'-discountRub',p.discountRub,'number','min="0" step="1"')+
        '</div><div class="tw-result"><strong>'+rub(o.amount)+'</strong><span>'+o.days+' дней доступа'+(o.gift?' · +'+duration(o.gift)+' в подарок':'')+'</span></div></div>';
      }).join('')+'</section>'+
    '<section class="tw-panel"><h4>Публикация тарифа</h4><div class="tw-fields">'+
      field('Дата начала','base','publishFrom',d.publishFrom,'date')+
      field('Дата окончания','base','publishUntil',d.publishUntil,'date')+
    '</div></section>'+
    '<section class="tw-panel"><h4>Акция</h4><label class="tw-check"><input type="checkbox" data-tw-campaign="enabled" '+(c.enabled?'checked':'')+'> Включить акцию</label><div class="tw-fields">'+
      pick('Для периода','campaign','months',c.months,[[1,'1 месяц'],[6,'6 месяцев'],[12,'12 месяцев']])+
      pick('Вид скидки','campaign','kind',c.kind,[['percent','Проценты'],['rub','Рубли']])+
      field(c.kind==='percent'?'Размер скидки, %':'Размер скидки, ₽','campaign','discount',c.discount,'number','min="0" step="1"')+
      field('Дополнительно дней в подарок','campaign','giftDays',c.giftDays,'number','min="0" step="1"')+
      field('Начало первой акции','campaign','from',c.from,'date')+
      field('Окончание программы (необязательно)','campaign','until',c.until,'date')+
      field('Повтор через N месяцев (0 — один раз)','campaign','repeat',c.repeat,'number','min="0" max="120" step="1"')+
      field('Длительность акции, дней','campaign','length',c.length,'number','min="1" max="366" step="1"')+
    '</div><p class="tw-note">Например: каждые 3 месяца скидка 50% на 7 дней, при этом подарочные месяцы остаются.</p></section>'+
    '<section class="tw-panel tw-summary"><div class="tw-preview-title"><h4>Предпросмотр для покупателя</h4>'+field('На дату','preview','date',previewDate,'date')+'</div>'+
      [1,6,12].map(m=>{const o=offer(d,m,previewDate);return '<div class="tw-offer"><span>'+m+' мес.'+(o.on?' · Акция':'')+'</span><strong>'+rub(o.amount)+'</strong><small>'+o.days+' дней доступа'+(o.discount?' · −'+o.discount+'%':'')+'</small></div>';}).join('')+
    '</section>'+
    '<details class="tw-tools" '+(toolsOpen?'open':'')+'><summary>Инструменты тарифа <span>'+h.ready+' из '+h.total+' готово</span></summary>'+
      '<div class="tw-tools-inner"><div class="tw-tool-actions">'+
       pick('Показывать','filter','value',filter,[['included','Включённые'],['all','Все'],['testing','В проверке'],['not-ready','Не готово']])+
       '<button type="button" class="admin-button secondary" data-tw-tools-nav>Настроить инструменты</button></div>'+
       h.rows.filter(r=>filter==='all'||filter==='included'&&r.included||filter==='testing'&&r.status==='TESTING'||filter==='not-ready'&&r.status!=='READY').map(r=>
         '<div class="tw-tool-row"><span>'+esc(r.name)+'</span><span>'+(r.included?'✓':'—')+'</span><small>'+esc(r.status==='READY'?'Готово':r.status==='TESTING'?'В проверке':r.status==='NOT_READY'?'Не готово':'Нет данных')+'</small></div>').join('')+
      '</div></details>'+
    '<footer class="tw-foot"><span>Это интерактивный макет: условия и акции пока не сохраняются и не влияют на покупки.</span><button type="button" class="admin-button secondary" data-tw-reset>Сбросить пробные изменения</button></footer></section>';
  }
  content.innerHTML='<div class="admin-overview admin-tariff-section tw"><div class="admin-heading"><h2>Тарифы</h2></div>'+
    '<div class="admin-overview-tariffs-heading"><strong>Кабинет <span>/ Professional</span></strong></div>'+
    '<p class="tw-note tw-notice">Интерактивный предпросмотр конструктора. Изменения здесь не сохраняются в коммерческой базе.</p>'+
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
    bind('[data-tw-period]',el=>{const [m,key]=el.dataset.twPeriod.split('-');d.periods[m][key]=num(el.value,key==='giftDays'?3650:key==='discount'?100:1000000);});
    bind('[data-tw-campaign]',el=>{const k=el.dataset.twCampaign;d.campaign[k]=k==='enabled'?el.checked:['repeat','length','months','discount','giftDays'].includes(k)?num(el.value):el.value;});
    content.querySelector('[data-tw-preview]')?.addEventListener('change',e=>{previewDate=e.target.value||iso();rerender();});
    content.querySelector('[data-tw-filter]')?.addEventListener('change',e=>{filter=e.target.value;toolsOpen=true;rerender();});
    content.querySelector('.tw-tools')?.addEventListener('toggle',e=>{toolsOpen=e.target.open;});
  }
}
