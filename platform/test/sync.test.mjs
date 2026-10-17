import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runSync,slot} from '../sync.mjs';
const require=createRequire(import.meta.url),muke=path.resolve(process.env.MUKE_REPO||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../../muke'));
const {collectPages,sourceSnapshot,validatePublication}=require(path.join(muke,'tools/publication.js'));
const fields=[{field_id:'status-field',field_name:'Status',type:3,property:{options:['未开始','进行中','已停止','已完成'].map(name=>({name}))}},{field_id:'job-field',field_name:'Job-CN',type:3}];
const titles=['Role A','Role B'].map((cn,i)=>({record_id:'title'+i,fields:{'Job-CN':cn,'Job-ID':cn,JID:'P'+i,'JD 岗位说明':'Original description','JD Uraian Tugas':'Original ID'}}));
function rows(states=['进行中','进行中']){return states.map((state,i)=>({record_id:'req'+i,fields:{'Job-CN':titles[i].fields['Job-CN'],Status:state,Goal:2}}));}
function source(states){return sourceSnapshot(rows(states),fields,titles);}
function output(states=['进行中','进行中']){return {jobs:titles.filter((_,i)=>states[i]==='进行中').map(r=>({cn:r.fields['Job-CN'],goal:2,open:true,jid:r.fields.JID,jd:'Original description',jdId:'Original ID'}))};}
async function temp(){return fs.mkdtemp(path.join(os.tmpdir(),'muke-sync-'));}
async function cleanup(root){if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('muke-sync-'))throw Error('Unexpected cleanup path');await fs.rm(root,{recursive:true,force:true});}

test('complete pagination is required; API errors, repeated cursors and truncated pages fail',async()=>{
 const result=await collectPages(async c=>({code:0,data:{items:[{record_id:c?'second':'first'}],has_more:!c,...(!c?{page_token:'page2'}:{})}}));assert.equal(result.length,2);
 for(const fn of [async()=>({code:403,data:{items:[],has_more:false}}),async()=>({code:0,data:{items:[],has_more:true,page_token:'x'}}),async()=>({code:0,data:{items:[{record_id:'duplicate'}],has_more:true,page_token:'x'}}),async()=>({code:0,data:{items:[{record_id:'first'}]}})])await assert.rejects(collectPages(fn));
 await assert.rejects(collectPages(async c=>({code:0,data:{items:[{record_id:c||'first'}],has_more:true,page_token:'x'+c}}),{limit:2}));
});
test('explicit batch closure supports partial retirement, zero jobs and reopening',()=>{
 const old=source(),before=output();const partial=['已停止','进行中'],closed=['已停止','已完成'];
 assert.equal(validatePublication(before,output(partial),source(partial),old).retiredJobs,1);
 assert.equal(validatePublication(before,output(closed),source(closed),old).openJobs,0);
 assert.equal(validatePublication(output(closed),before,old,source(closed)).openJobs,2);
 assert.throws(()=>validatePublication(before,output(closed),source(closed),null));
});
test('deleted rows, unknown/blank status, schema changes and mismatched output retain protection',()=>{
 const before=output(),old=source(),closed=source(['已停止','已完成']);
 for(const next of [{...closed,records:closed.records.slice(1)},{...closed,statusField:'replaced'}, {...closed,records:closed.records.map(r=>({...r,state:''}))}])assert.throws(()=>validatePublication(before,{jobs:[]},next,old));
 assert.throws(()=>sourceSnapshot([],fields,titles));assert.throws(()=>source(['unknown','已停止']));assert.throws(()=>sourceSnapshot(rows(),fields.filter(f=>f.field_name!=='Status'),titles));
 assert.throws(()=>validatePublication(before,{jobs:[]},old,old));
 const invalid=output();invalid.jobs[0].goal=999;assert.throws(()=>validatePublication(before,invalid,old,old));
 invalid.jobs[0]= {...before.jobs[0],jd:''};assert.throws(()=>validatePublication(before,invalid,old,old));
});

