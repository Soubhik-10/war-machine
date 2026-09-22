import { sha256, stringToHex, parseAbi, recoverTypedDataAddress } from 'viem';
import { Battle } from '../dist/engine.mjs';
import { unpackChallenge as unpackCurrentChallenge } from '../dist/data.mjs';
import { CLIENT_ENGINE_HASH } from '../dist/release.mjs';
import { Battle as LegacyBattle } from './engines/4b762a9b76ba071b27799113a0aafb5b8a04a7a02e21a445e60295f3c82ca365.mjs';
import { unpackChallenge as unpackLegacyChallenge } from './engines/data.mjs';
import { Battle as E62Battle } from './engines/e62d2be3ff92293eb4ebb0a2357a039833ebf3a782ddff2d71dee367de1c5cf1/engine.mjs';
import { unpackChallenge as unpackE62Challenge } from './engines/e62d2be3ff92293eb4ebb0a2357a039833ebf3a782ddff2d71dee367de1c5cf1/data.mjs';

export const LEGACY_ENGINE_HASH = '4b762a9b76ba071b27799113a0aafb5b8a04a7a02e21a445e60295f3c82ca365';
export const E62_ENGINE_HASH = 'e62d2be3ff92293eb4ebb0a2357a039833ebf3a782ddff2d71dee367de1c5cf1';
// This advertised value covered both its original sources and later changed
// deployed sources. A record's engineHash alone cannot select either safely.
export const AMBIGUOUS_ENGINE_HASH = 'd65afc7a4429e15908beddef95eeba568d23a92d3870d5be844950c87e3b519c';
export const ENGINE_EVALUATORS = Object.freeze({
  ...(CLIENT_ENGINE_HASH === AMBIGUOUS_ENGINE_HASH ? {} : {[CLIENT_ENGINE_HASH]: Object.freeze({ Battle, unpackChallenge: unpackCurrentChallenge })}),
  [LEGACY_ENGINE_HASH]: Object.freeze({ Battle: LegacyBattle, unpackChallenge: unpackLegacyChallenge }),
  [E62_ENGINE_HASH]: Object.freeze({ Battle: E62Battle, unpackChallenge: unpackE62Challenge }),
});

