import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {projectCatalog,prepareDraft,DraftStore,createCatalogReader} from '../jobs.mjs';
import {createHandler,configFromEnv} from '../server.mjs';

function fixture(){
 const schemas={A01:[{field_name:'Job-CN',property:{options:[{name:'测试岗位'}]}},{field_name:'Status',property:{options:['未开始','进行中','已停止','已完成'].map(name=>({name}))}},{field_name:'紧急程度',property:{options:['宽松','常规','紧急'].map(name=>({name}))}}],H22:[],H28:[]};
 const rows={A01:[1,2].map(n=>({record_id:'req'+n,fields:{'需求名称':[{text:'Batch '+n}],'Job-CN':'测试岗位','Job-ID':{type:3,value:['Fixture Role']},Status:'进行中',Goal:n,'紧急程度':'常规','到岗期限':Date.parse('2026-10-20T17:00:00Z'),'申请状态':'已通过'}})),H22:[{record_id:'job1',fields:{'Job-CN':'测试岗位','Job-ID':'Fixture Role',JID:'FIX1','JD 岗位说明':'Original','JD Uraian Tugas':'Original ID'}}],H28:['通用简历','背景调查','招聘笔试'].map((type,n)=>({record_id:'form'+n,fields:{LinkType:type,'Job-CN':'测试岗位',URL:{link:'https://fixture.larksuite.com/share/base/form/fixture'},Status:'✅ 正在使用 ACT'}}))};
 return {rows,schemas,catalog:projectCatalog(rows,schemas)};
}
const proposal=cat=>({jobId:'job1',requirementId:'req1',baseVersion:cat.jobs[0].version,changes:{status:'已停止'}});
test('job projection preserves batches, Jakarta dates and H28 readiness without applicant data',()=>{
 const {catalog,rows,schemas}=fixture(),job=catalog.jobs[0];assert.equal(job.activeBatches,2);assert.equal(job.goal,3);assert.equal(job.requirements[0].due,'2026-10-21');assert.equal(job.forms.cv,'configured');assert.equal(job.canDraft,true);
 rows.H28[1].fields.Status='⛔ 已经停用 OFF';rows.H28.push(structuredClone(rows.H28[2]));const next=projectCatalog(rows,schemas).jobs[0];assert.equal(next.forms.bg,'inactive');assert.equal(next.forms.ex,'duplicate');assert.notEqual(next.version,job.version);
 rows.H28[0].fields.URL.link='javascript:alert(1)';assert.equal(projectCatalog(rows,schemas).jobs[0].forms.cv,'invalid');
});
test('draft impact checks remaining batches; rejects stale data, formula fields and impossible dates',()=>{
 const {catalog}=fixture();const p=prepareDraft(proposal(catalog),catalog);assert.equal(p.impact.activeBatches,1);assert.equal(p.impact.visible,true);assert.equal(p.differences[0].before,'进行中');
 for(const input of [{...proposal(catalog),baseVersion:'old'},{...proposal(catalog),changes:{'Job-ID':'hacked'}},{...proposal(catalog),changes:{goal:-1}},{...proposal(catalog),changes:{due:'2026-02-30'}},{...proposal(catalog),changes:{status:'已删除'}},{...proposal(catalog),changes:{status:'进行中'}},{...proposal(catalog),requirementId:'new',changes:{status:'进行中'}}])assert.throws(()=>prepareDraft(input,catalog));
 const newDraft=prepareDraft({...proposal(catalog),requirementId:'new',changes:{name:'New',goal:3,status:'未开始',priority:'常规'}},catalog);assert.equal(newDraft.impact.activeBatches,2);assert.match(newDraft.warnings.join(' '),/审批/);
});
test('private draft persistence is atomic, deduplicated, survives restart and keeps archived records',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'muke-jobs-'));try{
  const store=new DraftStore(root),{catalog}=fixture(),actor={name:'Fixture HR',openId:'fixture-private-id'},prepared=prepareDraft(proposal(catalog),catalog);
  const results=await Promise.all([store.create(prepared,actor),store.create(prepared,actor),store.create({...prepared,kind:'another-fixture'},actor)]);assert.equal(results[0].id,results[1].id);
  const restored=new DraftStore(root);assert.equal((await restored.list(catalog)).length,2);assert.equal((await restored.list(catalog))[0].authorId,undefined);
  await restored.archive(results[0].id,actor);assert.equal((await new DraftStore(root).list(catalog)).find(x=>x.id===results[0].id).state,'archived');
  catalog.jobs[0].version='changed';assert.ok((await restored.list(catalog)).every(d=>d.sourceChanged));assert.match(await readFile(path.join(root,'job-drafts.json'),'utf8'),/archived/);
 }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('muke-jobs-'))throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
