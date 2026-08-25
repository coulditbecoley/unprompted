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

REM The commit below stages all of data\ and reports\, so anything already
REM modified there would be swept into a bot commit that claims to be this
REM week's measurement. Refuse to start instead: a hand edit waiting to be
REM reviewed must not be published under the bot's name.
git status --porcelain -- data reports > "%TEMP%\unprompted-dirty.txt" 2>&1
for /f %%A in ("%TEMP%\unprompted-dirty.txt") do set DIRTY_SIZE=%%~zA
if not "%DIRTY_SIZE%"=="0" (
  echo ABORT: data\ or reports\ has uncommitted changes before the run: >> "%TEMP%\unprompted-weekly.log"
  type "%TEMP%\unprompted-dirty.txt" >> "%TEMP%\unprompted-weekly.log"
  exit /b 1
)

python -m unprompted.run --category all >> "%TEMP%\unprompted-weekly.log" 2>&1
set RUN_EXIT=%ERRORLEVEL%

REM 0 = every category published. 2 = at least one was held, which is the
REM checks working; held runs land in data\held and are committed as evidence,
REM not published. 3 = measured, but publishing it failed and the data is on
REM this machine only. Anything else is a real failure and nothing is committed.
if not "%RUN_EXIT%"=="0" if not "%RUN_EXIT%"=="2" (
  echo ABORT: pipeline exited %RUN_EXIT%, nothing committed >> "%TEMP%\unprompted-weekly.log"
  exit /b %RUN_EXIT%
)

REM Written with labels rather than one parenthesised block on purpose: cmd
REM expands %VAR% for a whole block when it parses it, so a variable set inside
REM the block reads as empty and the SHA comparison below would silently never
REM fire -- the exact class of bug this section exists to remove.
git add data reports >> "%TEMP%\unprompted-weekly.log" 2>&1
git diff --staged --quiet
if errorlevel 1 goto :publish
echo No new data to commit. >> "%TEMP%\unprompted-weekly.log"
goto :published

:publish
git -c user.name="unprompted-bot" -c user.email="bot@unprompted.report" commit -m "Run: measured and published" >> "%TEMP%\unprompted-weekly.log" 2>&1
if errorlevel 1 goto :commit_failed
git push >> "%TEMP%\unprompted-weekly.log" 2>&1
if errorlevel 1 goto :push_failed

REM Confirm the remote actually has it. Neither commit nor push returns non-zero
REM for every kind of failure, and PUSHED used to be printed unconditionally: a
REM network or auth failure looked identical to a real publication in both the
REM log and Task Scheduler's last result.
for /f %%H in ('git rev-parse HEAD') do set LOCAL_SHA=%%H
for /f %%H in ('git rev-parse "@{upstream}"') do set REMOTE_SHA=%%H
if not "%LOCAL_SHA%"=="%REMOTE_SHA%" goto :sha_mismatch
echo PUSHED %LOCAL_SHA%, exit %RUN_EXIT% >> "%TEMP%\unprompted-weekly.log"
goto :published

:commit_failed
echo FAILED: git commit failed. The week is measured but not committed. >> "%TEMP%\unprompted-weekly.log"
exit /b 3

:push_failed
echo FAILED: git push failed. The commit is on this machine only and the site >> "%TEMP%\unprompted-weekly.log"
echo         will not update. Fix the remote and push by hand. Do not re-run >> "%TEMP%\unprompted-weekly.log"
echo         the week: the data already exists and data/runs is append-only. >> "%TEMP%\unprompted-weekly.log"
exit /b 3

:sha_mismatch
echo FAILED: push reported success but the remote and this machine disagree. >> "%TEMP%\unprompted-weekly.log"
echo         local  %LOCAL_SHA% >> "%TEMP%\unprompted-weekly.log"
echo         remote %REMOTE_SHA% >> "%TEMP%\unprompted-weekly.log"
exit /b 3

:published

REM Mirror the week into the Obsidian vault while the data is fresh.
python scripts\sync_vault.py --no-pull >> "%TEMP%\unprompted-weekly.log" 2>&1

exit /b %RUN_EXIT%
