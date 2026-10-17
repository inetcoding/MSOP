import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHandler,configFromEnv} from '../server.mjs';
import {createAccessControl} from '../access.mjs';

const origin='https://hr.example.test';
function harness(){
 const config={...configFromEnv({}),production:true,hrOrigin:origin,jobsOrigin:'https://jobs.example.test',tenant:'fixture-company',appId:'fixture-login-app',appSecret:'fixture-secret',base:'fixture-base',hrIds:['owner'],accessFile:'/fixture/private-policy.json'};
 let policy={version:1,revision:'fixture-1',tenant:config.tenant,loginAppId:config.appId,subjects:['owner','hr','agent','manager','finance','employee'].map(role=>({openId:role,role,active:true}))},raw=null,unavailable=false,reads=0,writes=0;
 const accessOptions={readPolicy:async()=>{if(unavailable)throw Error('Unavailable');return raw??JSON.stringify(policy);}};
 const catalog={jobs:[],options:{},unmappedRequirements:0};
 const handler=createHandler(config,{accessOptions,oauthUser:async code=>({open_id:code,tenant_key:code==='outsider'?'other-company':config.tenant,name:'Fixture User'}),readCatalog:async()=>{reads++;return catalog;},draftStore:{list:async()=>[],create:async()=>{writes++;},archive:async()=>{writes++;}}});
 async function request(url,{method='GET',cookie='',body,headers={}}={}){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.url=url;req.method=method;req.headers={cookie,origin,'content-type':'application/json',...headers};req.socket={remoteAddress:'fixture'};
  let status=200,text='';const responseHeaders=new Map();
  await handler(req,{setHeader(k,v){responseHeaders.set(k.toLowerCase(),v);},writeHead(s,h={}){status=s;for(const[k,v]of Object.entries(h))responseHeaders.set(k.toLowerCase(),v);},end(v=''){text+=v;}});
  return {status,headers:responseHeaders,body:text?JSON.parse(text):null};
 }
 async function login(who){
  const start=await request('/auth/lark');assert.equal(start.status,303);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const response=await request('/auth/lark/callback?state='+state+'&code='+who,{cookie:start.headers.get('set-cookie').split(';')[0]});
  return {...response,cookie:response.status===303?response.headers.get('set-cookie')[0].split(';')[0]:''};
 }
 return {config,request,login,accessOptions,policy,setRaw:v=>raw=v,setUnavailable:v=>unavailable=v,counters:()=>({reads,writes})};
}

test('handoff roles cannot borrow application identity for job reads or draft mutations',async()=>{
 const h=harness();
 for(const who of ['hr','agent','manager','finance','employee']){
  const {cookie,status}=await h.login(who);assert.equal(status,303);
  const access=await h.request('/api/hr/access',{cookie});assert.deepEqual(access.body.capabilities,['workspace.view']);
  const workspace=await h.request('/api/hr/workspace',{cookie});assert.equal(workspace.status,200);assert.ok(workspace.body.links.length);assert.ok(workspace.body.links.every(x=>x.url.startsWith('https://mukestar.jp.larksuite.com/base/')));
  if(who==='finance'||who==='employee')assert.ok(workspace.body.links.every(x=>!['简历跟进','面试评估','招聘总评'].includes(x.title)));
  assert.equal((await h.request('/api/hr/jobs',{cookie})).status,403);
  for(const endpoint of ['preview','','archive']){
   const url='/api/hr/job-drafts'+(endpoint?'/'+endpoint:'');
   assert.equal((await h.request(url,{cookie,method:'POST',body:{role:'owner',openId:'owner',capabilities:['drafts.create'],id:'some-draft'}})).status,403);
  }
 }
 assert.deepEqual(h.counters(),{reads:0,writes:0});
});

test('anonymous, unlisted and wrong-company callers receive no private data',async()=>{
 const h=harness();
 for(const endpoint of ['/api/hr/access','/api/hr/workspace','/api/hr/jobs','/api/hr/future-private-api'])assert.equal((await h.request(endpoint)).status,401);
 for(const who of ['unlisted','outsider'])assert.equal((await h.login(who)).status,403);
 assert.deepEqual(h.counters(),{reads:0,writes:0});
});

test('policy changes invalidate an existing session before any further business read',async()=>{
 const h=harness();let {cookie}=await h.login('owner');
 assert.equal((await h.request('/api/hr/jobs',{cookie})).status,200);assert.equal(h.counters().reads,1);
 h.policy.subjects[0].role='hr'; // Even an unchanged revision string cannot preserve privilege.
 assert.equal((await h.request('/api/hr/jobs',{cookie})).status,401);
 assert.equal((await h.request('/api/session',{cookie})).body.user,null);
 ({cookie}=await h.login('owner'));assert.equal((await h.request('/api/hr/jobs',{cookie})).status,403);
 h.policy.subjects[0].active=false;
 assert.equal((await h.request('/api/hr/workspace',{cookie})).status,401);
 assert.equal((await h.login('owner')).status,403);assert.equal(h.counters().reads,1);
});

test('unreadable or malformed configured policy never falls back to administrator environment IDs',async()=>{
 const h=harness(),{cookie}=await h.login('owner');
 h.setUnavailable(true);
 for(const endpoint of ['/api/session','/api/hr/jobs','/api/hr/workspace'])assert.equal((await h.request(endpoint,{cookie})).status,503);
 assert.equal((await h.login('owner')).status,503);h.setUnavailable(false);
 for(const raw of ['{',JSON.stringify({...h.policy,loginAppId:'different-app'}),JSON.stringify({...h.policy,tenant:'different-company'}),JSON.stringify({...h.policy,subjects:[h.policy.subjects[0],h.policy.subjects[0]]}),JSON.stringify({...h.policy,subjects:[{openId:'owner',role:'administrator',active:true}]}),JSON.stringify({...h.policy,subjects:[{...h.policy.subjects[0],capabilities:['anything']}]})]){
  h.setRaw(raw);assert.equal((await h.request('/api/hr/jobs',{cookie})).status,503);
 }
 assert.deepEqual(h.counters(),{reads:0,writes:0});
});

test('owner capabilities never imply a publish, permission-management or business-write API',async()=>{
 const h=harness(),{cookie}=await h.login('owner');
 const response=await h.request('/api/hr/access',{cookie});assert.equal(response.body.role,'owner');assert.equal(response.body.openId,undefined);assert.equal(response.body.accessVersion,undefined);
 assert.ok(!response.body.capabilities.some(x=>/publish|permission|employee/.test(x)));
 for(const endpoint of ['/api/hr/job-drafts/publish','/api/hr/permissions','/api/hr/employees/create'])assert.ok([404,405].includes((await h.request(endpoint,{cookie,method:'POST',body:{}})).status));
 const access=createAccessControl(h.config,h.accessOptions),principal=await access.resolve({tenant_key:h.config.tenant,open_id:'owner'});
 assert.throws(()=>access.requireCapability(principal,'jobs.publish'),e=>e.status===403);
 assert.deepEqual(h.counters(),{reads:0,writes:0});
});

test('a policy revision change revokes sessions and permits a fresh approved login',async()=>{
 const h=harness(),first=await h.login('owner');h.policy.revision='fixture-2';
 assert.equal((await h.request('/api/hr/workspace',{cookie:first.cookie})).status,401);
 const next=await h.login('owner');assert.equal(next.status,303);assert.equal((await h.request('/api/hr/workspace',{cookie:next.cookie})).status,200);
});
