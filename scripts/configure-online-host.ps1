[CmdletBinding()]
param(
  [string]$OpenAIApiKey = $env:OPENAI_API_KEY,
  [switch]$EnableFunnel,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverEnvironmentPath = Join-Path $projectRoot ".env.docker.local"
$clientEnvironmentPath = Join-Path $projectRoot ".env.client.local"
$composePath = Join-Path $projectRoot "compose.online.yaml"
$localOrigin = "http://127.0.0.1:4311"
$gatewayKeyName = "Online Host Default"

function New-RandomSecret([int]$byteCount = 32) {
  $bytes = New-Object byte[] $byteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Read-EnvironmentFile([string]$path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $values }
  foreach ($line in [IO.File]::ReadAllLines($path)) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) { continue }
    $separator = $line.IndexOf("=")
    if ($separator -lt 1) { continue }
    $values[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
  }
  return $values
}

function Assert-SingleLine([string]$name, [string]$value) {
  if ($null -ne $value -and $value -match "[\r\n]") {
    throw "$name must be a single-line value."
  }
}

function Wait-ForHealth([string]$origin) {
  $lastError = $null
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    try {
      $response = Invoke-RestMethod -Uri "$origin/health" -TimeoutSec 3
      if ($response.status -eq "ok") { return }
    } catch {
      $lastError = $_
    }
    Start-Sleep -Seconds 1
  }
  if ($lastError) { throw "Container health check failed: $($lastError.Exception.Message)" }
  throw "Container health check failed."
}

function Get-TailscaleCommand {
  $installed = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $installed) { return $installed }
  $command = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "Tailscale CLI was not found."
}

Assert-SingleLine "OPENAI_API_KEY" $OpenAIApiKey
$existing = Read-EnvironmentFile $serverEnvironmentPath
$apiToken = if ($existing.API_TOKEN) { $existing.API_TOKEN } else { New-RandomSecret 36 }
$encryptionKey = if ($existing.API_KEY_ENCRYPTION_KEY) {
  $existing.API_KEY_ENCRYPTION_KEY
} else {
  New-RandomSecret 36
}
$modelCredential = if ($OpenAIApiKey) { $OpenAIApiKey } else { $existing.OPENAI_API_KEY }

$serverEnvironment = @(
  "# Local-only Docker secrets. This file is ignored by Git and Docker build context."
  "HOST=0.0.0.0"
  "PORT=4310"
  "AUTH_MODE=token"
  "API_TOKEN=$apiToken"
  "API_KEY_ENCRYPTION_KEY=$encryptionKey"
  "API_KEY_STORE_PATH=/data/api-keys.json"
  "USAGE_STORE_PATH=/data/usage-stats.json"
  "ALLOWED_PROJECT_ROOTS=/workspaces"
  "ALLOW_DANGEROUS_TASKS=false"
  "ALLOW_TASK_NETWORK=false"
  "OPENAI_API_KEY=$modelCredential"
)
[IO.File]::WriteAllLines($serverEnvironmentPath, $serverEnvironment, [Text.UTF8Encoding]::new($false))

$composeArguments = @("compose", "-f", $composePath, "up", "-d")
if (-not $SkipBuild) { $composeArguments += "--build" }
& docker @composeArguments
if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed with exit code $LASTEXITCODE." }

Wait-ForHealth $localOrigin
$adminHeaders = @{ Authorization = "Bearer $apiToken" }
$keys = Invoke-RestMethod -Uri "$localOrigin/api/v1/api-keys" -Headers $adminHeaders -TimeoutSec 10
$keyRecord = @($keys.apiKeys) | Where-Object { $_.name -eq $gatewayKeyName } | Select-Object -First 1
if ($keyRecord) {
  $revealed = Invoke-RestMethod `
    -Uri "$localOrigin/api/v1/api-keys/$($keyRecord.id)/secret" `
    -Headers $adminHeaders `
    -TimeoutSec 10
  $gatewayKey = $revealed.key
} else {
  $payload = @{
    name = $gatewayKeyName
    model = "gpt-5.6-sol"
    effort = "high"
    speed = "standard"
    permission = "read-only"
  } | ConvertTo-Json
  $created = Invoke-RestMethod `
    -Method Post `
    -Uri "$localOrigin/api/v1/api-keys" `
    -Headers $adminHeaders `
    -ContentType "application/json" `
    -Body $payload `
    -TimeoutSec 10
  $gatewayKey = $created.key
}

$models = Invoke-RestMethod `
  -Uri "$localOrigin/v1/models" `
  -Headers @{ Authorization = "Bearer $gatewayKey" } `
  -TimeoutSec 10
if ($models.object -ne "list" -or @($models.data).Count -lt 1) {
  throw "OpenAI-compatible model discovery failed."
}

$publicBaseUrl = ""
if ($EnableFunnel) {
  if (-not $modelCredential) {
    throw "OPENAI_API_KEY is missing. The local Host is ready, but Funnel was left disabled."
  }
  $tailscale = Get-TailscaleCommand
  $funnelStatusText = (& $tailscale funnel status --json | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Tailscale Funnel status failed with exit code $LASTEXITCODE." }
  if ($funnelStatusText) {
    $funnelStatus = $funnelStatusText | ConvertFrom-Json
    if ($null -ne $funnelStatus.Web) {
      foreach ($webEntry in @($funnelStatus.Web.PSObject.Properties)) {
        $handlers = $webEntry.Value.Handlers
        if ($null -eq $handlers) { continue }
        $rootHandler = $handlers.PSObject.Properties["/"]
        if ($null -eq $rootHandler) { continue }
        $proxyTarget = [string]$rootHandler.Value.Proxy
        if ($proxyTarget -and $proxyTarget.TrimEnd("/") -ne $localOrigin) {
          throw "HTTPS port 443 already funnels to $proxyTarget. Refusing to overwrite another service."
        }
      }
    }
  }
  & $tailscale funnel --bg --yes --https=443 $localOrigin
  if ($LASTEXITCODE -ne 0) { throw "Tailscale Funnel failed with exit code $LASTEXITCODE." }
  $status = & $tailscale status --json | ConvertFrom-Json
  $dnsName = [string]$status.Self.DNSName
  if (-not $dnsName) { throw "Tailscale did not return a device DNS name." }
  $publicBaseUrl = "https://$($dnsName.TrimEnd('.'))/v1"
}

$clientEnvironment = @(
  "# Keep this file private. Give third parties only the two values they need."
  "OPENAI_BASE_URL=$(if ($publicBaseUrl) { $publicBaseUrl } else { "$localOrigin/v1" })"
  "OPENAI_API_KEY=$gatewayKey"
)
[IO.File]::WriteAllLines($clientEnvironmentPath, $clientEnvironment, [Text.UTF8Encoding]::new($false))

Write-Host "Codex SDK V2 Docker Host is healthy at $localOrigin."
Write-Host "OpenAI-compatible GET /v1/models succeeded."
Write-Host "Private server settings: $serverEnvironmentPath"
Write-Host "Private client settings: $clientEnvironmentPath"
if ($publicBaseUrl) {
  Write-Host "Tailscale Funnel base_url: $publicBaseUrl"
} elseif (-not $modelCredential) {
  Write-Warning "OPENAI_API_KEY is not configured, so model calls and public Funnel remain disabled."
} else {
  Write-Host "Funnel was not requested. Run this script again with -EnableFunnel when ready."
}
