@echo off
setlocal
set "GIT_TERMINAL_PROMPT=0"
set "GCM_INTERACTIVE=never"
REM Runs the whole week on this machine and publishes the result.
REM
REM This lives here rather than in GitHub Actions because two of the five
REM engines are local CLI harnesses signed in to this machine's subscriptions,
REM and a cloud runner has no way to be signed in as you. The pipeline refuses
REM to start where a declared engine is missing, so the cloud path cannot run
REM the current method at all.
REM
REM Scheduled by scripts\install-weekly-task.ps1. Log: .unprompted\logs\weekly.log

cd /d "%~dp0.."
if errorlevel 1 exit /b 1
set "UNPROMPTED_PYTHON=%CD%\.venv\Scripts\python.exe"
if not exist "%UNPROMPTED_PYTHON%" (
  echo ABORT: create .venv and install requirements.lock before scheduling.
  exit /b 1
)

REM The log lives with the checkpoints it explains (gitignored), not in %TEMP%,
REM which Windows may clear; it is rotated once it passes 20 MB.
set "LOG=%CD%\.unprompted\logs\weekly.log"
"%UNPROMPTED_PYTHON%" -c "import pathlib; p=pathlib.Path(r'%LOG%'); p.parent.mkdir(parents=True, exist_ok=True); p.exists() and p.stat().st_size > 20_000_000 and p.replace(p.with_suffix('.log.1'))" 2>nul

REM Start marker for the shadow step's time budget at the end. Best effort.
"%UNPROMPTED_PYTHON%" -c "import pathlib,time; p=pathlib.Path('.unprompted'); p.mkdir(exist_ok=True); (p/'weekly-started').write_text(str(time.time()))" 2>nul

echo. >> "%LOG%"
echo ===== %DATE% %TIME% ===== >> "%LOG%"

REM Start from the published state, or the push at the end will be rejected.
set "RUN_BRANCH="
for /f "delims=" %%B in ('git branch --show-current') do set "RUN_BRANCH=%%B"
if not "%RUN_BRANCH%"=="main" (
  echo ABORT: checkout must be on main before scheduled measurement. >> "%LOG%"
  exit /b 1
)
"%UNPROMPTED_PYTHON%" scripts\timed.py 600 git pull --ff-only origin main >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ABORT: git pull failed, working tree may have local changes >> "%LOG%"
  "%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 1 --detail "git pull --ff-only failed before the run started, so nothing was measured." >> "%LOG%" 2>&1
  exit /b 1
)

REM Never include someone else's staged work in the measurement commit.
git diff --cached --quiet
if errorlevel 1 (
  echo ABORT: staged changes exist; finish that commit before scheduling.
  exit /b 1
)

REM The commit below stages all of data\ and reports\, so anything already
REM modified there would be swept into a bot commit that claims to be this
REM week's measurement. Refuse to start instead: a hand edit waiting to be
REM reviewed must not be published under the bot's name.
git status --porcelain -- data reports > "%TEMP%\unprompted-dirty.txt" 2>&1
for %%A in ("%TEMP%\unprompted-dirty.txt") do set "DIRTY_SIZE=%%~zA"
if not "%DIRTY_SIZE%"=="0" (
  echo ABORT: data\ or reports\ has uncommitted changes before the run: >> "%LOG%"
  type "%TEMP%\unprompted-dirty.txt" >> "%LOG%"
  "%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 1 --detail "data/ or reports/ had uncommitted changes before the run, so it refused to start rather than sweep them into a bot commit." >> "%LOG%" 2>&1
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
git status --porcelain -- src questions aliases providers.json agents.json scripts requirements.lock pyproject.toml > "%TEMP%\unprompted-method.txt" 2>&1
for %%A in ("%TEMP%\unprompted-method.txt") do set "METHOD_SIZE=%%~zA"
if not "%METHOD_SIZE%"=="0" (
  echo ABORT: the method is uncommitted, so this run could not be reproduced: >> "%LOG%"
  type "%TEMP%\unprompted-method.txt" >> "%LOG%"
  echo         Commit or stash these, then re-run. >> "%LOG%"
  "%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 1 --detail "Measurement code, launcher, dependency configuration, questions, aliases or a registry was uncommitted; refusing unreproducible work." >> "%LOG%" 2>&1
  exit /b 1
)

REM A public clone can pull even when publishing credentials have expired.
REM Check the push transport before paid work; dry-run changes no remote refs.
REM This cannot guarantee later network availability or server-side hooks.
"%UNPROMPTED_PYTHON%" scripts\timed.py 300 git push --dry-run origin HEAD:main >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ABORT: publication preflight failed before measurement. >> "%LOG%"
  "%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 1 --detail "Publication preflight failed before any provider calls. Check GitHub authentication and the origin push URL; git push --dry-run origin HEAD:main must succeed." >> "%LOG%" 2>&1
  exit /b 1
)

