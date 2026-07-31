@echo off
rem =====================================================================
rem  Refresh the baked Forward Log snapshot on aqmath.xyz.
rem
rem  The live Forward Log needs nothing from here: the daily job runs inside
rem  the Railway service (APScheduler, 01:30 UTC) and app-boot.js fetches
rem  /forward-log on every page load. This job maintains only the committed
rem  FALLBACK copy - what visitors see if that fetch fails, and what crawlers
rem  that do not run the fetch index.
rem
rem  Weekly is enough for a fallback, and it keeps the commit log quiet.
rem  tools/audit_pages.py fails the build once the snapshot passes 10 days,
rem  so a silently skipped run gets caught rather than going unnoticed.
rem
rem  Schedule (weekly, Mondays 04:00 local - after the 01:30 UTC service run):
rem    schtasks /create /tn "AQMath forward-log snapshot" /tr "%~f0" ^
rem             /sc weekly /d MON /st 04:00
rem
rem  Nothing is pushed automatically: this ends by showing what changed so the
rem  commit stays a deliberate act.
rem =====================================================================
setlocal
cd /d "%~dp0"
rem _logs is gitignored and, being _-prefixed, is excluded from the published
rem site by Jekyll - a run log must not become a public URL.
if not exist _logs mkdir _logs
set LOG=_logs\forward_log_refresh.txt

echo ==== %date% %time% ==== >> "%LOG%"

python tools\refresh_forward_log.py >> "%LOG%" 2>&1
if errorlevel 1 (
    echo REFRESH FAILED - see %LOG% >> "%LOG%"
    echo REFRESH FAILED - see %LOG%
    exit /b 1
)

python tools\audit_pages.py >> "%LOG%" 2>&1
if errorlevel 1 (
    echo AUDIT FAILED - not safe to commit, see %LOG% >> "%LOG%"
    echo AUDIT FAILED - not safe to commit, see %LOG%
    exit /b 1
)

echo. >> "%LOG%"
echo Snapshot refreshed and audited. Review and commit:
echo   git -C "%~dp0." status --short
echo   git -C "%~dp0." add _src/index.html index.html docs.html backtest.html results.html app.html
echo   git -C "%~dp0." commit -m "Refresh Forward Log fallback snapshot"
endlocal
