# V6 migration and release boundary

`WarMachineBountyEscrowV6.sol` is a source-only candidate in this checkout. It has
no deployed address, is not selected by the live Worker, and must not be added to
public discovery until the backend integration and an on-chain review are complete.

## Code-only release

The UI, status model, V6 source, tests, deployment example and dry-run tooling can
be released without changing the live payment rail. Keep these values unchanged:

```text
WM_BOUNTY_ESCROW_VERSION=5
WM_BOUNTY_ESCROW_ADDRESS=<current V5 address>
```

This code-only release does not move funds, change a contract, or migrate a
database row. V5 rewards remain in the V5 escrow. V5 active attempts and their
entry payments remain governed by V5, including its technical-reopen retry path.

Before an optional V6 cutover, stop new V5 funding and entries through the existing
pause or readiness controls. Let active V5 attempts settle, timeout, or complete
their documented technical recovery. Cancel or expire only eligible idle V5
bounties, and reconcile every reward and entry against its finalized V5 receipt.
Existing V5 funds and attempts cannot be moved automatically into V6. Do not ask a
player to pay a second entry as a substitute for reconciling an existing V5
attempt.

The V5 escrow address and the future V6 escrow address are separate funding
destinations. The creator and challenger addresses in each V5 record are already
the authoritative payment identities; preserve those records and receipts rather
than reconstructing them in V6. The pathUSD token address and platform fee
recipient are unchanged, but a new V6 escrow still needs its own reward funding,
relayer allowance and settlement configuration.

## Optional on-chain V6 deployment

Deploying V6 is a separate operational change after the code-only work. The
constructor uses the same Tempo Mainnet pathUSD token, a distinct pause guardian,
bounded agent relayer and settlement signer, an attempt window, and exactly one
signer with quorum one. V6 uses EIP-712 domain version `6`.

Preview the public constructor inputs locally:

```powershell
.\scripts\deploy-tempo-escrow-v6.ps1 -Initialize
.\scripts\deploy-tempo-escrow-v6.ps1 -DeployerAddress <public deployer address>
```

The preview does not broadcast and does not require a deployer keystore. The
script preflights `forge script --help` for Tempo's `--tempo.fee-token` option
and passes the pathUSD token explicitly. Use `-ForgePath` when the Tempo Forge
installation is outside the repository; the bundled standard Forge test binary
does not by itself prove that a deployment build supports Tempo transaction
fees. This document does not authorize or perform a broadcast; only an
explicitly reviewed operator may add `-Broadcast` and `-KeystorePath` after the
new address, bytecode, token, signer, relayer allowance and monitoring plan have
been checked.

After a separately approved deployment, backend configuration must be changed as
one reviewed operation to the new V6 address and version, with the same public
relayer and a V6-approved signer. The relayer must approve the new escrow before
MPP create or entry calls are enabled. No existing V5 reserve is a V6 reserve,
and no automatic migration or sweep exists.

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