export const CHAIN_ID = 4217;
export const ESCROW = '0xb14a3aA99C9349094612143089F55aE5372DeB24';
export const ABI = parseAbi([
  'function getBounty(uint256) view returns ((address creator,address challenger,uint128 reward,uint128 entry,uint64 expiresAt,uint64 attemptDeadline,uint64 attemptNonce,uint8 status,bytes32 termsHash))',
  'function isSettlementSigner(address) view returns (bool)',
  'function settlementQuorum() view returns (uint8)',
  'function settleAttempt((uint256 bountyId,uint64 attemptNonce,uint8 outcome,bytes32 resultHash,uint64 validUntil) settlement,bytes[] signatures)',
  'event AttemptSettled(uint256 indexed bountyId,uint64 indexed attemptNonce,address indexed challenger,uint8 outcome,bytes32 resultHash,uint128 winnerPayout,uint128 platformFee,uint128 creatorEntry)',
  'event AttemptEntered(uint256 indexed bountyId,uint64 indexed attemptNonce,address indexed challenger,uint64 attemptDeadline)',
]);
export function ensure(ok, code = 'INVALID_PAYLOAD') { if (!ok) throw Object.assign(Error(code), { code }); }
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { ensure(Number.isFinite(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  ensure(value && Object.getPrototypeOf(value) === Object.prototype);
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export const digest = value => sha256(stringToHex(canonical(value)));
export function typedData(payload) {
  return { domain: { name: 'War Machines Bounty Escrow', version: '3', chainId: CHAIN_ID, verifyingContract: ESCROW },
    primaryType: 'Settlement', types: { Settlement: [
      {name:'bountyId',type:'uint256'}, {name:'attemptNonce',type:'uint64'}, {name:'outcome',type:'uint8'},
      {name:'resultHash',type:'bytes32'}, {name:'validUntil',type:'uint64'},
    ] }, message: { bountyId: BigInt(payload.bountyId), attemptNonce: BigInt(payload.attemptNonce), outcome: payload.outcome, resultHash: payload.resultHash, validUntil: BigInt(payload.validUntil) } };
}
export function evaluate(record, time = Date.now(), expectedEscrow = ESCROW) {
  ensure(record.version === 1 && typeof record.engineHash === 'string' && ENGINE_EVALUATORS[record.engineHash], 'ENGINE_MISMATCH');
  ensure(record.chainId === CHAIN_ID && typeof record.escrow === 'string' && record.escrow.toLowerCase() === expectedEscrow.toLowerCase());
  ensure(Number.isSafeInteger(record.seed) && record.seed >= 0);
  ensure(Number.isSafeInteger(record.deadline) && record.deadline > 0);
  for (const amount of [record.reward, record.entry]) ensure(typeof amount === 'string' && /^(0|[1-9][0-9]*)$/.test(amount) && BigInt(amount) < 2n ** 128n);
  ensure(record.feeBps === 250 && BigInt(record.reward) > 0n);
  ensure(time < record.deadline * 1000, 'EXPIRED');
  const evaluator = ENGINE_EVALUATORS[record.engineHash];
  const defender = evaluator.unpackChallenge(record.defender);
  let result;
  if (record.reason === 'counter-build-timeout') {
    ensure(record.challenger === null && record.buildDeadline <= time && record.committedAt >= record.buildDeadline);
    result = { winner: 1, reason: record.reason, time: 0, seed: record.seed, integrity: [0,1], damage: [0,0] };
  } else {
    ensure(record.reason === 'battle' && record.committedAt < record.buildDeadline);
    ensure(record.challenger.a === record.defender.a && canonical(record.challenger.q) === canonical(record.defender.q));
    ensure((record.challenger.o || 'reactor') === (record.defender.o || 'reactor'), 'OBJECTIVE_MISMATCH');
    const challenger = evaluator.unpackChallenge(record.challenger);
    result = { ...new evaluator.Battle(challenger.machine, defender.machine, defender.arena, record.seed, {
      mode:'auto',
      swapSpawns:!!(record.seed & 1),
      objective:defender.objective||challenger.objective||'reactor',
      headless:true,
    }).run(), seed: record.seed };
  }
  const outcome = result.winner === 0 ? 0 : 1;
  const fee = outcome === 0 ? BigInt(record.reward) * 250n / 10000n : 0n;
  // V3-V5 transfer entry directly from challenger to creator at entry time.
  // V6 keeps it in escrow and releases it to the creator with a signed result.
  const amounts = {
    winnerPayout: outcome === 0 ? (BigInt(record.reward)-fee).toString() : '0',
    platformFee: fee.toString(),
    creatorEntry: record.escrowVersion === '6' ? record.entry : '0',
  };
  const payload = { bountyId: record.bountyId, attemptNonce: record.attemptNonce, outcome,
    resultHash: digest({ protocol:'war-machines-auto-v1', record, result, amounts }), validUntil: record.deadline - 1 };
  // Recovery only for results committed before migration 0005. The on-chain
  // bounty ID binds their immutable amounts; new matches always hash amounts
  // explicitly. Never change an already-issued legacy signature's message.
  if(record.legacy === true) {
    const commitment=record.reason==='battle'
      ? {version:'war-machines-settlement-v2',engineHash:record.engineHash,bountyId:record.bountyId,attemptNonce:Number(record.attemptNonce),outcome,challenger:record.challenger,defender:record.defender,result}
      : {version:'war-machines-settlement-v2',engineHash:record.engineHash,bountyId:record.bountyId,attemptNonce:Number(record.attemptNonce),outcome:1,challenger:null,defender:record.defender,reason:'counter-build-timeout',buildDeadline:record.buildDeadline,seed:record.seed};
    payload.resultHash=sha256(stringToHex(JSON.stringify(commitment)));
  }
  return { payload, amounts, result: {...result, outcome: result.winner === 0 ? 'win' : result.winner === 1 ? 'loss' : 'draw'} };
}
export function verifyPayload(record, payload, time, expectedEscrow = ESCROW) {
  const verified = evaluate(record, time, expectedEscrow);
  ensure(canonical(payload) === canonical(verified.payload), 'PAYLOAD_MISMATCH');
  return verified;
}
export async function quorum(payload, signatures, addresses) {
  ensure(signatures?.length === 2 && addresses?.length === 2, 'QUORUM');
  const recovered = await Promise.all(signatures.map(async signature => ({ signature, address: (await recoverTypedDataAddress({...typedData(payload),signature})).toLowerCase() })));
  ensure(new Set(recovered.map(x=>x.address)).size === 2 && recovered.every(x=>addresses.map(a=>a.toLowerCase()).includes(x.address)), 'QUORUM');
  return recovered.sort((a,b)=>a.address.localeCompare(b.address)).map(x=>x.signature);
}
