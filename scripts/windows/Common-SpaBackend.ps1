Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run PowerShell as Administrator.'
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter()][string[]]$ArgumentList = @()
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
    }
}

function Get-DotEnvValues {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Configuration file not found: $Path"
    }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed -split '=', 2
        if ($parts.Count -ne 2) { continue }
        $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
    return $values
}

function Resolve-MySqlClientTools {
    param([string]$MySqlBin)

    $candidateBins = @()
    if ($MySqlBin) { $candidateBins += $MySqlBin }

    $mysqlCommand = Get-Command 'mysql.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    $dumpCommand = Get-Command 'mysqldump.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($mysqlCommand -and $dumpCommand) {
        return [pscustomobject]@{ MySql = $mysqlCommand.Source; MySqlDump = $dumpCommand.Source }
    }

    $programFilesRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
    foreach ($programFiles in $programFilesRoots) {
        $mysqlRoot = Join-Path $programFiles 'MySQL'
        if (Test-Path -LiteralPath $mysqlRoot -PathType Container) {
            $candidateBins += Get-ChildItem -LiteralPath $mysqlRoot -Directory -Filter 'MySQL Server *' -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'bin' }
        }
    }

    foreach ($bin in @($candidateBins | Select-Object -Unique)) {
        $mysql = Join-Path $bin 'mysql.exe'
        $mysqldump = Join-Path $bin 'mysqldump.exe'
        if ((Test-Path -LiteralPath $mysql -PathType Leaf) -and (Test-Path -LiteralPath $mysqldump -PathType Leaf)) {
            return [pscustomobject]@{ MySql = $mysql; MySqlDump = $mysqldump }
        }
    }
    $requested = if ($MySqlBin) { " Requested directory: $MySqlBin." } else { '' }
    throw "Could not find both mysql.exe and mysqldump.exe via PATH or a MySQL Server installation.$requested"
}

function Assert-SafeVersion {
    param([Parameter(Mandatory)][string]$Version)
    if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
        throw 'Version/tag may contain only letters, numbers, dots, underscores and hyphens (maximum 80 characters).'
    }
}

function Get-CurrentReleasePath {
    param([Parameter(Mandatory)][string]$CurrentPath)
    if (-not (Test-Path -LiteralPath $CurrentPath)) { return $null }
    $item = Get-Item -LiteralPath $CurrentPath -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "$CurrentPath exists but is not a junction/reparse point. Refusing to modify it."
    }
    return $item.Target
}

function Set-ReleaseJunction {
    param(
        [Parameter(Mandatory)][string]$CurrentPath,
        [Parameter(Mandatory)][string]$TargetPath
    )
    if (-not (Test-Path -LiteralPath $TargetPath -PathType Container)) {
        throw "Target release does not exist: $TargetPath"
    }
    if (Test-Path -LiteralPath $CurrentPath) {
        $null = Get-CurrentReleasePath -CurrentPath $CurrentPath
        Invoke-CheckedCommand -FilePath $env:ComSpec -ArgumentList @('/c', 'rmdir', $CurrentPath)
    }
    Invoke-CheckedCommand -FilePath $env:ComSpec -ArgumentList @('/c', 'mklink', '/J', $CurrentPath, $TargetPath)
}

function Wait-BackendHealth {
    param(
        [string]$Uri = 'http://127.0.0.1:5000/health',
        [int]$Attempts = 20,
        [int]$DelaySeconds = 2
    )
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 5
            if ($response.status -eq 'ok') { return }
        } catch {
            if ($attempt -eq $Attempts) { throw }
        }
        Start-Sleep -Seconds $DelaySeconds
    }
    throw "Backend did not become healthy after $Attempts attempts: $Uri"
}

function Write-DeploymentState {
    param(
        [Parameter(Mandatory)][string]$StatePath,
        [Parameter(Mandatory)][string]$ServerId,
        [Parameter(Mandatory)][string]$CurrentVersion,
        [AllowNull()][string]$PreviousVersion,
        [Parameter(Mandatory)][string]$RepositoryUrl
    )
    $state = [ordered]@{
        serverId = $ServerId
        currentVersion = $CurrentVersion
        previousVersion = $PreviousVersion
        repositoryUrl = $RepositoryUrl
        deployedAt = [DateTimeOffset]::Now.ToString('o')
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
}