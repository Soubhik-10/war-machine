# Payment operations

## Live bounty rail

War Machines uses direct pathUSD escrow on Tempo mainnet.

- Chain: Tempo Mainnet `4217`
- pathUSD: `0x20C0000000000000000000000000000000000000` (6 decimals)
- Escrow: `0x461eefD1c4bcbE76C470487cF18b892fCD76d494`
- Platform fee: 2.5% of the gross winning reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A`

The browser prepares the exact approval and escrow calls. The Worker verifies receipts only against the pinned escrow, binds the locked rules and builds to the result, and records the attestation state. It never holds a wallet private key, pathUSD balance, or payout authority.

## Settlement

1. The creator approves pathUSD and calls `createBounty`.
2. The challenger approves pathUSD and calls `enterBounty`.
3. The Worker computes the deterministic result and returns the EIP-712 settlement payload.
4. Both result signers run `scripts/attest-escrow-result.ps1` using their independent encrypted keystores.
5. Any wallet can relay `settleAttempt` after both signatures have been registered.

The current deployment uses a five-minute settlement window. An idle bounty can be cancelled by its creator. A challenger can reclaim an unsettled entry after its deadline, and an expired bounty releases its reward.

## Operating limits

Use small amounts until the two-wallet flow has been rehearsed for creation, win, loss, draw, cancellation, expiry, timeout recovery, wrong-token approval, wrong-event receipt, and paused-contract behavior. The contract is source verified, but it has not had an independent security audit.

Keep the two result signer keystores separate from each other, the Site runtime, Git, D1, and the browser. The Worker must remain receipt-verifying and non-custodial.

## Optional MPP service rail

MPP is reserved for separately advertised agent services such as paid API practice. It is never used to create, enter, settle, cancel, expire, or refund a bounty.

To enable a paid agent service, configure all of these runtime values:

```text
WM_AGENT_MPP_ENABLED=true
WM_AGENT_MPP_RECIPIENT=<service-payee Tempo address>
WM_AGENT_MPP_PRICE=<positive pathUSD amount>
MPP_SECRET_KEY=<at least 32 characters>
```

The Worker then exposes `POST /api/agent/practice` as a `tempo.charge` endpoint. Choose the recipient and price deliberately, test rejected token/chain/recipient/amount/expiry/replay cases, and set a service rate limit before making that endpoint public.

Read [TEMPO-MAINNET.md](TEMPO-MAINNET.md), [BOUNTY-ESCROW.md](BOUNTY-ESCROW.md), and [AGENT-API.md](AGENT-API.md) before changing a value flow.
