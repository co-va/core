import { modal, mountModal } from '../modals/index.js';
import { button } from '../buttons/index.js';

const esc=(v='')=>String(v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
const normalize=v=>{const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return {h:0,min:0};return {h:Math.min(23,Number(m[1])),min:Number(m[2])<60?Number(m[2]):0}};
const text=v=>{const {h,min}=normalize(v);return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`};
const CYCLES=5;
const MIDDLE_CYCLE=Math.floor(CYCLES/2);

export function timeSlots({values=[],selected='',data='data-time-slot',ariaLabel='Выбрать время',className=''}={}){
  const items=Array.isArray(values)?values:[];
  return `<div class="time-slots${className?` ${esc(className)}`:'' }" role="group" aria-label="${esc(ariaLabel)}">${items.map(value=>{const slot=typeof value==='object'?value:{value,label:value};const raw=slot.value??slot.from??slot.label??'';const label=slot.label??raw;const isSelected=String(raw)===String(selected);const emphasized=Boolean(slot.emphasized);const disabled=Boolean(slot.disabled||slot.available===false);const occupied=Boolean(slot.occupied||slot.state==='occupied');return `<button type="button" class="time-slot${isSelected?' is-selected':''}${emphasized?' is-emphasized':''}${disabled?' is-disabled':''}${occupied?' is-occupied':''}" ${data}="${esc(raw)}" aria-pressed="${isSelected?'true':'false'}"${disabled?' disabled aria-disabled="true"':''}>${esc(label)}</button>`;}).join('')}</div>`;
}

export function wheel({values,selected,type,formatter=(v)=>String(v).padStart(2,'0')}={}){
  const base=Array.isArray(values)?values:[];
  return Array.from({length:CYCLES},(_,cycle)=>base.map((value,index)=>`<button type="button" class="time-wheel__item${cycle===MIDDLE_CYCLE&&String(value)===String(selected)?' is-selected':''}" data-time-wheel-item data-time-wheel-type="${esc(type)}" data-value="${esc(value)}" data-cycle="${cycle}" data-index="${index}">${esc(formatter(value))}</button>`).join('')).join('');
}

export function timePicker({name,label,value='',minuteStep=15,min='00:00',max='23:59',allowEmpty=false,placeholder='—'}={}){
  const raw=String(value||'').trim();
  const stored=allowEmpty&&!raw?'':text(raw);
  const visible=stored||placeholder;
  return `<div class="time-picker" data-time-picker="${esc(name)}" data-time-minute-step="${Number(minuteStep)||15}" data-time-min="${esc(min)}" data-time-max="${esc(max)}" data-time-allow-empty="${allowEmpty?'true':'false'}" data-time-placeholder="${esc(placeholder)}"><span class="time-picker__label">${esc(label)}</span><button type="button" class="time-picker__button" data-time-open>${esc(visible)}</button><input type="hidden" name="${esc(name)}" value="${esc(stored)}" data-time-value></div>`;
}

export function initTimePickers(root){root.querySelectorAll('[data-time-picker]').forEach(host=>host.querySelector('[data-time-open]')?.addEventListener('click',()=>open(host)))}

function openPicker({
  currentValue='00:00',
  minuteStep=15,
  minValue='00:00',
  maxValue='23:59',
  title='Время',
  allowEmpty=false,
  onSave=()=>{},
  onClear=()=>{},
}={}){
  const current=normalize(currentValue);
  const step=Math.max(1,Math.min(59,Number(minuteStep)||15));
  const min=normalize(minValue);
  const max=normalize(maxValue);
  const hours=Array.from({length:24},(_,i)=>i).filter(h=>h>=min.h&&h<=max.h);
  const minutes=Array.from({length:Math.floor(59/step)+1},(_,i)=>i*step).filter(m=>m<=59);
  if(!hours.length||!minutes.length)return null;
  const initialHour=hours.includes(current.h)?current.h:hours[0];
  const initialMinute=minutes.includes(current.min)?current.min:minutes[0];
  const selectedValues={hours:String(initialHour),minutes:String(initialMinute)};
  const content=`<div class="modal-title"><h2>${esc(title)}</h2></div><div class="time-wheel" data-time-wheel><div class="time-wheel__column" data-time-wheel-column="hours"><span class="time-wheel__label">Часы</span><div class="time-wheel__viewport">${wheel({values:hours,selected:initialHour,type:'hours'})}</div></div><div class="time-wheel__column" data-time-wheel-column="minutes"><span class="time-wheel__label">Минуты</span><div class="time-wheel__viewport">${wheel({values:minutes,selected:initialMinute,type:'minutes'})}</div></div></div>${allowEmpty?button('Очистить',{variant:'secondary',data:'data-time-clear'}):''}${button('Сохранить',{data:'data-time-save'})}`;
  const modalRoot=mountModal(document.body,modal(content,{variant:'x',title,className:'modal--time-picker-sheet',xRole:'picker'}));
  if(!modalRoot)return null;

  const nearestItem=(viewport)=>{
    const items=[...viewport.querySelectorAll('[data-time-wheel-item]')];
    if(!items.length)return null;
    const centerY=viewport.getBoundingClientRect().top+viewport.clientHeight/2;
    let nearest=items[0],distance=Infinity;
    items.forEach(item=>{const rect=item.getBoundingClientRect();const d=Math.abs(rect.top+rect.height/2-centerY);if(d<distance){distance=d;nearest=item;}});
    return nearest;
  };

  const selectOnly=(viewport,item)=>{
    viewport.querySelectorAll('[data-time-wheel-item]').forEach(other=>other.classList.toggle('is-selected',other===item));
    const type=item?.dataset.timeWheelType;
    if((type==='hours'||type==='minutes')&&item?.dataset.value!=null)selectedValues[type]=String(item.dataset.value);
  };

  const center=(type,value)=>{
    const item=modalRoot.querySelector(`[data-time-wheel-type="${type}"][data-value="${CSS.escape(String(value))}"][data-cycle="${MIDDLE_CYCLE}"]`);
    const viewport=item?.closest('.time-wheel__viewport');
    if(!item||!viewport)return;
    viewport.scrollTop=item.offsetTop-(viewport.clientHeight-item.offsetHeight)/2;
    selectOnly(viewport,item);
  };

  const syncColumn=(viewport,{recenter=true}={})=>{
    const nearest=nearestItem(viewport);
    if(!nearest)return;
    selectOnly(viewport,nearest);
    if(!recenter)return;
    const cycle=Number(nearest.dataset.cycle);
    if(cycle===MIDDLE_CYCLE)return;
    const type=nearest.dataset.timeWheelType;
    const value=nearest.dataset.value;
    const twin=modalRoot.querySelector(`[data-time-wheel-type="${type}"][data-value="${CSS.escape(value)}"][data-cycle="${MIDDLE_CYCLE}"]`);
    if(!twin)return;
    viewport.scrollTop+=twin.offsetTop-nearest.offsetTop;
    selectOnly(viewport,twin);
  };

  modalRoot.querySelectorAll('.time-wheel__viewport').forEach(viewport=>{
    let frame=0;
    let settle=0;
    viewport.addEventListener('scroll',()=>{
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      frame=requestAnimationFrame(()=>syncColumn(viewport,{recenter:false}));
      settle=setTimeout(()=>syncColumn(viewport,{recenter:true}),90);
    },{passive:true});
  });

  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    center('hours',initialHour);
    center('minutes',initialMinute);
  }));

  modalRoot.querySelectorAll('[data-time-wheel-item]').forEach(item=>item.addEventListener('click',()=>{
    const viewport=item.closest('.time-wheel__viewport');
    if(!viewport)return;
    selectOnly(viewport,item);
    viewport.scrollTo({top:item.offsetTop-(viewport.clientHeight-item.offsetHeight)/2,behavior:'smooth'});
  }));

  modalRoot.querySelector('[data-time-clear]')?.addEventListener('click',()=>{
    onClear();
    modalRoot.v2Close?.();
  });
  modalRoot.querySelector('[data-time-save]')?.addEventListener('click',()=>{
    const hour=selectedValues.hours;
    const minute=selectedValues.minutes;
    if(hour==null||minute==null)return;
    const value=`${String(Number(hour)).padStart(2,'0')}:${String(Number(minute)).padStart(2,'0')}`;
    onSave(value);
    modalRoot.v2Close?.();
  });
  return modalRoot;
}

function open(host){
  const hidden=host.querySelector('[data-time-value]');
  if(!hidden)return null;
  return openPicker({
    currentValue:hidden.value,
    minuteStep:host.dataset.timeMinuteStep,
    minValue:host.dataset.timeMin||'00:00',
    maxValue:host.dataset.timeMax||'23:59',
    title:host.querySelector('.time-picker__label')?.textContent||'Время',
    allowEmpty:host.dataset.timeAllowEmpty==='true',
    onClear:()=>{
      hidden.value='';
      host.querySelector('[data-time-open]').textContent=host.dataset.timePlaceholder||'—';
      hidden.dispatchEvent(new Event('input',{bubbles:true}));
      hidden.dispatchEvent(new Event('change',{bubbles:true}));
    },
    onSave:(value)=>{
      hidden.value=value;
      host.querySelector('[data-time-open]').textContent=value;
      hidden.dispatchEvent(new Event('input',{bubbles:true}));
      hidden.dispatchEvent(new Event('change',{bubbles:true}));
    },
  });
}

export function openTimePickerAction({
  value='',
  minuteStep=1,
  min='00:00',
  max='23:59',
  title='Время',
  onSave=()=>{},
}={}){
  return openPicker({
    currentValue:text(value),
    minuteStep,
    minValue:min,
    maxValue:max,
    title,
    onSave,
  });
}

export function openTimeRangeAction({
  from = '09:00',
  to = '18:00',
  title = 'График работы',
  validate = null,
  onSave = () => {},
} = {}) {
  const content = `<form class="form-grid" data-shared-time-range-form>
    <div class="time-range-fields">
      ${timePicker({ label: 'С', name: 'from', value: text(from) })}
      ${timePicker({ label: 'До', name: 'to', value: text(to) })}
    </div>
    ${button('Сохранить', { type: 'submit' })}
  </form>`;
  const layer = mountModal(document.body, modal(content, {
    variant: 'x',
    title,
    className: 'modal--time-range-sheet',
    xRole: 'editor',
  }));
  if (!layer) return null;
  initTimePickers(layer);
  const form = layer.querySelector('[data-shared-time-range-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const nextFrom = text(data.get('from'));
    const nextTo = text(data.get('to'));
    if (typeof validate === 'function') {
      const accepted = await validate({ from: nextFrom, to: nextTo });
      if (accepted === false) return;
    }
    layer.v2Close?.();
    onSave({ from: nextFrom, to: nextTo });
  });
  return layer;
}
