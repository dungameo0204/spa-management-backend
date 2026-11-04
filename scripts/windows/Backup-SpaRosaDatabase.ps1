[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend',
    [string]$MySqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin',
    [ValidateRange(1, 365)][int]$RetentionDays = 10
)

. "$PSScriptRoot\Common-SpaBackend.ps1"

$envValues = Get-DotEnvValues -Path (Join-Path $Root 'config\.env')
foreach ($required in @('DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_SYSTEM_NAME')) {
    if (-not $envValues.ContainsKey($required) -or -not $envValues[$required]) {
        throw "Missing $required in $Root\config\.env"
    }
}
if ($envValues.DB_SYSTEM_NAME -ne 'db_system_master') {
    throw 'DB_SYSTEM_NAME must be db_system_master for the Rosa production backup.'
}

$mysql = Join-Path $MySqlBin 'mysql.exe'
$mysqldump = Join-Path $MySqlBin 'mysqldump.exe'
foreach ($path in @($mysql, $mysqldump)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Not found: $path" }
}

$dbPort = if ($envValues.ContainsKey('DB_PORT') -and $envValues.DB_PORT) { $envValues.DB_PORT } else { '3306' }
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$backupsRoot = Join-Path $Root 'backups'
$backupDir = Join-Path $backupsRoot $stamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$dumpPath = Join-Path $backupDir 'spa-rosa-databases.sql'

$oldPassword = $env:MYSQL_PWD
try {
    $env:MYSQL_PWD = $envValues.DB_PASSWORD
    $query = "SELECT database_name FROM tenants WHERE database_name REGEXP '^db_spa_[0-9]+_[0-9a-f]+$' ORDER BY id"
    $tenantDatabases = @(& $mysql --batch --skip-column-names "--host=$($envValues.DB_HOST)" "--port=$dbPort" "--user=$($envValues.DB_USER)" $envValues.DB_SYSTEM_NAME "--execute=$query")
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the tenant database list from db_system_master.' }

    $databases = @($envValues.DB_SYSTEM_NAME, 'db_spa_template') + @($tenantDatabases | Where-Object { $_ -match '^db_spa_[0-9]+_[0-9a-f]+$' })
    $databases = @($databases | Sort-Object -Unique)
    Invoke-CheckedCommand -FilePath $mysqldump -ArgumentList (@(
        "--host=$($envValues.DB_HOST)", "--port=$dbPort", "--user=$($envValues.DB_USER)",
        '--single-transaction', '--routines', '--triggers', '--events', '--set-gtid-purged=OFF',
        "--result-file=$dumpPath", '--databases'
    ) + $databases)

    if ((Get-Item -LiteralPath $dumpPath).Length -lt 1024) { throw 'The database dump is unexpectedly small.' }
    $hash = Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256
    "$($hash.Hash)  spa-rosa-databases.sql" | Set-Content -LiteralPath (Join-Path $backupDir 'SHA256.txt') -Encoding ASCII
    [ordered]@{
        createdAt = [DateTimeOffset]::Now.ToString('o')
        databases = $databases
        dump = 'spa-rosa-databases.sql'
        sha256 = $hash.Hash
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $backupDir 'manifest.json') -Encoding UTF8
} finally {
    $env:MYSQL_PWD = $oldPassword
}

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $backupsRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{6}$' -and $_.CreationTime -lt $cutoff } |
    Remove-Item -Recurse -Force

[pscustomobject]@{
    BackupDirectory = $backupDir
    DumpPath = $dumpPath
    Databases = $databases
}