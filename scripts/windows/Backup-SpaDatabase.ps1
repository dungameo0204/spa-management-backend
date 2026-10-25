[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend',
    [string]$MySqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin',
    [int]$RetentionDays = 30
)

. "$PSScriptRoot\Common-SpaBackend.ps1"

$envValues = Get-DotEnvValues -Path (Join-Path $Root 'config\.env')
foreach ($required in @('DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_SYSTEM_NAME')) {
    if (-not $envValues.ContainsKey($required) -or -not $envValues[$required]) { throw "Missing $required in .env" }
}
$mysql = Join-Path $MySqlBin 'mysql.exe'
$mysqldump = Join-Path $MySqlBin 'mysqldump.exe'
if (-not (Test-Path -LiteralPath $mysql -PathType Leaf)) { throw "Not found: $mysql" }
if (-not (Test-Path -LiteralPath $mysqldump -PathType Leaf)) { throw "Not found: $mysqldump" }

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$backupDir = Join-Path $Root "backups\$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$dumpPath = Join-Path $backupDir 'spa-databases.sql'
$oldPassword = $env:MYSQL_PWD
try {
    $env:MYSQL_PWD = $envValues.DB_PASSWORD
    $query = 'SELECT database_name FROM tenants WHERE deleted_at IS NULL ORDER BY id'
    $tenantDatabases = & $mysql --batch --skip-column-names --host=$($envValues.DB_HOST) --user=$($envValues.DB_USER) $envValues.DB_SYSTEM_NAME --execute=$query
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the tenant database list.' }
    $databases = @($envValues.DB_SYSTEM_NAME, 'db_spa_template') + @($tenantDatabases | Where-Object { $_ })
    $databases = $databases | Sort-Object -Unique
    $arguments = @(
        "--host=$($envValues.DB_HOST)", "--user=$($envValues.DB_USER)",
        '--single-transaction', '--routines', '--triggers', '--events',
        '--set-gtid-purged=OFF', "--result-file=$dumpPath", '--databases'
    ) + $databases
    Invoke-CheckedCommand -FilePath $mysqldump -ArgumentList $arguments
    if ((Get-Item -LiteralPath $dumpPath).Length -lt 1024) { throw 'The backup file is unexpectedly small.' }
    $hash = Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256
    "$($hash.Hash)  $($hash.Path | Split-Path -Leaf)" | Set-Content -LiteralPath (Join-Path $backupDir 'SHA256.txt') -Encoding ASCII
    $manifest = [ordered]@{ createdAt = [DateTimeOffset]::Now.ToString('o'); databases = @($databases); dump = 'spa-databases.sql'; sha256 = $hash.Hash }
    $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $backupDir 'manifest.json') -Encoding UTF8

    # Cloudflare R2 Upload if configured
    $r2Config = Join-Path $Root 'config\r2-backup.json'
    $uploader = Join-Path $Root 'current\scripts\upload-backup-r2.js'
    if ((Test-Path -LiteralPath $r2Config -PathType Leaf) -and (Test-Path -LiteralPath $uploader -PathType Leaf)) {
        Write-Host 'Found R2 config. Uploading backup to Cloudflare R2...' -ForegroundColor Cyan
        $nodeExe = Join-Path $Root 'runtime\node\node.exe'
        if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { $nodeExe = 'node' }
        & $nodeExe $uploader --config $r2Config --dump $dumpPath --stamp $stamp
        if ($LASTEXITCODE -ne 0) {
            Write-Warning ('Cloudflare R2 upload failed with exit code ' + $LASTEXITCODE)
        }
    }
} finally {
    $env:MYSQL_PWD = $oldPassword
}

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath (Join-Path $Root 'backups') -Directory | Where-Object { $_.CreationTime -lt $cutoff } | Remove-Item -Recurse -Force
Write-Host "Backup completed: $dumpPath" -ForegroundColor Green