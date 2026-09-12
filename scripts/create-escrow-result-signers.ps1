[CmdletBinding()]
param(
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$contractsRoot = Join-Path $repoRoot 'contracts'
$forgeCast = Join-Path $repoRoot 'work\tooling\foundry\cast.exe'
if (-not $ConfigPath) {
    $ConfigPath = Join-Path $contractsRoot 'deployments\tempo-mainnet.local.env'
}
$signerDirectory = Join-Path $env:LOCALAPPDATA 'WarMachines\settlement-signers'
$publicAddressFile = Join-Path $signerDirectory 'public-addresses.txt'

if (-not (Test-Path -LiteralPath $forgeCast)) {
    throw "Tempo Foundry was not found at $forgeCast"
}
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Missing $ConfigPath. First run .\scripts\deploy-tempo-escrow.ps1 -Initialize"
}
New-Item -ItemType Directory -Force -Path $signerDirectory | Out-Null

function Get-ResultSignerAddress([string]$Name) {
    $path = Join-Path $signerDirectory $Name
    if (Test-Path -LiteralPath $path) {
        Write-Host "Reusing existing $Name. Foundry will ask for its password to read the public address."
        $output = & $forgeCast wallet address --keystore $path 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Foundry could not read $Name" }
    } else {
        Write-Host "Creating $Name. Foundry will ask for a password locally."
        Write-Host 'Use a strong, unique password and store it in your password manager.'
        $output = & $forgeCast wallet new $signerDirectory $Name 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Foundry could not create $Name" }
    }
    $output | ForEach-Object { Write-Host $_ }
    $addressLine = $output | Where-Object { $_ -match '(0x[0-9a-fA-F]{40})' } | Select-Object -Last 1
    if (-not $addressLine -or $addressLine -notmatch '(0x[0-9a-fA-F]{40})') {
        throw "Foundry did not return a public address for $Name"
    }
    return $Matches[1]
}

try {
    $guardian = Get-ResultSignerAddress 'war-machines-pause-guardian'
    $signerOne = Get-ResultSignerAddress 'war-machines-result-signer-1'
    $signerTwo = Get-ResultSignerAddress 'war-machines-result-signer-2'
} catch {
    Write-Error 'Signer creation stopped. Do not delete any existing keystore; it may be the only copy of that signer.'
    throw
}

if ($guardian -ieq $signerOne -or $guardian -ieq $signerTwo -or $signerOne -ieq $signerTwo) {
    throw 'Guardian and signer addresses unexpectedly matched; no deployment configuration was changed.'
}

$config = Get-Content -LiteralPath $ConfigPath -Raw
if ($config -notmatch '(?m)^WM_ESCROW_PAUSE_GUARDIAN=0x0000000000000000000000000000000000000000$' -or
    $config -notmatch '(?m)^WM_ESCROW_SIGNER_1=0x0000000000000000000000000000000000000000$' -or
    $config -notmatch '(?m)^WM_ESCROW_SIGNER_2=0x0000000000000000000000000000000000000000$') {
    throw "Guardian or signer placeholders in $ConfigPath were already changed. Public addresses are in $publicAddressFile; update the configuration manually."
}
$config = $config -replace '(?m)^WM_ESCROW_PAUSE_GUARDIAN=.*$', "WM_ESCROW_PAUSE_GUARDIAN=$guardian"
$config = $config -replace '(?m)^WM_ESCROW_SIGNER_1=.*$', "WM_ESCROW_SIGNER_1=$signerOne"
$config = $config -replace '(?m)^WM_ESCROW_SIGNER_2=.*$', "WM_ESCROW_SIGNER_2=$signerTwo"
Set-Content -LiteralPath $ConfigPath -Value $config -NoNewline
@(
    'War Machines settlement signer public addresses',
    "pause_guardian=$guardian",
    "signer_1=$signerOne",
    "signer_2=$signerTwo",
    'These addresses have no funds and cannot move escrow funds alone.',
    'The encrypted keystores in this folder are the only signing material. Back them up securely.'
) | Set-Content -LiteralPath $publicAddressFile

Write-Host ''
Write-Host 'One encrypted, zero-balance pause guardian and two result signer identities were created.'
Write-Host "Guardian: $guardian"
Write-Host "Signer 1: $signerOne"
Write-Host "Signer 2: $signerTwo"
Write-Host "Public addresses were written to $publicAddressFile"
Write-Host "Deployment configuration was updated at $ConfigPath"
Write-Host 'Next, run the preview command with your one funded burner deployer address.'
