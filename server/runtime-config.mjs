import {resolve} from 'node:path';
import {getAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

export const TEMPO_MAINNET={
 chainId:4217,
 rpcUrl:'https://rpc.tempo.xyz',
 explorer:'https://explore.tempo.xyz',
 currency:'USDC.e',
 token:'0x20C000000000000000000000b9537d11c60E8b50',
 decimals:6,
};

const positiveInteger=(value,name)=>{
 const n=BigInt(value||'0');
 if(n<=0n)throw Error(`${name} must be a positive integer in token base units.`);
 return n;
};
const address=(value,name)=>{try{return getAddress(value);}catch{throw Error(`${name} must be a valid EVM address.`);}};

/** Parse deployment settings. Mainnet deliberately has no partially-configured state. */
export function runtimeConfig(env=process.env,{root=process.cwd(),database}={}){
 const mode=env.WM_MODE||'demo';
 if(mode==='demo')return {mode,environment:'demo',paymentsEnabled:false,database:database||resolve(root,'var','war-machines.sqlite')};
 if(mode!=='tempo-mainnet')throw Error('WM_MODE must be demo or tempo-mainnet.');
 if(env.WM_MAINNET_ENABLE!=='tempo-mainnet-real-funds')throw Error('Mainnet is locked. Set WM_MAINNET_ENABLE=tempo-mainnet-real-funds after reviewing recipients and limits.');
 if(env.WM_PAYMENT_PAUSED==='true')throw Error('Mainnet payment stop switch is active.');
 if(env.WM_LEGAL_REVIEWED!=='true')throw Error('Mainnet is locked until WM_LEGAL_REVIEWED=true is recorded by the operator.');
 const origin=new URL(env.WM_PUBLIC_ORIGIN||'');
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('WM_PUBLIC_ORIGIN must be a canonical HTTPS origin with no path.');
 const db=database||env.DATABASE_PATH;
 if(!db||db===':memory:'||resolve(db)===resolve(root,'var','war-machines.sqlite'))throw Error('Tempo mainnet requires a dedicated DATABASE_PATH; the demo database cannot be reused.');
 const network={...TEMPO_MAINNET,rpcUrl:env.TEMPO_RPC_URL||TEMPO_MAINNET.rpcUrl};
 if(env.TEMPO_CHAIN_ID&&Number(env.TEMPO_CHAIN_ID)!==network.chainId)throw Error('Tempo mainnet chain ID must be 4217.');
 if(env.TEMPO_TOKEN&&getAddress(env.TEMPO_TOKEN)!==getAddress(network.token))throw Error('This release only accepts the reviewed Tempo mainnet USDC.e token.');
 if(env.WM_LEDGER_NAMESPACE!==`tempo-mainnet:${network.chainId}:${network.token.toLowerCase()}`)throw Error('WM_LEDGER_NAMESPACE must bind this database to Tempo mainnet and the configured token.');
 const escrowRecipient=address(env.TEMPO_ESCROW_RECIPIENT,'TEMPO_ESCROW_RECIPIENT');
 const platformRecipient=address(env.TEMPO_PLATFORM_RECIPIENT,'TEMPO_PLATFORM_RECIPIENT');
 const entryRecipient=address(env.TEMPO_ENTRY_RECIPIENT,'TEMPO_ENTRY_RECIPIENT');
 if(escrowRecipient===platformRecipient)throw Error('Escrow and platform recipients must be separately controlled addresses.');
 if(entryRecipient!==escrowRecipient)throw Error('This release requires entry fees to enter escrow so technical refunds remain possible.');
 if(!env.TEMPO_ESCROW_PRIVATE_KEY)throw Error('TEMPO_ESCROW_PRIVATE_KEY is required by the payout reconciler and must remain server-side.');
 const signer=privateKeyToAccount(env.TEMPO_ESCROW_PRIVATE_KEY);
 if(getAddress(signer.address)!==escrowRecipient)throw Error('The configured payout signer does not control TEMPO_ESCROW_RECIPIENT.');
 if(typeof env.MPP_SECRET_KEY!=='string'||Buffer.byteLength(env.MPP_SECRET_KEY)<32)throw Error('MPP_SECRET_KEY must contain at least 32 bytes.');
 return {
  mode,environment:'tempo-mainnet',paymentsEnabled:true,database:resolve(db),origin:origin.origin,network,
  mppSecret:env.MPP_SECRET_KEY,escrowRecipient,platformRecipient,entryRecipient,signer,
  maxOperationUnits:positiveInteger(env.WM_MAX_OPERATION_UNITS,'WM_MAX_OPERATION_UNITS'),
  maxOutstandingUnits:positiveInteger(env.WM_MAX_OUTSTANDING_UNITS,'WM_MAX_OUTSTANDING_UNITS'),
  quoteTtlSeconds:Math.min(600,Math.max(30,Number(env.WM_QUOTE_TTL_SECONDS||180))),
 };
}

export function unitsToAmount(units,decimals=TEMPO_MAINNET.decimals){
 const value=BigInt(units),scale=10n**BigInt(decimals),whole=value/scale,fraction=(value%scale).toString().padStart(decimals,'0').replace(/0+$/,'');
 return fraction?`${whole}.${fraction}`:`${whole}`;
}

export function amountToUnits(value,decimals=TEMPO_MAINNET.decimals){
 if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))throw Error('Amount must be an unsigned decimal string.');
 const [whole,fraction='']=value.split('.');
 if(fraction.length>decimals)throw Error(`Amount supports at most ${decimals} decimal places.`);
 return BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+'0'.repeat(decimals)).slice(0,decimals));
}
