[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$configPath = Join-Path $Root 'config\auto-update.json'
$statePath = Join-Path $Root 'state\deployment.json'
$logPath = Join-Path $Root 'logs\auto-update.log'
$deployScript = Join-Path $Root 'current\scripts\windows\Deploy-SpaBackend.ps1'

function Write-UpdateLog {
    param([Parameter(Mandatory)][string]$Message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ssK') $Message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    Write-Host $line
}

New-Item -ItemType Directory -Path (Split-Path $logPath -Parent) -Force | Out-Null

try {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "Auto-update configuration not found: $configPath" }
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw "Deployment state not found: $statePath" }
    if (-not (Test-Path -LiteralPath $deployScript -PathType Leaf)) { throw "Deploy script not found in current release: $deployScript" }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git was not found in PATH.' }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    foreach ($name in @('repositoryUrl', 'tagPattern', 'serverId', 'healthUri')) {
        if (-not $config.$name -or -not $config.$name.Trim()) { throw "Missing '$name' in $configPath" }
    }
    if ($config.tagPattern -notmatch '^[A-Za-z0-9][A-Za-z0-9._*?-]{0,79}$') {
        throw 'tagPattern contains unsupported characters.'
    }

    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $remoteRefs = @(& git ls-remote --tags --refs --sort=-version:refname $config.repositoryUrl $config.tagPattern)
    if ($LASTEXITCODE -ne 0) { throw "Could not query tags from $($config.repositoryUrl)" }
    $remoteRefs = @($remoteRefs | Where-Object { $_ -match '\srefs/tags/' })
    if ($remoteRefs.Count -eq 0) {
        Write-UpdateLog "No tag matches '$($config.tagPattern)'; no deployment was performed."
        exit 0
    }

    $versions = @($remoteRefs | ForEach-Object { ($_ -split '\s+', 2)[1] -replace '^refs/tags/', '' })
    $latestVersion = $versions[0]
    if ($latestVersion -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { throw "Unsafe tag returned by remote: $latestVersion" }

    if ($state.currentVersion -eq $latestVersion) {
        Write-UpdateLog "Already current: $latestVersion"
        exit 0
    }

    $currentMatchesChannel = $state.currentVersion -like $config.tagPattern
    if ($currentMatchesChannel -and $versions -notcontains $state.currentVersion) {
        throw "Current tag '$($state.currentVersion)' disappeared from the configured channel. Refusing an automatic downgrade."
    }

    Write-UpdateLog "Deploying $latestVersion (current: $($state.currentVersion), pattern: $($config.tagPattern))."
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $deployScript `
        -Version $latestVersion `
        -ServerId $config.serverId `
        -RepositoryUrl $config.repositoryUrl `
        -Root $Root `
        -HealthUri $config.healthUri
    if ($LASTEXITCODE -ne 0) { throw "Deploy script exited with code $LASTEXITCODE" }
    Write-UpdateLog "Deployment completed: $latestVersion"
} catch {
    Write-UpdateLog "ERROR: $($_.Exception.Message)"
    throw
}