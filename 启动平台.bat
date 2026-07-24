@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-platform.ps1" %*
set "PLATFORM_EXIT=%ERRORLEVEL%"
if not "%PLATFORM_EXIT%"=="0" echo Platform startup failed with exit code %PLATFORM_EXIT%.
pause
exit /b %PLATFORM_EXIT%
