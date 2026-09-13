import { broadcastPrepared, resumeBroadcast } from './relay-journal.mjs';
import { createWalletClient, http, encodeFunctionData, parseAbi } from 'viem';
import { tempo } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { authenticate, serviceCall, secret, reply, safeError } from './auth.mjs';
import { ABI, ESCROW, digest, ensure, quorum, typedData } from './protocol.mjs';
import { publicClient, validateMatchOnChain } from './chain.mjs';

export async function relayFetch(request,env,storage,dependencies={}) {
      try {
        const {body}=await authenticate(request,env.DB,{coordinator:env.COORDINATOR_AUTH},'relay');
        const path=new URL(request.url).pathname;
        const client=dependencies.client || publicClient(env), account=privateKeyToAccount(await secret(env.RELAY_KEY));
        ensure(account.address.toLowerCase()===env.RELAY_ADDRESS.toLowerCase(),'RELAY_CONFIGURATION');
        if(path==='/health') {
          ensure(await client.getChainId()===4217,'CHAIN_MISMATCH');
          const signers=JSON.parse(env.SIGNER_ADDRESSES);
          ensure(signers.length===2 && new Set(signers.map(x=>x.toLowerCase())).size===2 && !signers.some(x=>x.toLowerCase()===account.address.toLowerCase()),'RELAY_CONFIGURATION');
          ensure(Number(await client.readContract({address:ESCROW,abi:ABI,functionName:'settlementQuorum'}))===2,'QUORUM');
          const balance=await client.readContract({address:'0x20c0000000000000000000000000000000000000',abi:parseAbi(['function balanceOf(address) view returns (uint256)']),functionName:'balanceOf',args:[account.address]});
          ensure(balance>=BigInt(env.MIN_RELAY_FEE_BALANCE || '1000000'),'RELAY_LOW_BALANCE');
          return reply({ok:env.WM_EMERGENCY_PAUSE!=='true',address:account.address});
        }
        ensure(path==='/relay' && Object.keys(body).join(',')==='attempt' && /^[a-f0-9-]{36}$/.test(body.attempt));
        const wallet=dependencies.wallet || createWalletClient({account,chain:tempo,transport:http(env.WM_TEMPO_RPC_URL,{timeout:15000,retryCount:0})});
        const data=await serviceCall(env.API,env.API_AUTH,'relay','api','/api/internal/settlement/record',body);
        const journalKey='tx:'+body.attempt, existing=await storage.get(journalKey);
        if(existing) {
          ensure(existing.payloadHash===digest(data.payload),'PAYLOAD_MISMATCH');
          const control=await serviceCall(env.API,env.API_AUTH,'relay','api','/api/internal/settlement/control',{});
          return reply(await resumeBroadcast(storage,client,wallet,journalKey,existing,{paused:control.paused || env.WM_EMERGENCY_PAUSE==='true',deadline:data.record.deadline,maxFeePerGas:BigInt(env.MAX_FEE_PER_GAS)}));
        }
        // Recover a fully signed settlement broadcast outside this relay as well.
        const entry=await client.getTransactionReceipt({hash:data.record.entryTx});
        const events=await client.getContractEvents({address:ESCROW,abi:ABI,eventName:'AttemptSettled',args:{bountyId:BigInt(data.record.bountyId),attemptNonce:BigInt(data.record.attemptNonce)},fromBlock:entry.blockNumber,toBlock:'latest'});
        const event=events.find(x=>x.args.resultHash?.toLowerCase()===data.payload.resultHash.toLowerCase());
        if(event) return reply({hash:event.transactionHash});
        ensure(!data.paused && env.WM_EMERGENCY_PAUSE!=='true','PAUSED');
        ensure(Date.now()<data.payload.validUntil*1000,'EXPIRED');
        await validateMatchOnChain(client,data.record);
        const addresses=JSON.parse(env.SIGNER_ADDRESSES);
        const signatures=await quorum(data.payload,data.signatures,addresses);
        ensure(!addresses.map(x=>x.toLowerCase()).includes(account.address.toLowerCase()),'RELAY_CONFIGURATION');
        for(const address of addresses) ensure(await client.readContract({address:ESCROW,abi:ABI,functionName:'isSettlementSigner',args:[address]}),'QUORUM');
        ensure(Number(await client.readContract({address:ESCROW,abi:ABI,functionName:'settlementQuorum'}))===2,'QUORUM');
        // Independent Tempo nonce lanes avoid one dropped transaction blocking other matches.
        const nonceKey=BigInt(digest({escrow:ESCROW,attempt:body.attempt})) & ((1n<<192n)-1n);
        ensure(nonceKey!==0n);
        const call=encodeFunctionData({abi:ABI,functionName:'settleAttempt',args:[typedData(data.payload).message,signatures]});
        const tx=await wallet.prepareTransactionRequest({account,to:ESCROW,data:call,value:0n,nonce:0,nonceKey,feeToken:'0x20c0000000000000000000000000000000000000',validBefore:data.payload.validUntil});
        ensure(tx.gas<=BigInt(env.MAX_RELAY_GAS || '1000000') && tx.maxFeePerGas<=BigInt(env.MAX_FEE_PER_GAS),'RELAY_FEE_LIMIT');
        const txRequest={chainId:4217,type:'tempo',to:ESCROW,data:call,value:0n,nonce:0,nonceKey,feeToken:tx.feeToken,validBefore:data.payload.validUntil,gas:tx.gas,maxFeePerGas:tx.maxFeePerGas,maxPriorityFeePerGas:tx.maxPriorityFeePerGas};
        const raw=await wallet.signTransaction(txRequest);
        const control=await serviceCall(env.API,env.API_AUTH,'relay','api','/api/internal/settlement/control',{});
        ensure(!control.paused,'PAUSED');
        const sent=await broadcastPrepared(storage,client,journalKey,raw,digest(data.payload),txRequest);
        await env.DB.prepare('INSERT INTO service_audit(attempt,event,created) VALUES(?,?,?)').bind(body.attempt,'broadcast-prepared',Date.now()).run();
        return reply({hash:sent.hash});
      } catch(error) { return reply({error:safeError(error)},503); }
}
