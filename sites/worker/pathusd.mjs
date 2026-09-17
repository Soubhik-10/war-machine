export const PATH_USD_DECIMALS=6;
export const PATH_USD_TOKEN='0x20C0000000000000000000000000000000000000';
/** Tempo's canonical bridged USDC token. It is an optional swap source; the
 * escrow and every payout remain denominated in pathUSD. Additional TIP-20
 * sources must be explicitly allowlisted by the operator. */
export const TEMPO_USDC_TOKEN='0x20C000000000000000000000b9537d11c60E8b50';
export const DEFAULT_TEMPO_INPUT_TOKENS=Object.freeze([PATH_USD_TOKEN,TEMPO_USDC_TOKEN]);
export const TEMPO_MAINNET_CHAIN_ID=4217;
export const PLATFORM_FEE_RECIPIENT='0xc20131e9132888993de6519D486E5558A5DbCb7A';

const scale=10n**BigInt(PATH_USD_DECIMALS);

/** Converts a user supplied decimal amount to exact 6-decimal pathUSD units. */
export function pathUsdToUnits(value,{allowZero=true,maxUnits}={}){
 const raw=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
 if(!/^\d+(?:\.\d+)?$/.test(raw))throw Error('Amount must be a positive decimal pathUSD value.');
 const [whole,fraction='']=raw.split('.');
 if(fraction.length>PATH_USD_DECIMALS)throw Error('pathUSD supports at most 6 decimal places.');
 const units=BigInt(whole)*scale+BigInt((fraction+'0'.repeat(PATH_USD_DECIMALS)).slice(0,PATH_USD_DECIMALS));
 if(!allowZero&&units===0n)throw Error('Amount must be greater than 0 pathUSD.');
 if(maxUnits!==undefined&&units>BigInt(maxUnits))throw Error('Amount exceeds the configured pathUSD operation limit.');
 return units;
}

/** Formats exact pathUSD units without floating point rounding. */
export function unitsToPathUsd(value,{fixed=false}={}){
 const units=BigInt(value),negative=units<0n,absolute=negative?-units:units,whole=absolute/scale;
 let fraction=(absolute%scale).toString().padStart(PATH_USD_DECIMALS,'0');
 if(!fixed)fraction=fraction.replace(/0+$/,'');
 return `${negative?'-':''}${whole}${fraction?'.'+fraction:''}`;
}

/**
 * Parse the operator's explicit Tempo swap-source allowlist. Keeping this
 * list bounded and address-only prevents a public environment variable from
 * turning the payment client into an arbitrary-token router. pathUSD is
 * always first because it is the escrow's canonical accounting token.
 */
export function parseTempoInputTokens(value){
 const raw=typeof value==='string'&&value.trim()?value.split(','):DEFAULT_TEMPO_INPUT_TOKENS;
 if(raw.length>16)throw Error('WM_TEMPO_SUPPORTED_TOKENS may contain at most 16 addresses.');
 const seen=new Set(),tokens=[];
 for(const candidate of raw){
  const token=String(candidate).trim();
  if(!/^0x[0-9a-fA-F]{40}$/.test(token)||/^0x0{40}$/i.test(token))throw Error('WM_TEMPO_SUPPORTED_TOKENS contains an invalid token address.');
  const normalized=token.toLowerCase();
  if(!seen.has(normalized)){seen.add(normalized);tokens.push(token);}
 }
 // mppx always appends its built-in pathUSD and USDC.e fallbacks. Keep both
 // visible in discovery so the effective client allowlist is never hidden.
 for(const fallback of DEFAULT_TEMPO_INPUT_TOKENS){
  const normalized=fallback.toLowerCase();
  if(seen.has(normalized))continue;
  if(tokens.length>=16)throw Error('WM_TEMPO_SUPPORTED_TOKENS must leave room for the pathUSD and USDC.e MPP fallbacks.');
  seen.add(normalized);
  if(fallback===PATH_USD_TOKEN)tokens.unshift(fallback);else tokens.push(fallback);
 }
 return tokens;
}

export const numberForUi=units=>Number(unitsToPathUsd(units));

export function payoutQuote(rewardUnits,entryUnits,feeBps=250){
 const reward=BigInt(rewardUnits),entry=BigInt(entryUnits),fee=(reward*BigInt(feeBps))/10000n,payout=reward-fee;
 return {
  platformFeeBps:feeBps,
  feePolicyVersion:'pathusd-mainnet-v1',
  platformFee:unitsToPathUsd(fee),
  payout:unitsToPathUsd(payout),
  netIfWin:unitsToPathUsd(payout-entry),
  platformFeeUnits:fee.toString(),
  payoutUnits:payout.toString(),
 };
}
