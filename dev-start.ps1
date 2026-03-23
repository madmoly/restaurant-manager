# Restaurant Manager - Local Dev Startup
# 실행: 이 파일 우클릭 > "PowerShell로 실행"
# 또는 PowerShell에서: Set-ExecutionPolicy Bypass -Scope Process; .\dev-start.ps1

$ErrorActionPreference = "SilentlyContinue"
$LASTEXITCODE = 0  # npx.ps1 버그 우회

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Restaurant Manager - Dev Server" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# .env 확인
if (-not (Test-Path ".env")) {
    Write-Host "[ERROR] .env 파일이 없습니다!" -ForegroundColor Red
    Write-Host "  .env.example을 참고해 .env를 생성하세요." -ForegroundColor Red
    Read-Host "Enter to exit"
    exit 1
}

$nodePath = "C:\Program Files\nodejs"
$env:Path = "$nodePath;$env:Path"

Write-Host "[1/2] API 서버 시작 (port 3000)..." -ForegroundColor Green
$api = Start-Process -FilePath "$nodePath\node.exe" `
    -ArgumentList "./node_modules/tsx/dist/cli.mjs", "watch", "server/index.ts" `
    -WorkingDirectory $projectDir `
    -PassThru

Start-Sleep -Seconds 3

Write-Host "[2/2] Vite 프론트엔드 시작 (port 5173)..." -ForegroundColor Green
$web = Start-Process -FilePath "$nodePath\node.exe" `
    -ArgumentList "./node_modules/vite/bin/vite.js", "--host" `
    -WorkingDirectory $projectDir `
    -PassThru

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  http://localhost:5173" -ForegroundColor Yellow
Write-Host "  계정: master / 1111" -ForegroundColor White
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# 브라우저 열기
Start-Process "http://localhost:5173"

Write-Host "서버 PID: API=$($api.Id), Web=$($web.Id)" -ForegroundColor Gray
Write-Host "종료하려면 Enter를 누르세요..." -ForegroundColor Gray
Read-Host

# 정리
Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
Write-Host "서버가 종료되었습니다."
