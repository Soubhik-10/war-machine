import {Mppx,tempo as tempoMethod} from 'mppx/client';
import {createClient,custom} from 'viem/tempo';

let paymentClient=null,address=null,discovery=null;
const chainId=()=>discovery?.payments?.chainId??4217;
const chainHex=()=>`0x${chainId().toString(16)}`;
const displayAmount=value=>{const amount=String(value);if(!/^\d+(?:\.\d+)?$/.test(amount))throw Error('The payment challenge has an invalid amount.');return amount.replace(/\.(\d*?)0+$/,'$1').replace(/\.$/,'');};
const fromB64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
const toB64=value=>{const bytes=new Uint8Array(value),chunk=0x8000;let text='';for(let i=0;i<bytes.length;i+=chunk)text+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const credentialJson=credential=>credential.toJSON?credential.toJSON():{id:credential.id,rawId:toB64(credential.rawId),type:credential.type,response:Object.fromEntries(['attestationObject','authenticatorData','clientDataJSON','signature','userHandle'].filter(k=>credential.response[k]).map(k=>[k,toB64(credential.response[k])])),clientExtensionResults:credential.getClientExtensionResults()};
const decodeOptions=options=>({...options,challenge:fromB64(options.challenge),...(options.user?{user:{...options.user,id:fromB64(options.user.id)}}:{}),...(options.excludeCredentials?{excludeCredentials:options.excludeCredentials.map(c=>({...c,id:fromB64(c.id)}))}:{}),...(options.allowCredentials?{allowCredentials:options.allowCredentials.map(c=>({...c,id:fromB64(c.id)}))}:{})});
async function json(url,body){const response=await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||`Authentication failed (${response.status}).`);return result;}

export async function configure(info){discovery=info;return info;}

export async function signInWallet(){
 if(!window.ethereum)throw Error('No compatible Tempo/EVM wallet was found. Install or open Tempo Wallet, then try again.');
 try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex()}]});}catch{throw Error(`Switch your wallet to Tempo mainnet (chain ${chainId()}), then try again.`);}
 [address]=await window.ethereum.request({method:'eth_requestAccounts'});const {message}=await json('/api/auth/challenge',{chainId:chainId()}),signature=await window.ethereum.request({method:'personal_sign',params:[message,address]});await json('/api/auth/verify',{address,message,signature});paymentClient=null;return address;
}

export async function registerPasskey(name='War Machines engineer'){
 const options=await json('/api/auth/passkey/register/options',{name,userId:crypto.randomUUID()}),credential=await navigator.credentials.create({publicKey:decodeOptions(options)});return json('/api/auth/passkey/register',credentialJson(credential));
}

export async function signInPasskey(){
 const options=await json('/api/auth/passkey/login/options',{}),credential=await navigator.credentials.get({publicKey:decodeOptions(options)});return json('/api/auth/passkey/login',credentialJson(credential));
}

async function payer(){
 if(paymentClient)return paymentClient;if(!discovery?.payments?.enabled)throw Error('Tempo payment discovery has not been loaded.');
 if(!window.ethereum)throw Error('A Tempo wallet is required to fund or enter a mainnet contract.');
 try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex()}]});}catch{throw Error(`Switch your wallet to Tempo mainnet (chain ${chainId()}).`);}
 const [payerAddress]=await window.ethereum.request({method:'eth_requestAccounts'});if(address&&payerAddress.toLowerCase()!==address.toLowerCase())throw Error('Reconnect with the verified payout wallet before authorizing a bounty payment.');address=payerAddress;const client=createClient({account:address,transport:custom(window.ethereum)});
 paymentClient=Mppx.create({polyfill:false,methods:[tempoMethod.charge({account:address,getClient:()=>client,expectedChainId:chainId(),expectedRecipients:discovery.payments.recipients})],onChallenge:async(challenge,{createCredential})=>{const r=challenge.request,amount=displayAmount(r.amount),meta=challenge.meta||{};if(!confirm(`Authorize ${amount} ${discovery.payments.currency} on Tempo mainnet?\n\n${r.description||meta.kind||'War Machines payment'}\nRecipient: ${r.recipient}\nNetwork fees are separate and shown by your wallet.`))return;return createCredential();}});return paymentClient;
}

export async function paidFetch(input,init){return (await payer()).fetch(input,init);}

export async function logout(){await Promise.allSettled([fetch('/api/auth/logout',{method:'POST',credentials:'include'}),fetch('/api/auth/passkey/logout',{method:'POST',credentials:'include'})]);paymentClient=null;address=null;}
