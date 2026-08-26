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
  python scripts\notify.py --status failed --exit-code 1 --detail "git pull --ff-only failed before the run started, so nothing was measured." >> "%TEMP%\unprompted-weekly.log" 2>&1
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
  python scripts\notify.py --status failed --exit-code 1 --detail "data/ or reports/ had uncommitted changes before the run, so it refused to start rather than sweep them into a bot commit." >> "%TEMP%\unprompted-weekly.log" 2>&1
  exit /b 1
)

REM The same rule for the inputs that decide what the numbers mean. A run is
REM only reproducible from this repository if the code, questions, aliases and
REM provider registry that produced it are in it; uncommitted, the recorded
REM commit points at something that never ran.
REM
REM Deliberately narrow. An audit recommended refusing on *any* dirty file,
REM which would trade a whole week's measurement for an uncommitted README
REM edit. These four paths are the ones that change a published figure.
git status --porcelain -- src questions aliases providers.json agents.json > "%TEMP%\unprompted-method.txt" 2>&1
for /f %%A in ("%TEMP%\unprompted-method.txt") do set METHOD_SIZE=%%~zA
if not "%METHOD_SIZE%"=="0" (
  echo ABORT: the method is uncommitted, so this run could not be reproduced: >> "%TEMP%\unprompted-weekly.log"
  type "%TEMP%\unprompted-method.txt" >> "%TEMP%\unprompted-weekly.log"
  echo         Commit or stash these, then re-run. >> "%TEMP%\unprompted-weekly.log"
  python scripts\notify.py --status failed --exit-code 1 --detail "src, questions, aliases or a registry was uncommitted, so this run would not have been reproducible from the repository." >> "%TEMP%\unprompted-weekly.log" 2>&1
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
  python scripts\notify.py --status failed --exit-code %RUN_EXIT% --detail "The pipeline exited %RUN_EXIT%, which is neither published nor held. Nothing was committed and this week's engine calls are gone." >> "%TEMP%\unprompted-weekly.log" 2>&1
  exit /b %RUN_EXIT%
)

REM Written with labels rather than one parenthesised block on purpose: cmd
REM expands %VAR% for a whole block when it parses it, so a variable set inside
REM the block reads as empty and the SHA comparison below would silently never
REM fire -- the exact class of bug this section exists to remove.
REM Checked, because a failed stage is indistinguishable from a clean week
REM once it has happened: `git diff --staged --quiet` then finds nothing staged,
REM the branch below logs "No new data to commit", and the task exits zero
REM having published nothing at all. Same class as the PUSHED line above.
git add data reports >> "%TEMP%\unprompted-weekly.log" 2>&1
if errorlevel 1 goto :stage_failed
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

:stage_failed
echo FAILED: git add failed, so nothing could be committed. The week is >> "%TEMP%\unprompted-weekly.log"
echo         measured and on this machine only. >> "%TEMP%\unprompted-weekly.log"
python scripts\notify.py --status failed --exit-code 3 --detail "git add failed, so the measured week could not be committed. It is on this machine only." >> "%TEMP%\unprompted-weekly.log" 2>&1
exit /b 3

:commit_failed
echo FAILED: git commit failed. The week is measured but not committed. >> "%TEMP%\unprompted-weekly.log"
python scripts\notify.py --status failed --exit-code 3 --detail "git commit failed. The week is measured but not committed, and exists on this machine only." >> "%TEMP%\unprompted-weekly.log" 2>&1
exit /b 3

:push_failed
echo FAILED: git push failed. The commit is on this machine only and the site >> "%TEMP%\unprompted-weekly.log"
echo         will not update. Fix the remote and push by hand. Do not re-run >> "%TEMP%\unprompted-weekly.log"
echo         the week: the data already exists and data/runs is append-only. >> "%TEMP%\unprompted-weekly.log"
python scripts\notify.py --status failed --exit-code 3 --detail "git push failed. The commit is local only and the site will not update. Push by hand; do not re-run the week." >> "%TEMP%\unprompted-weekly.log" 2>&1
exit /b 3

:sha_mismatch
echo FAILED: push reported success but the remote and this machine disagree. >> "%TEMP%\unprompted-weekly.log"
echo         local  %LOCAL_SHA% >> "%TEMP%\unprompted-weekly.log"
echo         remote %REMOTE_SHA% >> "%TEMP%\unprompted-weekly.log"
python scripts\notify.py --status failed --exit-code 3 --detail "The push reported success but the remote and this machine disagree on the commit, so the site may not have updated." >> "%TEMP%\unprompted-weekly.log" 2>&1
exit /b 3

:published
REM Record the outcome either way. Exit 2 means a category was held, which
REM is the checks working rather than breaking -- and still wants a person,
REM because a held week does not publish and nothing else says so.
if "%RUN_EXIT%"=="2" (
  python scripts\notify.py --status held --exit-code 2 --detail "At least one category was held and did not publish. The reasons are in the log above and the data is in data\held\." >> "%TEMP%\unprompted-weekly.log" 2>&1
) else (
  python scripts\notify.py --status published --exit-code 0 --detail "Every category published." >> "%TEMP%\unprompted-weekly.log" 2>&1
)


REM Mirror the week into the Obsidian vault while the data is fresh, and
REM archive the audience counters with it.
python scripts\sync_vault.py --no-pull >> "%TEMP%\unprompted-weekly.log" 2>&1
python scripts\sync_analytics.py >> "%TEMP%\unprompted-weekly.log" 2>&1
if errorlevel 1 echo WARNING: the audience archive did not complete; Redis prunes >> "%TEMP%\unprompted-weekly.log"

exit /b %RUN_EXIT%
