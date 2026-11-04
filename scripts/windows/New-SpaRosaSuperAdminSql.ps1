[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend',
    [string]$Username = 'superadmin',
    [string]$Fullname = 'Rosa Super Admin'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Username -notmatch '^[A-Za-z0-9._-]{3,100}$') { throw 'Username must be 3-100 characters: letters, numbers, dot, underscore or hyphen.' }
if ([string]::IsNullOrWhiteSpace($Fullname) -or $Fullname.Length -gt 255) { throw 'Fullname must contain 1-255 characters.' }

$release = Join-Path $Root 'current'
if (-not (Test-Path -LiteralPath (Join-Path $release 'node_modules\bcryptjs') -PathType Container)) {
    throw "bcryptjs not found in $release. Deploy the backend release before creating the Super Admin SQL."
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'node.exe was not found in PATH.' }

$password = Read-Host 'Nhap mat khau Super Admin (toi thieu 12 ky tu)' -AsSecureString
$confirm = Read-Host 'Nhap lai mat khau Super Admin' -AsSecureString
$firstPtr = [IntPtr]::Zero
$secondPtr = [IntPtr]::Zero
$plain = $null
$confirmation = $null
$oldValue = [Environment]::GetEnvironmentVariable('SPA_ADMIN_PASSWORD', 'Process')
try {
    $firstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $secondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPtr)
    $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPtr)
    if ($plain -cne $confirmation) { throw 'Mat khau nhap lai khong khop.' }
    if ($plain.Length -lt 12) { throw 'Mat khau phai co it nhat 12 ky tu.' }

    [Environment]::SetEnvironmentVariable('SPA_ADMIN_PASSWORD', $plain, 'Process')
    Push-Location -LiteralPath $release
    try {
        $hashOutput = @(& node.exe -e "const bcrypt = require('bcryptjs'); bcrypt.hash(process.env.SPA_ADMIN_PASSWORD, 10).then(hash => console.log(hash)).catch(() => process.exit(1));" 2>&1)
        if ($LASTEXITCODE -ne 0) { throw 'Khong tao duoc bcrypt hash; kiem tra Node.js va bcryptjs.' }
    } finally { Pop-Location }
    $hash = ($hashOutput -join '').Trim()
    if ($hash -notmatch '^\$2[aby]\$10\$[./A-Za-z0-9]{53}$') { throw 'bcrypt hash khong hop le.' }

    $escapedUsername = $Username.Replace("'", "''")
    $escapedFullname = $Fullname.Replace("'", "''")
    Write-Output @"
-- Run once in MySQL only after db_system_master.production.sql was imported.
-- This refuses to add a second active Super Admin or overwrite an existing account.
INSERT INTO db_system_master.users (tenant_id, branch_id, username, fullname, password, system_role, created_by)
SELECT NULL, NULL, '$escapedUsername', '$escapedFullname', '$hash', 'SUPER_ADMIN', 'PRODUCTION_BOOTSTRAP'
WHERE NOT EXISTS (
    SELECT 1 FROM db_system_master.users
    WHERE system_role = 'SUPER_ADMIN' AND tenant_id IS NULL AND branch_id IS NULL AND deleted_at IS NULL
);
SELECT ROW_COUNT() AS inserted_rows;
SELECT id, username, fullname, system_role, tenant_id, branch_id, deleted_at
FROM db_system_master.users WHERE system_role = 'SUPER_ADMIN';
-- inserted_rows must be 1 on first installation. If it is 0, STOP and inspect the SELECT output.
"@
} finally {
    [Environment]::SetEnvironmentVariable('SPA_ADMIN_PASSWORD', $oldValue, 'Process')
    $plain = $null; $confirmation = $null
    if ($firstPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr) }
    if ($secondPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr) }
    $password = $null; $confirm = $null
}