export const PATH_USD_DECIMALS=6;
export const PATH_USD_TOKEN='0x20C0000000000000000000000000000000000000';
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
