import { canonical, ensure } from './protocol.mjs';
const bytes = value => new TextEncoder().encode(value);
const toHex = value => [...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function secret(binding) {
  ensure(binding && typeof binding.get === 'function', 'SECRET_MANAGER_UNAVAILABLE');
  const value = await binding.get(); ensure(typeof value === 'string' && value.length >= 32, 'SECRET_MANAGER_UNAVAILABLE'); return value;
}
async function key(binding) { return crypto.subtle.importKey('raw',bytes(await secret(binding)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']); }
const signingText = (audience,caller,path,stamp,nonce,body) => canonical({audience,caller,method:'POST',path,stamp,nonce,body});
export async function serviceCall(binding, credential, caller, audience, path, body) {
  ensure(binding?.fetch, 'SERVICE_UNAVAILABLE');
  const stamp = Date.now(), nonce = crypto.randomUUID();
  const signature = toHex(await crypto.subtle.sign('HMAC',await key(credential),bytes(signingText(audience,caller,path,stamp,nonce,body))));
  const response = await binding.fetch(new Request('https://service.internal'+path,{method:'POST',headers:{'content-type':'application/json','x-wm-caller':caller,'x-wm-time':String(stamp),'x-wm-nonce':nonce,'x-wm-signature':signature},body:canonical(body),signal:AbortSignal.timeout(25000)}));
  ensure(response.ok, 'SERVICE_UNAVAILABLE'); return response.json();
}
export async function authenticate(request, db, credentials, audience, time = Date.now()) {
  ensure(request.method === 'POST', 'UNAUTHORIZED');
  const caller = request.headers.get('x-wm-caller'), stamp = Number(request.headers.get('x-wm-time')), nonce=request.headers.get('x-wm-nonce'), signature=request.headers.get('x-wm-signature');
  ensure(credentials[caller] && Number.isSafeInteger(stamp) && Math.abs(time-stamp)<=30000 && /^[a-f0-9-]{36}$/.test(nonce) && /^[a-f0-9]{64}$/.test(signature), 'UNAUTHORIZED');
  const reader=request.body?.getReader();ensure(reader,'INVALID_PAYLOAD');
  let raw='',length=0;const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>2048){await reader.cancel();ensure(false,'REQUEST_TOO_LARGE');}raw+=decoder.decode(value,{stream:true});}
  raw+=decoder.decode();
  const body = JSON.parse(raw), path = new URL(request.url).pathname;
  ensure(await crypto.subtle.verify('HMAC',await key(credentials[caller]),Uint8Array.from(signature.match(/../g),x=>parseInt(x,16)),bytes(signingText(audience,caller,path,stamp,nonce,body))), 'UNAUTHORIZED');
  const inserted = await db.prepare('INSERT OR IGNORE INTO service_nonces(caller,nonce,expires) VALUES(?,?,?)').bind(caller,nonce,time+60000).run();
  ensure(inserted.meta.changes===1,'REPLAY');
  const minute = Math.floor(time/60000);
  await db.prepare('INSERT INTO service_rates(caller,minute,count) VALUES(?,?,1) ON CONFLICT(caller,minute) DO UPDATE SET count=count+1').bind(caller,minute).run();
  ensure((await db.prepare('SELECT count FROM service_rates WHERE caller=? AND minute=?').bind(caller,minute).first()).count <= 120,'RATE_LIMIT');
  await db.batch([db.prepare('DELETE FROM service_nonces WHERE expires<?').bind(time),db.prepare('DELETE FROM service_rates WHERE minute<?').bind(minute-2)]);
  return {caller,body};
}
export const reply = (body,status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
export function safeError(error) { return ['UNAUTHORIZED','REPLAY','RATE_LIMIT','EXPIRED','ENGINE_MISMATCH','PAYLOAD_MISMATCH','QUORUM','PAUSED','FINALITY_PENDING','CHAIN_MISMATCH','SECRET_MANAGER_UNAVAILABLE','SERVICE_UNAVAILABLE','INVALID_PAYLOAD'].includes(error.code) ? error.code : 'DEPENDENCY_FAILURE'; }
