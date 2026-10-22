[CmdletBinding()]
param(
    [string]$Root = 'C:\SpaBackend'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$release = Join-Path $Root 'current'
if (-not (Test-Path -LiteralPath (Join-Path $release 'node_modules\bcryptjs') -PathType Container)) {
    throw "bcryptjs not found in $release. Run this on the backend machine after deploying a release."
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'node.exe was not found in PATH.' }

$password = Read-Host 'Nhap mat khau MOI cho superadmin' -AsSecureString
$confirm = Read-Host 'Nhap lai mat khau MOI' -AsSecureString
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
    } finally {
        Pop-Location
    }
    $hash = ($hashOutput -join '').Trim()
    if ($hash -notmatch '^\$2[aby]\$10\$[./A-Za-z0-9]{53}$') { throw 'bcrypt hash khong hop le.' }

    Write-Output @"
-- Chay trong MySQL tren may khach, sau khi da backup db_system_master.
-- Chi doi mat khau superadmin dang hoat dong; khong tao user moi, khong sua DB cu.
SELECT id, username, tenant_id, branch_id, system_role, deleted_at
FROM db_system_master.users WHERE username = 'superadmin';

UPDATE db_system_master.users
SET password = '$hash', updated_by = 'PASSWORD_RESET'
WHERE username = 'superadmin'
  AND system_role = 'SUPER_ADMIN'
  AND tenant_id IS NULL AND branch_id IS NULL AND deleted_at IS NULL;
SELECT ROW_COUNT() AS updated_rows;
-- updated_rows phai = 1; neu = 0, DUNG va kiem tra tai khoan, khong tu sua dieu kien.
"@
} finally {
    [Environment]::SetEnvironmentVariable('SPA_ADMIN_PASSWORD', $oldValue, 'Process')
    $plain = $null
    $confirmation = $null
    if ($firstPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr) }
    if ($secondPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr) }
    $password = $null
    $confirm = $null
}