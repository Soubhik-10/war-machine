param(
  [Parameter(Mandatory=$true)][string]$AttemptId,
  [string]$Origin = 'http://127.0.0.1:8770',
  [string]$SignerOnePath = (Join-Path $env:LOCALAPPDATA 'WarMachines\settlement-signers\signer-1'),
  [string]$SignerTwoPath = (Join-Path $env:LOCALAPPDATA 'WarMachines\settlement-signers\signer-2')
)

$ErrorActionPreference = 'Stop'
if ($Origin -notmatch '^https?://[^/]+$') { throw 'Origin must be an http(s) origin without a trailing path.' }
if ($AttemptId -notmatch '^[a-f0-9-]{36}$') { throw 'AttemptId must be a UUID.' }
if (-not (Get-Command cast -ErrorAction SilentlyContinue)) { throw 'Foundry cast is required and was not found on PATH.' }
if (-not (Test-Path -LiteralPath $SignerOnePath) -or -not (Test-Path -LiteralPath $SignerTwoPath)) { throw 'Both encrypted signer keystores are required. Use the paths printed by create-escrow-result-signers.ps1.' }

$info = Invoke-RestMethod -Uri "$Origin/api/attempts/$AttemptId/settlement" -Method Get
if ($info.status -ne 'awaiting-signatures') { throw "Attempt is $($info.status), not awaiting result signatures." }
$deadline = [Int64]$info.settlement.validUntil
if ($deadline -le [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) { throw 'The attestation window has expired. The challenger can call refundTimedOutAttempt.' }

$typedDataPath = Join-Path ([IO.Path]::GetTempPath()) "war-machines-settlement-$AttemptId.json"
try {
  $info.typedData | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $typedDataPath -Encoding utf8NoBOM
  Write-Host 'Review the result hash, bounty ID, attempt nonce and expiry before each local keystore prompt.' -ForegroundColor Yellow
  $signatureOne = (& cast wallet sign --data --from-file $typedDataPath --keystore $SignerOnePath).Trim()
  $signatureTwo = (& cast wallet sign --data --from-file $typedDataPath --keystore $SignerTwoPath).Trim()
  $payload = @{ signatures = @($signatureOne, $signatureTwo) } | ConvertTo-Json -Compress
  $prepared = Invoke-RestMethod -Uri "$Origin/api/attempts/$AttemptId/attestations" -Method Post -ContentType 'application/json' -Body $payload
  if (-not $prepared.direct -or $prepared.kind -ne 'settle-attempt') { throw 'The service did not return a direct escrow settlement plan.' }
  Write-Host 'Two signatures were accepted. Open the attempt in the browser and select “Settle onchain”.' -ForegroundColor Green
  Write-Host 'This script never broadcasts a transaction or reads a private key into the site.' -ForegroundColor Green
}
finally {
  if (Test-Path -LiteralPath $typedDataPath) { Remove-Item -LiteralPath $typedDataPath -Force }
}
