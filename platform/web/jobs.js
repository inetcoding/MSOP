'use strict';
const $=s=>document.querySelector(s),form=$('#edit-form'),dialog=$('#editor');
let catalog,selected,payload,currentDraft;
const messages={source_changed:'Lark 数据已变化。请关闭编辑、刷新岗位后重新核对。',schema_changed:'Lark 字段结构已变化，请先核对配置。',no_changes:'还没有修改内容。',invalid_goal:'招聘目标须为 1–10000 的整数。',incomplete_requirement:'请完整填写新增招聘批次。',job_unavailable:'该岗位尚未完成招聘配置。',draft_capacity:'草稿数量已达上限，请联系管理员整理。'};
function errorText(e){return messages[e.code]||(e.status===401?'登录已失效，请重新登录。':e.status===429?'操作较频繁，请稍后重试。':'暂时无法完成，请稍后重试。');}
async function api(url,options={}){const r=await fetch(url,{cache:'no-store',...options});const body=await r.json();if(!r.ok)throw Object.assign(Error(),{status:r.status,code:body.code});return body;}
function post(url,data){return api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function time(s){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Jakarta',dateStyle:'short',timeStyle:'short'}).format(new Date(s));}
function option(label,v){const o=el('option',label);o.value=v;return o;}
const formNames={cv:'简历',bg:'背调',ex:'测评'},formStates={configured:'已配置',missing:'缺失',inactive:'已停用',duplicate:'重复',invalid:'链接异常'};
function hasIssue(job){return Object.values(job.forms).some(s=>s!=='configured');}
function render(){
 const sync=catalog.sync;$('#sync-state').textContent=sync?(sync.ok?'招聘页最近同步成功：':'最近一次同步未成功，招聘页仍使用上一版。上次成功：')+(sync.lastSuccessAt?time(sync.lastSuccessAt)+'（雅加达）':'暂无记录')+' · 自动同步时段 09:00–22:00，每小时一次。':'暂时无法读取招聘页同步状态。';
 const open=catalog.jobs.filter(j=>j.activeBatches>0);$('#open-count').textContent=open.length;$('#batch-count').textContent=open.reduce((n,j)=>n+j.activeBatches,0);$('#draft-count').textContent=catalog.drafts.filter(d=>d.state==='draft').length;
 $('#read-time').textContent='读取：'+time(catalog.fetchedAt)+'（雅加达）';
 const q=$('#search').value.trim().toLowerCase(),filter=$('#filter').value;
 const jobs=catalog.jobs.filter(j=>(j.cn+j.idName+j.jid).toLowerCase().includes(q)&&(filter==='all'||filter==='open'&&j.activeBatches>0||filter==='closed'&&!j.activeBatches||filter==='issues'&&hasIssue(j))).sort((a,b)=>b.activeBatches-a.activeBatches||a.cn.localeCompare(b.cn,'zh'));
 $('#jobs').replaceChildren();$('#empty').hidden=jobs.length>0;
 for(const j of jobs){
  const card=el('article',undefined,'job-card'),top=el('div',undefined,'job-card-top'),title=el('div');title.append(el('span',j.jid||'未配置岗位代码','job-code'),el('h3',j.cn),el('p',j.idName||'未配置印尼文名称'));top.append(title,el('span',j.activeBatches?'在招':'未在招','pill'+(j.activeBatches?' live':'')));card.append(top);
  const numbers=el('div',undefined,'job-numbers');for(const [n,label]of [[j.activeBatches,'进行中批次'],[j.goal,'招聘目标']]){const item=el('span');item.append(el('b',n),document.createTextNode(label));numbers.append(item);}card.append(numbers);
  const checks=el('div',undefined,'job-checks');for(const [key,state]of Object.entries(j.forms))checks.append(el('span',(state==='configured'?'✓ ':'! ')+formNames[key]+' · '+formStates[state],state==='configured'?'':'issue'));card.append(checks);
  const footer=el('footer'),isPublished=catalog.published?.names.includes(j.cn);footer.append(el('span',catalog.published?(isPublished?'招聘页已展示':'招聘页未展示'):'招聘页快照暂不可用'));const button=el('button',j.canDraft?'查看 / 编辑草稿 →':'查看岗位 →');button.onclick=()=>edit(j);footer.append(button);card.append(footer);$('#jobs').append(card);
 }
 const drafts=catalog.drafts.filter(d=>$('#show-archived').checked||d.state==='draft');$('#drafts').replaceChildren();
 if(!drafts.length)$('#drafts').append(el('p','还没有未发布草稿。进入岗位后，可编辑现有批次或拟定新增需求。','empty'));
 for(const d of drafts){const row=el('article',undefined,'draft-row'),text=el('div');text.append(el('h3',d.jobName+' · '+(d.kind==='new-requirement'?'新增需求':'岗位变更')+' · '+(d.state==='archived'?'已归档':'未发布')),el('p',time(d.createdAt)+' · '+d.authorName+' · '+d.differences.length+' 项变更'+(d.sourceChanged?' · 原始数据已变化，需重新核对':'')));const button=el('button','查看差异 →');button.onclick=()=>showSaved(d);row.append(text,button);$('#drafts').append(row);}
}
async function load(){
 $('#refresh').disabled=true;$('#status').hidden=false;$('#status').textContent='正在读取 Lark 岗位与需求…';
 try{catalog=await api('/api/hr/jobs');$('#manager').hidden=false;$('#login').hidden=true;$('#logout').hidden=false;render();$('#status').hidden=!catalog.unmappedRequirements;$('#status').textContent=catalog.unmappedRequirements+' 条招聘需求未匹配到 H22 岗位，请在 Lark 中核对。';}
 catch(e){$('#status').textContent=errorText(e);if(e.status===401){$('#manager').hidden=true;$('#login').hidden=false;$('#logout').hidden=true;}}
 finally{$('#refresh').disabled=false;}
}
function fillBatch(){
 const r=selected.requirements.find(r=>r.id===form.elements.requirement.value),isNew=!r;
 for(const key of ['name','goal','priority','status','due'])form.elements[key].value=r?.[key]??({name:selected.cn+' 招聘需求',goal:1,status:catalog.options.statuses.find(x=>/未开始/.test(x))||'',priority:catalog.options.priorities.find(x=>/常规/.test(x))||'',due:''}[key]);
 $('#batch-info').textContent=r?'审批结果：'+(r.approval||'未填写')+'。招聘状态与审批结果是两个独立字段。':'新增批次仅为计划草稿，正式建立需求前需完成招聘审批核验。';
 if(!selected.canDraft)$('#batch-info').textContent='该岗位尚未完成招聘配置，当前仅可查看。请先在 Lark 核对职务与招聘选项。';
}
function edit(job){
 selected=job;currentDraft=null;payload=null;$('#editor-title').textContent=job.cn+' · 岗位与需求';$('#edit-status').textContent='';$('#save-status').textContent='';form.hidden=false;$('#review').hidden=true;
 form.elements.requirement.replaceChildren(...job.requirements.map(r=>option((r.name||'招聘批次')+' · '+r.status+' · '+r.goal+' 人',r.id)));
 if(job.canDraft||!job.requirements.length)form.elements.requirement.append(option('＋ 拟定新增招聘批次','new'));
 form.elements.status.replaceChildren(...catalog.options.statuses.map(x=>option(x,x)));form.elements.priority.replaceChildren(...catalog.options.priorities.map(x=>option(x,x)));
 const active=job.requirements.find(r=>/进行中/.test(r.status));if(active)form.elements.requirement.value=active.id;
 form.elements.jd.value=job.jd;form.elements.jdId.value=job.jdId;
 for(const field of form.querySelectorAll('input,select,textarea,button'))field.disabled=!job.canDraft;
 fillBatch();dialog.showModal();
}
function input(){const requirementId=form.elements.requirement.value,r=selected.requirements.find(x=>x.id===requirementId),changes={};for(const key of ['name','goal','status','priority','due','jd','jdId']){const next=key==='goal'?Number(form.elements[key].value):form.elements[key].value.trim(),before=key.startsWith('jd')?selected[key]:r?.[key];if(next!==before)changes[key]=next;}return {jobId:selected.id,requirementId,baseVersion:selected.version,changes};}
function review(d){
 form.hidden=true;$('#review').hidden=false;$('#differences').replaceChildren();$('#warnings').replaceChildren();$('#save-status').textContent='';
 for(const diff of d.differences){const row=el('div',undefined,'diff-row'),values=el('div',undefined,'diff-values');row.append(el('h3',diff.label));for(const [label,val]of [['当前内容',diff.before],['草稿内容',diff.after]]){const cell=el('div');cell.append(el('small',label),document.createTextNode(val===''?'（空）':String(val)));values.append(cell);}row.append(values);$('#differences').append(row);}
 for(const w of d.warnings)$('#warnings').append(el('li',w));if(d.sourceChanged)$('#warnings').prepend(el('li','原始数据已经变化，本草稿需要重新核对。'));
 $('#impact').textContent='按草稿推算：'+d.impact.activeBatches+' 个进行中批次；正式执行并完成同步后，岗位将'+(d.impact.visible?'继续展示。':'不再展示。')+' 当前招聘页未被修改。';
 $('#save-draft').hidden=!!currentDraft;$('#back-edit').hidden=!!currentDraft;$('#archive-draft').hidden=!currentDraft||currentDraft.state==='archived';
}
function showSaved(d){currentDraft=d;$('#editor-title').textContent=d.jobName+' · '+(d.state==='archived'?'已归档草稿':'未发布草稿');review(d);dialog.showModal();}
form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;$('#edit-status').textContent='正在核对最新数据…';try{payload=input();review(await post('/api/hr/job-drafts/preview',payload));}catch(error){$('#edit-status').textContent=errorText(error);}finally{button.disabled=false;}};
$('#save-draft').onclick=async()=>{const button=$('#save-draft');button.disabled=true;$('#save-status').textContent='正在保存…';try{currentDraft=await post('/api/hr/job-drafts',payload);review(currentDraft);$('#save-status').textContent='已保存为未发布草稿，Lark 和招聘页保持不变。';await load();}catch(e){$('#save-status').textContent=errorText(e);}finally{button.disabled=false;}};
$('#archive-draft').onclick=async()=>{const button=$('#archive-draft');button.disabled=true;try{await post('/api/hr/job-drafts/archive',{id:currentDraft.id});currentDraft.state='archived';review(currentDraft);$('#save-status').textContent='已归档，仍可在“显示已归档”中查看。';await load();}catch(e){$('#save-status').textContent=errorText(e);}finally{button.disabled=false;}};
$('#back-edit').onclick=()=>{form.hidden=false;$('#review').hidden=true;$('#edit-status').textContent='';};$('#close-editor').onclick=()=>dialog.close();form.elements.requirement.onchange=fillBatch;
$('#search').oninput=render;$('#filter').onchange=render;$('#show-archived').onchange=render;$('#refresh').onclick=load;
$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});location.href='/hr/';};
$('#base-link').href='https://mukestar.jp.larksuite.com/base/LZgFb8JQXasW5NsZRV5jl5nWpSf?table=tblDDCntGCkEmWnK';
load();
