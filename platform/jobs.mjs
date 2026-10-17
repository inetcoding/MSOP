import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {lark} from './lark.mjs';
import {hash} from './security.mjs';

export const TABLES = {A01:'tblDDCntGCkEmWnK', H22:'tblkIVU61UVMoraT', H28:'tblBdsUE5thm5cmk'};
const FIELDS = {
 A01:{'需求名称':1,'Job-CN':3,'Job-ID':19,Status:3,Goal:2,'紧急程度':3,'到岗期限':5,'申请状态':3},
 H22:{JID:1,'Job-CN':3,'Job-ID':3,'JD 岗位说明':1,'JD Uraian Tugas':1},
 H28:{LinkType:3,'Job-CN':3,URL:15,Note:1,Status:3}
};
export function value(v){const a=v?.value??v;return (Array.isArray(a)?a:[a]).map(x=>typeof x==='string'||typeof x==='number'?String(x):x?.name||x?.text||x?.link||'').filter(Boolean).join(',');}
function fail(status,code){throw {status,jobCode:code};}
function date(v){const n=Number(value(v));return n>1e11?new Date(n+7*3600000).toISOString().slice(0,10):'';}
function formState(rows){
 if(!rows.length)return 'missing';
 if(rows.length!==1)return 'duplicate';
 const f=rows[0].fields;if(/OFF|停用/.test(value(f.Status)))return 'inactive';
 const raw=f.URL?.link||value(f.URL);
 try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||!u.hostname.endsWith('.larksuite.com'))return 'invalid';}catch{return 'invalid';}
 return 'configured';
}
export function projectCatalog(rows,schemas){
 const options=(table,name)=>schemas[table].find(f=>f.field_name===name)?.property?.options?.map(x=>x.name)||[];
 const reqs=rows.A01.map(r=>({id:r.record_id,name:value(r.fields['需求名称']),cn:value(r.fields['Job-CN']),idName:value(r.fields['Job-ID']),status:value(r.fields.Status),goal:Number(value(r.fields.Goal))||0,priority:value(r.fields['紧急程度']),due:date(r.fields['到岗期限']),approval:value(r.fields['申请状态'])}));
 const cv=rows.H28.filter(r=>/通用简历|简历/.test(value(r.fields.LinkType)+value(r.fields.Note)));
 const jobs=rows.H22.filter(r=>value(r.fields['Job-CN'])).map(r=>{
  const f=r.fields,cn=value(f['Job-CN']),requirements=reqs.filter(x=>x.cn===cn),active=requirements.filter(x=>/进行中/.test(x.status));
  const forms={cv:formState(cv),bg:formState(rows.H28.filter(r=>value(r.fields['Job-CN'])===cn&&/背景调查/.test(value(r.fields.LinkType)))),ex:formState(rows.H28.filter(r=>value(r.fields['Job-CN'])===cn&&/招聘笔试/.test(value(r.fields.LinkType))))};
  const job={id:r.record_id,cn,idName:value(f['Job-ID']),jid:value(f.JID),jd:value(f['JD 岗位说明']),jdId:value(f['JD Uraian Tugas']),requirements,forms,activeBatches:active.length,goal:active.reduce((a,x)=>a+x.goal,0),canDraft:options('A01','Job-CN').includes(cn)&&rows.H22.filter(x=>value(x.fields['Job-CN'])===cn).length===1};
  job.version=hash(JSON.stringify(job));return job;
 });
 return {fetchedAt:new Date().toISOString(),mode:'draft-only',jobs,options:{statuses:options('A01','Status'),priorities:options('A01','紧急程度')},unmappedRequirements:reqs.filter(r=>!jobs.some(j=>j.cn===r.cn)).length};
}
export function createCatalogReader(config,call=lark){
 let cached,inflight,token,expires=0;
 async function read(){
  if(!config.readAppId||!config.readAppSecret||!config.base)fail(503,'integration_unavailable');
  if(!token||Date.now()>expires){const t=await call('/open-apis/auth/v3/tenant_access_token/internal',{body:{app_id:config.readAppId,app_secret:config.readAppSecret}});if(!t.tenant_access_token)throw Error('No read token');token=t.tenant_access_token;expires=Date.now()+Math.max(60,Number(t.expire||7200)-300)*1000;}
  async function pages(table,kind,body){let items=[],cursor='';for(let n=0;n<30;n++){
   const url='/open-apis/bitable/v1/apps/'+encodeURIComponent(config.base)+'/tables/'+TABLES[table]+'/'+kind+'?page_size='+(kind==='fields'?100:500)+(cursor?'&page_token='+encodeURIComponent(cursor):'');
   const response=await call(url,{token,body});const d=response.data;
   if(!d||!Array.isArray(d.items))throw Error('Incomplete Lark response');items.push(...d.items);
   if(!d.has_more)return items;if(!d.page_token||d.page_token===cursor)throw Error('Incomplete pagination');cursor=d.page_token;
  }throw Error('Pagination limit');}
  const schemas={},rows={};
  // Serial reads avoid the existing Base API rate-limit problem. Never request people fields.
  for(const table of Object.keys(TABLES)){
   schemas[table]=await pages(table,'fields');
   for(const [name,type] of Object.entries(FIELDS[table]))if(!schemas[table].some(f=>f.field_name===name&&f.type===type))fail(503,'schema_changed');
   rows[table]=await pages(table,'records/search',{field_names:Object.keys(FIELDS[table])});
  }
  return projectCatalog(rows,schemas);
 }
 return async(force=false)=>{
  if(!force&&cached&&Date.now()-Date.parse(cached.fetchedAt)<60000)return structuredClone(cached);
  if(!inflight)inflight=read().then(r=>(cached=r)).finally(()=>{inflight=null;});
  return structuredClone(await inflight);
 };
}

