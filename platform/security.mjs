import {randomBytes,createHash,pbkdf2,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(pbkdf2);
export const nonce=()=>randomBytes(32).toString('base64url');
export const hash=s=>createHash('sha256').update(s).digest('hex');
export function safeCode(value){return typeof value==='string'&&/^[a-z0-9]{1,64}$/i.test(value)?value.toLowerCase():null;}
export function authorizedHR(user,config){return !!(config.tenant&&user.tenant_key===config.tenant&&user.open_id&&config.hrIds.includes(user.open_id));}
export function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(p=>p.length===2));}
export function allowedOrigin(req,origins){return origins.includes(req.headers.origin)&&req.headers['sec-fetch-site']!=='cross-site';}
export class Limiter{
 constructor(){this.entries=new Map();}
 take(key,max=8,window=900000){const now=Date.now();let item=this.entries.get(key);if(!item||item.until<=now)item={n:0,until:now+window};if(this.entries.size>10000){for(const [k,v] of this.entries)if(v.until<=now)this.entries.delete(k);if(this.entries.size>10000)return false;}item.n++;this.entries.set(key,item);return item.n<=max;}
}
export class SessionStore{
 constructor(){this.items=new Map();}
 set(data,ttl){for(const [k,v] of this.items)if(v.expires<Date.now())this.items.delete(k);if(this.items.size>=5000)throw Error('session capacity');const id=nonce();this.items.set(hash(id),{...data,expires:Date.now()+ttl});return id;}
 get(id){const key=hash(id||'');const s=this.items.get(key);if(!s||s.expires<Date.now()){this.items.delete(key);return null;}return s;}
 delete(id){this.items.delete(hash(id||''));}
}
export async function decryptPanel(blob,pin){
 if(blob?.v!==1||blob.it!==150000||typeof pin!=='string'||pin.length<6||pin.length>128)throw Error('invalid');
 const salt=Buffer.from(blob.salt||'','base64'),iv=Buffer.from(blob.iv||'','base64'),ct=Buffer.from(blob.ct||'','base64');
 if(salt.length!==16||iv.length!==12||ct.length<17||ct.length>100000)throw Error('invalid');
 const key=await derive(pin,salt,150000,32,'sha256');const decipher=createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAuthTag(ct.subarray(-16));const value=JSON.parse(Buffer.concat([decipher.update(ct.subarray(0,-16)),decipher.final()]).toString());
 if(value.role!=='scout')throw Error('invalid');return value;
}
export function publicPanel(p){const counts={};for(const key of ['cv','pr','ex','iv','pass','hired','trial','conf','active']){const v=p.agg?.[key];counts[key]=Number.isFinite(v)?v:null;}return {name:p.name,code:p.code,job:p.job,jobId:p.jobId,stamp:p.stamp,counts,invite:p.url||''};}