test('Lark reader refuses unexpected field types and never submits business writes',async()=>{
 const calls=[];const reader=createCatalogReader({readAppId:'fixture',readAppSecret:'fixture',base:'fixture'},async(url,options)=>{calls.push([url,options]);if(url.includes('tenant_access_token'))return {tenant_access_token:'fixture-token',expire:7200};if(url.includes('/fields'))return {data:{items:[{field_name:'Goal',type:20}],has_more:false}};throw Error('Unexpected API');});
 await assert.rejects(reader(),e=>e.jobCode==='schema_changed');assert.equal(calls.length,2);assert.ok(calls.every(([url])=>url.includes('tenant_access_token')||url.includes('/fields')));
});

test('queued or staged drafts cannot commit after authorization is revoked',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'muke-jobs-'));try{
  const store=new DraftStore(root),{catalog}=fixture(),actor={name:'Fixture',openId:'fixture'},prepared=prepareDraft(proposal(catalog),catalog);
  const existing=await store.create(prepared,actor),before=await readFile(store.file,'utf8');
  const release=Promise.withResolvers();store.queue=release.promise;
  const queued=store.create({...prepared,kind:'queued'},actor,async()=>{throw {status:401};});
  const denial=assert.rejects(queued,e=>e.status===401);release.resolve();await denial;
  let checks=0;await assert.rejects(store.archive(existing.id,actor,async()=>{if(++checks===2)throw {status:401};}),e=>e.status===401);
  assert.equal(checks,2);assert.equal(await readFile(store.file,'utf8'),before);
  assert.deepEqual(await readdir(root),['job-drafts.json']);
  await store.archive(existing.id,actor,async()=>{});assert.equal((await store.list(catalog))[0].state,'archived');
 }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('muke-jobs-'))throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
test('HR API protects drafts from anonymous access and CSRF; preview never persists; no publish endpoint',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'muke-jobs-'));try{
  const {catalog}=fixture(),store=new DraftStore(root),origin='http://127.0.0.1:3000';let reads=0;
  const handler=createHandler({...configFromEnv({}),appId:'fixture',appSecret:'fixture',tenant:'company',hrIds:['hr'],data:root},{readCatalog:async()=>{reads++;return structuredClone(catalog);},draftStore:store,oauthUser:async()=>({open_id:'hr',tenant_key:'company',name:'HR'})});
  async function request(url,{method='GET',headers={},body}={}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=url;req.method=method;req.headers=headers;req.socket={remoteAddress:'fixture'};const h=new Map();let status=200,text='';await handler(req,{setHeader(k,v){h.set(k.toLowerCase(),v);},writeHead(s,more={}){status=s;for(const[k,v]of Object.entries(more))h.set(k.toLowerCase(),v);},end(x=''){text+=x;}});return {status,headers:h,text};}
  for(const url of ['/api/hr/jobs','/api/hr/job-drafts'])assert.equal((await request(url)).status,401);assert.equal(reads,0);
  const start=await request('/auth/lark'),state=new URL(start.headers.get('location')).searchParams.get('state');const login=await request('/auth/lark/callback?state='+state+'&code=fixture',{headers:{cookie:start.headers.get('set-cookie').split(';')[0]}});const cookie=login.headers.get('set-cookie')[0].split(';')[0];
  const auth={cookie,origin,'content-type':'application/json'};const send=body=>({method:'POST',headers:auth,body});
  assert.equal((await request('/api/hr/job-drafts',{...send(proposal(catalog)),headers:{...auth,origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await request('/api/hr/job-drafts/preview',send(proposal(catalog)))).status,200);assert.equal((await store.list(catalog)).length,0);
  const saved=await request('/api/hr/job-drafts',send(proposal(catalog)));assert.equal(saved.status,201);assert.equal((await store.list(catalog)).length,1);assert.equal(JSON.parse(saved.text).authorId,undefined);
  assert.equal((await request('/api/hr/job-drafts/publish',send({}))).status,404);assert.equal((await request('/job-drafts.json')).status,404);
  const response=await request('/api/hr/jobs',{headers:{cookie}});assert.equal(response.status,200);assert.equal(JSON.parse(response.text).mode,'draft-only');assert.match(response.headers.get('cache-control'),/no-store/);
 }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('muke-jobs-'))throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
