// Release-only gate: Git history is the durable change evidence; the existing map is the catalogue.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEVELOPMENT_CATALOG } from '../admin/development-map.js';

const prefix='Operational-Evidence: ';
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const uniqueStrings=a=>Array.isArray(a)&&a.length>0&&a.every(nonempty)&&new Set(a).size===a.length;
const criterionIds=new Set(DEVELOPMENT_CATALOG.flatMap(m=>m.criteria.map(c=>c.key)));
const byMechanism=new Map(DEVELOPMENT_CATALOG.map(m=>[m.id,m.criteria.map(c=>c.key)]));
const coreDomains={
  'account-contacts':['contacts','records','loyalty','documents'],account:['contacts','records','permissions','documents','configuration'],
  'account-unread':['communications'],auth:['permissions','participants','contacts'], 'auxiliary-state':['configuration','contacts','loyalty','inventory'],
  'business-state':['contacts','configuration','records','inventory'],communication:['communications'], 'data-transfer':['integration','contacts','records','finance','inventory'],
  'document-registry':['documents'], 'email-verification':['communications','permissions'],event:['time','records'],finance:['finance','sales','obligations','compensation','cost','loyalty','tax'],
  history:['records','contacts','finance','documents','configuration','integration'],inventory:['inventory','products','cost','sales','resources','orders','logistics'],
  loyalty:['loyalty','finance'],note:['records','contacts'],notification:['communications'], 'online-booking':['records','time','services','resources','communications'],
  'password-reset':['permissions'], 'platform-notice':['communications'],procedure:['services','products','service-stages'],profile:['workspace','workspace-relations','contacts','participants','time','configuration'],
  push:['communications'],record:['records','services','service-stages','time','resources','participants','sales','finance','loyalty','cost'],
  'saas-access':['permissions','configuration'], 'saas-admin':['permissions','configuration','documents','finance'],
  'tenant-document-archive':['documents'], 'tenant-invitation':['participants','permissions'],time:['time','resources','records'], 'transactional-email':['communications'],workspace:['workspace','workspace-relations','participants','permissions','configuration']
};
export function scopeFor(file,repository='core'){
  if(/\.md$/i.test(file))return {exempt:true,allowed:[]};
  if(repository==='core'&&file==='admin/index.html')return {exempt:true,generated:true,allowed:[]};
  const exact=DEVELOPMENT_CATALOG.flatMap(m=>m.criteria.filter(c=>c.work?.source?.repo===repository&&c.work.source.path===file).map(c=>c.key));
  const domain=repository==='core'?file.match(/^server\/src\/([^/]+)\//)?.[1]:null;
  const mapped=(coreDomains[domain]||[]).flatMap(k=>byMechanism.get(k)||[]);
  const allowed=[...new Set([...exact,...mapped])];
  if(allowed.length)return {allowed};
  // Infrastructure can be recorded without inventing a business criterion. Unknown runtime paths require a real criterion.
  if(/^(?:admin\/|landing\/|\.github\/|tests\/|scripts\/|server\/scripts\/|ui\/|css\/)/.test(file)||/^(?:package(?:-lock)?\.json|Dockerfile(?:\..*)?|docker-compose.*\.ya?ml|nginx\.conf|amvera\.ya?ml|\.gitignore)$/.test(file))return {allowed:['platform',...criterionIds]};
  return {allowed:[...criterionIds]};
}
export function parseEvidence(message){
  const rows=[];
  for(const line of message.split(/\r?\n/)){
    if(!line.startsWith(prefix))continue;
    const x=JSON.parse(line.slice(prefix.length));
    if(!x||!uniqueStrings(x.files)||!uniqueStrings(x.criteria)||!nonempty(x.result)||typeof x.remaining!=='string'||!uniqueStrings(x.checks)||x.criteria.some(k=>k!=='platform'&&!criterionIds.has(k))||!['candidate','implemented'].includes(x.kind)||Object.hasOwn(x,'ownerConfirmed'))throw Error('Invalid Operational-Evidence record');
    if(x.files.some(p=>p.startsWith('/')||p.split('/').includes('..')||p.includes('\0')))throw Error('Invalid evidence path');
    rows.push(x);
  }
  return rows;
}
export function verifyEvidence({files,commits,versionAt,head,repository='core'}){
  const errors=[], covered=[];
  const records=[];
  for(const c of commits){
    try{for(const e of parseEvidence(c.message))records.push({...e,sha:c.sha});}
    catch(err){errors.push(c.sha+': '+err.message);}
  }
  for(const file of files){
    const scope=scopeFor(file,repository);
    if(scope.exempt)continue;
    const v=versionAt(head,file);
    const matches=records.filter(e=>e.files.includes(file)&&e.criteria.some(k=>scope.allowed.includes(k))&&versionAt(e.sha,file)===v);
    if(!matches.length)errors.push(file+': missing evidence for final file version; allowed criteria: '+scope.allowed.join(', '));
    else covered.push({file,sha:matches[0].sha});
  }
  return {errors,covered};
}
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
export function run(base,head,repository='core'){
  if(!/^[0-9a-f]{40}$/.test(base)||!(/^[0-9a-f]{40}$/.test(head)))throw Error('Expected exact base/head commit SHAs');
  const ancestor=git(['merge-base',base,head]).trim();
  const files=git(['diff','--name-only','--no-renames','-z',ancestor,head]).split('\0').filter(Boolean);
  const commits=git(['rev-list',ancestor+'..'+head]).trim().split('\n').filter(Boolean).map(sha=>({sha,message:git(['show','-s','--format=%B',sha])}));
  const cache=new Map();
  const versionAt=(sha,file)=>{const key=sha+'\0'+file;if(!cache.has(key))cache.set(key,git(['--literal-pathspecs','ls-tree','-z',sha,'--',file]));return cache.get(key);};
  const out=verifyEvidence({files,commits,versionAt,head,repository});
  for(const x of out.errors)console.error(x);
  console.log('Release evidence: '+out.covered.length+' covered; '+out.errors.length+' errors. This is not owner acceptance.');
  return out.errors.length?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{process.exitCode=run(process.argv[2],process.argv[3],process.argv[4]||'core');}catch(e){console.error(e.message);process.exitCode=1;}
}
