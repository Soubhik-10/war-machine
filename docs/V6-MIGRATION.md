# V6 live escrow operations

V6 is the live Tempo Mainnet bounty escrow and the only active contract version
in this repository. The Worker must be configured with
`WM_BOUNTY_ESCROW_VERSION=6`, the verified deployed V6 address, and the matching
settlement signer and relayer settings. Keep those production values in the
hosting provider's protected configuration; do not copy secrets into this
document or source control.

The old V1–V5 sources, tests, scripts, and deployment examples are retained under
[`contracts/stale/`](../contracts/stale/README.md) for historical audit and
recovery. They are not the active deployment path. The Worker may still read
historical records as needed; archived on-chain contracts remain immutable.

Updating application code or this documentation does not redeploy the contract,
move escrow funds, or rewrite existing bounty records. A V6 deployment is already
live; do not run a deployment script merely to publish an app change. Existing
older-version funds and attempts remain on their original contract and must be
reconciled against that contract's finalized receipts. Never ask a player to pay
a second entry as a substitute for reconciling an existing attempt.

## V6 payment configuration

V6 uses the Tempo Mainnet pathUSD token, a pause guardian, a bounded agent
relayer, a settlement signer, and one-signer quorum. V6 uses EIP-712 domain
version `6`. The relayer must be funded and approved for the V6 escrow before
native MPP create or entry payments are enabled. Verify the escrow address,
chain, token, signer, and relayer against the deployed contract and the protected
Worker configuration before changing any production setting.

The deployment helper remains available for a separately reviewed future V6
deployment or recovery rehearsal:

```powershell
.\scripts\deploy-tempo-escrow-v6.ps1 -Initialize
.\scripts\deploy-tempo-escrow-v6.ps1 -DeployerAddress <public deployer address>
```

These commands only preview constructor settings. Broadcasting is a separate
operation and is not part of routine application releases.

## V6 economic and recovery semantics

V6 holds the challenger entry in escrow and exposes `reservedEntries` separately
from `reservedRewards`. A signed win pays the challenger the reward after the
fixed 2.5% fee and pays the held entry to the creator. A signed loss or draw pays
the held entry to the creator. `AttemptSettled.creatorEntry` reports the actual
entry amount transferred.

After the attempt deadline plus the two-minute settlement grace, both
`forfeitTimedOutAttempt` and `reopenTimedOutAttempt` perform the same technical
refund: they return the held entry to the recorded challenger, reopen the bounty,
and emit `TimedOutAttemptRefunded`. Neither timeout function can confiscate a held
entry or pay it to the creator. V6 has no `cancelBountyFor`; only the recorded
creator may cancel an idle bounty directly.

V6 retains the one-signer trusted-operator model. It is not independent
two-signer protection, and the bounded MPP relayer still temporarily controls a
forwarded payment before the matching escrow call.
