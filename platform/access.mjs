import fs from 'node:fs/promises';
import {hash} from './security.mjs';

// These are platform capabilities, not a copy of Base's row/field permissions.
// Only the explicitly approved owner can use the application-identity catalog.
// Other roles currently receive Lark handoff links, never application data access.
const ROLES=Object.freeze({
 owner:{label:'系统负责人',capabilities:['workspace.view','jobs.read','drafts.preview','drafts.create','drafts.archive']},
 hr:{label:'人事协作',capabilities:['workspace.view']},
 agent:{label:'经纪协作',capabilities:['workspace.view']},
 manager:{label:'部门协作',capabilities:['workspace.view']},
 finance:{label:'财务协作',capabilities:['workspace.view']},
 employee:{label:'员工自助',capabilities:['workspace.view']}
});
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));}
function validId(id){return typeof id==='string'&&id.length>0&&id.length<=128&&id.trim()===id;}
function parsePolicy(raw,config){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>100000)throw Error('Invalid policy');
 const p=JSON.parse(raw);
 if(!exactKeys(p,['version','revision','tenant','loginAppId','subjects'])||p.version!==1||!validId(p.revision)||p.tenant!==config.tenant||p.loginAppId!==config.appId||!Array.isArray(p.subjects)||p.subjects.length>500)throw Error('Invalid policy');
 const ids=new Set();
 for(const s of p.subjects){
  if(!exactKeys(s,['openId','role','active'])||!validId(s.openId)||ids.has(s.openId)||typeof s.active!=='boolean'||!Object.hasOwn(ROLES,s.role))throw Error('Invalid subject');
  ids.add(s.openId);
 }
 return p;
}
export function createAccessControl(config,{readPolicy=filename=>fs.readFile(filename,'utf8')}={}){
 async function policy(){
  if(!config.tenant||!config.appId)return null;
  if(config.accessFile){
   try{return parsePolicy(await readPolicy(config.accessFile),config);}catch{throw {status:503,accessCode:'access_policy_unavailable'};}
  }
  // Compatibility until a private policy is installed. These IDs are administrators,
  // never a general employee allowlist. A configured policy never falls back here.
  return {version:1,revision:'bootstrap',tenant:config.tenant,loginAppId:config.appId,subjects:(config.hrIds||[]).map(openId=>({openId,role:'owner',active:true}))};
 }
 async function resolve(user){
  if(!user||!config.tenant||user.tenant_key!==config.tenant||!validId(user.open_id))return null;
  const p=await policy();if(!p)return null;
  const s=p.subjects.find(s=>s.openId===user.open_id&&s.active);if(!s)return null;
  const role=ROLES[s.role];
  return {openId:s.openId,tenant:p.tenant,accessRole:s.role,label:role.label,capabilities:[...role.capabilities],accessVersion:hash(JSON.stringify(p))};
 }
 async function current(session){
  if(!session||session.role!=='hr')return null;
  const p=await resolve({open_id:session.openId,tenant_key:session.tenant});
  return p&&p.accessVersion===session.accessVersion&&p.accessRole===session.accessRole?p:null;
 }
 function requireCapability(principal,capability){if(!principal)throw {status:401};if(!principal.capabilities.includes(capability))throw {status:403,accessCode:'permission_denied'};}
 return {resolve,current,requireCapability};
}

const HANDOFFS=[
 {title:'招聘需求',label:'A01 · 招聘需求与审批',table:'tblDDCntGCkEmWnK',roles:['hr','agent','manager','finance']},
 {title:'简历跟进',label:'A05 · 候选人简历',table:'tblyxgrrFk1Jzy6e',roles:['owner','hr','agent','manager']},
 {title:'面试评估',label:'A08 · 面试记录',table:'tblQKNfszw1LKvUJ',roles:['owner','hr','agent','manager']},
 {title:'招聘总评',label:'A09 · 综合评估',table:'tbl53EDnftILW69E',roles:['owner','hr','agent','manager']},
 {title:'员工档案',label:'H01 · 入职与人员档案',table:'tbl0IXzgKcVRJetS',roles:['owner','hr','agent','manager','finance']},
 {title:'星探管理',label:'A04 · 推荐渠道',table:'tbloM0cxrKR4kOyC',roles:['owner','hr','agent']}
];
export function workspaceLinks(principal,base){
 const root='https://mukestar.jp.larksuite.com/base/'+encodeURIComponent(base),links=[];
 if(principal.capabilities.includes('jobs.read'))links.push({title:'岗位管理',label:'在招岗位 · 变更草稿',url:'/hr/jobs/'});
 for(const item of HANDOFFS)if(item.roles.includes(principal.accessRole))links.push({title:item.title,label:item.label,url:root+'?table='+item.table});
 if(principal.accessRole==='employee')links.push({title:'我的 Lark 业务入口',label:'按本人已有权限查看',url:root});
 return links;
}
