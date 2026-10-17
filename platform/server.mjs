import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {safeCode,cookies,allowedOrigin,authorizedHR,Limiter,SessionStore,decryptPanel,publicPanel,hash,nonce} from './security.mjs';
import {authorizationUrl,oauthUser} from './lark.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp'};
export function configFromEnv(env=process.env){return {port:Number(env.PORT||3000),host:env.HOST||'127.0.0.1',muke:path.resolve(env.MUKE_REPO||path.join(HERE,'../../muke')),data:path.resolve(env.MUKE_PRIVATE_DATA||path.join(HERE,'.runtime')),jobsOrigin:env.JOBS_ORIGIN||'http://127.0.0.1:3000',hrOrigin:env.HR_ORIGIN||'http://127.0.0.1:3000',production:env.NODE_ENV==='production',proxy:env.TRUST_PROXY==='1',appId:env.LARK_LOGIN_APP_ID||'',appSecret:env.LARK_LOGIN_APP_SECRET||'',tenant:env.LARK_TENANT_KEY||'',hrIds:(env.HR_ADMIN_OPEN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean),base:env.LARK_BASE_TOKEN||'',syncConfigured:!!(env.LARK_APP_ID&&env.LARK_APP_SECRET&&env.LARK_BASE_TOKEN),applyEnabled:env.APPLICATIONS_ENABLED==='1'};}
export function createHandler(config,dependencies={}){
 const sessions=new SessionStore(),pending=new SessionStore(),limiter=new Limiter();
 const getUser=dependencies.oauthUser||oauthUser;
 const origins=[config.jobsOrigin,config.hrOrigin];
 if(config.production&&origins.some(o=>!o.startsWith('https://')))throw Error('Production requires HTTPS origins');
 const secure=config.production?'; Secure':'';
 function cookie(name,value,seconds){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`;}
 async function dataDir(){try{const generation=(await fs.readFile(path.join(config.data,'CURRENT'),'utf8')).trim();if(!/^gen-[a-z0-9-]+$/.test(generation))throw Error();return path.join(config.data,generation);}catch{return path.join(config.data,'seed');}}
 async function jsonFile(rel){return JSON.parse(await fs.readFile(path.join(await dataDir(),rel),'utf8'));}
 async function scoutReady(){if(process.env.SCOUT_LOGIN_ENABLED!=='1'&&!dependencies.scoutEnabled)return false;try{const s=JSON.parse(await fs.readFile(path.join(config.data,'sync-status.json'),'utf8'));const age=Date.now()-Date.parse(s.at);return s.ok===true&&age>=0&&age<26*3600000;}catch{return false;}}
 function reply(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));}
 function redirect(res,url,headers={}){res.writeHead(303,{Location:url,...headers});res.end();}
 function client(req){return config.proxy?String(req.headers['x-real-ip']||req.socket.remoteAddress):req.socket.remoteAddress;}
 async function body(req){if(!(req.headers['content-type']||'').startsWith('application/json'))throw {status:415};let n=0,s='';for await(const chunk of req){n+=chunk.length;if(n>4096)throw {status:413};s+=chunk;}try{return JSON.parse(s);}catch{throw {status:400};}}
 async function file(res,root,relative,legacy=false){const filename=path.resolve(root,relative);if(!filename.startsWith(path.resolve(root)+path.sep))throw {status:404};const ext=path.extname(filename);if(!types[ext])throw {status:404};const b=await fs.readFile(filename);if(legacy)res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");res.writeHead(200,{'Content-Type':types[ext]});res.end(b);}
 return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
 try{
 const u=new URL(req.url,'http://local'),p=u.pathname;
 if((req.url||'').length>8192)throw {status:414};
 if(req.method==='GET'&&p==='/healthz')return reply(res,200,{ok:true,version:'0.1.0'});
 if(req.method==='GET'&&p==='/api/public-status')return reply(res,200,{syncConfigured:config.syncConfigured,applicationsEnabled:config.applyEnabled});
 if(req.method==='GET'&&p==='/api/session'){const s=sessions.get(cookies(req).muke_session);return reply(res,200,{user:s?{name:s.name,role:s.role}:null,hrConfigured:!!(config.appId&&config.appSecret&&config.tenant&&config.hrIds.length)});}
 if(req.method==='POST'&&p==='/api/logout'){if(!allowedOrigin(req,origins))throw {status:403};sessions.delete(cookies(req).muke_session);return reply(res,200,{ok:true},{'Set-Cookie':cookie('muke_session','',0)});}
 if(req.method==='POST'&&p==='/api/partner/login'){
  if(!await scoutReady())throw {status:503};
  if(!allowedOrigin(req,origins))throw {status:403};if(!limiter.take('ip:'+client(req),10))throw {status:429};const b=await body(req),code=safeCode(b.code);if(!code||!limiter.take('code:'+code,10))throw {status:401};
  try{const panel=await jsonFile('p/'+code+'.json');const decoded=await decryptPanel(panel,b.pin);if(String(decoded.code||'').toLowerCase()!==code||!String(decoded.status||'').startsWith('🟢'))throw Error();const id=sessions.set({role:'scout',name:decoded.name,code,panel:publicPanel(decoded),signature:hash(JSON.stringify(panel))},30*60000);return reply(res,200,{ok:true},{'Set-Cookie':cookie('muke_session',id,1800)});}catch{throw {status:401};}
 }
 if(req.method==='GET'&&p==='/api/partner/me'){
  if(!await scoutReady())throw {status:503};
  const s=sessions.get(cookies(req).muke_session);if(!s||s.role!=='scout')throw {status:401};let current;try{current=await jsonFile('p/'+s.code+'.json');}catch{sessions.delete(cookies(req).muke_session);throw {status:401};}if(hash(JSON.stringify(current))!==s.signature){sessions.delete(cookies(req).muke_session);throw {status:401};}
  const panel={...s.panel};if(panel.invite){try{const url=new URL(panel.invite);if(!['inetcoding.github.io','zanboooo.github.io',new URL(config.jobsOrigin).hostname].includes(url.hostname))throw Error();if(!/^\/(muke\/)?join\/?$/.test(url.pathname))throw Error();panel.invite=config.jobsOrigin+'/join/'+url.search+url.hash;}catch{panel.invite='';}}return reply(res,200,panel);
 }
 if(req.method==='GET'&&p==='/auth/lark'){
  if(!config.appId||!config.appSecret||!config.tenant||!config.hrIds.length)throw {status:503};if(!limiter.take('oauth:'+client(req),20))throw {status:429};const verifier=nonce();const id=pending.set({verifier},5*60000);return redirect(res,authorizationUrl(id,createHash('sha256').update(verifier).digest('base64url'),config),{'Set-Cookie':cookie('muke_oauth',id,300)});
 }
 if(req.method==='GET'&&p==='/auth/lark/callback'){
  const state=u.searchParams.get('state'),saved=cookies(req).muke_oauth;const flow=pending.get(state);if(!state||state!==saved||!flow)throw {status:403};pending.delete(state);if(!u.searchParams.get('code'))throw {status:400};const user=await getUser(u.searchParams.get('code'),flow.verifier,config);if(!authorizedHR(user,config))throw {status:403};const id=sessions.set({role:'hr',name:user.name||user.en_name||'HR',openId:user.open_id,tenant:user.tenant_key},4*3600000);return redirect(res,config.hrOrigin+'/hr/',{'Set-Cookie':[cookie('muke_session',id,14400),cookie('muke_oauth','',0)]});
 }
 if(req.method==='GET'&&p==='/api/hr/workspace'){
  const s=sessions.get(cookies(req).muke_session);if(!s||s.role!=='hr'||!authorizedHR({open_id:s.openId,tenant_key:s.tenant},config))throw {status:401};if(!config.base)throw {status:503};const base='https://mukestar.jp.larksuite.com/base/'+encodeURIComponent(config.base);return reply(res,200,{name:s.name,mode:'lark-handoff',links:[{title:'招聘需求',label:'A01 · 岗位与需求',url:base+'?table=tblDDCntGCkEmWnK'},{title:'简历跟进',label:'A05 · 候选人简历',url:base+'?table=tblyxgrrFk1Jzy6e'},{title:'面试评估',label:'A08 · 面试记录',url:base+'?table=tblQKNfszw1LKvUJ'},{title:'招聘总评',label:'A09 · 综合评估',url:base+'?table=tbl53EDnftILW69E'},{title:'员工档案',label:'H01 · 入职与人员档案',url:base+'?table=tbl0IXzgKcVRJetS'},{title:'星探管理',label:'A04 · 推荐渠道',url:base+'?table=tbloM0cxrKR4kOyC'}]});
 }
 if(req.method!=='GET'&&req.method!=='HEAD')throw {status:405};
 if(req.method==='HEAD'){if(p!=='/healthz')throw {status:405};res.writeHead(200);return res.end();}
 if(p==='/data/jobs.json'||p==='/data/manual.json'||p==='/data/bench.json')return reply(res,200,await jsonFile(p.slice(6)));
 const entry=p.match(/^\/data\/(j|s)\/([a-z0-9]{1,64})\.json$/);if(entry)return reply(res,200,await jsonFile(`${entry[1]}/${entry[2]}.json`));
 if(p==='/'||p==='/portal/')return file(res,path.join(config.muke,'portal'),'index.html');
 if(['/portal/app.js','/portal/style.css'].includes(p))return file(res,config.muke,p.slice(1));
 if(p==='/join'||p==='/join/'){
  if(!config.applyEnabled)return redirect(res,'https://inetcoding.github.io/muke/join/'+u.search);return file(res,config.muke,'join/index.html',true);
 }
 if(p==='/agent/'||p==='/agent')return redirect(res,'/partner/'+u.search);
 if(['/partner/','/hr/','/hr/setup.html'].includes(p))return file(res,path.join(HERE,'web'),p==='/partner/'?'partner.html':p==='/hr/'?'hr.html':'setup.html');
 if(['/assets/platform.css','/assets/platform.js'].includes(p))return file(res,path.join(HERE,'web'),path.basename(p));
 throw {status:404};
 }catch(e){const status=e.status||(e.code==='ENOENT'?404:502);reply(res,status,{error:({400:'Invalid request',401:'Login required or credentials invalid',403:'Access denied',404:'Not found',405:'Method not allowed',413:'Request too large',415:'JSON required',429:'Too many attempts. Try again later.',503:'Integration not configured'})[status]||'Service temporarily unavailable'});}
 };
}
export function createApp(config,dependencies={}){return http.createServer(createHandler(config,dependencies));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const c=configFromEnv();const server=createApp(c);server.requestTimeout=30000;server.headersTimeout=10000;server.listen(c.port,c.host,()=>console.log(`MUKE server listening on ${c.host}:${c.port}`));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));}
