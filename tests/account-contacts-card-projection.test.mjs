import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Exercise the ACTUAL Core projection functions; do not copy implementation here.
const source = readFileSync(new URL('../server/src/account-contacts/account-contacts.service.ts', import.meta.url), 'utf8');
function between(first, second) {
  const start = source.indexOf(first), end = source.indexOf(second,start);
  assert.ok(start >= 0 && end > start, 'Expected Core source '+first);
  return source.slice(start,end);
}
const helpers = between('function publicCardAppearance(', 'function publicDiscountText(');
const programs = between('function publicProgramCard(', '// This is formatting only;');
const js = stripTypeScriptTypes(helpers+'\n'+programs, {mode:'strip'});
const { publicContactCard, publicProgramCard } = runInNewContext(
  js+'\n({publicContactCard,publicProgramCard})', {
    objectValue: (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
    arrayValue: (value) => Array.isArray(value) ? value : [],
    text: (value) => String(value ?? '').trim(),
  },
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const configured = {
  gradient: {from:'#123456',mid:'#456789',to:'#abcdef',angle:100},
  lines: [
    {cells:{
      left:{field:'name',align:'left',color:'#ddeeff',size:'l',bold:true},
      center:{field:'privateField',align:'center',color:'#111111'},
      right:{field:'phone',align:'right',color:'#aabbcc'},
    }},
    {cells:{left:{field:'discount'},right:{field:'workplaceName'}}},
  ],
};
const fields = [
  {value:'name',label:'Имя',text:'Александр'},
  {value:'phone',label:'Телефон',text:'+79999999999'},
  {value:'discount',label:'Скидка',text:''},
  {value:'workplaceName',label:'Пространство',text:'Салон'},
];
const card = plain(publicContactCard(configured,fields,'/photo.jpg','20% 70%'));
assert.equal(card.appearance.lines[0].cells.left.field,'name');
assert.equal(card.appearance.lines[0].cells.right.field,'phone');
assert.equal(card.appearance.lines[0].cells.center.field,'');
assert.equal(card.appearance.lines[0].cells.left.color,'#ddeeff');
assert.equal(card.appearance.lines[0].cells.left.bold,true);
assert.equal(card.appearance.gradient.angle,100);
assert.deepEqual(card.fields,fields,'All configured public values must reach User, including legitimately empty discount');
assert.equal(card.photo,'/photo.jpg');
assert.equal(card.photoPosition,'20% 70%');
const old=plain(publicContactCard({lines:[{field:'name',zone:'full'}]},fields,'','50% 50%'));
assert.deepEqual(old.fields,[fields[0]],'Historic row can be rendered without new UI');
const values={uei:'UEI-1',title:'Программа',subtitle:'Срок',status:'Активно',metaLeft:'10%',metaRight:'500 ₽'};
const template=[{scope:'loyalty-deposit',photo:'/program.jpg',photoPosition:'30% 40%',appearance:{
  lines:[{cells:{left:{field:'title',color:'#112233'},center:{field:'personPhone'},right:{field:'metaRight'}}}],
}}];
const program=plain(publicProgramCard(template,'loyalty-deposit',values));
assert.equal(program.appearance.lines[0].cells.left.field,'title');
assert.equal(program.appearance.lines[0].cells.center.field,'','Private fields cannot leak via template');
assert.equal(program.appearance.lines[0].cells.right.field,'metaRight');
assert.deepEqual(program.fields.map(x=>x.value),['title','metaRight']);
assert.equal(program.photo,'/program.jpg');
assert.equal(program.photoPosition,'30% 40%');
const depositFields = ['benefit','nominal','funded','spent','balance','toFund'];
const depositAppearance = {gradient:configured.gradient,lines:[
  {cells:{left:{field:'balance',align:'right',bold:true},center:{field:'nominal',color:'#123456'},right:{field:'funded'}}},
  {cells:{left:{field:'benefit'},center:{field:'spent'},right:{field:'toFund'}}},
  {cells:{left:{field:'personPhone'},center:{field:''},right:{field:'title'}}},
]};
const depositValues = Object.fromEntries(depositFields.map((key,i)=>[key,String(i+1)]));
const extended=plain(publicProgramCard([{scope:'loyalty-deposit',appearance:depositAppearance}],'loyalty-deposit',{...depositValues,title:'Test',personPhone:'private'}));
for(const key of depositFields) assert.equal(extended.fields.find(x=>x.value===key)?.text,depositValues[key]);
assert.deepEqual(extended.appearance.lines.slice(0,2).map(x=>x.cells),depositAppearance.lines.slice(0,2).map(x=>x.cells));
assert.equal(extended.appearance.lines[2].cells.left.field,'');
assert.equal(extended.fields.some(x=>x.value==='personPhone'),false);
const accountFields=['amountLabel','currentAmount','balance','debt'];
const account=plain(publicProgramCard([{scope:'loyalty-personal-account',appearance:{lines:accountFields.map(field=>({field}))}}],'loyalty-personal-account',Object.fromEntries(accountFields.map(key=>[key,key]))));
assert.deepEqual(account.fields.map(x=>x.value).sort(),[...accountFields].sort());
assert.deepEqual(account.appearance.lines.map(x=>x.field),accountFields,'Professional layout, not field registry order, determines the positions');
console.log('PASS: Core projects Professional 9x3 cards intact with public field filtering');
