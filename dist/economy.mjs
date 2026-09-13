// One sandbox credit = 1,000 integer units. No floating-point ledger arithmetic.
export const CREDIT_SCALE=1000;
export const PLATFORM_FEE_BPS=250;
export const FEE_POLICY_VERSION='winning-reward-v1';
export const PLATFORM_FEE_POLICY=Object.freeze({version:FEE_POLICY_VERSION,basisPoints:PLATFORM_FEE_BPS,percent:2.5,basis:'gross winning reward',chargedOn:'verified win only',rounding:'down to the smallest currency unit',entrySeparate:true});
export function creditUnits(credits){
 const units=Math.round(credits*CREDIT_SCALE);
 if(!Number.isFinite(credits)||!Number.isSafeInteger(units)||Math.abs(units/CREDIT_SCALE-credits)>1e-9)throw Error('Invalid credit precision or amount.');
 return units;
}
export function rewardQuote(reward,entry=0,basisPoints=PLATFORM_FEE_BPS){
 if(reward<0||entry<0||!Number.isSafeInteger(basisPoints)||basisPoints<0||basisPoints>10000)throw Error('Invalid reward quote.');
 const gross=creditUnits(reward),entryUnits=creditUnits(entry),fee=Number(BigInt(gross)*BigInt(basisPoints)/10000n),payout=gross-fee;
 return {grossReward:reward,entry,platformFeeBps:basisPoints,platformFee:fee/CREDIT_SCALE,payout:payout/CREDIT_SCALE,netIfWin:(payout-entryUnits)/CREDIT_SCALE,feePolicyVersion:basisPoints?FEE_POLICY_VERSION:'legacy-no-fee'};
}
