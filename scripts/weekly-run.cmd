@echo off
REM Runs the whole week on this machine and publishes the result.
REM
REM This lives here rather than in GitHub Actions because two of the five
REM engines are local CLI harnesses signed in to this machine's subscriptions,
REM and a cloud runner has no way to be signed in as you. The pipeline refuses
REM to start where a declared engine is missing, so the cloud path cannot run
REM the current method at all.
REM
REM Scheduled by scripts\install-weekly-task.ps1. Log: %TEMP%\unprompted-weekly.log

cd /d "%~dp0.."

echo. >> "%TEMP%\unprompted-weekly.log"
echo ===== %DATE% %TIME% ===== >> "%TEMP%\unprompted-weekly.log"

REM Start from the published state, or the push at the end will be rejected.
git pull --ff-only >> "%TEMP%\unprompted-weekly.log" 2>&1
if errorlevel 1 (
  echo ABORT: git pull failed, working tree may have local changes >> "%TEMP%\unprompted-weekly.log"
  exit /b 1
)

python -m unprompted.run --category all >> "%TEMP%\unprompted-weekly.log" 2>&1
set RUN_EXIT=%ERRORLEVEL%

REM 0 = every category published. 2 = at least one was held, which is the
REM checks working; held runs land in data\held and are committed as evidence,
REM not published. Anything else is a real failure and nothing is committed.
if not "%RUN_EXIT%"=="0" if not "%RUN_EXIT%"=="2" (
  echo ABORT: pipeline exited %RUN_EXIT%, nothing committed >> "%TEMP%\unprompted-weekly.log"
  exit /b %RUN_EXIT%
)

git add data reports >> "%TEMP%\unprompted-weekly.log" 2>&1
git diff --staged --quiet
if errorlevel 1 (
  git -c user.name="unprompted-bot" -c user.email="bot@unprompted.report" commit -m "Run: measured and published" >> "%TEMP%\unprompted-weekly.log" 2>&1
  git push >> "%TEMP%\unprompted-weekly.log" 2>&1
  echo PUSHED, exit %RUN_EXIT% >> "%TEMP%\unprompted-weekly.log"
) else (
  echo No new data to commit. >> "%TEMP%\unprompted-weekly.log"
)

REM Mirror the week into the Obsidian vault while the data is fresh.
python scripts\sync_vault.py --no-pull >> "%TEMP%\unprompted-weekly.log" 2>&1

exit /b %RUN_EXIT%
