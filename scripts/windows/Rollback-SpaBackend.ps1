[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend',
    [string]$HealthUri = 'http://127.0.0.1:5000/health'
)

. "$PSScriptRoot\Common-SpaBackend.ps1"
Assert-Administrator

$statePath = Join-Path $Root 'state\deployment.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw "Deployment state was not found: $statePath" }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if (-not $state.previousVersion) { throw 'There is no previousVersion to roll back to.' }

$currentPath = Join-Path $Root 'current'
$targetPath = Join-Path $Root "releases\$($state.previousVersion)"
$serviceExe = Join-Path $Root 'service\SpaBackend.exe'
$oldCurrent = $state.currentVersion

Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('stop')
Set-ReleaseJunction -CurrentPath $currentPath -TargetPath $targetPath
try {
    Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('start')
    Wait-BackendHealth -Uri $HealthUri
    Write-DeploymentState -StatePath $statePath -ServerId $state.serverId -CurrentVersion $state.previousVersion -PreviousVersion $oldCurrent -RepositoryUrl $state.repositoryUrl
    Write-Host "Successfully rolled back to $($state.previousVersion)." -ForegroundColor Green
} catch {
    & $serviceExe stop | Out-Null
    Set-ReleaseJunction -CurrentPath $currentPath -TargetPath (Join-Path $Root "releases\$oldCurrent")
    & $serviceExe start | Out-Null
    throw
}