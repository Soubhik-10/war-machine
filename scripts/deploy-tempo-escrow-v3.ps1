[CmdletBinding()]
param(
    [switch]$Initialize,
    [switch]$Broadcast,
    [string]$ConfigPath,
    [string]$DeployerAddress,
    [string]$KeystorePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$contractsRoot = Join-Path $repoRoot 'contracts'
$defaultConfig = Join-Path $contractsRoot 'deployments\tempo-mainnet-v3.local.env'
$exampleConfig = Join-Path $contractsRoot 'deployments\tempo-mainnet-v3.env.example'
$forge = Join-Path $repoRoot 'work\tooling\foundry\forge.exe'

if (-not $ConfigPath) { $ConfigPath = $defaultConfig }
if ($Initialize) {
    if (Test-Path -LiteralPath $ConfigPath) { throw "Refusing to overwrite existing local configuration: $ConfigPath" }
    Copy-Item -LiteralPath $exampleConfig -Destination $ConfigPath
    Write-Host "Created public V3 deployment configuration: $ConfigPath"
    Write-Host 'Set a pause guardian and the public address for the automatic settlement wallet.'
    exit 0
}
if (-not (Test-Path -LiteralPath $forge)) { throw "Tempo Foundry was not found at $forge" }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Missing $ConfigPath. Run: .\scripts\deploy-tempo-escrow-v3.ps1 -Initialize" }
if (-not $KeystorePath -or -not (Test-Path -LiteralPath $KeystorePath)) { throw 'Pass an existing encrypted deployer keystore with -KeystorePath.' }
if (-not $DeployerAddress -or $DeployerAddress -notmatch '^0x[0-9a-fA-F]{40}$') { throw 'Pass the public deployer address with -DeployerAddress 0x...' }

function Import-PublicEnv([string]$Path) {
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $pair = $line -split '=', 2
        if ($pair.Count -ne 2 -or $pair[0] -notmatch '^[A-Z0-9_]+$') { throw "Invalid configuration line: $line" }
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
$signer = Require-Address 'WM_ESCROW_SETTLEMENT_SIGNER'
if ($guardian -eq $signer) { throw 'The pause guardian and settlement signer must be different addresses.' }
$window = [int][Environment]::GetEnvironmentVariable('WM_ESCROW_ATTEMPT_WINDOW_SECONDS', 'Process')
if ($window -lt 480 -or $window -gt 3600) { throw 'WM_ESCROW_ATTEMPT_WINDOW_SECONDS must be between 480 and 3600.' }
if ($DeployerAddress.ToLowerInvariant() -in @($guardian, $signer)) { throw 'The deployer must be distinct from the guardian and settlement signer.' }

Write-Host 'Tempo Mainnet V3 bounty escrow configuration'
Write-Host "  deployer: $DeployerAddress"
Write-Host '  token:    0x20C0000000000000000000000000000000000000 (pathUSD)'
Write-Host "  guardian: $guardian"
Write-Host "  signer:   $signer (1-of-1 automatic settlement)"
Write-Host "  window:   $window seconds"
Write-Host '  fee:      fixed at 2.5% of a winning reward to 0xc20131e9132888993de6519D486E5558A5DbCb7A'
Write-Host '  timeout:  no challenger refund; entry is forfeited to the bounty creator'

$forgeArgs = @(
    'script', 'script/DeployWarMachineBountyEscrowV3.s.sol:DeployWarMachineBountyEscrowV3',
    '--root', $contractsRoot,
    '--rpc-url', 'https://rpc.tempo.xyz',
    '--sender', $DeployerAddress
)
if ($Broadcast) {
    if ((Read-Host 'Type DEPLOY to unlock the encrypted deployer keystore and broadcast to Tempo Mainnet') -cne 'DEPLOY') {
        Write-Host 'Deployment cancelled before any signing prompt.'
        exit 0
    }
    $forgeArgs += @('--keystore', $KeystorePath, '--broadcast', '--verify', '--verifier-url', 'https://contracts.tempo.xyz')
} else {
    Write-Host 'Preview only: no transaction will be sent. Add -Broadcast after reviewing these values.'
}

Push-Location $contractsRoot
try {
    & $forge @forgeArgs
    if ($LASTEXITCODE -ne 0) { throw "Forge exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