set "UNPROMPTED_WEEKLY_RUN=1"
"%UNPROMPTED_PYTHON%" -m unprompted.run --category all --summary-file .unprompted\weekly-summary.json >> "%LOG%" 2>&1
set RUN_EXIT=%ERRORLEVEL%

REM 0 = every category published. 2 = at least one was held, which is the
REM checks working; held runs land in data\held and are committed as evidence,
REM not published. 3 = measured, but publishing it failed and the data is on
REM this machine only. Anything else is a real failure and nothing is committed.
if not "%RUN_EXIT%"=="0" if not "%RUN_EXIT%"=="2" (
  echo ABORT: pipeline exited %RUN_EXIT%, nothing committed >> "%LOG%"
  "%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code %RUN_EXIT% --detail "The pipeline exited %RUN_EXIT%, which is neither published nor held. Nothing was committed and completed engine answers remain in the local checkpoint directory." >> "%LOG%" 2>&1
  exit /b %RUN_EXIT%
)

REM Record the outcome BEFORE staging, so it is committed with the week it
REM describes. Exit 2 means a category was held, which is the checks working
REM rather than breaking -- and still wants a person, because a held week does
REM not publish and nothing else says so.
REM
REM This used to run at :published, after the commit. notify.py's own docstring
REM says data\last-run.json is "committed with the run", and it never was: every
REM run that got this far left the file dirty, and the dirty-data guard at the
REM top of this script then refused to start the NEXT run. One completed run
REM disabled the schedule until somebody committed the file by hand. First bit
REM on 2026-09-07, which is why 2026-09-14 would not have measured anything.
if "%RUN_EXIT%"=="2" (
  "%UNPROMPTED_PYTHON%" scripts\notify.py --status held --exit-code 2 --summary-file .unprompted\weekly-summary.json --detail "At least one category was held, failed or refused. See the run log for details." >> "%LOG%" 2>&1
) else (
  "%UNPROMPTED_PYTHON%" scripts\notify.py --status published --exit-code 0 --summary-file .unprompted\weekly-summary.json --detail "Every category measured and passed local checks. Commit and push follow; deployment is not verified." >> "%LOG%" 2>&1
)

REM Written with labels rather than one parenthesised block on purpose: cmd
REM expands %VAR% for a whole block when it parses it, so a variable set inside
REM the block reads as empty and the SHA comparison below would silently never
REM fire -- the exact class of bug this section exists to remove.
REM Checked, because a failed stage is indistinguishable from a clean week
REM once it has happened: `git diff --staged --quiet` then finds nothing staged,
REM the branch below logs "No new data to commit", and the task exits zero
REM having published nothing at all. Same class as the PUSHED line above.
REM The message says what happened: a held week committed as "published"
REM misled anyone reading git log (2026-10-26).
set "COMMIT_MSG=Run: measured and published"
if "%RUN_EXIT%"=="2" set "COMMIT_MSG=Run: measured; one or more categories held, see data/last-run.json"
git add data reports >> "%LOG%" 2>&1
if errorlevel 1 goto :stage_failed
git diff --staged --quiet
if errorlevel 1 goto :publish
echo No new data to commit. >> "%LOG%"
goto :published

:publish
git -c user.name="unprompted-bot" -c user.email="bot@unprompted.report" commit -m "%COMMIT_MSG%" >> "%LOG%" 2>&1
if errorlevel 1 goto :commit_failed
"%UNPROMPTED_PYTHON%" scripts\timed.py 900 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=120 push origin HEAD:main >> "%LOG%" 2>&1
if errorlevel 1 goto :push_failed

