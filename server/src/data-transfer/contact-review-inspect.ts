import { contactIdentityFields, contactMatches, findContactCandidates,
  identityValue, reliableContactCandidate } from './contact-identity';
import type { ContactIdentityField } from './contact-identity';

type Obj=Record<string,any>;
export type ReviewIssue = {
  field:string;label:string;system:string;excel:string;
  owners:Array<{key:string;code:string;name:string;matchedBy?:string[]}>;
  decision?:{mode:'keep'|'replace'|'remove'|'add'|'same'|'different';value:string};
};
const text=(v:unknown)=>String(v??'').trim();
const normalized=(v:unknown)=>text(v).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const contactFields=['uei','phone','name','surname','email','additionalPhone','additionalEmail',
  'birthDate','gender','discountPercent','telegram','additionalTelegram','note'];
const labels:Record<string,string>={uei:'Код клиента',phone:'Телефон',
  additionalPhone:'Дополнительный телефон',email:'Email',
  additionalEmail:'Дополнительный Email',name:'Имя',surname:'Фамилия',
  birthDate:'Дата рождения',gender:'Пол',discountPercent:'Скидка',
  telegram:'Telegram',additionalTelegram:'Дополнительный Telegram',note:'Примечание',
  identity:'Совпадение контакта',format:'Данные строки'};
const groupFor=(field:string)=>field==='phone'||field==='additionalPhone'?'phones':
  field==='email'||field==='additionalEmail'?'emails':
  field==='telegram'||field==='additionalTelegram'?'telegrams':'';
