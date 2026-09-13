# War Machines payment handoff

The previous server-custody payment path is disabled. Bounty value is held only by the verified non-upgradeable Tempo escrow:

- Chain: Tempo Mainnet `4217`
- pathUSD: `0x20C0000000000000000000000000000000000000` (6 decimals)
- Escrow: `0x461eefD1c4bcbE76C470487cF18b892fCD76d494`
- Platform fee: 2.5% of gross winner reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A`

The browser and Worker now prepare and verify direct escrow flows for creation, entry, settlement, cancellation, timeout recovery and expiry. No game backend payout key exists.

## Current private-trial checklist

- [x] Creator reward is approved and deposited by `createBounty`.
- [x] Challenger entry is approved and deposited by `enterBounty`.
- [x] Worker binds the immutable defender, rules, terrain, engine release, creator address, exact amounts and expiry into `termsHash`.
- [x] Worker verifies receipt events only from the pinned escrow address.
- [x] Two EIP-712 signatures are required before `settleAttempt`.
- [x] Browser can relay an attested settlement and verify the on-chain event and payment amounts.
- [x] Creator cancellation, challenger timeout refund and public expiry use direct contract exits.
- [x] Platform fee is immutable in deployed bytecode and is 2.5% of a win only.
- [x] Agent API discovery separates direct escrow bounties from MPP service work.
- [x] A local encrypted-keystore script prepares both result signatures without putting a private key in the Site, D1, Git or browser.
- [ ] Run a complete real-wallet rehearsal with two wallets: creation, win, loss/draw, technical refund, cancellation, expiry, wrong approval, wrong event, late signature and pause behavior.
- [ ] Move the two signer keys into separate operational controls and replace the manual desktop signing script with a reviewed, monitored result-attestation service.
- [ ] Independently review the deployed contract, Worker receipt verification and UI transaction plans.
- [ ] Define incident response, monitoring, D1 backup/restore and public support procedures.
- [ ] Obtain the required legal and payment-provider review for paid-entry prize activity before broadly advertising or raising limits.

## MPP implementation TODO

MPP is for separately priced agent service calls only. It cannot invoke escrow methods and is never a substitute for `createBounty`, `enterBounty`, or `settleAttempt`.

- [x] Worker has an opt-in MPP `tempo.charge` route for `POST /api/agent/practice`.
- [x] Discovery announces MPP only after configuration validates.
- [x] Bounty routes stay direct escrow-only even when MPP is enabled.
- [ ] Choose the separate service-payee wallet and the exact per-practice pathUSD price.
- [ ] Set `WM_AGENT_MPP_ENABLED=true`, `WM_AGENT_MPP_RECIPIENT`, `WM_AGENT_MPP_PRICE`, and a 32+ character `MPP_SECRET_KEY` in the Site backend settings.
- [ ] Test an MPP client against that route: reject wrong origin, token, recipient, chain, amount, expired credential and replayed credential.
- [ ] Decide whether agent practice needs rate limits and a cost ceiling before enabling public MPP billing.

Read [TEMPO-MAINNET.md](TEMPO-MAINNET.md), [BOUNTY-ESCROW.md](BOUNTY-ESCROW.md), and [AGENT-API.md](AGENT-API.md) before changing any value flow.
