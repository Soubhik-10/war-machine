[CmdletBinding()]
param(
    [switch]$Initialize,
    [switch]$Broadcast,
    [string]$ConfigPath,
    [string]$DeployerAddress,
    [string]$KeystorePath,
    [string]$ForgePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$contractsRoot = Join-Path $repoRoot 'contracts'
$defaultConfig = Join-Path $contractsRoot 'deployments\tempo-mainnet-v6.local.env'
$exampleConfig = Join-Path $contractsRoot 'deployments\tempo-mainnet-v6.env.example'
$forge = if ($ForgePath) { $ForgePath } else { Join-Path $repoRoot 'work\tooling\foundry\forge.exe' }
if (-not $ConfigPath) { $ConfigPath = $defaultConfig }
if ($Initialize) {
    if (Test-Path -LiteralPath $ConfigPath) { throw "Refusing to overwrite existing local configuration: $ConfigPath" }
    Copy-Item -LiteralPath $exampleConfig -Destination $ConfigPath
    Write-Host "Created public V6 deployment configuration: $ConfigPath"
    exit 0
}
if (-not (Test-Path -LiteralPath $forge)) { throw "Repository Forge executable was not found at $forge" }
try {
    $forgeHelp = (& $forge script --help 2>&1 | Out-String)
} catch {
    throw "Unable to inspect Forge deployment support. Supply -ForgePath to a Tempo Forge build."
}
if ($forgeHelp -notmatch '(?m)--tempo\.fee-token\s+<FEE_TOKEN>') {
    throw "The selected Forge does not expose --tempo.fee-token. Use a Tempo Forge build (or pass its path with -ForgePath); standard Foundry is sufficient for local tests but cannot preview or broadcast this Tempo deployment."
}
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'Missing V6 configuration. Run with -Initialize.' }
if ($Broadcast -and (-not $KeystorePath -or -not (Test-Path -LiteralPath $KeystorePath))) { throw 'Broadcast requires an existing encrypted deployer keystore with -KeystorePath.' }
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
    if (-not $value -or $value -notmatch '^0x[0-9a-fA-F]{40}$' -or $value -eq '0x0000000000000000000000000000000000000000') { throw "$Name must be a non-zero public address." }
    return $value.ToLowerInvariant()
}
Import-PublicEnv $ConfigPath
$guardian = Require-Address 'WM_ESCROW_PAUSE_GUARDIAN'
$relayer = Require-Address 'WM_ESCROW_AGENT_RELAYER'
$signer = Require-Address 'WM_ESCROW_SETTLEMENT_SIGNER'
if ($guardian -eq $relayer -or $guardian -eq $signer -or $relayer -eq $signer) { throw 'Guardian, relayer and signer must be distinct public addresses.' }
$window = [int][Environment]::GetEnvironmentVariable('WM_ESCROW_ATTEMPT_WINDOW_SECONDS', 'Process')
if ($window -lt 480 -or $window -gt 3600) { throw 'WM_ESCROW_ATTEMPT_WINDOW_SECONDS must be between 480 and 3600.' }

Write-Host 'Tempo Mainnet V6 bounty escrow configuration (one trusted settlement signer)'
Write-Host "  deployer: $DeployerAddress"
Write-Host '  token:    0x20C0000000000000000000000000000000000000 (pathUSD)'
Write-Host "  guardian: $guardian"
Write-Host "  relayer:  $relayer"
Write-Host "  signer:   $signer (1-of-1)"
Write-Host "  window:   $window seconds; grace: 120 seconds"

$forgeArgs = @('script', 'script/DeployWarMachineBountyEscrowV6.s.sol:DeployWarMachineBountyEscrowV6', '--root', $contractsRoot, '--rpc-url', 'https://rpc.tempo.xyz', '--sender', $DeployerAddress, '--tempo.fee-token', '0x20C0000000000000000000000000000000000000')
if ($Broadcast) {
    if ((Read-Host 'Type DEPLOY to unlock the encrypted deployer keystore and broadcast to Tempo Mainnet') -cne 'DEPLOY') { Write-Host 'Deployment cancelled before any signing prompt.'; exit 0 }
    $forgeArgs += @('--keystore', $KeystorePath, '--broadcast', '--verify', '--verifier-url', 'https://contracts.tempo.xyz')
} else { Write-Host 'Preview only: no transaction will be sent. No deployer keystore is required. Verify Tempo RPC and Forge compatibility before any broadcast.' }
Push-Location $contractsRoot
try { & $forge @forgeArgs; if ($LASTEXITCODE -ne 0) { throw "Forge exited with code $LASTEXITCODE" } } finally { Pop-Location }
