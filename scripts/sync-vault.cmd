@echo off
REM Mirrors the published weekly notes into the Obsidian vault.
REM Scheduled daily rather than weekly: the run happens in the cloud, so a daily
REM idempotent pull catches the week whenever this machine is next awake.
cd /d "%~dp0.."
python scripts\sync_vault.py >> "%TEMP%\unprompted-sync.log" 2>&1
