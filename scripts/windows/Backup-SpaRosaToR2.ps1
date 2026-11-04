[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend',
    [string]$MySqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin',
    [string]$R2ConfigPath = 'C:\SpaBackend\config\r2-backup.json'
)

. "$PSScriptRoot\Common-SpaBackend.ps1"

if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw 'AWS CLI (aws.exe) is required for Cloudflare R2 backups.' }
if (-not (Test-Path -LiteralPath $R2ConfigPath -PathType Leaf)) { throw "R2 config not found: $R2ConfigPath" }

$config = Get-Content -LiteralPath $R2ConfigPath -Raw | ConvertFrom-Json
foreach ($required in @('endpointUrl', 'bucket', 'prefix', 'accessKeyId', 'secretAccessKey')) {
    if (-not $config.$required) { throw "Missing '$required' in $R2ConfigPath" }
}
if ($config.bucket -notmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$') { throw 'R2 bucket name is invalid.' }
$prefix = ([string]$config.prefix).Trim('/')
if ($prefix -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$') { throw 'R2 prefix is invalid.' }

$oldAccessKey = $env:AWS_ACCESS_KEY_ID
$oldSecret = $env:AWS_SECRET_ACCESS_KEY
$oldRegion = $env:AWS_DEFAULT_REGION
try {
    $env:AWS_ACCESS_KEY_ID = [string]$config.accessKeyId
    $env:AWS_SECRET_ACCESS_KEY = [string]$config.secretAccessKey
    $env:AWS_DEFAULT_REGION = 'auto'

    $local = & (Join-Path $PSScriptRoot 'Backup-SpaRosaDatabase.ps1') -Root $Root -MySqlBin $MySqlBin -RetentionDays 10
    if (-not $local -or -not $local.BackupDirectory) { throw 'Local database backup failed; R2 upload was not attempted.' }
    $stamp = Split-Path $local.BackupDirectory -Leaf
    $remote = "s3://$($config.bucket)/$prefix/$stamp/"
    Invoke-CheckedCommand -FilePath 'aws.exe' -ArgumentList @('s3', 'cp', $local.BackupDirectory, $remote, '--recursive', '--only-show-errors', '--endpoint-url', $config.endpointUrl)

    $objectsJson = @(& aws.exe s3api list-objects-v2 --bucket $config.bucket --prefix "$prefix/" --endpoint-url $config.endpointUrl --output json) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Could not list R2 backup objects for retention.' }
    $response = $objectsJson | ConvertFrom-Json
    $stamps = @($response.Contents | ForEach-Object {
        if ($_.Key -match "^$([regex]::Escape($prefix))/(\d{4}-\d{2}-\d{2}_\d{6})/") { $Matches[1] }
    } | Where-Object { $_ } | Sort-Object -Unique)
    $dated = @($stamps | ForEach-Object {
        [pscustomobject]@{ Stamp = $_; Date = [datetime]::ParseExact($_, 'yyyy-MM-dd_HHmmss', $null) }
    })

    $daily = @($dated | Group-Object { $_.Date.ToString('yyyy-MM-dd') } | ForEach-Object {
        $_.Group | Sort-Object Date -Descending | Select-Object -First 1
    } | Sort-Object Date -Descending | Select-Object -First 4)
    $weekly = @($dated | Group-Object {
        $date = $_.Date
        $date.Date.AddDays(-(([int]$date.DayOfWeek + 6) % 7)).ToString('yyyy-MM-dd')
    } | ForEach-Object {
        $_.Group | Sort-Object Date -Descending | Select-Object -First 1
    } | Sort-Object Date -Descending | Select-Object -First 4)
    $keep = @($daily + $weekly | Select-Object -ExpandProperty Stamp -Unique)

    foreach ($item in $dated) {
        if ($keep -notcontains $item.Stamp) {
            Invoke-CheckedCommand -FilePath 'aws.exe' -ArgumentList @('s3', 'rm', "s3://$($config.bucket)/$prefix/$($item.Stamp)/", '--recursive', '--only-show-errors', '--endpoint-url', $config.endpointUrl)
        }
    }
    Write-Host "R2 backup completed: $remote; retained $($keep.Count) daily/weekly recovery points." -ForegroundColor Green
} finally {
    $env:AWS_ACCESS_KEY_ID = $oldAccessKey
    $env:AWS_SECRET_ACCESS_KEY = $oldSecret
    $env:AWS_DEFAULT_REGION = $oldRegion
}