[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend',
    [Parameter(Mandatory)][string]$WinSWPath,
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [string]$TemplatePath
)

. "$PSScriptRoot\Common-SpaBackend.ps1"
Assert-Administrator

if (-not (Test-Path -LiteralPath $WinSWPath -PathType Leaf)) { throw "WinSW not found: $WinSWPath" }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node.js not found: $NodePath" }

$directories = @('config', 'releases', 'service', 'logs', 'backups', 'state')
foreach ($directory in $directories) {
    New-Item -ItemType Directory -Path (Join-Path $Root $directory) -Force | Out-Null
}

$envPath = Join-Path $Root 'config\.env'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw "Create $envPath before installing the service."
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'current\src\server.js') -PathType Leaf)) {
    throw "No release is linked at $Root\current. Deploy the first release before installing the service."
}

$serviceExe = Join-Path $Root 'service\SpaBackend.exe'
$serviceXml = Join-Path $Root 'service\SpaBackend.xml'

$existing = Get-Service -Name 'SpaBackend' -ErrorAction SilentlyContinue
if ($existing) {
    if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) { throw "Existing SpaBackend service wrapper not found: $serviceExe" }
    if ($existing.Status -ne 'Stopped') {
        Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('stop')
        Start-Sleep -Seconds 2
    }
    Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('uninstall')
}

Copy-Item -LiteralPath $WinSWPath -Destination $serviceExe -Force

if (-not $TemplatePath) { $TemplatePath = Join-Path $Root 'current\deploy\windows\SpaBackend.xml' }
if (-not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) { throw "WinSW XML template not found: $TemplatePath" }
$xml = Get-Content -LiteralPath $templatePath -Raw
$escapedNode = [Security.SecurityElement]::Escape($NodePath)
$escapedRoot = [Security.SecurityElement]::Escape($Root)
$xml = $xml.Replace('C:\Program Files\nodejs\node.exe', $escapedNode)
$xml = $xml.Replace('C:\SpaBackend', $escapedRoot)
Set-Content -LiteralPath $serviceXml -Value $xml -Encoding UTF8

Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('install')
Invoke-CheckedCommand -FilePath $serviceExe -ArgumentList @('start')
Wait-BackendHealth
Write-Host 'SpaBackend service is installed and healthy at http://127.0.0.1:5000/health' -ForegroundColor Green