'use strict';
const $=s=>document.querySelector(s),page=document.body.dataset.page;
async function api(url,options={}){const r=await fetch(url,{cache:'no-store',...options});if(!r.ok)throw Object.assign(Error(),{status:r.status});return r.json();}
async function logout(){await api('/api/logout',{method:'POST'});location.reload();}
const exit=$('#logout');if(exit)exit.onclick=()=>logout().catch(()=>location.reload());
if(page==='hr'){
 api('/api/session').then(async s=>{
 if(s.user?.role==='hr'){const w=await api('/api/hr/workspace');$('#login').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;$('#user-name').textContent=w.name;for(const entry of w.links){const a=document.createElement('a');a.className='card';a.href=entry.url;a.target='_blank';a.rel='noopener noreferrer';const arrow=document.createElement('span');arrow.textContent='↗';const label=document.createElement('p');label.textContent=entry.label;const title=document.createElement('h3');title.textContent=entry.title;a.append(arrow,label,title);$('#links').append(a);}}
 else{$('#lark-login').hidden=!s.hrConfigured;$('#login-state').textContent=s.hrConfigured?'扫码登录后进入你的工作台。':'新版工作台正在接入公司账号。接入完成前，请继续使用现有 Lark 工作入口。';}
 }).catch(()=>{$('#login-state').textContent='暂时无法加载工作台，请稍后重试。';});
}
async function partner(){const p=await api('/api/partner/me');$('#login').hidden=true;$('#partner-workspace').hidden=false;$('#partner-name').textContent='Halo, '+p.name;$('#partner-job').textContent=p.jobId||p.job||'';$('#data-date').textContent='Data diperbarui: '+(p.stamp||'—');const labels={cv:'Lamaran',pr:'Kuesioner',ex:'Tes',iv:'Wawancara',pass:'Lulus',hired:'Bergabung'};$('#metrics').replaceChildren();for(const [key,label]of Object.entries(labels)){const el=document.createElement('div');el.className='metric';const t=document.createElement('span');t.textContent=label;const n=document.createElement('strong');n.textContent=p.counts[key]??'—';el.append(t,n);$('#metrics').append(el);}if(p.invite){$('#invite').hidden=false;$('#invite').href=p.invite;$('#invite-status').textContent='Gunakan tautan ini agar rekomendasi tetap tercatat atas namamu.';}else{$('#invite-status').textContent='Tautan belum diterbitkan. Hubungi koordinator rekrutmen.';}}
if(page==='partner'){
 const query=new URLSearchParams(location.search);$('#partner-login').elements.code.value=query.get('s')||query.get('code')||'';
 partner().catch(e=>{if(e.status===503)$('#login-state').textContent='Portal partner baru belum aktif. Gunakan akses yang diberikan koordinator untuk sementara.';});
 $('#partner-login').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;$('#login-state').textContent='Memeriksa akses…';try{await api('/api/partner/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:f.elements.code.value.trim(),pin:f.elements.pin.value.trim()})});f.elements.pin.value='';await partner();}catch(error){$('#login-state').textContent=error.status===429?'Terlalu banyak percobaan. Coba lagi nanti.':'Kode atau PIN tidak sesuai, atau akses belum aktif.';}finally{b.disabled=false;}};
}