const fieldValue=(field:string,v:unknown):string=>{
  if((contactIdentityFields as readonly string[]).includes(field))
    return identityValue(field as ContactIdentityField,v);
  if(field==='discountPercent')return text(v).replace(',','.');
  return normalized(v);
};
function getPersonValue(person:Obj,identity:Obj,field:string):string{
  if(field==='uei'){
    const relations=obj(identity.relations);
    return text(relations['person:'+text(person.key)]||person.uei);
  }
  const group=groupFor(field);
  if(group){
    const values=Array.isArray(person[group])?person[group]:[];
    return text(values[field.startsWith('additional')?1:0]);
  }
  return text(person[field]);
}
const matchesField=(person:Obj,field:string,v:unknown)=>{
  if(!text(v))return false;
  const group=groupFor(field);
  return group?(Array.isArray(person[group])?person[group]:[])
    .some((item:unknown)=>fieldValue(field,item)===fieldValue(field,v))
    :fieldValue(field,person[field])===fieldValue(field,v);
};
const owner=(p:Obj,identity:Obj)=>({
  key:text(p.key),code:getPersonValue(p,identity,'uei'),
  name:[text(p.name),text(p.surname)].filter(Boolean).join(' '),
});
const sameFamily=(a:ContactIdentityField,b:ContactIdentityField)=>{
  const family=(x:ContactIdentityField)=>x==='uei'?'uei':
    x==='phone'||x==='additionalPhone'?'phone':
    x==='email'||x==='additionalEmail'?'email':'telegram';
  return family(a)===family(b);
};
function make(field:string,system:unknown,excel:unknown,owners:ReviewIssue['owners']=[]):ReviewIssue{
  return {field,label:labels[field]||field,system:text(system),excel:text(excel),owners};
}
export function inspectContactRow(values:Obj,people:Obj[],identity:Obj,
  file:Array<{row:number;values:Obj}>,rowNumber:number,
  previous:ReviewIssue[]=[],choice:ReviewIssue['decision']|null=null){
  const candidates=findContactCandidates(people,identity,values);
  const sourceCandidates=file.filter(row=>row.row!==rowNumber &&
    contactIdentityFields.some(field=>{
      const incoming=identityValue(field,values[field]);
      return incoming&&contactIdentityFields.some(other=>
        sameFamily(field,other)&&identityValue(other,obj(row.values)[other])===incoming);
    })&&contactFields.some(field=>
      fieldValue(field,obj(row.values)[field])!==fieldValue(field,values[field])))
    .map(row=>({
      key:'excel:'+row.row,code:text(obj(row.values).uei),
      name:[text(obj(row.values).name),text(obj(row.values).surname)]
        .filter(Boolean).join(' '),
      matchedBy:contactIdentityFields.filter(field=>
        Boolean(identityValue(field,values[field]))&&contactIdentityFields.some(other=>
          sameFamily(field,other)&&identityValue(other,obj(row.values)[other])
            ===identityValue(field,values[field]))),
    }));
  const selected=choice||previous.find(i=>i.field==='identity')?.decision||null;
  const selectedSame=selected?.mode==='same';
  const selectedOther=selected?.mode==='different';
  const chosen=selectedSame?candidates.find(p=>p.key===selected.value):null;
  const candidate=selectedSame?chosen:selectedOther?null:candidates.length===1?candidates[0]:null;
  const person=candidate?people.find(p=>text(p.key)===candidate.key)||null:null;
  // Repeated rows in a differently-sized workbook are already processed
  // when every non-empty imported value exists in this very same person.
  // The import must not upsert or change such a Person again.
  const unchanged=Boolean(person && previous.length===0 && !selectedOther
    && candidates.length===1 && reliableContactCandidate(candidates[0])
    && sourceCandidates.length===0 && contactFields.every(field=>{
      if(!text(values[field]))return true;
      const current=getPersonValue(person,identity,field);
      if(groupFor(field))return matchesField(person,field,values[field]);
      if(field==='discountPercent'){
        const incoming=Number(values[field]),saved=Number(current);
        return Number.isFinite(incoming)&&Number.isFinite(saved)
          && (incoming===saved || (incoming>0&&incoming<=1&&incoming*100===saved));
      }
      return Boolean(current)&&fieldValue(field,current)===fieldValue(field,values[field]);
    }));
  if(unchanged)return {person,issues:[] as ReviewIssue[],candidates,sourceCandidates,
    unchanged:true};
  const issues=new Map<string,ReviewIssue>();
  const add=(field:string,system:unknown,excel:unknown,owners:ReviewIssue['owners']=[])=>{
    const old=issues.get(field);
    if(!old)issues.set(field,make(field,system,excel,owners));
    else {
      if(!old.system)old.system=text(system);
      old.owners=[...new Map([...old.owners,...owners].map(p=>[p.key,p])).values()];
    }
  };
  if(person){
    for(const field of contactFields){
      if(!text(values[field]))continue;
      const saved=getPersonValue(person,identity,field);
      if(groupFor(field)){
        if(saved&&!matchesField(person,field,values[field]))
          add(field,saved,values[field]);
      }else if(saved&&fieldValue(field,saved)!==fieldValue(field,values[field])){
        add(field,saved,values[field]);
      }
    }
  }else if(!text(values.phone)&&!text(values.uei)&&!text(values.additionalPhone)){
    add('phone','',values.phone||'Укажите телефон или код клиента');
  }
  // Every row of Excel is inspected against every other source row,
  // including cross-column overlaps (primary vs additional contacts).
  for(const field of contactIdentityFields){
    const wanted=identityValue(field,values[field]);
    if(!wanted)continue;
    const overlaps=file.filter(row=>row.row!==rowNumber&&
      contactIdentityFields.some(other=>sameFamily(field,other)
        &&identityValue(other,obj(row.values)[other])===wanted));
    if(overlaps.some(row=>contactFields.some(key=>
      fieldValue(key,obj(row.values)[key])!==fieldValue(key,values[key])))){
      add(field,'Повтор в Excel',values[field],overlaps.map(row=>({
        key:'excel:'+row.row,code:text(obj(row.values).uei),
        name:[text(obj(row.values).name),text(obj(row.values).surname)].filter(Boolean).join(' '),
        matchedBy:[field],
      })));
    }
  }
  for(const field of contactIdentityFields){
    if(!text(values[field]))continue;
    const owners=people.filter(p=>text(p.key)!==text(person?.key)
      &&contactMatches(p,identity,field,values[field]));
    if(owners.length)
      add(field,getPersonValue(person||{},identity,field)||'У другого контакта',
        values[field],owners.map(p=>owner(p,identity)));
  }
  const rate=Number(text(values.discountPercent).replace(',','.'));
  if(text(values.discountPercent)&&rate>0&&rate<=1)
    add('discountPercent','Уточните: процент или доля',values.discountPercent);
  if(values.uei&&!identityValue('uei',values.uei))
    add('uei','Неверный код',values.uei);
  for(const field of ['phone','additionalPhone'] as const){
    if(values[field]&&!identityValue(field,values[field]))
      add(field,'Неверный телефон',values[field]);
  }
  for(const field of ['email','additionalEmail']){
    if(values[field]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(values[field])))
      add(field,'Неверный Email',values[field]);
  }
  const needsChoice=candidates.length>0 &&(
    candidates.length!==1||!reliableContactCandidate(candidates[0])||issues.size>0
  ) || sourceCandidates.length>0;
  if(needsChoice||selected){
    const identityIssue=make('identity',
      candidates.length===1?candidates[0].name:'Найдены совпадения',
      [text(values.uei),text(values.name),text(values.surname)].filter(Boolean).join(' '),
      [...candidates.map(c=>({key:c.key,code:c.code,name:c.name,
        matchedBy:[...c.matchedBy]})),...sourceCandidates]);
    if(selected&&(selected.mode==='different'
      ||(selected.mode==='same'&&(Boolean(chosen)||sourceCandidates.some(c=>c.key===selected.value)))))
      identityIssue.decision=selected;
    issues.set('identity',identityIssue);
  }
  for(const old of previous){
    if(old.field==='identity')continue;
    if(old.field==='format'&&!issues.has(old.field))issues.set(old.field,old);
    else if(old.decision&&issues.has(old.field))issues.get(old.field)!.decision=old.decision;
  }
  return {person,issues:[...issues.values()],candidates,sourceCandidates,unchanged:false};
}
