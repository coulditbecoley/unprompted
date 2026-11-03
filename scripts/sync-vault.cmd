@echo off
REM Mirrors the published weekly notes into the Obsidian vault.
REM Scheduled daily rather than weekly. The weekly run calls this itself at the
REM end, so the daily pass is a safety net: it catches a week published from
REM elsewhere, or one whose run was interrupted after publishing.
cd /d "%~dp0.."
REM The project's own interpreter, as the weekly launcher uses: sync_analytics
REM imports the pipeline, which a bare system python cannot.
set "SYNC_PYTHON=python"
if exist ".venv\Scripts\python.exe" set "SYNC_PYTHON=.venv\Scripts\python.exe"
REM Push a measured week whose push failed, if one is recorded. Exactly that
REM commit, fast-forward only; a busy lock (exit 4) just means try tomorrow.
"%SYNC_PYTHON%" scripts\publish.py pending >> "%TEMP%\unprompted-sync.log" 2>&1
set "PUBLISH_EXIT=%ERRORLEVEL%"
if "%PUBLISH_EXIT%"=="4" set "PUBLISH_EXIT=0"
"%SYNC_PYTHON%" scripts\sync_vault.py >> "%TEMP%\unprompted-sync.log" 2>&1
set "VAULT_EXIT=%ERRORLEVEL%"

REM Copy the audience counters out of Redis before they age away. They
REM expire after ninety days, so this has to run more often than that, and
REM daily means a day is archived while it is still cheap to fetch. Run
REM independently of the line above: a failure to mirror the weekly notes
REM must not also cost the history.
"%SYNC_PYTHON%" scripts\sync_analytics.py >> "%TEMP%\unprompted-sync.log" 2>&1
set "ANALYTICS_EXIT=%ERRORLEVEL%"

REM Both outcomes count. Task Scheduler showed 0 whenever the last line worked,
REM so a failing vault sync looked healthy. Each step also writes its own status
REM file under .unprompted\status, which readiness and the mid-week check read.
if not "%PUBLISH_EXIT%"=="0" exit /b %PUBLISH_EXIT%
if not "%VAULT_EXIT%"=="0" exit /b %VAULT_EXIT%
exit /b %ANALYTICS_EXIT%
