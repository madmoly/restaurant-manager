# Restaurant Manager - Local Dev Startup
# API 서버(3000) + Vite 프론트엔드(5173)를 동시에 실행
# 사용법: PowerShell에서 .\dev.ps1 또는 우클릭 > PowerShell로 실행

$ErrorActionPreference = "Continue"
$LASTEXITCODE = 0  # npx.ps1 버그 우회 (Node.js v25)
$projectDir = $PSScriptRoot

# Node.js 경로 탐색
$nodePath = $null
foreach ($candidate in @(
    "C:\Program Files\nodejs\node.exe",
    "$env:ProgramFiles\nodejs\node.exe",
    (Get-Command node -ErrorAction SilentlyContinue)?.Source
)) {
    if ($candidate -and (Test-Path $candidate)) {
        $nodePath = $candidate
        break
    }
}
if (-not $nodePath) {
    Write-Host "[ERROR] node.exe를 찾을 수 없습니다. Node.js가 설치되어 있는지 확인하세요." -ForegroundColor Red
    Read-Host "아무 키나 누르면 종료"
    exit 1
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Restaurant Manager - Dev Server" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Node: $nodePath" -ForegroundColor Gray

# .env 확인
if (-not (Test-Path "$projectDir\.env")) {
    Write-Host "[ERROR] .env 파일이 없습니다. .env.example을 참고해 생성하세요." -ForegroundColor Red
    Read-Host "아무 키나 누르면 종료"
    exit 1
}

# node_modules 확인
if (-not (Test-Path "$projectDir\node_modules")) {
    Write-Host "[INFO] node_modules가 없습니다. npm install 실행 중..." -ForegroundColor Yellow
    $nodeDir = Split-Path $nodePath
    $npmCli = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
    & $nodePath $npmCli install --include=dev
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install 실패. 수동으로 실행하세요." -ForegroundColor Red
        Read-Host "아무 키나 누르면 종료"
        exit 1
    }
}

# tsx, vite 모듈 경로 확인
$tsxPath = Join-Path $projectDir "node_modules\tsx\dist\cli.mjs"
$vitePath = Join-Path $projectDir "node_modules\vite\bin\vite.js"

if (-not (Test-Path $tsxPath)) {
    Write-Host "[ERROR] tsx 모듈을 찾을 수 없습니다: $tsxPath" -ForegroundColor Red
    Read-Host "아무 키나 누르면 종료"
    exit 1
}
if (-not (Test-Path $vitePath)) {
    Write-Host "[ERROR] vite 모듈을 찾을 수 없습니다: $vitePath" -ForegroundColor Red
    Read-Host "아무 키나 누르면 종료"
    exit 1
}

Write-Host "[1/2] API 서버 시작 (port 3000)..." -ForegroundColor Green
$apiJob = Start-Process -FilePath $nodePath `
    -ArgumentList $tsxPath, "watch", "server/index.ts" `
    -WorkingDirectory $projectDir `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 2

Write-Host "[2/2] Vite 프론트엔드 시작 (port 5173)..." -ForegroundColor Green
$webJob = Start-Process -FilePath $nodePath `
    -ArgumentList $vitePath, "--host" `
    -WorkingDirectory $projectDir `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 2

# 브라우저 자동 열기
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  브라우저에서 접속:" -ForegroundColor White
Write-Host "  http://localhost:5173" -ForegroundColor Yellow
Write-Host "" -ForegroundColor White
Write-Host "  계정: master / 1111" -ForegroundColor White
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "종료하려면 Ctrl+C 또는 이 창을 닫으세요." -ForegroundColor Gray

try {
    Wait-Process -Id $apiJob.Id
} catch {
    # Ctrl+C pressed
} finally {
    if (-not $apiJob.HasExited) { Stop-Process -Id $apiJob.Id -Force -ErrorAction SilentlyContinue }
    if (-not $webJob.HasExited) { Stop-Process -Id $webJob.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "서버가 종료되었습니다." -ForegroundColor Gray
}
