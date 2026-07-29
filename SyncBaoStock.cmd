@echo off
setlocal
cd /d "%~dp0"

set "SYNC_MODE=%~1"
if "%SYNC_MODE%"=="" set "SYNC_MODE=daily"
set "SYNC_DATASET=%~2"
set "SYNC_START="
set "SYNC_END="

if /I "%SYNC_MODE%"=="repair" (
  set "SYNC_START=%~2"
  set "SYNC_END=%~3"
  set "SYNC_DATASET=%~4"
)
if "%SYNC_DATASET%"=="" set "SYNC_DATASET=all"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-baostock-local.ps1" -Mode "%SYNC_MODE%" -Dataset "%SYNC_DATASET%" -StartDate "%SYNC_START%" -EndDate "%SYNC_END%"
set "SYNC_EXIT=%ERRORLEVEL%"

echo.
if "%SYNC_EXIT%"=="0" (
  echo BaoStock %SYNC_MODE% / %SYNC_DATASET% finished. Refresh Terminal or Trend Tracker.
) else (
  echo BaoStock sync did not finish. Review the message above.
)
echo.
pause
exit /b %SYNC_EXIT%