REM Confirm the remote actually has it. Neither commit nor push returns non-zero
REM for every kind of failure, and PUSHED used to be printed unconditionally: a
REM network or auth failure looked identical to a real publication in both the
REM log and Task Scheduler's last result.
set "LOCAL_SHA="
set "REMOTE_SHA="
for /f %%H in ('git rev-parse HEAD') do set "LOCAL_SHA=%%H"
"%UNPROMPTED_PYTHON%" scripts\timed.py 180 git ls-remote origin refs/heads/main > "%TEMP%\unprompted-remote.txt" 2>> "%LOG%"
if errorlevel 1 goto :sha_mismatch
for /f "usebackq" %%H in ("%TEMP%\unprompted-remote.txt") do set "REMOTE_SHA=%%H"
if "%LOCAL_SHA%"=="" goto :sha_mismatch
if "%REMOTE_SHA%"=="" goto :sha_mismatch
if not "%LOCAL_SHA%"=="%REMOTE_SHA%" goto :sha_mismatch
echo PUSHED %LOCAL_SHA%, exit %RUN_EXIT% >> "%LOG%"
goto :published

:stage_failed
echo FAILED: git add failed, so nothing could be committed. The week is >> "%LOG%"
echo         measured and on this machine only. >> "%LOG%"
"%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 3 --detail "git add failed, so the measured week could not be committed. It is on this machine only." >> "%LOG%" 2>&1
exit /b 3

:commit_failed
echo FAILED: git commit failed. The week is measured but not committed. >> "%LOG%"
"%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 3 --detail "git commit failed. The week is measured but not committed, and exists on this machine only." >> "%LOG%" 2>&1
exit /b 3

:push_failed
echo FAILED: git push failed. The commit is on this machine only and the site >> "%LOG%"
echo         will not update. Fix the remote and push by hand. Do not re-run >> "%LOG%"
echo         the week: the data already exists and data/runs is append-only. >> "%LOG%"
"%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 3 --detail "git push failed. The commit is local only and the site will not update. Push by hand; do not re-run the week." >> "%LOG%" 2>&1
exit /b 3

:sha_mismatch
echo FAILED: push reported success but the remote and this machine disagree. >> "%LOG%"
echo         local  %LOCAL_SHA% >> "%LOG%"
echo         remote %REMOTE_SHA% >> "%LOG%"
"%UNPROMPTED_PYTHON%" scripts\notify.py --status failed --exit-code 3 --detail "The push reported success but the remote and this machine disagree on the commit, so the site may not have updated." >> "%LOG%" 2>&1
exit /b 3

:published
REM Mirror the week into the Obsidian vault while the data is fresh, and
REM archive the audience counters with it.
REM A failure here is logged and reported in the exit code, but it never
REM replaces a held week's 2 and never skips the shadow step below.
set "SYNC_FAILED="
"%UNPROMPTED_PYTHON%" scripts\sync_vault.py --no-pull >> "%LOG%" 2>&1
if errorlevel 1 set "SYNC_FAILED=1"
"%UNPROMPTED_PYTHON%" scripts\sync_analytics.py >> "%LOG%" 2>&1
if errorlevel 1 set "SYNC_FAILED=1"
if defined SYNC_FAILED echo WARNING: vault or analytics sync failed after publishing; the week itself is published. >> "%LOG%"

REM Shadow second reader. Jev re-reads the stored answers of the date this run
REM measured and writes only to the gitignored audit\jev-shadow. It runs after
REM the week is pushed, stops within a time budget that keeps clear of the
REM task's 8-hour limit, and its exit code is ignored. It does not report into
REM data\last-run.json or the notification.
"%UNPROMPTED_PYTHON%" scripts\compare_jev.py weekly >> "%LOG%" 2>&1

REM 4 only for an otherwise clean week: a held week stays 2.
if "%RUN_EXIT%"=="0" if defined SYNC_FAILED exit /b 4
exit /b %RUN_EXIT%
