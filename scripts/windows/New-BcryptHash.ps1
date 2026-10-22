[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot 'node_modules\bcryptjs') -PathType Container)) {
    throw "Khong tim thay bcryptjs trong $RepositoryRoot. Hay cai dependencies cua backend truoc."
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Khong tim thay node.exe trong PATH.'
}

$password = Read-Host 'Nhap mat khau can bam' -AsSecureString
$confirmation = Read-Host 'Nhap lai mat khau' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
$plain = $null
$confirmed = $null
$previousValue = [Environment]::GetEnvironmentVariable('SPA_HASH_PASSWORD', 'Process')
try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $confirmed = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)
    if ($plain -cne $confirmed) { throw 'Mat khau nhap lai khong khop.' }
    if ($plain.Length -lt 12) { throw 'Mat khau phai co it nhat 12 ky tu.' }

    [Environment]::SetEnvironmentVariable('SPA_HASH_PASSWORD', $plain, 'Process')
    Push-Location -LiteralPath $RepositoryRoot
    try {
        $result = @(& node.exe -e "require('bcryptjs').hash(process.env.SPA_HASH_PASSWORD, 10).then(hash => console.log(hash)).catch(() => process.exit(1))" 2>&1)
        if ($LASTEXITCODE -ne 0) { throw 'Khong tao duoc bcrypt hash.' }
    } finally {
        Pop-Location
    }
    $hash = ($result -join '').Trim()
    if ($hash -notmatch '^\$2[aby]\$10\$[./A-Za-z0-9]{53}$') { throw 'bcrypt hash khong hop le.' }
    Write-Output $hash
} finally {
    [Environment]::SetEnvironmentVariable('SPA_HASH_PASSWORD', $previousValue, 'Process')
    $plain = $null
    $confirmed = $null
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    if ($confirmationPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer) }
    $password = $null
    $confirmation = $null
}