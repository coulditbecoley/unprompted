<#
    Registers the weekly run with Windows Task Scheduler.

    The measurement moved off GitHub Actions because two of the five engines are
    local CLI harnesses signed in to this machine. Run this once, from an
    ordinary (non-admin) PowerShell:

        powershell -ExecutionPolicy Bypass -File scripts\install-weekly-task.ps1

    Remove it with:

        Unregister-ScheduledTask -TaskName "Unprompted weekly run" -Confirm:$false
#>

$ErrorActionPreference = "Stop"

$taskName = "Unprompted weekly run"
$repo     = Split-Path -Parent $PSScriptRoot
$script   = Join-Path $repo "scripts\weekly-run.cmd"

if (-not (Test-Path $script)) { throw "not found: $script" }

# Monday 13:00 local. The cloud job used 13:00 UTC; this one follows the
# machine's clock because it can only run when the machine is on anyway.
# components/freshness.tsx counts down to the same slot and must stay in step.
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 1pm
$action  = New-ScheduledTaskAction -Execute $script -WorkingDirectory $repo

# StartWhenAvailable matters more than the exact time: a laptop that was asleep
# on Monday should still produce the week when it next wakes, because a missing
# week costs more than a late one.
#
# ExecutionTimeLimit is generous. Five engines including two local agents is a
# few hundred calls per category and can run for hours.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 8) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName    $taskName `
    -Description "Measures every Unprompted category on this machine and pushes the result. Local CLI engines cannot run in the cloud." `
    -Trigger     $trigger `
    -Action      $action `
    -Settings    $settings `
    -Force | Out-Null

Write-Host "Registered '$taskName'."
Write-Host "  runs:   Mondays at 13:00, or next wake-up if asleep"
Write-Host "  script: $script"
Write-Host "  log:    $env:TEMP\unprompted-weekly.log"
Write-Host ""
Write-Host "Run it once now to check it works:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
