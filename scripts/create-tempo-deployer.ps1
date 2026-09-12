[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cast = Join-Path $repoRoot 'work\tooling\foundry\cast.exe'
$directory = Join-Path $env:LOCALAPPDATA 'WarMachines\deployer'
$accountName = 'war-machines-tempo-deployer'
$keystore = Join-Path $directory $accountName
$addressFile = Join-Path $directory 'deployer-address.txt'

if (-not (Test-Path -LiteralPath $cast)) {
    throw "Tempo Foundry was not found at $cast"
}
if (Test-Path -LiteralPath $keystore) {
    throw "A deployer keystore already exists at $keystore. Refusing to replace it."
}

New-Item -ItemType Directory -Force -Path $directory | Out-Null
Write-Host 'Foundry will now create an encrypted local deployment key.'
Write-Host 'Choose a strong password and store it in your password manager. The raw private key is never displayed or saved in this repository.'

$previousErrorAction = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $output = & $cast wallet new $directory $accountName 2>&1
    $exitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorAction
}
$lines = @($output | ForEach-Object { $_.ToString() })
$lines | ForEach-Object { Write-Host $_ }
if ($exitCode -ne 0) {
    throw "Foundry could not create the encrypted deployer (exit $exitCode): $($lines -join [Environment]::NewLine)"
}
$addressLine = $lines | Where-Object { $_ -match '(0x[0-9a-fA-F]{40})' } | Select-Object -Last 1
if (-not $addressLine -or $addressLine -notmatch '(0x[0-9a-fA-F]{40})') {
    throw 'Foundry did not return the deployer public address. Do not delete the keystore.'
}
$address = $Matches[1]
@(
    'War Machines local Tempo deployment account',
    "address=$address",
    "keystore=$keystore",
    'This file contains public information only.'
) | Set-Content -LiteralPath $addressFile

Write-Host ''
Write-Host "Local encrypted deployer created: $keystore"
Write-Host "Public address: $address"
Write-Host "Fund this address with at least 0.05 pathUSD, then deploy with:"
Write-Host ".\scripts\deploy-tempo-escrow.ps1 -DeployerAddress $address -KeystorePath '$keystore' -Broadcast"
