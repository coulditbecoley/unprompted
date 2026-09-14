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
$nextMonday = (Get-Date).Date.AddHours(13)
while ($nextMonday.DayOfWeek -ne 'Monday' -or $nextMonday -le (Get-Date)) {
    $nextMonday = $nextMonday.AddDays(1)
}
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At $nextMonday
# No UTC offset: keep 13:00 on the machine's local clock across DST changes.
$trigger.StartBoundary = $nextMonday.ToString("yyyy-MM-dd'T'HH:mm:ss")
$action  = New-ScheduledTaskAction -Execute $script -WorkingDirectory $repo

# StartWhenAvailable matters more than the exact time: a laptop that was asleep
# on Monday should still produce the week when it next wakes, because a missing
# week costs more than a late one.
#
# ExecutionTimeLimit is generous. Five engines including two local agents is a
# few hundred calls per category and can run for hours.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 8) `
    -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    # Retain the installed principal and credentials when correcting settings.
    Set-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Settings $settings | Out-Null
} else {
    Register-ScheduledTask `
    -TaskName    $taskName `
    -Description "Measures every Unprompted category on this machine and pushes the result. Local CLI engines cannot run in the cloud." `
    -Trigger     $trigger `
    -Action      $action `
    -Settings    $settings `
    -Force | Out-Null
}

Write-Host "Registered '$taskName'."
Write-Host "  runs:   Mondays at 13:00 local; wake requested, catch up when available"
Write-Host "  needs:  this machine powered on and the operator signed in (locking is fine)"
Write-Host "  script: $script"
Write-Host "  log:    $env:TEMP\unprompted-weekly.log"
Write-Host ""
Write-Host "Run it once now to check it works:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
