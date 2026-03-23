@echo off
chcp 65001 >nul
title Restaurant Manager - Dev Server

echo ======================================
echo   Restaurant Manager - Dev Server
echo ======================================
echo.

cd /d "%~dp0"

echo [1/2] API 서버 시작 (port 3000)...
start "API Server" cmd /k "cd /d "%~dp0" && npx tsx watch server/index.ts"

timeout /t 3 /nobreak >nul

echo [2/2] Vite 프론트엔드 시작 (port 5173)...
start "Vite Dev" cmd /k "cd /d "%~dp0" && npx vite --host"

timeout /t 3 /nobreak >nul

echo.
echo ======================================
echo   브라우저에서 접속:
echo   http://localhost:5173
echo.
echo   계정: master / 1111
echo ======================================
echo.

start http://localhost:5173

echo 이 창은 닫아도 됩니다. 서버 창을 닫으면 서버가 종료됩니다.
pause
