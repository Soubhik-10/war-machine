let address=null,discovery=null;
const chainId=()=>discovery?.payments?.chainId??4217;
const chainHex=()=>`0x${chainId().toString(16)}`;
async function json(url,body){const response=await fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||`Authentication failed (${response.status}).`);return result;}

export async function configure(info){discovery=info;return info;}

export async function signInWallet(){
 if(!window.ethereum)throw Error('No compatible Tempo/EVM wallet was found. Install or open Tempo Wallet, then try again.');
 try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex()}]});}catch{throw Error(`Switch your wallet to Tempo mainnet (chain ${chainId()}), then try again.`);}
  [address]=await window.ethereum.request({method:'eth_requestAccounts'});const {message}=await json('/api/auth/challenge',{chainId:chainId()}),signature=await window.ethereum.request({method:'personal_sign',params:[message,address]});await json('/api/auth/verify',{address,message,signature});return address;
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function directWallet(){
 if(!discovery?.payments?.directEscrow)throw Error('Direct bounty escrow discovery has not been loaded.');
 if(!window.ethereum)throw Error('A Tempo wallet is required to fund or enter a bounty.');
 try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:chainHex()}]});}catch{throw Error(`Switch your wallet to Tempo mainnet (chain ${chainId()}).`);}
 const [wallet]=await window.ethereum.request({method:'eth_requestAccounts'});
 if(address&&wallet.toLowerCase()!==address.toLowerCase())throw Error('Reconnect with the wallet you used to sign in before funding or entering a bounty.');
 address=wallet;return wallet;
}
async function sendDirect(wallet,call){
 if(!call||typeof call.to!=='string'||typeof call.data!=='string')throw Error('The escrow transaction plan is malformed.');
 const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:wallet,to:call.to,data:call.data}]});
 if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('The wallet did not return a transaction hash.');
 for(let attempt=0;attempt<90;attempt++){const receipt=await window.ethereum.request({method:'eth_getTransactionReceipt',params:[hash]});if(receipt){if(receipt.status!=='0x1')throw Error('The escrow transaction reverted. No bounty change was made.');return hash;}await wait(1000);}
 throw Error('The transaction is still confirming. Use Recover request; do not submit it again.');
}

export async function executeEscrowPlan(plan){
 const wallet=await directWallet(),expected=discovery.payments.escrow?.toLowerCase();
 if(!plan||plan.chainId!==chainId()||plan.escrow?.toLowerCase()!==expected||plan.call?.to?.toLowerCase()!==expected)throw Error('The bounty plan does not match the verified Tempo escrow.');
 if(plan.approval){if(plan.approval.to?.toLowerCase()!==discovery.payments.token?.toLowerCase())throw Error('The approval token does not match pathUSD.');await sendDirect(wallet,plan.approval);}
 return sendDirect(wallet,plan.call);
}

export async function logout(){await fetch('/api/auth/logout',{method:'POST',credentials:'include'});address=null;}