const LABELS={name:'需求名称',goal:'招聘目标',status:'需求状态',priority:'紧急程度',due:'到岗期限',jd:'中文岗位说明',jdId:'印尼文岗位说明'};
export function prepareDraft(input,catalog){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['jobId','requirementId','baseVersion','changes'].includes(k)))fail(400,'invalid_draft');
 const job=catalog.jobs.find(j=>j.id===input.jobId);if(!job?.canDraft)fail(400,'job_unavailable');
 if(input.baseVersion!==job.version)fail(409,'source_changed');
 const isNew=input.requirementId==='new';const requirement=job.requirements.find(r=>r.id===input.requirementId);
 if(!isNew&&!requirement)fail(400,'requirement_unavailable');
 const changes=input.changes;if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>!Object.hasOwn(LABELS,k)))fail(400,'invalid_draft');
 const normalized={};
 for(const [key,v] of Object.entries(changes)){
  if(key==='goal'){if(!Number.isInteger(v)||v<1||v>10000)fail(400,'invalid_goal');normalized[key]=v;continue;}
  if(typeof v!=='string'||v.length>(key.startsWith('jd')?20000:200))fail(400,'invalid_draft');
  const s=v.trim();
  if(key==='name'&&!s)fail(400,'invalid_name');
  if(key==='status'&&!catalog.options.statuses.includes(s))fail(400,'invalid_status');
  if(key==='priority'&&!catalog.options.priorities.includes(s))fail(400,'invalid_priority');
  if(key==='due'&&s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))fail(400,'invalid_date');
  normalized[key]=s;
 }
 if(isNew&&!['name','goal','status','priority'].every(k=>Object.hasOwn(normalized,k)))fail(400,'incomplete_requirement');
 const differences=[];
 for(const [key,after] of Object.entries(normalized)){const before=key.startsWith('jd')?job[key]:requirement?.[key]??'';if(before!==after)differences.push({key,label:LABELS[key],before,after});}
 if(!differences.length)fail(400,'no_changes');
 let activeBatches=job.activeBatches;
 const nextStatus=normalized.status??requirement?.status??'';
 if(isNew){if(/进行中/.test(nextStatus))activeBatches++;}else activeBatches+=Number(/进行中/.test(nextStatus))-Number(/进行中/.test(requirement.status));
 const warnings=['草稿仅保存在服务器，尚未发布到 Lark 或招聘页。','上线前仍需核验审批、自动化触发及报名回跳。'];
 if(isNew)warnings.push('新增需求必须先核验现有招聘审批流程，不能绕过审批直接发布。');
 if(activeBatches>1)warnings.push('同岗位仍有 '+activeBatches+' 个进行中批次；停止单个批次不会让岗位下架。');
 if(differences.some(d=>d.key.startsWith('jd')))warnings.push('岗位说明由 H22 共用，正式修改后会影响该岗位所有招聘批次。');
 if(Object.values(job.forms).some(s=>s!=='configured'))warnings.push('报名表单配置存在缺失、停用、重复或无效项，需要先检查 H28。');
 return {jobId:job.id,jobName:job.cn,requirementId:input.requirementId,baseVersion:job.version,kind:isNew?'new-requirement':'edit-requirement',differences,warnings,impact:{activeBatches,visible:activeBatches>0}};
}

export class DraftStore{
 constructor(directory){this.directory=directory;this.file=path.join(directory,'job-drafts.json');this.queue=Promise.resolve();}
 async read(){try{const text=await fs.readFile(this.file,'utf8');if(text.length>30_000_000)throw Error('Draft store too large');const data=JSON.parse(text);if(data.version!==1||!Array.isArray(data.items))throw Error('Invalid draft store');return data;}catch(e){if(e.code==='ENOENT')return {version:1,items:[]};throw e;}}
 async mutate(fn){const task=this.queue.then(async()=>{const data=await this.read(),result=fn(data);await fs.mkdir(this.directory,{recursive:true,mode:0o700});const tmp=this.file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(tmp,JSON.stringify(data),{mode:0o600,flag:'wx'});await fs.rename(tmp,this.file);}catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw e;}return result;});this.queue=task.catch(()=>{});return task;}
 async create(prepared,actor){return this.mutate(data=>{const signature=hash(JSON.stringify(prepared)+actor.openId);const found=data.items.find(x=>x.signature===signature&&x.state==='draft');if(found)return found;if(data.items.length>=1000)fail(409,'draft_capacity');const item={...prepared,id:randomUUID(),signature,state:'draft',createdAt:new Date().toISOString(),authorName:actor.name,authorId:actor.openId};data.items.unshift(item);return item;});}
 async archive(id,actor){if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))fail(400,'invalid_draft');return this.mutate(data=>{const d=data.items.find(x=>x.id===id);if(!d)fail(404,'draft_missing');if(d.state!=='archived'){d.state='archived';d.archivedAt=new Date().toISOString();d.archivedBy=actor.openId;}return d;});}
 async list(catalog){await this.queue;return (await this.read()).items.map(d=>publicDraft(d,catalog));}
}
export function publicDraft(d,catalog){const {authorId,signature,archivedBy,...safe}=d;return {...safe,sourceChanged:catalog.jobs.find(j=>j.id===d.jobId)?.version!==d.baseVersion};}
