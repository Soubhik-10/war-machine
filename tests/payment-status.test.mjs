import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentBreakdown,
  paymentIsRefunded,
  paymentIsV6,
  paymentStatus,
  paymentTimeline,
} from "../dist/payment-status.mjs";

test("technical retry is not presented as a refund", () => {
  const attempt = {
    status: "technical-retry",
    result: {
      outcome: "technical-failure",
      payoutStatus: "technical-retry",
      entry: "0.25",
      net: "-0.25",
    },
    payment: { technicalFailure: true, retryAvailable: true },
  };
  const status = paymentStatus(attempt);
  assert.match(status.label, /Technical recovery/);
  assert.doesNotMatch(status.label, /refund/i);
  assert.match(status.detail, /not returned/);
  assert.match(paymentTimeline(attempt), /sponsored retry/);
  assert.match(paymentBreakdown(attempt), /WALLET CASH DELTA/);
  assert.match(paymentBreakdown(attempt), /-0\.25 pathUSD/);
});

test("signed result remains pending until escrow finality", () => {
  const status = paymentStatus({
    status: "awaiting-signatures",
    result: { outcome: "win" },
    payment: {},
  });
  assert.equal(status.label, "Result ready — awaiting signature");
  assert.match(status.detail, /not a missing result/);
});

test("expired and busy board records can be identified without changing legacy statuses", () => {
  const pending = paymentStatus({ status: "queued", payment: {} });
  assert.equal(pending.label, "Result processing");
});

test("V6 technical recovery does not offer a sponsored retry before refund finality", () => {
  const attempt = {
    status: "technical-refund",
    result: { outcome: "technical-refund", payoutStatus: "technical-refund", entry: "0.25" },
    payment: { escrowVersion: 6, finalized: false, refundStatus: "pending", retryAvailable: true },
  };
  assert.equal(paymentIsV6(attempt), true);
  assert.equal(paymentIsRefunded(attempt), false);
  const status = paymentStatus(attempt);
  assert.equal(status.label, "Technical refund pending");
  assert.doesNotMatch(status.detail, /sponsored retry/i);
  assert.doesNotMatch(paymentTimeline(attempt), /sponsored retry/i);
});

test("V6 shows refunded only after finality and reports the returned entry and zero cash delta", () => {
  const finalized = {
    status: "technical-refund",
    result: { outcome: "technical-refund", payoutStatus: "technical-refund", entry: "0.25", net: "0" },
    payment: { escrowVersion: 6, finalized: true, retryAvailable: true },
  };
  assert.equal(paymentIsRefunded(finalized), true);
  assert.equal(paymentStatus(finalized).label, "Refunded");
  assert.match(paymentStatus(finalized).detail, /0\.25 pathUSD entry/);
  assert.match(paymentBreakdown(finalized), /0 pathUSD/);
  assert.match(paymentBreakdown(finalized), /ENTRY RETURNED/);
  assert.doesNotMatch(paymentTimeline(finalized), /sponsored retry/i);

  const verified = {
    ...finalized,
    payment: { escrowVersion: 6, finalized: false, refundStatus: "verified" },
  };
  assert.equal(paymentIsRefunded(verified), true);
});

test("V6 technical-retry becomes refunded only with finality", () => {
  const attempt = {
    status: "technical-retry",
    result: { payoutStatus: "technical-retry", entry: "0.25" },
    payment: { escrowVersion: 6, finalized: true },
  };
  assert.equal(paymentIsRefunded(attempt), true);
  assert.equal(paymentStatus(attempt).label, "Refunded");
});