[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string]$OutputDirectory = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path 'artifacts'),
    [string]$PackageName = 'SpaBackendBootstrap_SpaTestRosa',
    [string]$BackendTag = 'backend-spatestrosa-v1.0.2'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PackageName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
    throw 'PackageName contains unsupported characters.'
}
if ($BackendTag -notmatch '^backend-spatestrosa-v\d+\.\d+\.\d+$') {
    throw 'BackendTag must be an exact Spa Test Rosa release tag.'
}

$files = [ordered]@{
    'deploy\bootstrap\spatestrosa\README_FIRST.md' = 'README_FIRST.md'
    'deploy\bootstrap\spatestrosa\INSTALL_TEST_ENVIRONMENT.md' = 'INSTALL_TEST_ENVIRONMENT.md'
    'deploy\bootstrap\spatestrosa\.env.example' = '.env.example'
    'db_system_master.sql' = 'db_system_master.sql'
    'db_spa_template.sql' = 'db_spa_template.sql'
    'db_spa_1791039769068_e185.sql' = 'db_spa_1791039769068_e185.sql'
    'deploy\windows\SpaBackend.xml' = 'deploy\windows\SpaBackend.xml'
    'scripts\windows\Common-SpaBackend.ps1' = 'scripts\windows\Common-SpaBackend.ps1'
    'scripts\windows\Deploy-SpaBackend.ps1' = 'scripts\windows\Deploy-SpaBackend.ps1'
    'scripts\windows\Install-SpaBackendService.ps1' = 'scripts\windows\Install-SpaBackendService.ps1'
    'scripts\windows\Check-SpaBackendUpdate.ps1' = 'scripts\windows\Check-SpaBackendUpdate.ps1'
    'scripts\windows\Install-SpaBackendAutoUpdate.ps1' = 'scripts\windows\Install-SpaBackendAutoUpdate.ps1'
    'scripts\windows\Rollback-SpaBackend.ps1' = 'scripts\windows\Rollback-SpaBackend.ps1'
}

$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) "$PackageName-$([guid]::NewGuid().ToString('N'))"
$packageRoot = Join-Path $stagingRoot $PackageName
$zipPath = Join-Path $OutputDirectory "$PackageName.zip"
$checksumPath = "$zipPath.sha256"

try {
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    foreach ($entry in $files.GetEnumerator()) {
        $source = Join-Path $RepositoryRoot $entry.Key
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required Rosa bootstrap file is missing: $source" }
        $destination = Join-Path $packageRoot $entry.Value
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }

    $manifestFiles = Get-ChildItem -LiteralPath $packageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }
    $manifest = [ordered]@{
        package = $PackageName
        environment = 'Spa Test Rosa'
        serverId = 'spatestrosa'
        initialBackendTag = $BackendTag
        tagPattern = 'backend-spatestrosa-v*'
        apiOrigin = 'https://api-spa-testrosa.infinityhavocx.men'
        frontendOrigin = 'https://app-spa-testrosa.infinityhavocx.men'
        tenantDatabase = 'db_spa_1791039769068_e185'
        createdAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
        containsSensitiveData = $true
        files = @($manifestFiles)
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Encoding UTF8

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    Remove-Item -LiteralPath $zipPath, $checksumPath -Force -ErrorAction SilentlyContinue
    Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
    $zipHash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
    "$($zipHash.Hash)  $($zipHash.Path | Split-Path -Leaf)" | Set-Content -LiteralPath $checksumPath -Encoding ASCII

    Write-Host "Spa Test Rosa bootstrap package created: $zipPath" -ForegroundColor Green
    Write-Host "SHA-256: $($zipHash.Hash)" -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}