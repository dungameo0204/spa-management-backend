[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend',
    [string]$MySqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin',
    [string]$R2ConfigPath = 'C:\SpaBackend\config\r2-backup.json',
    [ValidatePattern('^\d{2}:\d{2}$')][string]$DailyAt = '01:30',
    [string]$TaskName = 'SpaRosaBackupToR2'
)

. "$PSScriptRoot\Common-SpaBackend.ps1"
Assert-Administrator

$scriptPath = Join-Path $Root 'current\scripts\windows\Backup-SpaRosaToR2.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Backup script not found: $scriptPath" }
if (-not (Test-Path -LiteralPath $R2ConfigPath -PathType Leaf)) { throw "Create protected R2 configuration first: $R2ConfigPath" }

$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`" -Root `"$Root`" -MySqlBin `"$MySqlBin`" -R2ConfigPath `"$R2ConfigPath`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($DailyAt, 'HH:mm', $null))
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Creates Rosa MySQL backup, uploads it to Cloudflare R2, and applies retention.' -Force | Out-Null
Write-Host "Scheduled backup task installed: $TaskName at $DailyAt every day." -ForegroundColor Green