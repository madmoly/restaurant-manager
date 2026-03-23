@echo off
chcp 65001 >nul
set "PATH=C:\Program Files\nodejs;C:\Users\madmo\AppData\Roaming\npm;%PATH%"
cd /d "%~dp0"
echo [1] CWD: %CD%
echo [2] Node version:
node --version
echo [3] Installing dependencies...
call npm install --include=dev
echo [4] Done. Exit code: %ERRORLEVEL%
echo.
echo Press any key to close...
pause >nul
