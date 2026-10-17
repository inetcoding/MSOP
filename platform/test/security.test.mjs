import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {randomBytes,pbkdf2Sync,createCipheriv} from 'node:crypto';
import {Readable} from 'node:stream';
import {createHandler,configFromEnv} from '../server.mjs';
import {authorizedHR,Limiter,SessionStore,safeCode,decryptPanel} from '../security.mjs';
function encrypted(obj,pin){const salt=randomBytes(16),iv=randomBytes(12),key=pbkdf2Sync(pin,salt,150000,32,'sha256'),c=createCipheriv('aes-256-gcm',key,iv),ct=Buffer.concat([c.update(JSON.stringify(obj)),c.final(),c.getAuthTag()]);return {v:1,it:150000,salt:salt.toString('base64'),iv:iv.toString('base64'),ct:ct.toString('base64')};}
test('HR authorization requires exact tenant and application open_id',()=>{const c={tenant:'test-tenant',hrIds:['test-user']};assert.equal(authorizedHR({tenant_key:'other',open_id:'test-user'},c),false);assert.equal(authorizedHR({tenant_key:'test-tenant',name:'test-user'},c),false);assert.equal(authorizedHR({tenant_key:'test-tenant',open_id:'test-user'},c),true);});
test('input boundaries, session expiry and bounded login attempts',()=>{assert.equal(safeCode('../secret'),null);assert.equal(safeCode('ABC234'),'abc234');const s=new SessionStore();assert.equal(s.get(s.set({role:'hr'},-1)),null);const l=new Limiter();assert.equal(l.take('a',1),true);assert.equal(l.take('a',1),false);});
test('legacy scout cipher verifies tag and rejects wrong PIN',async()=>{const pin=randomBytes(12).toString('hex'),blob=encrypted({role:'scout',code:'sample'},pin);assert.equal((await decryptPanel(blob,pin)).role,'scout');await assert.rejects(decryptPanel(blob,'wrong-value'));await assert.rejects(decryptPanel({...blob,it:1},pin));});
test('request handler boundaries, scout isolation and revocation',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'muke-test-'));const data=path.join(root,'data');await mkdir(path.join(data,'seed/p'),{recursive:true});const pin=randomBytes(12).toString('hex');await writeFile(path.join(data,'seed/jobs.json'),JSON.stringify({jobs:[],stamp:'test'}));const blob=encrypted({role:'scout',code:'sample',name:'Test Partner',agg:{cv:2},url:''},pin);await writeFile(path.join(data,'seed/p/sample.json'),JSON.stringify(blob));await writeFile(path.join(data,'seed/_status.json'),'private');
 const activeBlob=encrypted({role:'scout',code:'sample',name:'Test Partner',status:'🟢 Active',agg:{cv:2},url:''},pin);await writeFile(path.join(data,'seed/p/sample.json'),JSON.stringify(activeBlob));await writeFile(path.join(data,'sync-status.json'),JSON.stringify({ok:true,at:new Date().toISOString()}));
 const config={...configFromEnv({}),data,muke:root};const handle=createHandler(config,{scoutEnabled:true});const base='http://127.0.0.1:3000';
 async function fetch(url,options={}){const parsed=new URL(url);const req=Readable.from(options.body?[Buffer.from(options.body)]:[]);req.url=parsed.pathname+parsed.search;req.method=options.method||'GET';req.headers=Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));req.socket={remoteAddress:'127.0.0.1'};const headers=new Map();let status=200,output='';await handle(req,{setHeader(k,v){headers.set(k.toLowerCase(),v);},writeHead(s,h={}){status=s;for(const[k,v]of Object.entries(h))headers.set(k.toLowerCase(),v);},end(b=''){output+=b;}});return {status,headers,json:async()=>JSON.parse(output)};}
 const origin='http://127.0.0.1:3000';
 try{
 for(const url of ['/data/p/sample.json','/data/_status.json','/tools/_net.js','/.env','/data/j/%2e%2e%2f_status.json'])assert.equal((await fetch(base+url)).status,404,url);
 assert.equal((await fetch(base+'/api/hr/workspace')).status,401);
 assert.equal((await fetch(base+'/api/partner/me')).status,401);
 assert.equal((await fetch(base+'/auth/lark')).status,503);
 assert.equal((await fetch(base+'/auth/lark/callback?state=fake&code=fake')).status,403);
 const login=body=>({method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(base+'/api/partner/login',{...login({code:'sample',pin}),headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'}})).status,403);
 const r=await fetch(base+'/api/partner/login',login({code:'sample',pin}));assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);const cookie=r.headers.get('set-cookie').split(';')[0];
 const me=await fetch(base+'/api/partner/me',{headers:{Cookie:cookie}});assert.equal(me.status,200);assert.equal((await me.json()).counts.cv,2);
 assert.equal((await fetch(base+'/api/hr/workspace',{headers:{Cookie:cookie}})).status,401);
 await writeFile(path.join(data,'seed/p/sample.json'),JSON.stringify({...blob,ct:'revoked'}));assert.equal((await fetch(base+'/api/partner/me',{headers:{Cookie:cookie}})).status,401);
 const apply=await fetch(base+'/join/?s=ABC234&j=Role',{redirect:'manual'});assert.equal(apply.status,303);assert.equal(apply.headers.get('location'),'https://inetcoding.github.io/muke/join/?s=ABC234&j=Role');
 await writeFile(path.join(data,'sync-status.json'),JSON.stringify({ok:true,at:new Date(Date.now()-27*3600000).toISOString()}));assert.equal((await fetch(base+'/api/partner/login',login({code:'sample',pin}))).status,503);
 }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('muke-test-'))throw Error('Unexpected test cleanup path');await rm(root,{recursive:true,force:true});}
});
test('OAuth binds state to browser, uses PKCE and consumes callback once',async()=>{
 const config={...configFromEnv({}),production:true,jobsOrigin:'https://jobs.example.com',hrOrigin:'https://hr.example.com',appId:'fixture-client',appSecret:randomBytes(16).toString('hex'),tenant:'tenant-fixture',hrIds:['user-fixture']};
 let tokenCalls=0;const handle=createHandler(config,{oauthUser:async(code,verifier)=>{tokenCalls++;assert.ok(verifier.length>=43);return {name:'Test User',open_id:'user-fixture',tenant_key:'tenant-fixture'};}});
 async function request(url,cookie=''){const req=Readable.from([]);req.url=url;req.method='GET';req.headers={cookie};req.socket={remoteAddress:'127.0.0.1'};let status=200;const headers=new Map();await handle(req,{setHeader(k,v){headers.set(k.toLowerCase(),v);},writeHead(s,h={}){status=s;for(const[k,v]of Object.entries(h))headers.set(k.toLowerCase(),v);},end(){}});return {status,headers};}
 const start=await request('/auth/lark');assert.equal(start.status,303);const target=new URL(start.headers.get('location'));assert.equal(target.searchParams.get('code_challenge_method'),'S256');assert.ok(target.searchParams.get('code_challenge'));const state=target.searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
 const url='/auth/lark/callback?state='+state+'&code=test-code';assert.equal((await request(url,'muke_oauth=incorrect')).status,403);assert.equal(tokenCalls,0);
 const good=await request(url,cookie);assert.equal(good.status,303);assert.equal(good.headers.get('location'),'https://hr.example.com/hr/');assert.ok(good.headers.get('set-cookie').every(c=>c.includes('; Secure')));assert.equal(tokenCalls,1);
 assert.equal((await request(url,cookie)).status,403);assert.equal(tokenCalls,1);
});
