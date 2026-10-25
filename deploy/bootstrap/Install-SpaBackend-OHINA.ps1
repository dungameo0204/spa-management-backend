<#
.SYNOPSIS
    Tự động cài đặt trọn gói Spa Backend cho Spa O'HINA trên máy khách (Ổ D:\).
.DESCRIPTION
    Script này sẽ:
    1. Cài đặt các công cụ cần thiết (Node.js, Git, MySQL) nếu chưa có.
    2. Cấu hình PATH biến môi trường máy.
    3. Thiết lập cấu trúc thư mục D:\SpaBackend.
    4. Cấu hình file .env và cấu hình Cloudflare R2 backup.
    5. Khởi tạo Database MySQL (db_system_master, db_spa_template).
    6. Cài đặt Windows Service (SpaBackend).
    7. Tải và triển khai code bản backend-ohina-v1.0.0.
    8. Cài đặt tác vụ tự động Update (19:30) và tự động Backup R2 (19:15).
#>

[CmdletBinding()]
param(
    [string]$Root = 'D:\SpaBackend',
    [string]$DbPassword = 'spa_secure_password_2026',
    [string]$ServerId = 'spa-ohina',
    [string]$Version = 'backend-ohina-v1.0.0',
    [string]$CorsOrigin = 'https://app-spa-ohina.infinityhavocx.men'
)

$ErrorActionPreference = 'Stop'

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   BẮT ĐẦU CÀI ĐẶT SPA BACKEND CHO SPA O'HINA (Ổ D:\)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Kiểm tra quyền Administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Bạn phải mở PowerShell bằng quyền Administrator (Run as Administrator) để chạy script này!"
}

# 2. Tạo cấu trúc thư mục D:\SpaBackend
Write-Host "`n[1/7] Tạo cấu trúc thư mục tại $Root..." -ForegroundColor Yellow
$dirs = @('backups', 'config', 'logs', 'releases', 'runtime', 'scripts', 'service', 'state')
foreach ($d in $dirs) {
    $p = Join-Path $Root $d
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

# 3. Cài đặt công cụ nền tảng nếu thiếu (Git, Node.js)
Write-Host "`n[2/7] Kiểm tra Git và Node.js..." -ForegroundColor Yellow
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Đang cài đặt Git qua winget..." -ForegroundColor Cyan
    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Đang cài đặt Node.js LTS qua winget..." -ForegroundColor Cyan
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
}

# Nạp lại biến môi trường PATH hiện tại
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# 4. Tạo file cấu hình D:\SpaBackend\config\.env
Write-Host "`n[3/7] Cấu hình file .env..." -ForegroundColor Yellow
$jwtSecret = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$envContent = @"
NODE_ENV=production
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=spa_backend
DB_PASSWORD=$DbPassword
DB_SYSTEM_NAME=db_system_master
JWT_SECRET=$jwtSecret
CORS_ORIGINS=$CorsOrigin
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $Root 'config\.env'), $envContent, $utf8NoBom)
Write-Host "Đã tạo: $Root\config\.env" -ForegroundColor Green

# 5. Tạo cấu hình Cloudflare R2 backup (D:\SpaBackend\config\r2-backup.json)
Write-Host "`n[4/7] Cấu hình Cloudflare R2 Backup..." -ForegroundColor Yellow
$r2Config = [ordered]@{
    bucket = "spa-ohina"
    accessKeyId = "8d01082731c2f5bc46d4c2c85bf608ee"
    secretAccessKey = "f107e157982ed618dbfe5835e7eb9fce8470ea10007a26f3dcce4a812f47b482"
    endpoint = "https://91765969becc4314153c19e2a5523e50.r2.cloudflarestorage.com"
}
$r2Json = $r2Config | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText((Join-Path $Root 'config\r2-backup.json'), $r2Json, $utf8NoBom)
Write-Host "Đã tạo: $Root\config\r2-backup.json" -ForegroundColor Green

# 6. Copy các scripts và template cần thiết từ thư mục hiện tại
Write-Host "`n[5/7] Sao chép scripts triển khai và file database template..." -ForegroundColor Yellow
$currentDir = $PSScriptRoot
if (Test-Path (Join-Path $currentDir 'scripts\windows')) {
    Copy-Item (Join-Path $currentDir 'scripts\windows\*') -Destination (Join-Path $Root 'scripts') -Force
}
if (Test-Path (Join-Path $currentDir 'deploy\windows\SpaBackend.xml')) {
    Copy-Item (Join-Path $currentDir 'deploy\windows\SpaBackend.xml') -Destination (Join-Path $Root 'service\SpaBackend.xml') -Force
}
if (Test-Path (Join-Path $currentDir 'db_system_master.sql')) {
    Copy-Item (Join-Path $currentDir 'db_system_master.sql') -Destination (Join-Path $Root 'database\db_system_master.sql') -Force
}
if (Test-Path (Join-Path $currentDir 'db_spa_template.sql')) {
    Copy-Item (Join-Path $currentDir 'db_spa_template.sql') -Destination (Join-Path $Root 'database\db_spa_template.sql') -Force
}

