const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const transactionLink = (hash,label) => /^0x[0-9a-fA-F]{64}$/.test(hash || '') ? `<a href="https://explore.tempo.xyz/tx/${hash}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : '';
export function paymentStatus(attempt, time=Date.now()) {
  const payment=attempt.payment || {}, result=attempt.result;
  if(result?.outcome==='technical-failure' || payment.technicalFailure) return {label:payment.retryAvailable?'Technical failure — free retry available':'Technical failure — recovering',detail:payment.retryAvailable?'The match was not settled because of an infrastructure timeout. Your entry was not treated as a loss. Start the sponsored retry below at no additional cost.':'The match result was not settled in time because of an infrastructure failure. We are reopening the bounty and issuing a one-time sponsored retry.'};
  if(payment.finalized) return {label:result?.outcome==='win'?'Paid':result?.outcome==='draw'?'Draw':result?.outcome==='technical-refund'?'Refunded':'Lost',detail:`Paid to your wallet: ${result?.payout || '0'} pathUSD. Entry: ${result?.entry || '0'} pathUSD. Platform fee: ${result?.platformFee || '0'} pathUSD.`};
  if(payment.state==='timeout') return {label:'Settlement recovery in progress',detail:'The settlement service is recovering this attempt. It is not being recorded as a player loss; do not pay again.'};
  if(payment.transactionHash) return {label:'Confirming payout',detail:'The settlement was submitted. Waiting for chain finality before confirming the exact payment.'};
  return {label:payment.state==='retry'?'Payout delayed':'Verifying result',detail:'Independent services are verifying the result and settling it automatically. You can close this page; no further wallet action is needed.'};
}
export function paymentPanel(attempt) {
  const status=paymentStatus(attempt),payment=attempt.payment || {};
  return `<section class="notice payment-status" role="status" aria-live="polite"><h3>${escape(status.label)}</h3><p>${escape(status.detail)}</p><p>${[transactionLink(payment.entryTransactionHash,'Entry transaction'),transactionLink(payment.transactionHash,payment.finalized?'Finalized settlement':'Settlement transaction')].filter(Boolean).join(' · ')}</p></section>`;
}
