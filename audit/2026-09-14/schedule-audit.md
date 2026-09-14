# Monday automation audit — September 14, 2026

## Verdict

The installed task is enabled for every Monday at 13:00 Eastern, next on
September 21. Scheduling defects were repaired in the repository and installed
task. This is readiness evidence, not a guarantee of future publication.

The machine must remain powered on and the operator signed in; a locked session
is sufficient. Wake timers are enabled on AC power, disabled on battery. The task
now requests wake-up and catches up when available. It cannot run while shut down
or signed out. Interactive login is retained because the two local engine
subscriptions depend on the operator's session and credentials.

## Findings and disposition

| Finding | Disposition |
|---|---|
| WakeToRun was disabled | Enabled in installer and live task. |
| Trigger stored `13:00-04:00`, risking DST disagreement with the website's Eastern schedule | Replaced with offset-free local 13:00; weekly Monday interval remains one. |
| Launcher could measure/push from another branch | Requires `main`; pull and push explicitly target `origin/main`. |
| Push verification used a local upstream ref | Now queries the remote branch with `git ls-remote`; empty or unequal hashes fail. |
| Dirty-file guard split paths containing spaces | Corrected CMD file-size expansion and exercised a path containing spaces. |
| Uncommitted launcher/dependency changes escaped the method guard | Added scripts, requirements.lock, and pyproject.toml. |
| Git could request interactive authentication | Disabled Git/credential-manager prompts for the scheduled invocation. |
| Status write could be interrupted midway | Reused the pipeline's atomic JSON writer. |
| Watchdog required a nonexistent `weekly-run` label | Removed the label dependency; issue creation remains part of the existing scheduled alarm. No audit notification was sent. |
| Watchdog counted a newly dated rereading of an old measurement as this week's run | Requires matching category, nonempty readings, and a measurement date in the watched week; corrupt records do not silence the alarm. |
| Windows launcher had no hosted execution test | Added a Windows CI job using a temporary checkout, local bare remote, and fake measurement/notification transports. |

## Verified

- Live trigger: Monday, WeeksInterval=1, enabled; StartBoundary
  `2026-09-21T13:00:00` with no UTC offset.
- Live settings: WakeToRun=true, StartWhenAvailable=true, IgnoreNew, eight-hour
  execution limit; existing principal retained. No paid task was manually started.
- Today's real task started September 14 at 13:00; no missed triggers recorded.
  Exit 2 reflects mixed category outcomes, not failure to launch. The log confirms
  coding published, images held, writing refused by budget, and the data pushed.
- All five engines resolve in local preflight. Claude and OpenAI model/auth
  lookups succeeded without generation. Both CLI tools report logged in.
  Perplexity has configuration and today's successful run; no new paid auth probe.
- GitHub authentication is available. The independent watchdog workflow is active;
  its latest scheduled run completed September 8. Its cron is Tuesday 09:00 UTC;
  GitHub may start scheduled workflows late. Cloud measurement cron is intentionally
  disabled because it cannot reproduce the local CLI engines.
- Actual CMD integration: successful and held outcomes commit and push to the
  disposable remote; staged work, dirty data, changed scripts, and wrong branches
  refuse before measurement. No external provider calls or public issues.
- Local regression suite, shared metric checks, and dependency audit are used to
  qualify the change; hosted CI includes the new Windows launcher acceptance job.

## Remaining limits

The $150 monthly ceiling remains unchanged pending an explicit budget decision.
Recorded September spend is $132.3659. Next week's three-category estimate is
$56.64 (coding $19.64, images $20.30, writing $16.70), projecting $189.0059.
Therefore the task is scheduled, but all-category measurement is not funded.
At the unchanged balance, coding and images would refuse; writing currently fits
its individual estimate. Actual usage can differ. A five-Monday month at this
weekly estimate is $283.20 before recovery or variation.

Batch engine execution was implemented in the prior upgrade and passed offline
recovery/accounting tests. Its first scheduled execution is still the live batch
acceptance. Unresolved batches intentionally block new spending until collected.
Quality gates intentionally hold ambiguous or incomplete readings. No guarantees
are made about future provider uptime, credential expiry, invoice balances, or
GitHub/Vercel availability. Push failure retains local data for recovery.

This audit traced the scheduling, launch, environment, provider, checkpoint,
budget, publication, notification, watchdog, and CI paths and ran project checks.
It is not an assertion that every possible defect in every file is eliminated.

Microsoft scheduler reference:
https://learn.microsoft.com/en-us/windows/win32/taskschd/trigger-startboundary
