# War Machines bounty escrow

V6 is the live, non-upgradeable pathUSD escrow on Tempo Mainnet and the only
active contract version in this repository. Historical versions are kept under
[`contracts/stale/`](../contracts/stale/README.md) for reference; they are not
the deployment path for new bounties.

## Live configuration

- Chain: Tempo Mainnet, chain ID `4217`.
- Token: pathUSD, `0x20C0000000000000000000000000000000000000` (6 decimals).
- Escrow: use the verified V6 address returned by the live discovery document;
  do not infer it from an old deployment record.
- Winning reward fee: 2.5% (250 bps); use discovery and the verified contract
  to confirm the recipient and exact net payout before funding.
- V6 uses one configured EIP-712 settlement signer and a bounded payment
  relayer for native MPP.

The protected Worker configuration uses `WM_BOUNTY_ESCROW_VERSION=6`. Keep the
deployed address and private signer/relayer material in their approved settings
and secret stores. Routine UI or documentation releases do not require a
contract redeploy.

## Payment and settlement

The creator funds the gross reward through the escrow. The challenger pays the
separate entry. V6 holds both reserves on-chain while the attempt is active. A
verified win pays the challenger the gross reward less the 2.5% fee and sends
the held entry to the creator. A settled loss or draw pays the held entry to
the creator and reopens the bounty.

V6's technical timeout path is a refund, not a loss: after the attempt window
and settlement grace, either timeout entrypoint returns the held entry to the
recorded challenger, reopens the bounty, and emits `TimedOutAttemptRefunded`.
This is the failsafe for an attempt that was entered but did not settle in
time. Only the recorded creator can cancel an idle bounty; V6 has no
`cancelBountyFor` method.

The contract fixes the token, fee, payout recipients, and result domain. The
Worker verifies the finalized contract event and immutable bounty terms before
updating app state. The one-signer setup is a trusted-operator model, not
independent multi-party protection. The bounded MPP relayer temporarily handles
forwarded payments before the matching escrow call; keep its allowance and
balance within the approved cap.

## Verification and development

Use the current discovery document to verify the chain, V6 escrow address,
token, payment routes, and current status. Do not send a bare pathUSD transfer
to the escrow; use the exact direct-wallet plan or MPP challenge the app
provides.

The active Foundry paths contain only V6 sources, tests, and deploy tooling:

```powershell
cd contracts
..\work\tooling\foundry\forge.exe fmt --check
..\work\tooling\foundry\forge.exe test -vvv
```

Archived V1–V5 sources and tests are outside these paths. Their on-chain
deployments remain immutable and may still be relevant to historical receipt
reconciliation; archiving local files does not alter them or migrate funds.
