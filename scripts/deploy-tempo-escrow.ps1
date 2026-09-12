[CmdletBinding()]
param(
    [switch]$Initialize,
    [switch]$Broadcast,
    [switch]$BrowserWallet,
    [string]$ConfigPath,
    [string]$DeployerAddress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$contractsRoot = Join-Path $repoRoot 'contracts'
$defaultConfig = Join-Path $contractsRoot 'deployments\tempo-mainnet.local.env'
$exampleConfig = Join-Path $contractsRoot 'deployments\tempo-mainnet.env.example'
$forge = Join-Path $repoRoot 'work\tooling\foundry\forge.exe'

if (-not $ConfigPath) {
    $ConfigPath = $defaultConfig
}

if ($Initialize) {
    if (Test-Path -LiteralPath $ConfigPath) {
        throw "Refusing to overwrite existing local configuration: $ConfigPath"
    }
    Copy-Item -LiteralPath $exampleConfig -Destination $ConfigPath
    Write-Host "Created local public-address configuration: $ConfigPath"
    Write-Host 'Set the guardian and two independent signer addresses, then run this script again.'
    exit 0
}

if (-not (Test-Path -LiteralPath $forge)) {
    throw "Tempo Foundry was not found at $forge"
}
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Missing $ConfigPath. Run: .\scripts\deploy-tempo-escrow.ps1 -Initialize"
}

function Import-PublicEnv([string]$Path) {
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $pair = $line -split '=', 2
        if ($pair.Count -ne 2 -or $pair[0] -notmatch '^[A-Z0-9_]+$') {
            throw "Invalid configuration line: $line"
        }
        [Environment]::SetEnvironmentVariable($pair[0], $pair[1].Trim(), 'Process')
    }
}

function Require-Address([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not $value -or $value -notmatch '^0x[0-9a-fA-F]{40}$' -or $value -eq '0x0000000000000000000000000000000000000000') {
        throw "$Name must be a non-zero public address."
    }
    return $value.ToLowerInvariant()
}

Import-PublicEnv $ConfigPath
$guardian = Require-Address 'WM_ESCROW_PAUSE_GUARDIAN'
$signerOne = Require-Address 'WM_ESCROW_SIGNER_1'
$signerTwo = Require-Address 'WM_ESCROW_SIGNER_2'

if ($guardian -eq $signerOne -or $guardian -eq $signerTwo -or $signerOne -eq $signerTwo) {
    throw 'Guardian and settlement signers must be three distinct addresses.'
}
if ([Environment]::GetEnvironmentVariable('WM_ESCROW_SIGNER_COUNT', 'Process') -ne '2') {
    throw 'Public deployment requires exactly two settlement signers.'
}
if ([Environment]::GetEnvironmentVariable('WM_ESCROW_SIGNER_QUORUM', 'Process') -ne '2') {
    throw 'Public deployment requires a 2-of-2 settlement quorum.'
}
$window = [int][Environment]::GetEnvironmentVariable('WM_ESCROW_ATTEMPT_WINDOW_SECONDS', 'Process')
if ($window -lt 60 -or $window -gt 3600) {
    throw 'WM_ESCROW_ATTEMPT_WINDOW_SECONDS must be between 60 and 3600.'
}
if (-not $DeployerAddress -or $DeployerAddress -notmatch '^0x[0-9a-fA-F]{40}$') {
    throw 'Pass the public burner wallet with -DeployerAddress 0x...'
}
if ($DeployerAddress.ToLowerInvariant() -in @($guardian, $signerOne, $signerTwo)) {
    throw 'The burner deployer must not be the guardian or either settlement signer.'
}

Write-Host 'Tempo Mainnet bounty escrow configuration'
Write-Host "  deployer: $DeployerAddress"
Write-Host "  token:    0x20C0000000000000000000000000000000000000 (pathUSD)"
Write-Host "  guardian: $guardian"
Write-Host "  signers:  $signerOne, $signerTwo (2-of-2)"
Write-Host "  window:   $window seconds"
Write-Host '  fee:      fixed at 2.5% to 0xc20131e9132888993de6519D486E5558A5DbCb7A'

$forgeArgs = @(
    'script', 'script/DeployWarMachineBountyEscrow.s.sol:DeployWarMachineBountyEscrow',
    '--root', $contractsRoot,
    '--rpc-url', 'https://rpc.tempo.xyz',
    '--sender', $DeployerAddress
)

if ($Broadcast) {
    $signerPrompt = if ($BrowserWallet) {
        'Type DEPLOY to connect Foundry to your browser wallet and broadcast to Tempo Mainnet'
    } else {
        'Type DEPLOY to open the hidden burner-key prompt and broadcast to Tempo Mainnet'
    }
    $confirmation = Read-Host $signerPrompt
    if ($confirmation -cne 'DEPLOY') {
        Write-Host 'Deployment cancelled before any signing prompt.'
        exit 0
    }
    if ($BrowserWallet) {
        $forgeArgs += '--browser'
    } else {
        $forgeArgs += @('--interactives', '1')
    }
    $forgeArgs += @(
        '--broadcast',
        '--verify',
        '--verifier-url', 'https://contracts.tempo.xyz'
    )
} else {
    Write-Host 'Preview only: no transaction will be sent. Add -Broadcast only after reviewing these values.'
}

Push-Location $contractsRoot
try {
    & $forge @forgeArgs
    if ($LASTEXITCODE -ne 0) { throw "Forge exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
