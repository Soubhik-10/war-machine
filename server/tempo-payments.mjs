import {createClient,http} from 'viem/tempo';
import {Mppx,tempo} from 'mppx/server';
import {createMppStore} from './sqlite-kv.mjs';
import {amountToUnits,unitsToAmount} from './runtime-config.mjs';

export function createTempoPayments(store,config){
 if(!config.paymentsEnabled)return null;
 const replay=createMppStore(store.db);
 const method=tempo.charge({currency:config.network.token,decimals:config.network.decimals,chainId:config.network.chainId,testnet:false,store:replay,waitForConfirmation:true,sponsorBudget:false});
 const mppx=Mppx.create({methods:[method],secretKey:config.mppSecret,realm:new URL(config.origin).hostname,requiresAuth:true});
 const charge=({amount,units,recipient,externalId,operation=externalId,description,meta,expires})=>{
  const value=units===undefined?amountToUnits(String(amount),config.network.decimals):BigInt(units);if(value<=0n||value>config.maxOperationUnits)throw Error('Payment exceeds the configured per-operation ceiling.');
  return mppx.charge({amount:unitsToAmount(value,config.network.decimals),recipient,externalId:operation,description,meta,expires});
 };
 return {mppx,charge,replay};
}

export function createPayoutClient(config){
 if(!config.paymentsEnabled)return null;
 return createClient({account:config.signer,feeToken:config.network.token,transport:http(config.network.rpcUrl)});
}

export function createPayoutReconciler(store,config){
 const client=createPayoutClient(config);if(!client)return null;let running=false;
 async function once(){if(running)return;running=true;try{
  for(const operation of store.submittedFinancial())try{const receipt=await client.getTransactionReceipt({hash:operation.provider_ref});store.markFinancial(operation.id,receipt.status==='success'?'confirmed':'failed-needs-reconciliation');}catch(e){if(!/not found|could not be found/i.test(e.message))store.markFinancial(operation.id,'failed-needs-reconciliation');}
  const operation=store.nextFinancial();if(!operation)return;const outstanding=store.db.prepare("SELECT amount_units FROM financial_operations WHERE status IN ('requested','submitted')").all().reduce((n,row)=>n+BigInt(row.amount_units),0n);if(outstanding>config.maxOutstandingUnits)throw Error('Outstanding payment ceiling reached; payout queue is paused.');
  try{const tx=await client.token.transfer({token:config.network.token,to:operation.recipient,amount:BigInt(operation.amount_units)});store.markFinancial(operation.id,'submitted',tx);}catch{store.markFinancial(operation.id,'failed-needs-reconciliation');}
 }finally{running=false;}}
 return {once};
}
