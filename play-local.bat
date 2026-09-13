@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22.21.1 or newer to run local sandbox bounties.
  echo For the static sandbox only, run: python serve.py --open
  pause
  exit /b 1
)
node server.mjs --open
if errorlevel 1 pause
