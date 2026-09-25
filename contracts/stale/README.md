# Archived escrow versions

This directory contains historical contract sources, tests, deployment scripts,
deployment wrappers, and deployment examples for escrow versions before V6.
They are retained for audit, source verification, and historical recovery only.

V6 is the sole active contract version in `contracts/src`, `contracts/test`,
`contracts/script`, and `contracts/deployments`. The Foundry profile and CI use
those active directories, so archived contracts are not compiled or tested by
the normal workflow. Do not deploy or use an archived version for new funds.
The old deployment wrappers and two-signer result utility are archived here as
well; use the V6 deployment tooling only for a separately approved deployment.

The Worker may still contain read-only compatibility and recovery logic for
existing historical bounty records. Moving these files does not rewrite or
delete on-chain contracts, migrate balances, or change the live escrow.