# 7. Triển khai bản release backend-ohina-v1.0.0
Write-Host "`n[6/7] Tải code và triển khai bản release $Version..." -ForegroundColor Yellow
$deployScript = Join-Path $Root 'scripts\Deploy-SpaBackend.ps1'
if (Test-Path $deployScript) {
    & powershell.exe -ExecutionPolicy Bypass -File $deployScript -Version $Version -ServerId $ServerId -Root $Root
    # Sao chép .env vào current
    Copy-Item (Join-Path $Root 'config\.env') -Destination (Join-Path $Root 'current\.env') -Force
} else {
    Write-Warning "Chưa tìm thấy $deployScript. Vui lòng chạy Deploy-SpaBackend.ps1 sau khi giải nén đầy đủ."
}

# 8. Cài đặt 2 tác vụ định kỳ:
# - Auto-update code lúc 19:30
# - Auto-backup R2 lúc 19:15
Write-Host "`n[7/7] Cài đặt lịch tự động Update (19:30) và Backup R2 (19:15)..." -ForegroundColor Yellow

$powerShellPath = Join-Path $PSHOME 'powershell.exe'

# Task Auto Update
$updateScript = Join-Path $Root 'current\scripts\windows\Check-SpaBackendUpdate.ps1'
if (Test-Path $updateScript) {
    $autoUpdateConfig = [ordered]@{
        serverId = $ServerId
        repositoryUrl = 'https://github.com/dungameo0204/spa-management-backend.git'
        tagPattern = 'backend-ohina-v*'
        healthUri = 'http://127.0.0.1:5000/health'
        intervalMinutes = 1440
    }
    $autoUpdateConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root 'config\auto-update.json') -Encoding UTF8

    $actionUpdate = New-ScheduledTaskAction -Execute $powerShellPath -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$updateScript`" -Root `"$Root`""
    $triggerUpdate = New-ScheduledTaskTrigger -Daily -At "19:30"
    $settingsUpdate = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $principalUpdate = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName 'SpaBackendAutoUpdate' -Action $actionUpdate -Trigger $triggerUpdate -Settings $settingsUpdate -Principal $principalUpdate -Description "Daily auto-update at 19:30 for Spa O'HINA" -Force | Out-Null
    Write-Host "Đã cài đặt Task SpaBackendAutoUpdate (19:30 hàng ngày)." -ForegroundColor Green
}

# Task Auto Backup
$backupScript = Join-Path $Root 'scripts\Backup-SpaDatabase.ps1'
if (Test-Path $backupScript) {
    # Tìm đường dẫn mysql.exe
    $mySqlExe = (Get-ChildItem -Path "C:\Program Files\MySQL", "C:\Program Files (x86)\MySQL", "D:\" -Filter "mysql.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
    $mySqlBin = if ($mySqlExe) { Split-Path $mySqlExe -Parent } else { 'C:\Program Files\MySQL\MySQL Server 8.0\bin' }

    $actionBackup = New-ScheduledTaskAction -Execute $powerShellPath -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$backupScript`" -Root `"$Root`" -MySqlBin `"$mySqlBin`""
    $triggerBackup = New-ScheduledTaskTrigger -Daily -At "19:15"
    $settingsBackup = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $principalBackup = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask -TaskName 'SpaBackendDailyBackup' -Action $actionBackup -Trigger $triggerBackup -Settings $settingsBackup -Principal $principalBackup -Description "Daily backup at 19:15 to Cloudflare R2 for Spa O'HINA" -Force | Out-Null
    Write-Host "Đã cài đặt Task SpaBackendDailyBackup (19:15 hàng ngày)." -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "   CÀI ĐẶT HOÀN TẤT CHO SPA O'HINA!                    " -ForegroundColor Green
Write-Host "   Backend URL local: http://127.0.0.1:5000            " -ForegroundColor Green
Write-Host "   Public API Domain: https://api-spa-ohina.infinityhavocx.men " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
