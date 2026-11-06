[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$ServerId,
    [string]$RepositoryUrl = 'https://github.com/dungameo0204/spa-management-backend.git',
    [string]$Root = 'C:\SpaBackend',
    [string]$HealthUri = 'http://127.0.0.1:5000/health'
)

. "$PSScriptRoot\Common-SpaBackend.ps1"
Assert-Administrator
Assert-SafeVersion -Version $Version

$lockPath = Join-Path $Root 'state\deploy.lock'
$statePath = Join-Path $Root 'state\deployment.json'
$releasePath = Join-Path $Root "releases\$Version"
$currentPath = Join-Path $Root 'current'
$serviceExe = Join-Path $Root 'service\SpaBackend.exe'
$backupScript = Join-Path $releasePath 'scripts\windows\Backup-SpaDatabase.ps1'
$migrationRunner = Join-Path $releasePath 'scripts\apply-release-migrations.js'

New-Item -ItemType Directory -Path (Join-Path $Root 'releases') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Root 'state') -Force | Out-Null
if (Test-Path -LiteralPath $lockPath) { throw "A deployment lock already exists: $lockPath" }
New-Item -ItemType File -Path $lockPath -Force | Out-Null

$previousPath = $null
$previousVersion = $null
$serviceWasRunning = $false
try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git was not found in PATH.' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd was not found in PATH.' }
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'config\.env') -PathType Leaf)) { throw "Missing $Root\config\.env" }

    $tagRef = "refs/tags/$Version"
    $remoteTag = & git ls-remote --tags --refs $RepositoryUrl $tagRef
    if ($LASTEXITCODE -ne 0 -or -not $remoteTag) { throw "Exact tag '$Version' was not found at $RepositoryUrl" }

    if (-not (Test-Path -LiteralPath $releasePath)) {
        Invoke-CheckedCommand -FilePath 'git' -ArgumentList @('clone', '--depth', '1', '--branch', $Version, '--single-branch', $RepositoryUrl, $releasePath)
        Push-Location $releasePath
        try { Invoke-CheckedCommand -FilePath 'npm.cmd' -ArgumentList @('ci', '--omit=dev', '--ignore-scripts') }
        finally { Pop-Location }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $releasePath 'src\server.js') -PathType Leaf)) {
        throw "Invalid release: src\server.js is missing from $releasePath"
    }
    if (-not (Test-Path -LiteralPath $migrationRunner -PathType Leaf)) {
        throw "Invalid release: migration runner is missing from $releasePath"
    }
    if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) {
        throw "Invalid release: backup script is missing from $releasePath"
    }
    $nodeExe = Join-Path $Root 'runtime\node\node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { $nodeExe = 'node.exe' }
    $migrationPlanRaw = & $nodeExe $migrationRunner --release-path $releasePath --root $Root --plan
    if ($LASTEXITCODE -ne 0) { throw "Migration planning failed for $Version" }
    try { $migrationPlan = $migrationPlanRaw | ConvertFrom-Json } catch { throw "Migration runner returned invalid plan output: $migrationPlanRaw" }
    $migrationRequired = [bool]$migrationPlan.requiresMigration

    $previousPath = Get-CurrentReleasePath -CurrentPath $currentPath
    if ($previousPath) { $previousVersion = Split-Path $previousPath -Leaf }
    $service = Get-Service -Name 'SpaBackend' -ErrorAction SilentlyContinue
    $serviceWasRunning = $service -and $service.Status -ne 'Stopped'
    if ($serviceWasRunning) {
        if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) { throw "Service wrapper is missing: $serviceExe" }
        Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('stop')
    }

    if ($migrationRequired) {
        Write-Host "Pending schema migrations detected for $Version. Creating backup before migration." -ForegroundColor Yellow
        Invoke-CheckedCommand -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $backupScript, '-Root', $Root)
        $migrationApplyRaw = & $nodeExe $migrationRunner --release-path $releasePath --root $Root --apply
        if ($LASTEXITCODE -ne 0) { throw "Migration apply failed for $Version" }
        try { $migrationApply = $migrationApplyRaw | ConvertFrom-Json } catch { throw "Migration runner returned invalid apply output: $migrationApplyRaw" }
        Write-Host "Schema migrations completed: $($migrationApply | ConvertTo-Json -Compress)" -ForegroundColor Green
    }

    Set-ReleaseJunction -CurrentPath $currentPath -TargetPath $releasePath
    if ($service) {
        Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('start')
        Wait-BackendHealth -Uri $HealthUri
    }
    Write-DeploymentState -StatePath $statePath -ServerId $ServerId -CurrentVersion $Version -PreviousVersion $previousVersion -RepositoryUrl $RepositoryUrl
    Write-Host "Successfully deployed $Version on server '$ServerId'." -ForegroundColor Green
} catch {
    $deployError = $_
    Write-Warning "Deployment failed: $($deployError.Exception.Message)"
    if ($previousPath -and (Test-Path -LiteralPath $previousPath -PathType Container)) {
        try {
            $service = Get-Service -Name 'SpaBackend' -ErrorAction SilentlyContinue
            if ($service -and $service.Status -ne 'Stopped') { & $serviceExe stop | Out-Null }
            Set-ReleaseJunction -CurrentPath $currentPath -TargetPath $previousPath
            if ($serviceWasRunning) {
                Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('start')
                Wait-BackendHealth -Uri $HealthUri
            }
            Write-Warning "The junction was rolled back to $previousVersion."
        } catch {
            Write-Warning "Automatic rollback also failed: $($_.Exception.Message)"
        }
    }
    throw $deployError
} finally {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}