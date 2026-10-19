[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ServerId,
    [Parameter(Mandatory)][string]$TagPattern,
    [string]$RepositoryUrl = 'https://github.com/dungameo0204/spa-management-backend.git',
    [string]$Root = 'C:\SpaBackend',
    [string]$HealthUri = 'http://127.0.0.1:5000/health',
    [ValidateRange(5, 1440)][int]$IntervalMinutes = 15,
    [string]$TaskName = 'SpaBackendAutoUpdate'
)

. "$PSScriptRoot\Common-SpaBackend.ps1"
Assert-Administrator

if ($ServerId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { throw 'ServerId contains unsupported characters.' }
if ($TagPattern -notmatch '^[A-Za-z0-9][A-Za-z0-9._*?-]{0,79}$') { throw 'TagPattern contains unsupported characters.' }

$updateScript = Join-Path $Root 'current\scripts\windows\Check-SpaBackendUpdate.ps1'
$statePath = Join-Path $Root 'state\deployment.json'
$configPath = Join-Path $Root 'config\auto-update.json'
if (-not (Test-Path -LiteralPath $updateScript -PathType Leaf)) { throw "Auto-update script not found in current release: $updateScript" }
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw "Deploy the first release before enabling auto-update: $statePath" }

$config = [ordered]@{
    serverId = $ServerId
    repositoryUrl = $RepositoryUrl
    tagPattern = $TagPattern
    healthUri = $HealthUri
    intervalMinutes = $IntervalMinutes
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$updateScript`" -Root `"$Root`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Deploy the newest Git tag matching $TagPattern for Spa Backend." -Force | Out-Null

Write-Host "Auto-update task installed: $TaskName" -ForegroundColor Green
Write-Host "Tag pattern: $TagPattern; interval: $IntervalMinutes minutes" -ForegroundColor Green
Write-Host "Configuration: $configPath" -ForegroundColor Green