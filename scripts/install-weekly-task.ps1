<#
    Registers the weekly run with Windows Task Scheduler.

    The measurement moved off GitHub Actions because two of the five engines are
    local CLI harnesses signed in to this machine. Run this once, from an
    ordinary (non-admin) PowerShell:

        powershell -ExecutionPolicy Bypass -File scripts\install-weekly-task.ps1

    Remove it with:

        Unregister-ScheduledTask -TaskName "Unprompted weekly run" -Confirm:$false
        Unregister-ScheduledTask -TaskName "Unprompted Monday readiness" -Confirm:$false
#>

param(
    # Print the settings that would be registered, as JSON, and register nothing.
    [switch]$DryRun,
    # The interpreter that computes the readiness budget; the repo's own .venv by default.
    [string]$Python
)

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
# ExecutionTimeLimit is generous. Five engines including two local agents is a
# few hundred calls per category and can run for hours.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 8) `
    -MultipleInstances IgnoreNew

# Interactive, never "run whether logged on or not". That mode (S4U) gets no
# access to Windows Credential Manager, so git cannot read the saved GitHub
# sign-in and the publication preflight fails before anything is measured.
# That is what stopped 2026-09-21.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# Sunday 18:00: the weekly run's own first checks, the evening before, so a
# drifted CLI model or a broken key is an issue to fix rather than a lost week.
$readyName    = "Unprompted Monday readiness"
$readyTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Sunday -At ((Get-Date).Date.AddHours(18))
# Local 18:00 across DST, as for the weekly run above.
$readyTrigger.StartBoundary = (Get-Date).Date.AddHours(18).ToString("yyyy-MM-dd'T'HH:mm:ss")
$readyAction  = New-ScheduledTaskAction -Execute (Join-Path $repo ".venv\Scripts\python.exe") -Argument "scripts\readiness.py" -WorkingDirectory $repo
# The limit comes from the check's own budget (every allowed CLI retry, cleanup and
# the issue), never a fixed number: a fixed 45 minutes let Windows end a slow check
# before it could report. No fallback: a limit that cannot be computed stops here.
if (-not $Python) { $Python = Join-Path $repo ".venv\Scripts\python.exe" }
$limitText = & $Python (Join-Path $repo "scripts\readiness.py") --print-task-limit
if ($LASTEXITCODE -ne 0 -or "$limitText".Trim() -notmatch '^\d+$' -or [int]"$limitText".Trim() -le 0) {
    throw "could not compute the readiness time limit (got '$limitText'); nothing registered"
}
$readyLimit = New-TimeSpan -Seconds ([int]"$limitText".Trim())
$readySettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit $readyLimit -MultipleInstances IgnoreNew
# Wednesday 09:00: the same checks without any provider call (configuration,
# budget, GitHub sign-in, push access, disk, backup and export age, an unpushed
# week, an undelivered alert, the watchdog). Five days' notice instead of one
# evening's, at no cost.
$midName     = "Unprompted mid-week check"
$midTrigger  = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Wednesday -At ((Get-Date).Date.AddHours(9))
$midTrigger.StartBoundary = (Get-Date).Date.AddHours(9).ToString("yyyy-MM-dd'T'HH:mm:ss")
$midAction   = New-ScheduledTaskAction -Execute (Join-Path $repo ".venv\Scripts\python.exe") -Argument "scripts\readiness.py --free" -WorkingDirectory $repo
$midSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
if ($DryRun) {
    [pscustomobject]@{
        midweek_start           = $midTrigger.StartBoundary
        midweek_limit_seconds   = [int][System.Xml.XmlConvert]::ToTimeSpan($midSettings.ExecutionTimeLimit).TotalSeconds
        weekly_limit_seconds    = [int][System.Xml.XmlConvert]::ToTimeSpan($settings.ExecutionTimeLimit).TotalSeconds
        readiness_limit_seconds = [int]$readyLimit.TotalSeconds
        weekly_start            = $trigger.StartBoundary
        readiness_start         = $readyTrigger.StartBoundary
    } | ConvertTo-Json -Compress
    return
}
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Settings $settings -Principal $principal | Out-Null
} else {
    Register-ScheduledTask `
    -TaskName    $taskName `
    -Description "Measures every Unprompted category on this machine and pushes the result. Local CLI engines cannot run in the cloud." `
    -Trigger     $trigger `
    -Action      $action `
    -Settings    $settings `
    -Principal   $principal `
    -Force | Out-Null
}

if (Get-ScheduledTask -TaskName $readyName -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $readyName -Trigger $readyTrigger -Action $readyAction -Settings $readySettings -Principal $principal | Out-Null
} else {
    Register-ScheduledTask -TaskName $readyName -Description "Runs the weekly run's first checks the evening before and opens an issue if they fail." `
        -Trigger $readyTrigger -Action $readyAction -Settings $readySettings -Principal $principal -Force | Out-Null
}

if (Get-ScheduledTask -TaskName $midName -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $midName -Trigger $midTrigger -Action $midAction -Settings $midSettings -Principal $principal | Out-Null
} else {
    Register-ScheduledTask -TaskName $midName -Description "Free mid-week health check for the Unprompted weekly run; opens an issue if anything would stop Monday." `
        -Trigger $midTrigger -Action $midAction -Settings $midSettings -Principal $principal -Force | Out-Null
}

Write-Host "Registered '$taskName'."
Write-Host "Registered '$readyName' (Sundays 18:00)."
Write-Host "Registered '$midName' (Wednesdays 09:00, free)."
Write-Host "  runs:   Mondays at 13:00 local; wake requested, catch up when available"
Write-Host "  needs:  this machine powered on and the operator signed in (locking is fine)"
Write-Host "  script: $script"
Write-Host "  log:    $repo\.unprompted\logs\weekly.log"
Write-Host ""
Write-Host "Run it once now to check it works:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