test('real generator handles all-closed requirements without disabling other publication checks',async()=>{
 const root=await temp();try{
  await fs.writeFile(path.join(root,'manual.json'),JSON.stringify({staff:'Fixture',speed:'Fixture',jobs:{}}));
  const id={A01:'tblDDCntGCkEmWnK',A02:'tblIiWloAPiwkN8M',A03:'tblYMNkEDcql4pAb',A04:'tbloM0cxrKR4kOyC',A05:'tblyxgrrFk1Jzy6e',A06:'tblesxO7u1JdTVcG',A08:'tblQKNfszw1LKvUJ',A09:'tbl53EDnftILW69E',H01:'tbl0IXzgKcVRJetS',H22:'tblkIVU61UVMoraT',H28:'tblBdsUE5thm5cmk'};
  const script=await fs.readFile(path.join(muke,'tools/sync-portal.js'),'utf8');let states=['进行中','进行中'];
  const checks=require(path.join(muke,'tools/checks.js'));
  async function generate(){
   const data={A01:rows(states),A02:titles.map((t,i)=>({record_id:'task'+i,fields:{'T-Status':'发布',ARef:'FIX'+i,'Job-CN':t.fields['Job-CN']}})),A03:titles.map((t,i)=>({record_id:'agent'+i,fields:{ARef:'FIX'+i,Agent:[{name:'Fixture Agent'}],'Job-CN':t.fields['Job-CN'],Open:true,Status:states[i]}})),A04:[{record_id:'scout',fields:{SRef:'FIXSCOUT',Scot:'Fixture Scout',PIN:'fixture-pin-for-tests-only','Job-CN':'Role A','SC Status':'🟢 Active'}}],A05:[],A08:[],A09:[],H01:[],H22:titles,H28:[{record_id:'cv',fields:{LinkType:'通用简历',URL:'https://fixture.larksuite.com/share/base/form/cv'}},...titles.flatMap((t,i)=>['背景调查','招聘笔试'].map((type,n)=>({record_id:'form'+i+n,fields:{LinkType:type,'Job-CN':t.fields['Job-CN'],URL:'https://fixture.larksuite.com/share/base/form/f'+i+n}})))]};
   const metadata={A01:fields,H01:[{field_id:'res',field_name:'Status',property:{options:[{id:'res-option',name:'离职 RES'}]}}],H22:[{field_id:'title-name',field_name:'Job-CN',property:{options:[]}}],A05:['Ref','Full Name','WhatsApp','JOB','Kanal'].map((name,i)=>({field_id:'cv'+i,field_name:name})),A06:['Ref','Full Name','WhatsApp'].map((name,i)=>({field_id:'bg'+i,field_name:name}))};
   const net={auth:async()=>({}),J:async(_h,_method,url)=>{const table=Object.keys(id).find(k=>url.includes(id[k]));assert.ok(table);return {code:0,data:{items:url.includes('/fields')?metadata[table]:data[table],has_more:false}};}};
   const localRequire=name=>name==='./_net.js'?net:name==='./notify.js'?{send:async()=>assert.fail('Unexpected notification')}:name==='./checks.js'?{...checks,formLinks:async()=>({name:'表单链接',ok:true,msg:'Fixture only'})}:name.startsWith('./')?require(path.join(muke,'tools',name)):require(name);
   return vm.runInNewContext(script,{require:localRequire,__dirname:path.join(muke,'tools'),process:{env:{MUKE_DATA_DIR:root,LARK_BASE_TOKEN:'fixture',MUKE_STRICT_CHECKS:'1',GITHUB_ACTIONS:'1'}},console:{log(){}},Buffer,setTimeout:fn=>setTimeout(fn,0)});
  }
  await generate();assert.equal(JSON.parse(await fs.readFile(path.join(root,'jobs.json'))).jobs.length,2);
  states=['已停止','已完成'];await generate();assert.equal(JSON.parse(await fs.readFile(path.join(root,'jobs.json'))).jobs.length,0);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'_job-source.json'))).records.length,2);
  states=['进行中','已完成'];await generate();assert.equal(JSON.parse(await fs.readFile(path.join(root,'jobs.json'))).jobs.length,1);
 }finally{await cleanup(root);}
});
test('worker publishes verified empty snapshots atomically and retains last success on failure',async()=>{
 const root=await temp();try{
  const seed=path.join(root,'seed');await fs.mkdir(seed);await fs.writeFile(path.join(seed,'jobs.json'),JSON.stringify(output()));await fs.writeFile(path.join(seed,'_job-source.json'),JSON.stringify(source()));await fs.writeFile(path.join(seed,'manual.json'),'{}');
  const config={syncConfigured:true,data:root,muke};const stopped=['已停止','已完成'];
  await runSync(config,{generate:async(_c,stage)=>{await fs.writeFile(path.join(stage,'jobs.json'),JSON.stringify(output(stopped)));await fs.writeFile(path.join(stage,'_job-source.json'),JSON.stringify(source(stopped)));}});
  const pointer=await fs.readFile(path.join(root,'CURRENT'),'utf8'),success=JSON.parse(await fs.readFile(path.join(root,'sync-status.json')));assert.equal(success.ok,true);assert.ok(success.lastSuccessAt);
  await assert.rejects(runSync(config,{generate:async()=>{throw Error('fixture source unavailable');}}));assert.equal(await fs.readFile(path.join(root,'CURRENT'),'utf8'),pointer);const failure=JSON.parse(await fs.readFile(path.join(root,'sync-status.json')));assert.equal(failure.ok,false);assert.equal(failure.lastSuccessAt,success.lastSuccessAt);
 }finally{await cleanup(root);}
});
test('scheduler retains the Jakarta 09:00 to 22:00 window',()=>{
 assert.equal(slot(new Date('2026-10-18T01:59:59Z')),null);assert.equal(slot(new Date('2026-10-18T02:00:00Z')),'2026-10-18T02');assert.equal(slot(new Date('2026-10-18T15:30:00Z')),'2026-10-18T15');assert.equal(slot(new Date('2026-10-18T16:00:00Z')),null);
});
