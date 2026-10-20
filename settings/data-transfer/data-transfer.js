import { apiRequest } from '../../core/auth.js';
import { button, select, page, details, workspaceHeaderContext, selectFile, openNotice, dataTable, bindDataTable } from '../../ui/ui.js';
import { settingToggle } from '../../ui/settings/index.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
async function request(path, body = {}) {
  const response=await apiRequest(`/data-transfer/${path}`,{method:'POST',body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.message || 'Не удалось обработать данные');return data;
}
async function download(rows,template=false){
  const response=await apiRequest('/data-transfer/table',{method:'POST',body:JSON.stringify({rows,template})});
  if(!response.ok)throw Error('Не удалось сохранить таблицу');
  const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=template?'перенос-данных.xlsx':'исправить-данные.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function render(root){
  const state={step:'upload',input:null,inspected:null,result:null,busy:false,history:[],cancelId:'',sortKey:'reason',descending:false,onlyErrors:true};
  const notify=()=>window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  function draw(){
    const next=state.step==='mapping'?'Проверить':state.step==='checked'?'Перенести':'Загрузить файл';
    root.innerHTML=page([
      workspaceHeaderContext({title:'Перенос данных',c:{label:next,data:'data-transfer-next'}}),
      details([{label:'Шаг',value:state.step==='mapping'?'Проверить колонки':state.step==='checked'?'Проверка':state.step==='result'?'Результат':'Загрузить'}]),
      state.step==='upload'?`<ol><li>Скачайте шаблон.</li><li>Перенесите старые данные в подходящие колонки — по смыслу, а не по старому названию.</li><li>Заполняйте только то, что известно. В одном файле можно указать разные виды данных.</li><li>Загрузите файл. Система распределит понятные данные по разделам.</li><li>Ошибки можно скачать, исправить и загрузить повторно.</li></ol>${button('Скачать шаблон',{variant:'secondary',data:'data-transfer-template'})}`:'',
      state.step==='mapping'?mapping():'',state.result?results():'',history(),'<p class="form-error" role="status" data-transfer-error></p>',
    ]);
    const nextButton=root.querySelector('[data-transfer-next]');if(nextButton)nextButton.disabled=state.busy;
    nextButton?.addEventListener('click',advance);
    root.querySelector('[data-transfer-template]')?.addEventListener('click',()=>run(()=>download([],true)));
    root.querySelector('[data-transfer-errors-file]')?.addEventListener('click',()=>run(()=>download(state.result.rows.filter(row=>row.reason))));
    root.querySelector('[data-transfer-table]')?.addEventListener('click',()=>run(()=>download(state.result.rows)));
    root.querySelector('[data-transfer-only-errors]')?.addEventListener('click',()=>{state.onlyErrors=!state.onlyErrors;draw();});
    root.querySelectorAll('[data-fact-without-procedure]').forEach(control=>control.addEventListener('click',()=>run(async()=>{
      const key=control.dataset.factWithoutProcedure;const selected=state.input.withoutProcedureFacts || [];
      state.input.withoutProcedureFacts=selected.includes(key)?selected.filter(value=>value!==key):[...selected,key];
      state.result=await request('check',state.input);draw();
    })));
    root.querySelectorAll('[data-transfer-cancel]').forEach(control=>control.addEventListener('click',()=>{state.cancelId=control.dataset.transferCancel;draw();}));
    root.querySelector('[data-transfer-cancel-confirm]')?.addEventListener('click',()=>run(async()=>{
      await request('cancel',{sessionId:state.cancelId});state.cancelId='';state.result=null;state.step='upload';await loadHistory();mutated();draw();
    }));
    bindDataTable(root,key=>{state.descending=state.sortKey===key?!state.descending:false;state.sortKey=key;draw();});notify();
  }
  function mapping(){
    return `<p>Что означает эта колонка? Выберите подходящее значение. Ненужные колонки оставьте пустыми.</p>${state.inspected.sheets.map((sheet,index)=>{
      const config=state.input.sheets[sheet.name];return `<section>${details([{label:'Лист',value:sheet.name}])}${sheet.headers.map((header,column)=>select({label:header || `Колонка ${column+1}`,name:`column-${index}-${column}`,value:Object.keys(config.columns).find(key=>config.columns[key]===column)||'',data:`data-column-index="${column}" data-sheet-index="${index}"`,options:[{value:'',label:'Не переносить'},...Object.entries(state.inspected.fields).map(([value,label])=>({value,label}))]})).join('')}</section>`;
    }).join('')}`;
  }
  function collect(){state.inspected.sheets.forEach((sheet,index)=>{
    const columns={};root.querySelectorAll(`[data-sheet-index="${index}"]`).forEach(control=>{if(control.value){if(columns[control.value]!==undefined)throw Error('Одна и та же колонка назначения выбрана дважды');columns[control.value]=Number(control.dataset.columnIndex);}});
    state.input.sheets[sheet.name]={domain:'standard',columns};
  });}
  function results(){
    const result=state.result;
    const rows=result.rows.filter(row=>!state.onlyErrors || row.reason).map(row=>({sheet:row.sheet,row:row.row,reason:row.reason || (result.preview?'Готово':row.status==='unchanged'?'Уже перенесено':'Перенесено'),values:Object.entries(row.values).filter(([key])=>state.inspected.fields[key]).map(([key,value])=>`${state.inspected.fields[key]}: ${String(value)}`).join('; ')}));
    return `${details([{label:result.preview?'Готово к переносу':'Перенесено',value:result.transferred},{label:'Уже перенесено',value:result.unchanged},{label:'Не перенесено',value:result.failed}])}
      ${button('Скачать результат',{variant:'secondary',data:'data-transfer-table'})}
      ${result.failed?button('Скачать данные для исправления',{variant:'secondary',data:'data-transfer-errors-file'}):''}
      ${settingToggle({label:'Только требуют исправления',checked:state.onlyErrors,data:'data-transfer-only-errors'})}
      ${state.step==='checked'?result.rows.filter(row=>row.domain==='consumables'&&!row.values.procedure&&(row.reason?.startsWith('Не указана процедура для расходника')||state.input.withoutProcedureFacts?.includes(row.sourceKey))).map(row=>`<section>${details([{label:'Расходник',value:`${row.sheet} · строка ${row.row} · ${row.values.material || ''}`}])}${settingToggle({label:'Импортировать без процедуры',checked:state.input.withoutProcedureFacts?.includes(row.sourceKey),data:`data-fact-without-procedure="${escapeHtml(row.sourceKey)}"`})}</section>`).join(''):''}
      ${rows.length?dataTable({caption:'Результат проверки данных',columns:[{key:'sheet',label:'Данные'},{key:'row',label:'Строка'},{key:'reason',label:'Причина'},{key:'values',label:'Исходные значения'}],rows,sortKey:state.sortKey,descending:state.descending}):''}`;
  }
  function history(){return state.history.length?`<section><h3>История переносов</h3>${state.history.map(item=>`<section>${details([{label:'Дата',value:new Date(item.createdAt).toLocaleString('ru-RU')},{label:'Файл / источник',value:item.filename || item.source},{label:'Перенесено',value:item.transferred},{label:'Не перенесено',value:item.failed},{label:'Статус',value:item.status==='cancelled'?'Перенос отменён':'Завершён'}])}${item.status==='cancelled'?'':state.cancelId===item.id?`<p>Отменить этот перенос? Независимые данные будут защищены. При конфликте отмена остановится.</p>${button('Подтвердить отмену',{variant:'danger',data:'data-transfer-cancel-confirm'})}`:button('Отменить перенос',{variant:'secondary',data:`data-transfer-cancel="${escapeHtml(item.id)}"`})}</section>`).join('')}</section>`:'';}
  async function loadHistory(){state.history=await request('sessions');}
  function mutated(){window.dispatchEvent(new CustomEvent('book:server-mutation-completed',{detail:{scopes:['business','operational','auxiliary','profile','inventory','finance']}}));}
  async function run(work){if(state.busy)return;state.busy=true;const control=root.querySelector('[data-transfer-next]');if(control)control.disabled=true;notify();
    try{await work();}catch(error){const node=root.querySelector('[data-transfer-error]');if(node)node.textContent=error.message;else openNotice({title:'Перенос данных',message:error.message});}
    finally{state.busy=false;const control=root.querySelector('[data-transfer-next]');if(control)control.disabled=false;notify();}}
  async function advance(){if(state.busy)return;
    if(state.step==='upload'||state.step==='result'){
      const file=await selectFile({accept:'.xlsx,.csv,.tsv'});if(!file?.dataUrl)return;
      await run(async()=>{const input={dataUrl:file.dataUrl,filename:file.name || file.file?.name || 'данные.xlsx',source:file.name || file.file?.name || 'Файл',sheets:{}};
        const inspected=await request('inspect',input);inspected.sheets.forEach(sheet=>{input.sheets[sheet.name]={domain:'standard',columns:sheet.columns};});
        Object.assign(state,{input,inspected,result:null});
        if(inspected.sheets.every(sheet=>sheet.standard)){state.result=await request('check',input);state.step='checked';}else state.step='mapping';draw();});
    }else if(state.step==='mapping'){await run(async()=>{collect();state.result=await request('check',state.input);state.step='checked';draw();});}
    else await run(async()=>{state.result=await request('commit',state.input);state.step='result';await loadHistory();mutated();draw();});
  }
  draw();loadHistory().then(draw).catch(()=>{});
}
