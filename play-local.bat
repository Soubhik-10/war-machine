@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  py -3 serve.py --open
) else (
  python serve.py --open
)
if errorlevel 1 pause
