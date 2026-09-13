import { ensure } from './protocol.mjs';
import { serviceCall, reply } from './auth.mjs';

const decode = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function operatorIdentity(request,env) {
  const token=request.headers.get('cf-access-jwt-assertion');ensure(token && token.length<16000,'UNAUTHORIZED');
  const [head,body,signature,...extra]=token.split('.');ensure(extra.length===0 && signature,'UNAUTHORIZED');
  const header=JSON.parse(new TextDecoder().decode(decode(head))),claims=JSON.parse(new TextDecoder().decode(decode(body)));
  const issuer='https://'+env.ACCESS_TEAM_DOMAIN;
  ensure(header.alg==='RS256' && claims.iss===issuer && claims.exp>Date.now()/1000 && (!claims.nbf || claims.nbf<=Date.now()/1000) && Array.isArray(claims.aud) && claims.aud.includes(env.ACCESS_AUDIENCE),'UNAUTHORIZED');
  const jwks=await (await fetch(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(10000)})).json();
  const jwk=jwks.keys.find(key=>key.kid===header.kid);ensure(jwk,'UNAUTHORIZED');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  ensure(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(signature),new TextEncoder().encode(head+'.'+body)),'UNAUTHORIZED');
  ensure(String(env.OPERATOR_EMAILS || '').split(',').map(x=>x.trim()).includes(claims.email),'UNAUTHORIZED');
  return claims.email;
}
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Settlement operations</title>
<style>body{font:16px system-ui;background:#111c23;color:#edf3f6;max-width:1000px;margin:40px auto;padding:20px}button,input{font:inherit;padding:12px;margin:6px;background:#263c48;color:white;border:1px solid #7392a2}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1b2b34;padding:20px}button:first-of-type{background:#7a2424}a{color:#8ad5ff}</style>
<h1>Settlement operations</h1><p>Pause stops new entries, signing and relay broadcasts. Already broadcast transactions can still finalize.</p>
<button id="pause">Emergency pause</button><button id="resume">Resume services</button><button id="tick">Run recovery now</button>
<p><label>Retry a job <input id="attempt" placeholder="Attempt identifier"></label><button id="retry">Retry</button></p>
<p id="status" role="status"></p><h2>Health and alerts</h2><pre id="metrics">Loading…</pre><h2>Recent audit events</h2><pre id="audit"></pre>
<script type="module">const el=id=>document.getElementById(id);async function call(path,body){const r=await fetch('/ops/'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw Error('Operation unavailable. Check access and service health.');return r.json();}async function refresh(){try{const m=await call('metrics');el('metrics').textContent=JSON.stringify(m,null,2);const a=await call('audit');el('audit').textContent=JSON.stringify(a,null,2);}catch(e){el('status').textContent=e.message;}}for(const action of ['pause','resume','tick','retry'])el(action).onclick=async()=>{try{await call(action==='resume'?'pause':action,action==='pause'||action==='resume'?{paused:action==='pause'}:action==='retry'?{attempt:el('attempt').value}:{});el('status').textContent='Operation recorded.';await refresh();}catch(e){el('status').textContent=e.message;}}refresh();setInterval(refresh,10000);</script></html>`;
export default {async fetch(request,env) {
  try {
    const identity=await operatorIdentity(request,env),url=new URL(request.url);
    if(url.pathname==='/')return new Response(html,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});
    const action=url.pathname.slice('/ops/'.length);
    ensure(url.pathname.startsWith('/ops/') && ['metrics','audit','pause','tick','retry'].includes(action));
    const mutation=['pause','tick','retry'].includes(action);
    ensure(request.method===(mutation?'POST':'GET'),'UNAUTHORIZED');
    if(mutation)ensure(request.headers.get('origin')===url.origin && request.headers.get('content-type')==='application/json','UNAUTHORIZED');
    const raw=mutation?await request.text():'{}';ensure(raw.length<=1024);
    const body=JSON.parse(raw);
    return reply(await serviceCall(env.API,env.OPERATOR_AUTH,'operator','api','/api/internal/settlement/'+action,{...body,operator:identity}));
  } catch { return reply({error:'Operator access or service unavailable.'},403); }
}};
