@echo off
setlocal
cd /d "%~dp0"

set "SYNC_MODE=%~1"
if "%SYNC_MODE%"=="" set "SYNC_MODE=daily"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-baostock-local.ps1" -Mode "%SYNC_MODE%" -StartDate "%~2" -EndDate "%~3"
set "SYNC_EXIT=%ERRORLEVEL%"

echo.
if "%SYNC_EXIT%"=="0" (
  echo BaoStock %SYNC_MODE% finished. Refresh Trend Tracker to load the latest closes.
) else (
  echo BaoStock sync did not finish. Review the message above.
)
echo.
pause
exit /b %SYNC_EXIT%
