const ROOT='https://open.larksuite.com';
export async function lark(path,{token,body,method=body?'POST':'GET'}={}){
 const r=await fetch(ROOT+path,{method,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok||(data.code&&data.code!==0))throw Error('Lark request failed');return data;
}
export async function oauthUser(code,verifier,config){
 const t=await lark('/open-apis/authen/v2/oauth/token',{body:{grant_type:'authorization_code',client_id:config.appId,client_secret:config.appSecret,redirect_uri:config.hrOrigin+'/auth/lark/callback',code,code_verifier:verifier}});
 if(!t.access_token)throw Error('Missing access token');
 const info=await lark('/open-apis/authen/v1/user_info',{token:t.access_token});return info.data;
}
export function authorizationUrl(state,challenge,config){const u=new URL(ROOT+'/open-apis/authen/v1/authorize');Object.entries({client_id:config.appId,response_type:'code',redirect_uri:config.hrOrigin+'/auth/lark/callback',state,code_challenge:challenge,code_challenge_method:'S256'}).forEach(([k,v])=>u.searchParams.set(k,v));return u.toString();}
