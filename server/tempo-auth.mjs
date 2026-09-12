import {Handler} from 'accounts/server';
import {http} from 'viem';
import {createAuthKv} from './sqlite-kv.mjs';

export function createTempoAuth(store,config){
 const origin=config.origin||'http://localhost',rpId=new URL(origin).hostname,kv=createAuthKv(store.db,store.now);
 const identity=(scheme,details)=>store.provisionIdentity({scheme,chain:scheme==='tempo'?'4217':'webauthn',network:config.environment,address:details.address||null,credential:details.credential||null});
 const wallet=Handler.auth({
  path:'/api/auth',origin,trustProxy:false,store:kv,transport:http(config.network?.rpcUrl),cookieName:'wm_tempo_session',
  ttl:{challenge:300,session:86400},statement:'Sign in to War Machines. This proves identity only and does not authorize a payment.',
  onAuthenticate:({address})=>Response.json({account:identity('tempo',{address}).account}),
 });
 const passkey=Handler.webAuthn({
  path:'/api/auth/passkey',origin,rpId,kv,cookieName:'wm_passkey_session',ttl:{challenge:300,session:86400},
  onRegister:async({credentialId,publicKey,userId,request})=>{const active=await wallet.getSession(request),linked=active&&store.identityAccount('tempo',String(active.chainId),active.address,null),account=linked?(store.attachIdentity(linked.account,{scheme:'webauthn',chain:'webauthn',network:config.environment,credential:credentialId}),linked):identity('webauthn',{credential:credentialId});return Response.json({account:account.account,credentialId,publicKey,userId,linkedToTempo:!!linked});},
  onAuthenticate:({credentialId})=>{const account=store.identityAccount('webauthn','webauthn',null,credentialId);if(!account)throw Error('This passkey is not linked to a War Machines account.');return Response.json({account:account.account});},
 });
 async function session(request){
  const tempo=await wallet.getSession(request);if(tempo){const row=store.identityAccount('tempo',String(tempo.chainId),tempo.address,null);if(row)return {...row,scheme:'tempo',address:tempo.address,expiresAt:tempo.expiresAt};}
  const webauthn=await passkey.getSession(request);if(webauthn){const row=store.identityAccount('webauthn','webauthn',null,webauthn.credentialId);if(row)return {...row,scheme:'webauthn',credentialId:webauthn.credentialId,expiresAt:webauthn.expiresAt};}
  return null;
 }
 return {wallet,passkey,session,rpId,origin};
}
