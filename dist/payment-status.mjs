const escape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      c
    ],
  );

export const transactionLink = (hash, label) =>
  /^0x[0-9a-fA-F]{64}$/.test(hash || "")
    ? `<a href="https://explore.tempo.xyz/tx/${hash}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`
    : "";

const resultOf = (attempt) => attempt?.result || {};
const paymentOf = (attempt) => attempt?.payment || {};
const v6 = (attempt) => {
  const result = resultOf(attempt),
    payment = paymentOf(attempt);
  return [
    payment.protocolVersion,
    payment.escrowVersion,
    payment.version,
    result.protocolVersion,
    result.escrowVersion,
  ].some((value) => Number(value) === 6);
};
const verifiedRefundState = (attempt) => {
  const result = resultOf(attempt),
    payment = paymentOf(attempt),
    state = String(
      payment.refundStatus ?? result.refundStatus ?? "",
    ).toLowerCase();
  return (
    payment.refundStatusVerified === true ||
    result.refundStatusVerified === true ||
    ["verified", "confirmed", "finalized", "settled", "settled-onchain", "refunded"].includes(state)
  );
};
export const paymentIsRefunded = (attempt) => {
  const result = resultOf(attempt),
    payment = paymentOf(attempt),
    refundOutcome =
      result.outcome === "technical-refund" ||
      result.payoutStatus === "technical-refund" ||
      attempt?.status === "technical-refund" ||
      (v6(attempt) &&
        (result.payoutStatus === "technical-retry" ||
          attempt?.status === "technical-retry")) ||
      payment.refundStatus !== undefined;
  return refundOutcome && (payment.finalized === true || verifiedRefundState(attempt));
};
export const paymentIsV6 = v6;
const isTechnical = (attempt) => {
  const result = resultOf(attempt),
    payment = paymentOf(attempt);
  return (
    result.outcome === "technical-refund" ||
    result.outcome === "technical-failure" ||
    result.payoutStatus === "technical-refund" ||
    result.payoutStatus === "technical-retry" ||
    attempt?.status === "technical-refund" ||
    attempt?.status === "technical-retry" ||
    payment.technicalFailure === true
  );
};
const isSettled = (attempt) => {
  const result = resultOf(attempt),
    payment = paymentOf(attempt);
  return payment.finalized === true || result.payoutStatus === "settled-onchain";
};

export function paymentStatus(attempt) {
  const payment = paymentOf(attempt),
    result = resultOf(attempt),
    technical = isTechnical(attempt),
    settled = isSettled(attempt);
  if (paymentIsRefunded(attempt)) {
    const entry = result.entry ?? payment.entry ?? payment.entryAmount;
    return {
      label: "Refunded",
      detail: entry
        ? `The V6 escrow returned your ${entry} pathUSD entry. Wallet cash delta is 0 pathUSD before network or swap fees.`
        : "The V6 escrow finalized the entry refund. Wallet cash delta is 0 pathUSD before network or swap fees.",
    };
  }
  if (technical) {
    if (v6(attempt)) {
      return {
        label: "Technical refund pending",
        detail:
          "The V6 timeout recovery has not reached a verified finalized refund yet. Do not pay again; a retry action is not available on this escrow path.",
      };
    }
    return {
      label: payment.retryAvailable
        ? "Technical recovery — free retry available"
        : "Technical recovery in progress",
      detail: payment.retryAvailable
        ? "The signed result missed the settlement window. Your original entry was not returned by this recovery path; the reopened challenge offers one sponsored retry. Do not pay the entry again."
        : "The signed result missed the settlement window. Recovery is still being reconciled; your entry is not recorded as a combat loss. Do not pay again while this attempt is being recovered.",
    };
  }
  if (settled) {
    return {
      label:
        result.outcome === "win"
          ? "Paid"
          : result.outcome === "draw"
            ? "Draw settled"
            : "Loss settled",
      detail:
        result.outcome === "win"
          ? "The escrow finalized the winner payout. Check the wallet cash delta separately from network or swap fees."
          : "The escrow finalized this outcome. The entry follows the posted loss, draw, or deadline terms.",
    };
  }
  if (payment.transactionHash) {
    return {
      label: "Settlement submitted — awaiting finality",
      detail:
        "A settlement transaction was submitted. Wait for the finalized receipt before treating the result as Paid, Draw settled, or Loss settled.",
    };
  }
  if (attempt?.status === "awaiting-signatures") {
    return {
      label: "Result ready — awaiting signature",
      detail:
        "The battle result is recorded and waiting for the configured settlement signer. It is not a missing result and does not require another entry payment.",
    };
  }
  if (attempt?.status === "ready-to-settle") {
    return {
      label: "Result signed — settlement pending",
      detail:
        "The battle result is recorded and waiting for the escrow settlement. It is not a missing result and does not require another entry payment.",
    };
  }
  if (["queued", "running"].includes(attempt?.status)) {
    return {
      label: "Result processing",
      detail:
        "The official replay is complete or being finalized. Payment status will update after the escrow result is verified.",
    };
  }
  if (attempt?.status === "engineering") {
    return {
      label: "Entry confirmed — build window open",
      detail:
        "The escrow entry is confirmed and the opponent is revealed. Submit one valid counter before the displayed deadline.",
    };
  }
  return {
    label: "Payment status pending",
    detail:
      "The attempt is still being reconciled. Refresh this page using the saved attempt ID; do not submit another entry.",
  };
}

