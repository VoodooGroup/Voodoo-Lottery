@echo off
title Voodoo Lottery
cd /d "%~dp0"
echo.
echo  Project: %~dp0
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js is not installed or not in PATH.
  echo  Install from https://nodejs.org  then run START.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0public\index.html" (
  echo  ERROR: public\index.html missing.
  pause
  exit /b 1
)

echo  Starting Voodoo Lottery on http://127.0.0.1:8080/
echo  Keep this window open. Press Ctrl+C to stop.
echo.
node "%~dp0server.js"
echo.
echo  Server stopped.
pause
