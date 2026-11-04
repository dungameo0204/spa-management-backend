[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$OutputDirectory,
    [string]$PackageName = 'SpaBackendBootstrap_SpaRosaProduction',
    [string]$BackendTag = 'backend-spatestrosa-v1.0.2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptRepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $RepositoryRoot) { $RepositoryRoot = $scriptRepositoryRoot }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $scriptRepositoryRoot 'artifacts' }
if ($PackageName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { throw 'PackageName contains unsupported characters.' }
if ($BackendTag -notmatch '^backend-spatestrosa-v\d+\.\d+\.\d+$') { throw 'BackendTag must be an exact Rosa release tag.' }

$files = [ordered]@{
    'deploy\bootstrap\sparosa-production\README_FIRST.md' = 'README_FIRST.md'
    'deploy\bootstrap\sparosa-production\INSTALL_PRODUCTION.md' = 'INSTALL_PRODUCTION.md'
    'deploy\bootstrap\sparosa-production\.env.example' = '.env.example'
    'deploy\bootstrap\sparosa-production\r2-backup.example.json' = 'r2-backup.example.json'
    'deploy\bootstrap\sparosa-production\mysql-initialize-rosa.sql' = 'mysql-initialize-rosa.sql'
    'deploy\bootstrap\sparosa-production\db_system_master.production.sql' = 'db_system_master.production.sql'
    'deploy\bootstrap\sparosa-production\db_spa_template.schema.sql' = 'db_spa_template.schema.sql'
    'deploy\windows\SpaBackend.xml' = 'deploy\windows\SpaBackend.xml'
    'scripts\windows\Common-SpaBackend.ps1' = 'scripts\windows\Common-SpaBackend.ps1'
    'scripts\windows\Deploy-SpaBackend.ps1' = 'scripts\windows\Deploy-SpaBackend.ps1'
    'scripts\windows\Install-SpaBackendService.ps1' = 'scripts\windows\Install-SpaBackendService.ps1'
    'scripts\windows\Check-SpaBackendUpdate.ps1' = 'scripts\windows\Check-SpaBackendUpdate.ps1'
    'scripts\windows\Install-SpaBackendAutoUpdate.ps1' = 'scripts\windows\Install-SpaBackendAutoUpdate.ps1'
    'scripts\windows\Rollback-SpaBackend.ps1' = 'scripts\windows\Rollback-SpaBackend.ps1'
    'scripts\windows\Backup-SpaRosaDatabase.ps1' = 'scripts\windows\Backup-SpaRosaDatabase.ps1'
    'scripts\windows\Backup-SpaRosaToR2.ps1' = 'scripts\windows\Backup-SpaRosaToR2.ps1'
    'scripts\windows\Install-SpaRosaBackupTask.ps1' = 'scripts\windows\Install-SpaRosaBackupTask.ps1'
    'scripts\windows\New-SpaRosaSuperAdminSql.ps1' = 'scripts\windows\New-SpaRosaSuperAdminSql.ps1'
}

$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) "$PackageName-$([guid]::NewGuid().ToString('N'))"
$packageRoot = Join-Path $stagingRoot $PackageName
$zipPath = Join-Path $OutputDirectory "$PackageName.zip"
$checksumPath = "$zipPath.sha256"
try {
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    foreach ($entry in $files.GetEnumerator()) {
        $source = Join-Path $RepositoryRoot $entry.Key
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required Rosa production bootstrap file is missing: $source" }
        $destination = Join-Path $packageRoot $entry.Value
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
    $manifestFiles = Get-ChildItem -LiteralPath $packageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    }
    [ordered]@{
        package = $PackageName; environment = 'Rosa Production'; serverId = 'sparosa-production'; initialBackendTag = $BackendTag
        tagPattern = 'backend-spatestrosa-v*'; apiOrigin = 'https://api-spa-rosa.infinityhavocx.men'
        frontendOrigin = 'https://app-spa-rosa.infinityhavocx.men'; containsSensitiveData = $false
        containsTenantData = $false; createdAtUtc = [DateTimeOffset]::UtcNow.ToString('o'); files = @($manifestFiles)
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Encoding UTF8
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    Remove-Item -LiteralPath $zipPath, $checksumPath -Force -ErrorAction SilentlyContinue
    Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
    $zipHash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
    "$($zipHash.Hash)  $($zipHash.Path | Split-Path -Leaf)" | Set-Content -LiteralPath $checksumPath -Encoding ASCII
    Write-Host "Rosa production bootstrap package created: $zipPath" -ForegroundColor Green
    Write-Host "SHA-256: $($zipHash.Hash)" -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}