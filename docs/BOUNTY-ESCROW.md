# War Machines bounty escrow

`contracts/src/WarMachineBountyEscrow.sol` and `contracts/src/WarMachineBountyEscrowV3.sol` are historical direct-wallet escrows. V4 is the legacy non-upgradeable pathUSD escrow for native MPP agent create/entry calls. `contracts/src/WarMachineBountyEscrowV5.sol` is the current release: it keeps direct entry payment semantics, adds a two-minute settlement grace, and separates technical reopen from real timeout forfeiture.

The retired v1 escrow remains immutable at [`0x461eefD1c4bcbE76C470487cF18b892fCD76d494`](https://explore.tempo.xyz/address/0x461eefD1c4bcbE76C470487cF18b892fCD76d494). Its historical record remains in [`contracts/deployments/tempo-mainnet.json`](../contracts/deployments/tempo-mainnet.json); do not send it new bounty funds.

The public application prepares direct wallet calls to this escrow and verifies the emitted events. It does not custody player funds or contain settlement private keys. The current V5 small-amount trial uses one fixed settlement signer (`settlementQuorum = 1`) so the Worker can settle automatically; that is a limited-trial trust boundary, not independent multi-party protection. Do not increase bounty sizes until a reviewed multi-signer contract version is deployed.

## Live immutable configuration

| Setting        | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Chain          | Tempo Mainnet (`4217`)                                                   |
| Token          | pathUSD, `0x20C0000000000000000000000000000000000000` (6 decimals)       |
| Platform fee   | 2.5% (`250` bps), recipient `0xc20131e9132888993de6519D486E5558A5DbCb7A` |
| Attempt window | 600 seconds: 3–5 minutes to build plus signer/relay reserve              |
| Pause guardian | `<configured V5 guardian>`                                             |
| Agent relayer  | `<configured V5 relayer>`                                              |
| Settlement     | V5: one configured EIP-712 result signer plus 120-second relay grace; V3/V4 records may differ |

The token, fee and attempt-window values are the V5 deployment policy. Replace the address fields with the values printed by the V5 deployment and verify the resulting bytecode. This is a code-level audit, not an independent third-party audit.

## What the contract protects

- The contract, rather than the backend, holds every bounty reward and active entry.
- It accepts one configured TIP-20 token only at deployment. The included mainnet deploy script fixes this to Tempo pathUSD: `0x20C0000000000000000000000000000000000000`.
- The 2.5% reward fee and its recipient (`0xc20131e9132888993de6519D486E5558A5DbCb7A`) are immutable bytecode constants.
- The payout recipient is always the active challenger. A result signer cannot substitute a wallet, a fee rate, a token, a reward, or an entry amount.
- The creator receives the separately disclosed entry amount after a completed non-technical attempt. The platform receives no hidden entry fee.
- A creator cannot cancel or expire while an attempt is active. Missing the build deadline is a real loss; after the V5 grace, anyone can call the timeout finalizer and the entry remains with the creator. If a committed result was not settled because infrastructure failed, the Worker calls `reopenTimedOutAttempt` instead, reopens the bounty, and grants one sponsored retry without another user payment. Expiry only returns an idle bounty's unused reward reserve.
- The pause guardian can stop new bounties and entries, but cannot block settlement, cancellation, expiry, or player refunds. There is no owner withdrawal, upgrade function, proxy, rescue method, or arbitrary transfer function.
- A battle outcome needs the constructor's fixed EIP-712 quorum. Current V5 uses one signer for a small trial; the constructor permanently fixes that set and quorum. Use an independently reviewed multi-signer contract for a public release.
- Exact token balance checks reject fee-on-transfer or non-conforming token behavior. All value fields are integer token base units; pathUSD uses six decimals.

## What it does not prove

The on-chain contract cannot simulate the game. Settlement signers are an oracle for the off-chain deterministic replay. A quorum prevents one compromised signer from fabricating a result, but it does not make the oracle trustless. The complete replay must be published and its canonical hash must equal `resultHash` in the signed settlement. No administrator can reverse a settlement.

V5's relayer methods are intentionally narrower than a general payment channel: the Worker verifies the MPP receipt, then submits the exact payer, terms, reward or entry supplied by the route. The contract never lets the relayer choose a different bounty recipient or settlement result. Direct wallet methods remain available for browser players.

## Contract lifecycle

```mermaid
stateDiagram-v2
    [*] --> Open: creator funds reward
    Open --> Active: challenger escrows entry
    Active --> Claimed: signed challenger win
    Active --> Open: signed loss/draw or technical refund
    Active --> Open: timeout finalizer sends entry to creator
    Active --> Open: technical reopen grants one sponsored retry
    Open --> Cancelled: creator cancels
    Open --> Expired: expiry
```

The UI must show the gross reward, 2.5% fee, winner payout, entry amount, entry recipient, expiry, active-attempt deadline, token, chain, contract address, signer quorum, result hash, and every contract event before a wallet asks the user to sign or approve a transfer.

## Paid defender reveal

The defender blueprint is committed by the bounty's immutable `termsHash`, but it is not returned by public Worker routes. Before entry, a bounty exposes its arena, terrain, construction rules, construction cost, mass, fitted-part count, weapon count and economic terms. A confirmed `AttemptEntered` event grants the exact defender only to that challenger account.

That paid challenger gets a server-recorded build deadline, then submits one valid counter with `POST /api/attempts/:id/deploy`. The Worker commits the defender, challenger, arena, seed, engine hash and simulation result to `resultHash` before the configured signer attests it. Other users cannot obtain the defender from bounty, validation, attempt or replay routes.

V5's 600-second attempt window gives the Worker a cost-scaled three-to-five-minute construction phase and leaves a two-minute relay grace. A valid committed result can settle during that grace. If the result still cannot settle, the public Worker uses the technical-reopen function; only a missing build uses timeout forfeiture. Do not point the public Worker at this escrow until its address, immutable fee constants, signer set, source verification, and signer service have been reviewed and pinned in `runtimeConfig`.

## Development checks

The package has no Solidity or npm dependencies. Foundry compiles the bundled sources directly.

```powershell
cd contracts
..\work\tooling\foundry\forge.exe fmt --check
..\work\tooling\foundry\forge.exe test -vvv
```

The tests cover payout accounting, fixed fees, loss/draw reserve retention, active-attempt cancellation protection, creator timeout forfeiture, active-expiry protection, invalid signatures, replay resistance, and pause powers.

## Public-money activation gate

Do not take a payment through the Site until all of these are true:

1. Have an independent Solidity reviewer inspect the exact deployed bytecode and source.
2. Rehearse the configured V5 signer, pause guardian, expiry, cancellation, incorrect signatures, signer outage, wrong token, and wallet rejection. A future multi-signer release must rehearse each independent signer.
3. Keep the V5 settlement signer key in a dedicated server secret store and replace the trial signer with a separately operated multi-signer replay/attestation service before public funds. The retired custodial payout queue must remain disabled.
4. Rehearse direct wallet calls for `approve`, `createBounty`, `enterBounty`, settlement, timeout forfeiture, technical reopen, cancellation and expiry. For V5, also rehearse exact MPP challenge/retry, relayer allowance, relay recovery and the sponsored technical retry.
5. Display this contract address, token, gross reward, 2.5% fee, winner payout, entry amount, expiry, attempt deadline, signer quorum, result hash, and relevant events before every signing request.
6. Test first with a deliberately low real-money cap and no fee sponsorship. Paid-entry prize rules, tax, sanctions, consumer protection, and payment-provider requirements still need an operator review.

Tempo documents Foundry deployment and verification at <https://docs.tempo.xyz/sdk/foundry> and <https://docs.tempo.xyz/quickstart/verify-contracts>. Tempo mainnet is chain ID 4217 and pathUSD uses six decimals: <https://docs.tempo.xyz/protocol/exchange/pathUSD>.

## V5 deployment with the desktop launcher

The current V5 script deploys the pathUSD escrow with a separate pause guardian, agent relayer and settlement signer. It reads public constructor values from the ignored local file and never reads a relayer or settlement private key. V5 adds a two-minute result relay grace and the technical-reopen event used for sponsored recovery.

```powershell
cd C:\Users\soubh\Documents\Codex\2026-09-12\hey\work\github-war-machine
.\scripts\deploy-tempo-escrow-v5.ps1 -Initialize
```

Edit `contracts\deployments\tempo-mainnet-v5.local.env` with three distinct public addresses and a `600` second window, preview, then broadcast with the existing encrypted deployer keystore:

```powershell
.\scripts\deploy-tempo-escrow-v5.ps1 `
  -DeployerAddress 0xCA57cA8E21670fCaD76aD6485223fc231fd020D5 `
  -KeystorePath "$env:LOCALAPPDATA\WarMachines\deployer\war-machines-tempo-deployer"

.\scripts\deploy-tempo-escrow-v5.ps1 `
  -DeployerAddress 0xCA57cA8E21670fCaD76aD6485223fc231fd020D5 `
  -KeystorePath "$env:LOCALAPPDATA\WarMachines\deployer\war-machines-tempo-deployer" `
  -Broadcast
```

Type `DEPLOY` exactly at the confirmation prompt. Record the new V5 address and verification result, then configure the Worker with the same escrow, signer and relayer addresses. Keep the private settlement, relayer and MPP secret values in the hosting provider's secret store only.

## Legacy V3/V4 and browser deployment (historical only)

The commands below target older direct-wallet contracts and are retained only for reading historical deployments. Do not use them for the current V5 native-MPP release.

Copy `contracts/deployments/tempo-mainnet.env.example`, enter public addresses only, and load it in the shell. The deployer must remain in a wallet or hardware-backed interactive signer; never paste a private key into this file, the shell history, the repository, ChatGPT Sites, or chat.

After testnet rehearsal and bytecode review, run the deployment script with the public values
loaded into the shell and Foundry's interactive key prompt:

```powershell
cd contracts
..\work\tooling\foundry\forge.exe script script/DeployWarMachineBountyEscrow.s.sol:DeployWarMachineBountyEscrow `
  --rpc-url https://rpc.tempo.xyz `
  --interactives 1 --broadcast --verify
```

That command needs the fully reviewed public signer, guardian, quorum and attempt-window values.
It deliberately asks for the deployer key interactively rather than accepting it from a file, so the
operator can inspect the destination, bytecode, chain, token, signer quorum, pause guardian, and
transaction before broadcast.

## Legacy browser deployment (historical only)

An EVM-compatible Tempo wallet can deploy this contract without revealing its key to this
repository or to ChatGPT. Use this only after the mainnet deployment gate above has been met.

1. Connect the wallet to **Tempo Mainnet** (chain ID `4217`) and ensure it holds enough `pathUSD`
   to pay the transaction fee. Tempo has no native gas token; conventional wallet transactions to
   a contract need a `pathUSD` balance.
2. Open [Remix](https://remix.ethereum.org), create
   `WarMachineBountyEscrow.sol`, and paste the exact source from
   `contracts/src/WarMachineBountyEscrow.sol` at the reviewed Git commit.
3. In Remix Solidity Compiler select **0.8.30**, enable optimization with **1,000 runs**, and set
   EVM version to **Cancun**. Compile the `WarMachineBountyEscrow` contract.
4. In **Deploy & Run**, select **Injected Provider** and confirm the wallet shows Tempo Mainnet.
   Select `WarMachineBountyEscrow`, then enter these constructor arguments:

   ```text
   token:              0x20C0000000000000000000000000000000000000
   pauseGuardian:      <dedicated public guardian address>
   attemptWindow:      600
   settlementSigners:  [<signer 1 address>, <signer 2 address>]
   settlementQuorum:   2
   ```

   `signer 1` and `signer 2` must be independent, dedicated key holders. They are not allowed to
   change payout amounts or recipients, but both can attest a result. Do not use the deployer
   wallet as either signer or pause guardian.

5. Before approving the wallet popup, verify the chain, exact source commit, compiler settings,
   token address, guardian, both signer addresses, `600` second window, and `2` quorum. The fee
   recipient and 2.5% rate are compiled into the contract and cannot be changed during deployment.
6. Record the deployed address and transaction hash, verify it at
   [Tempo's contract verifier](https://contracts.tempo.xyz), then test only an extremely small
   bounty from a second wallet before enabling paid bounties in the Site.

Do not send `pathUSD` directly to the deployed address. The contract only accepts funds through
`createBounty` and `enterBounty`, after a wallet approves the exact token amount.

## Legacy desktop Foundry launcher (historical only)

`scripts/deploy-tempo-escrow.ps1` is prepared for a burner deployer. It only reads public
configuration values and asks Foundry for the burner key in the desktop terminal when
`-Broadcast` is explicitly supplied. The key is never written to the project or a Site setting.

```powershell
cd C:\Users\soubh\Documents\Codex\2026-09-12\hey\work\github-war-machine
.\scripts\deploy-tempo-escrow.ps1 -Initialize
```

Edit the created, ignored file at
`contracts/deployments/tempo-mainnet.local.env`: enter a dedicated pause guardian plus two
independently controlled settlement signer addresses. Then preview the immutable settings:

```powershell
.\scripts\deploy-tempo-escrow.ps1 -DeployerAddress <your burner address>
```

When the preview is correct, broadcast from the terminal:

```powershell
.\scripts\deploy-tempo-escrow.ps1 -DeployerAddress <your burner address> -Broadcast
```

The launcher first requires the literal confirmation `DEPLOY`, then Foundry prompts for the
burner key locally. Never paste that key into chat, a Site setting, `.env`, or a repository file.

If the burner is connected in a browser wallet whose private key cannot be exported, use the
same launcher with `-BrowserWallet` instead. Foundry will ask the browser wallet to sign; the
private key stays in that wallet.

```powershell
.\scripts\deploy-tempo-escrow.ps1 -DeployerAddress <your wallet address> -Broadcast -BrowserWallet
```

### Local encrypted Foundry deployer

Some Tempo browser or passkey accounts intentionally do not expose a raw private key. Do not try
to extract one. To use Foundry without a browser-wallet bridge, create a separate local encrypted
deployer instead:

```powershell
.\scripts\create-tempo-deployer.ps1
```

It stores a new key only as an encrypted keystore in `%LOCALAPPDATA%\WarMachines\deployer` and
prints its public address. Transfer a small pathUSD fee balance to that public address, then use
the same deployer with its keystore:

```powershell
.\scripts\deploy-tempo-escrow.ps1 `
  -DeployerAddress <printed public address> `
  -KeystorePath "$env:LOCALAPPDATA\WarMachines\deployer\war-machines-tempo-deployer" `
  -Broadcast
```

Foundry asks locally for the keystore password. Neither the password nor the raw key belongs in
chat, a Site environment setting, or the repository.

### Creating the two result signers

They are not funded wallets and do not pay transaction fees. They are two local, encrypted
keypairs whose **public** addresses are fixed into the escrow. A result needs both signatures, so
one leaked signing key cannot invent a payout.

Run this once in the desktop terminal after initializing the local configuration:

```powershell
.\scripts\create-escrow-result-signers.ps1
```

Foundry prompts locally for a different password for each key and saves encrypted keystores under
`%LOCALAPPDATA%\WarMachines\settlement-signers`. The script puts only their public addresses into
the ignored local deployment file. It also creates a third zero-balance keypair for
`WM_ESCROW_PAUSE_GUARDIAN`, so the only pre-existing wallet you need is the funded burner
deployer.

For a small private trial, both signer keypairs may be controlled by the same operator. That is
not independent protection against a compromised computer. Before public paid bounties, place the
signers under separate operational controls and build the result-attestation service that uses
them; the current Site deliberately does not hold these keys.
