// Lark remains authoritative. Build a private generation, then replace CURRENT atomically.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {configFromEnv} from './server.mjs';
const require=createRequire(import.meta.url);
async function exists(p){try{await fs.access(p);return true;}catch{return false;}}
async function state(config,value){const file=path.join(config.data,'sync-status.json');let old={};try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch{}const lastSuccessAt=value.ok?value.at:old.lastSuccessAt||(old.ok?old.at:null);const tmp=path.join(config.data,'sync-status.tmp');await fs.writeFile(tmp,JSON.stringify({...value,lastSuccessAt}),{mode:0o600});await fs.rename(tmp,file);}
async function generate(config,stage){
 const child=spawn(process.execPath,[path.join(config.muke,'tools/sync-portal.js')],{stdio:['ignore','pipe','pipe'],env:{...process.env,MUKE_DATA_DIR:stage,MUKE_STRICT_CHECKS:'1',GITHUB_ACTIONS:'1',FORCE_SYNC:'0',LARK_ALERT_CHAT_ID:''}});
 // Do not copy API errors, row content or decrypted business data into logs.
 child.stdout.resume();child.stderr.resume();await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Sync data validation or source request failed')));});
}
export async function runSync(config,dependencies={}){
 if(!config.syncConfigured)throw Error('Lark sync credentials have not been configured');
 await fs.mkdir(config.data,{recursive:true,mode:0o700});
 const lock=await fs.open(path.join(config.data,'sync.lock'),'wx',0o600).catch(()=>{throw Error('Sync lock exists; inspect the running sync before removing it');});
 try{
 const gen='gen-'+Date.now()+'-'+randomUUID();const stage=path.join(config.data,gen);let previous='seed';
 try{const old=(await fs.readFile(path.join(config.data,'CURRENT'),'utf8')).trim();if(/^gen-[a-z0-9-]+$/.test(old))previous=old;}catch{}
 const prior=path.join(config.data,previous);if(await exists(prior))await fs.cp(prior,stage,{recursive:true});else await fs.mkdir(stage,{recursive:true,mode:0o700});
 if(!await exists(path.join(stage,'manual.json')))await fs.copyFile(path.join(config.muke,'data/manual.json'),path.join(stage,'manual.json'));
 await (dependencies.generate||generate)(config,stage);
 const read=async(dir,name)=>{try{return JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const {validatePublication}=require(path.join(config.muke,'tools/publication.js'));
 validatePublication(await read(prior,'jobs.json'),await read(stage,'jobs.json'),await read(stage,'_job-source.json'),await read(prior,'_job-source.json'));
 const tmp=path.join(config.data,'CURRENT.tmp');await fs.writeFile(tmp,gen,{mode:0o600});await fs.rename(tmp,path.join(config.data,'CURRENT'));
 await state(config,{ok:true,at:new Date().toISOString(),generation:gen});console.log('Sync generation published');
 }catch(e){await state(config,{ok:false,at:new Date().toISOString()});throw e;}finally{await lock.close();await fs.unlink(path.join(config.data,'sync.lock'));}
}
export function slot(now=new Date()){const hour=now.getUTCHours();if(hour<2||hour>15)return null;return now.toISOString().slice(0,13);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const config=configFromEnv();
if(process.argv.includes('--once')){runSync(config).catch(()=>{console.error('Sync failed; previous generation retained. Check private configuration and Lark access.');process.exitCode=1;});}
else{
 console.log('Sync worker ready: 09:00–22:00 Asia/Jakarta, 14 hourly slots');
 let busy=false;
 const tick=async()=>{if(busy||process.env.SYNC_ENABLED!=='1')return;const next=slot();if(!next)return;busy=true;try{await fs.mkdir(config.data,{recursive:true,mode:0o700});const marker=path.join(config.data,'last-slot');let last='';try{last=await fs.readFile(marker,'utf8');}catch{}if(last===next)return;await fs.writeFile(marker,next,{mode:0o600});await runSync(config);}catch{console.error('Scheduled sync failed; previous generation retained.');}finally{busy=false;}};
 await tick();setInterval(tick,30000);
}
}