function timelineState(done, current) {
  return done ? "complete" : current ? "current" : "pending";
}

export function paymentTimeline(attempt) {
  const payment = paymentOf(attempt),
    technical = isTechnical(attempt),
    v6Attempt = v6(attempt),
    refunded = paymentIsRefunded(attempt),
    settled = isSettled(attempt),
    hasEntry =
      !!payment.entryTransactionHash ||
      ["engineering", "queued", "running", "awaiting-signatures", "ready-to-settle", "settled", "refunded"].includes(
        attempt?.status,
      ),
    hasResult =
      !!attempt?.result ||
      ["queued", "running", "awaiting-signatures", "ready-to-settle", "settled", "refunded"].includes(
        attempt?.status,
      ),
    hasSubmittedSettlement = !!payment.transactionHash,
    deadline = payment.deadline ? Number(payment.deadline) * 1000 : 0,
    deadlineText = deadline
      ? `Build deadline ${new Date(deadline).toLocaleString()}`
      : "Build deadline / attempt window";
  const steps = [
    { label: "Payment accepted", state: timelineState(hasEntry, !hasEntry) },
    {
      label: "Escrow entry confirmed",
      state: timelineState(hasEntry, !hasEntry),
      detail: payment.entryTransactionHash
        ? transactionLink(payment.entryTransactionHash, "entry receipt")
        : "",
    },
    {
      label: deadlineText,
      state: timelineState(
        hasResult,
        hasEntry && !hasResult && (!deadline || deadline > Date.now()),
      ),
    },
    {
      label: "Result recorded",
      state: timelineState(hasResult, hasEntry && !hasResult),
    },
    {
      label: "Settlement submitted",
      state: timelineState(
        hasSubmittedSettlement || settled,
        hasResult && !hasSubmittedSettlement && !technical,
      ),
      detail: hasSubmittedSettlement
        ? transactionLink(payment.transactionHash, "settlement receipt")
        : "",
    },
    {
      label: refunded
        ? "Entry refunded by escrow"
        : technical
        ? v6Attempt
          ? "Technical refund · awaiting verification"
          : payment.retryAvailable
            ? "Technical recovery · sponsored retry"
            : "Technical recovery · awaiting reconciliation"
        : settled
          ? "Escrow payment finalized"
          : "Paid / recovery outcome",
      state: timelineState(
        refunded || settled || (technical && !v6Attempt),
        hasSubmittedSettlement && !settled,
      ),
    },
  ];
  return `<ol class="payment-timeline">${steps
    .map(
      (step) =>
        `<li class="${step.state}"><span aria-hidden="true"></span><div><strong>${escape(step.label)}</strong>${step.detail ? `<small>${step.detail}</small>` : ""}</div></li>`,
    )
    .join("")}</ol>`;
}

export function paymentBreakdown(attempt, currency = "pathUSD") {
  const result = resultOf(attempt),
    payment = paymentOf(attempt),
    amount = (value) =>
      value === undefined || value === null || value === ""
        ? "—"
        : `${escape(value)} ${escape(currency)}`,
    entry = result.entry ?? payment.entry ?? payment.entryAmount,
    cashDelta = paymentIsRefunded(attempt)
      ? "0"
      : result.walletCashDelta ??
        result.cashDelta ??
        (result.payoutStatus === "technical-retry" && result.net !== undefined
          ? result.net
          : isSettled(attempt) && result.net !== undefined
            ? result.net
            : null);
  return `<div class="payment-breakdown"><div><b>${amount(result.grossReward ?? result.reward)}</b><small>GROSS REWARD</small></div><div><b>${amount(result.platformFee)}</b><small>PLATFORM FEE</small></div><div><b>${amount(result.payout)}</b><small>WINNER PAYOUT</small></div><div><b>${amount(entry)}</b><small>${paymentIsRefunded(attempt) ? "ENTRY RETURNED" : "ENTRY PAID"}</small></div><div><b>${cashDelta === null ? "Pending" : amount(cashDelta)}</b><small>WALLET CASH DELTA</small></div></div>`;
}

export function paymentPanel(attempt) {
  const status = paymentStatus(attempt),
    payment = paymentOf(attempt),
    links = [
      transactionLink(payment.entryTransactionHash, "Entry transaction"),
      transactionLink(
        payment.transactionHash,
        payment.finalized ? "Finalized settlement" : "Settlement transaction",
      ),
      transactionLink(payment.refundTransactionHash, "Refund transaction"),
    ].filter(Boolean);
  return `<section class="notice payment-status" role="status" aria-live="polite"><h3>${escape(status.label)}</h3><p>${escape(status.detail)}</p>${paymentTimeline(attempt)}${links.length ? `<p>${links.join(" · ")}</p>` : ""}</section>`;
}
