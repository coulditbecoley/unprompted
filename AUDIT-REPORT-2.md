# Second independent audit, 2026-08-26

A deeper pass over the whole project, run against commit `789d639` by a separate
agent with no involvement in writing the code, and told to hunt dead code,
anything out of place, and upgrades worth making. Published unedited below, on
the same terms as the first: a publication whose pitch is that its method is
public does not get to publish only the audits it likes.

**This is a snapshot.** It describes the tree as of 2026-08-26, and was acted on
the same day.

## What was fixed in response

| Finding | Status |
|---|---|
| F-8 the board showed an invented per-question denominator | **Fixed.** It divided answered rows by question count, which is an average, and published it as a count: the image board read "13/13" where fifteen runs had answered, and where five questions had only ten or eleven. Real numerators and denominators now come from the data. |
| F-3 an unchecked `git add` could report success having published nothing | **Fixed.** A failed stage is now caught before the "no new data" branch can mistake it for a clean week. |
| F-4 the rate limiter stored the raw caller address | **Fixed.** Hashed with a server-side secret before it reaches Redis, and the README claim corrected — it had said no address is stored while `rl:track:<ip>` sat in the store. |
| F-11 feed entries still hardcoded 13:00 UTC | **Fixed.** Half of this was fixed earlier and the per-entry half was missed; both now use the DST-aware schedule. |
| F-13 the operator's own `/admin` visits counted as audience | **Fixed**, on both sides. The earlier test missed it because it used curl, which runs no script. |
| F-12 "arrived from an assistant" counted plain search engines | **Fixed.** `bing.com`, `duckduckgo.com` and `openai.com` are out: they prove somebody used a search engine, not that an assistant cited this. |
| U-1 no committed test for the analytics contract | **Done.** `tests/analytics_contract.py`, 19 cases, each asserting the whole counter hash after a single event. |
| U-5 a question file re-read once per question | **Fixed**, along with the O(brands x questions x answers) scan behind the board. |
| D-5 a type-only package in production dependencies | **Fixed.** |

## What was deliberately not done

- **F-2, blocking a dirty tree from publishing.** Runs already stamp `-dirty` on
  the recorded commit, so the fact is captured. Refusing to publish would trade
  a whole week's measurement for an uncommitted comment, which is the worse
  failure for a weekly series.
- **F-1, the extractor registry not being authoritative for API extractors.**
  Real, and currently theoretical: one API extractor exists. Worth doing before
  a second one does.
- **F-5, F-6, F-7, F-9, F-10**, and the remaining dead-code findings. Open.
- The full U-2 refactor, persisting aggregates in Python and deleting the
  TypeScript metric. The correctness half was fixed at source. The rest does not
  remove the duplication it targets, because the archive is append-only and
  older runs carry no aggregates, so the site would need the second
  implementation as a fallback anyway.

---

# Deep audit, 2026-08-26

Verdict: There are no Critical findings. The second pass found three High-severity failures: the extractor registry is not authoritative for API extractors, a dirty source/configuration tree is allowed to produce an irreproducible public run, and an unchecked `git add` can make the weekly wrapper return success without publishing anything. The new analytics surface is compact and mostly fail-soft, but it does not yet meet its own correctness and privacy claims: the rate limiter uses the raw caller address as its identifier, the write path is not actually bounded by its 800 ms budget, archive outages are reported as successful empty syncs, mutable registry metadata can rewrite historical notes, and public counter labels can become Markdown in the private vault without escaping. The current public image board also displays invented per-question denominators. These are fixable without changing the project's core architecture; a database, user identity, or large framework migration would be a distraction.

## Dead, duplicated, or out of place

| ID | Severity | Finding | Primary evidence |
|---|:---:|---|---|
| D-1 | Low | Two exported helpers and four CSS selectors have no caller or rendered element | `components/ui.tsx:133-143`, `lib/agents.ts:78-81`, `app/globals.css:184-188`, `app/globals.css:252-255`, `app/globals.css:291-295` |
| D-2 | Low | Agent metadata has a second hand-maintained copy beside an unused registry helper | `agents.json:3-195`, `lib/agents.ts:38-52`, `lib/agents.ts:78-81`, `components/admin-analytics.tsx:339-386` |
| D-3 | Low | Assistant-referrer classification is duplicated across TypeScript and Python | `lib/analytics.ts:229-258`, `scripts/sync_analytics.py:55-72` |
| D-4 | Low | Current operational comments still describe the retired 225-call/category shape | `lib/categories.ts:42-46`, `src/unprompted/cli_provider.py:27-30`, `src/unprompted/extract.py:166-168`, `src/unprompted/reextract.py:1-5` |
| D-5 | Low | A type-only package is installed as a production dependency | `package.json:12-25` |

## Defects

| ID | Severity | Finding | Primary evidence |
|---|:---:|---|---|
| F-1 | High | Every enabled API extractor means “Claude Batch API,” regardless of registry ID or environment, and an unavailable primary API never falls through to the declared CLI fallbacks | `app/api/admin/commit/route.ts:133-176`, `src/unprompted/cli_provider.py:251-281`, `src/unprompted/run.py:125-139`, `src/unprompted/run.py:185-195`, `README.md:123-153` |
| F-2 | High | The scheduler permits uncommitted source, questions, aliases, and provider configuration to publish an unreproducible run | `scripts/weekly-run.cmd:17-34`, `src/unprompted/run.py:64-84`, `src/unprompted/run.py:185-211` |
| F-3 | High | `git add` is unchecked, so staging failure is reported as “No new data” and the task can exit successfully | `scripts/weekly-run.cmd:52-72` |
| F-4 | Medium | The “no address / no identifier” analytics claim is false for the rate limiter | `lib/rate-limit.ts:18-21`, `lib/rate-limit.ts:61-64`, `lib/rate-limit.ts:79-85`, `README.md:224-226` |
| F-5 | Medium | Redis construction and the analytics write happen outside the advertised failure budget | `lib/analytics.ts:33-41`, `lib/analytics.ts:126-132`, `lib/analytics.ts:170-205`, `lib/rate-limit.ts:79-88`, `app/api/track/route.ts:63-108` |
| F-6 | Medium | An unreachable Redis is archived as an empty day and the sync still exits zero; the weekly wrapper also discards both archive exit codes | `scripts/sync_analytics.py:84-96`, `scripts/sync_analytics.py:317-382`, `scripts/weekly-run.cmd:90-97` |
| F-7 | Medium | Public analytics values can poison counters and inject Markdown into the private Obsidian archive | `app/api/track/route.ts:40-49`, `app/api/track/route.ts:81-107`, `lib/analytics.ts:164-168`, `scripts/sync_analytics.py:129-135`, `scripts/sync_analytics.py:192-216` |
| F-8 | Medium | The interactive board reconstructs one denominator for every question and is wrong on the current public image run | `lib/data.ts:217-222`, `components/board-live.tsx:96-102`, `components/board-live.tsx:139-149`, `data/runs/2026-08-24/ai-image-generators.json:8630` |
| F-9 | Medium | Historical agent/vendor labels are regenerated from today's registry, so editing the registry can rewrite old notes | `lib/analytics.ts:138-142`, `scripts/sync_analytics.py:75-78`, `scripts/sync_analytics.py:182-187`, `scripts/sync_analytics.py:359-380` |
| F-10 | Medium | `/questions` and the machine-readable guide promise the publication's questions while serving only the default category | `app/questions/page.tsx:6-27`, `app/questions/page.tsx:44-94`, `lib/categories.ts:79-113`, `app/llms.txt/route.ts:43-53` |
| F-11 | Medium | The feed's top timestamp uses the DST-aware schedule, but every entry still uses hard-coded 13:00 UTC | `app/feed.xml/route.ts:40-43`, `app/feed.xml/route.ts:74-80`, `lib/schedule.ts:1-17`, `lib/schedule.ts:58-62` |
| F-12 | Medium | “Arrived from an assistant” includes ambiguous general search/corporate hosts and overstates what the referrer proves | `lib/analytics.ts:229-258`, `components/admin-analytics.tsx:270-282`, `README.md:234-238` |
| F-13 | Low | Authenticated operator visits to `/admin` are counted as human audience traffic | `app/layout.tsx:80-92`, `components/beacon.tsx:96-103`, `app/api/track/route.ts:87-107`, `lib/analytics.ts:143-154` |

## Upgrades worth making

| Rank | Severity | Upgrade | Value / effort | Primary evidence |
|---:|:---:|---|---|---|
| U-1 | High | Commit an analytics contract suite covering the writer, proxy/route split, limiter failure modes, and archive | Very high / medium | `package.json:5-10`, `.github/workflows/ci.yml:25-40`, `lib/analytics.ts:130-205`, `scripts/sync_analytics.py:317-382` |
| U-2 | High | Persist per-question numerators and denominators once in Python and have the site render them | Very high / medium | `src/unprompted/aggregate.py:59-123`, `lib/data.ts:183-243`, `tests/agreement.test.mjs:22-80`, `components/board-live.tsx:96-102` |
| U-3 | Medium | Make the vault sync observable and atomic: distinguish missing keys from transport errors, write temp-and-replace, and alert on failure | High / low-medium | `scripts/sync_analytics.py:84-126`, `scripts/sync_analytics.py:349-382`, `scripts/sync-vault.cmd:7-14` |
| U-4 | Medium | Put a real timeout on the Redis client, use a cheaper fixed window, and move IP limiting to the platform or a disclosed keyed pseudonym | High / low | `lib/analytics.ts:35-41`, `lib/rate-limit.ts:39-56`, `lib/rate-limit.ts:76-88` |
| U-5 | Low | Cache build-time run/YAML reads and stop loading the same question file inside a loop | Medium / low | `lib/data.ts:109-173`, `components/chart-board.tsx:35-36`, `components/chart-board.tsx:98-101`, `app/sitemap.ts:30-44` |
| U-6 | Low | Take patch dependency updates, align Node types to the Node 24 CI runtime, and move `@types/js-yaml` to dev dependencies | Low / low | `package.json:12-25`, `.github/workflows/ci.yml:28-34` |

## Detail: dead, duplicated, or out of place

### D-1 — Unused exports and CSS remnants

`SequencerHead()` remains exported in `components/ui.tsx:133-143`, but the interactive board replaced it with its own sortable header at `components/board-live.tsx:158-192`; repository-wide reference counting found only the definition. `knownAgents()` at `lib/agents.ts:78-81` likewise has no caller. The unused CSS selectors are `.trim-left`, `.wordmark-text`, `.wordmark-chip`, and `.buffer-head`; the live elements use `trim-top`, `logo-word`/`logo-lockup`, and no buffer header (`app/page.tsx:88-108`).

Why it matters: these remnants make the reusable surface look larger than it is and obscure which registry path is authoritative. The CSS is small, but it is exactly the kind of post-redesign residue this audit was asked to find.

Fix: delete `SequencerHead`, either use `knownAgents()` as part of D-2's consolidation or delete it, and remove the four dead selector arms. Severity: **Low**.

### D-2 — Agent metadata has a second hand-maintained copy

Classification reads `agents.json` through `lib/agents.ts:38-52`. The dashboard does not use that source; it repeats every current name/vendor/purpose in `AGENT_META` (`components/admin-analytics.tsx:339-386`) and defaults an unknown name to `training` (`components/admin-analytics.tsx:139-145`). The exported `knownAgents()` that could supply the current registry is unused.

Why it matters: a newly added live agent will be classified and counted correctly, then shown on the dashboard with no vendor and the wrong purpose until a second file is edited. The current 32 registry names are unique and all patterns compile, so this is prospective drift, not a claim that today's table is already mismatched.

Fix: derive current metadata from `agents.json`; retain a small explicit legacy map only for names removed from the registry but still present in Redis. Severity: **Low**.

### D-3 — Assistant host logic is duplicated across languages

`ASSISTANT_HOSTS` is independently defined in `lib/analytics.ts:237-254` and `scripts/sync_analytics.py:60-68`. The comment calls the list “short and stable,” but it already contains sixteen changing product surfaces. A one-sided edit changes whether the live dashboard and archived vault call the same referral an assistant.

Fix: put hosts in a small JSON registry read by both runtimes, or archive the derived classification so Python never reclassifies it. Severity: **Low**.

### D-4 — The old call count survives in live operational comments

There are five enabled engines (`providers.json:3-27`, `providers.json:68-98`) and fifteen questions with five repeats, so a current category schedules 375 engine calls (`src/unprompted/run.py:141-147`). `lib/categories.ts:44`, `src/unprompted/cli_provider.py:29`, `src/unprompted/extract.py:167`, and `src/unprompted/reextract.py:4` still say 225.

Why it matters: those comments explain cost, timeouts, and the value of re-extraction. They now understate the live unit of work by 40%.

Fix: write the invariant (`questions × engines × repeats`) rather than another literal, or update the comments when the method engine count changes. Historical tests and reports that correctly describe old 225-row runs should remain untouched. Severity: **Low**.

### D-5 — Type declarations are in production dependencies

`@types/js-yaml` is under `dependencies` at `package.json:12-19`; it is used only by TypeScript during development/build. `js-yaml` itself is the runtime package.

Why it matters: production-only installs and dependency inventories carry a package that cannot execute at runtime, obscuring the real deployed surface for no benefit.

Fix: move `@types/js-yaml` to `devDependencies`. Severity: **Low**.

## Detail: defects

### F-1 — The extractor registry is not authoritative

The admin/API validator accepts any API provider ID as long as it names an environment variable (`app/api/admin/commit/route.ts:133-176`). The Python selector then treats the first enabled entry of *any* API kind as the sentinel `None` (`src/unprompted/cli_provider.py:268-272`). `run_category()` interprets `None` as Anthropic, checks only `ANTHROPIC_API_KEY`, invokes the hard-coded Claude Batch path, and records the extractor as the generic string `api` (`src/unprompted/run.py:125-139`, `src/unprompted/run.py:185-195`).

Two failures follow:

1. Adding an enabled `mistral-api-extract` or any other API extractor through the supported admin UI silently runs Claude instead. The registry ID, declared environment, and displayed provider do not control execution.
2. With `claude-api-extract` enabled but its key absent, selection stops at that unavailable API. The run aborts before reaching the enabled local CLI entries, despite `README.md:128-153`, `providers.json:38-66`, and the admin copy calling them fallbacks for a machine with no key. The dashboard makes the same mistake by treating every API extractor as active without consulting `ready` (`app/admin/page.tsx:57-60`).

Why it matters: this is method and provenance drift, not only a bad status badge. The extractor that reads the week can differ from the registry entry the operator believes is active, or a declared fallback can fail to provide availability at all.

Fix: make selection return a tagged adapter object, never `None`. Maintain an API-extractor adapter map keyed by registry ID, validate IDs at commit/preflight, test availability using the entry's declared environment, fall through unavailable entries in registry order, and persist the selected ID plus model. Add tests for “primary API has no key, CLI is present” and “unknown API extractor is rejected.” Severity: **High**.

### F-2 — A dirty method can publish

The wrapper checks only `data` and `reports` before the run (`scripts/weekly-run.cmd:24-34`). A modified `questions/*.yml`, `aliases/*.yml`, `providers.json`, extractor prompt, normalization rule, or engine adapter is allowed. `git_sha()` detects that the tree is dirty and stores `<HEAD>-dirty` (`src/unprompted/run.py:64-84`), but that marker does not hold the run; the record is still checked and persisted to `data/runs` (`src/unprompted/run.py:185-211`). The wrapper later stages only data and reports.

Why it matters: the public commit can contain numbers produced by code or method inputs that are absent from that commit. `-dirty` admits the problem but does not preserve the diff needed to reproduce the week. This is a concrete hole in the “method and raw data public” claim.

Fix: before any provider call, require a clean worktree for every tracked and untracked method/code path (ignored local secrets remain ignored). Better still, store hashes for the question bank, alias map, provider registry, extraction prompt/schema, and lockfile, and fail closed if the commit cannot be resolved cleanly. Severity: **High**.

### F-3 — A staging failure looks like success

`git add data reports` at `scripts/weekly-run.cmd:52` has no error check. The next command asks whether the index has a diff; if staging failed and the index is unchanged, the script prints “No new data to commit,” jumps to `:published`, runs the optional mirrors, and exits with the pipeline's `0` or `2` (`scripts/weekly-run.cmd:53-56`, `scripts/weekly-run.cmd:90-97`).

Why it matters: an index lock, permission failure, or damaged repository can leave the complete week only on the operator's disk while Task Scheduler reports success. This is the same outcome the earlier push fix was meant to eliminate, at an earlier step that remained unchecked.

Fix: branch on `git add` immediately; on failure return publishing exit code 3 and retain the generated paths for manual recovery. After staging, assert that every generated run/held/report/quarantine path is present in the index before committing. Add the stage failure to the wrapper's fake-git integration cases. Severity: **High**.

### F-4 — The rate limiter stores the raw caller address as its identifier

`callerFor()` returns the first `x-forwarded-for` value or `x-real-ip` verbatim (`lib/rate-limit.ts:61-64`), and `rateLimit()` passes that raw value directly to `rl.limit()` (`lib/rate-limit.ts:79-85`). The comment instead says the SDK stores “a counter under a hash of it” (`lib/rate-limit.ts:18-21`), while the installed `@upstash/ratelimit` implementation constructs the key by joining prefix and identifier (`node_modules/@upstash/ratelimit/dist/index.mjs:969-970`). The Redis key therefore contains the address until the one-minute limiter window expires.

Why it matters: the main audience hashes do not store IPs, but the shared Redis database still does. `README.md:224-226`, the dashboard, and the vault note make an unconditional “no address / no identifier” claim. A short-lived IP key is lower risk than a durable visitor profile, but it is still an address-derived identifier.

Fix: either move this coarse protection to Vercel Firewall so the application datastore never receives the address, or derive a short-lived keyed pseudonym server-side and disclose that accurately. Do not use an unsalted hash; the IPv4 space is enumerable. Severity: **Medium**.

### F-5 — The 800 ms Redis budget does not bound the endpoint

The `Promise.race` in `rateLimit()` bounds only the limiter promise (`lib/rate-limit.ts:79-88`) and does not cancel it. When it times out open, `/api/track` proceeds to `await record()` (`app/api/track/route.ts:102-107`), which makes a second Redis call with no timeout (`lib/analytics.ts:170-205`). Client construction also occurs before either function's `try`: a malformed configured URL can throw from `redis()` (`lib/analytics.ts:35-41`), from `record()` at line 131, or from `get()` before the limiter's catch at `lib/rate-limit.ts:80`.

Why it matters: a merely slow Redis can still make the tracking route slow after the limiter “fails open,” and malformed configuration can make `/api/track` return 500 instead of its promised 204. `/api/subscribe` can also fail before reaching its own provider path. The proxy's agent count is placed in `waitUntil`, so public HTML remains isolated; the route handlers are not.

Fix: construct the Redis client defensively with an abort signal/request timeout and a small or disabled retry budget; catch `redis()`/limiter construction; and give `record()` its own deadline. If the limiter race wins, abort the underlying request rather than leaving it to consume commands later. Severity: **Medium**.

### F-6 — Archive transport errors are successful empty syncs

`fetch_day()` catches network, timeout, and parse errors, prints “unreachable,” and returns the same `{}` used for an absent/expired key (`scripts/sync_analytics.py:84-96`). `main()` skips empty results and unconditionally returns zero (`scripts/sync_analytics.py:349-382`). At the end of a weekly run, both vault commands have their exit codes ignored before the wrapper returns `RUN_EXIT` (`scripts/weekly-run.cmd:90-97`).

Why it matters: a broken token, bad URL, or ninety consecutive days of unreachable Redis can erase the only long-term audience history while every scheduled result stays green. The “never overwrite with less” guard protects already captured days; it cannot protect a day never captured.

Fix: distinguish `missing` from `failed`, accumulate failures, and return nonzero if any requested live day could not be read. Have both wrappers preserve each sync status and emit a visible failure/alert without undoing a successfully published week. Write raw JSON atomically. Severity: **Medium**.

### F-7 — Untrusted counter labels become Markdown

The public route accepts any 300-character string beginning with `/` as `path` and permits arbitrary values for query keys `a`, `b`, and `c` (`app/api/track/route.ts:40-49`, `app/api/track/route.ts:81-107`). Those values become Redis hash field names and comparison/brand labels (`lib/analytics.ts:164-168`). The archive's `table()` writes names directly between Markdown pipes with no escaping (`scripts/sync_analytics.py:129-135`), and the day note renders page, brand, comparison, click, and missing-path fields through it (`scripts/sync_analytics.py:192-216`).

Why it matters: one rate-limited POST can add pipes, newlines, links, or image syntax to the operator's private Obsidian note. React safely escapes the live dashboard, but Markdown is a separate rendering boundary. The same endpoint can also invent page views, brand lookups, comparisons, and click labels; the rate limit bounds volume per apparent caller, not truth.

Fix: validate paths as canonical site pathnames, reject control characters, allowlist event labels, constrain comparison values to known slugs, and escape Markdown cells (`|`, backslash, CR/LF, and link/image metacharacters) when rendering. Keep raw JSON, but treat every field in it as untrusted. Severity: **Medium**.

### F-8 — The board invents per-question denominators

`standings()` correctly computes each step using that question's answered rows (`lib/data.ts:217-222`). `LiveBoard` throws those denominators away and reconstructs one value as `round(total answered runs / number of visible questions)` (`components/board-live.tsx:96-102`), then displays `round(step × reconstructed denominator)` (`components/board-live.tsx:139-149`).

This is wrong on the current public image run. A read-only count of `data/runs/2026-08-24/ai-image-generators.json` found 201 answered rows across 15 questions; actual answered denominators range from 10 to 15 because the stored usage-limit failures begin at line 8630. The UI uses 13 for every question. The step height remains correct, but the hover sentence's `N/13` is fabricated for most columns.

Fix: make a step carry `{ named, answered }`, not only a rounded rate. Use the declared question order so a completely failed question remains visible as failed rather than disappearing. This should become the persisted cross-language aggregate described in U-2. Severity: **Medium**.

### F-9 — Today's registry rewrites yesterday's agent labels

The daily counter stores agent name and aggregate purpose as separate fields (`g:name` and `p:purpose`) but no name→vendor/purpose snapshot (`lib/analytics.ts:138-142`). On every sync, Python reads the current `agents.json`, labels each historical agent row from that current metadata, and rebuilds every note from all archived JSON (`scripts/sync_analytics.py:75-78`, `scripts/sync_analytics.py:182-187`, `scripts/sync_analytics.py:359-380`).

Why it matters: correcting a vendor or changing an agent from `training` to `search` silently relabels old notes even though the raw daily data cannot establish that historical mapping. Aggregate `p:*` counts remain original, so the rewritten per-agent labels can disagree with their own purpose totals.

Fix: snapshot agent vendor/purpose beside each raw day, or store a name+purpose composite counter. Never regenerate historical semantics solely from a mutable current registry. Severity: **Medium**.

### F-10 — The transparency page covers one of three categories

`/questions` imports the single `CATEGORY` alias, reads one YAML file, and loads one latest run (`app/questions/page.tsx:6-27`). It has no category selector or dynamic route and iterates only that one specification (`app/questions/page.tsx:44-94`). `CATEGORY` aliases `DEFAULT_CATEGORY`, currently AI Coding Assistants (`lib/categories.ts:79-113`, `lib/data.ts:498`). The machine guide nevertheless links `/questions` as “Every question and answer” for a publication whose preceding loop lists all categories (`app/llms.txt/route.ts:43-53`, `app/llms.txt/route.ts:55-73`).

Why it matters: the public trust surface is incomplete for writing tools and image generators. Their raw JSON exists in git, but the site and `llms.txt` imply the human-readable evidence page covers them.

Fix: add `/questions/[category]` or category tabs driven by `CATEGORIES`, link each chart and `llms.txt` entry to its category evidence page, and keep the bare route as the default/selector. Severity: **Medium**.

### F-11 — The feed timestamp fix is only half applied

The feed-level `<updated>` uses `runInstant()` (`app/feed.xml/route.ts:40-43`), which converts 13:00 America/New_York to the correct UTC instant (`lib/schedule.ts:58-62`). Each entry independently stamps `${run_date}T13:00:00Z` (`app/feed.xml/route.ts:74-80`). The schedule comment explicitly identifies that old UTC assumption as the bug (`lib/schedule.ts:1-8`).

Why it matters: Atom readers see internally inconsistent timestamps; in daylight time an entry claims publication four hours before the configured task, and in standard time five hours before it.

Fix: use `runInstant(run.run_date).toISOString()` for each entry as well. Longer term, persist actual start/end/publish time because `StartWhenAvailable` can run late. Severity: **Medium**.

### F-12 — An ambiguous host is treated as proof of assistant citation

`ASSISTANT_HOSTS` includes broad hosts such as `openai.com`, `bing.com`, and `duckduckgo.com`, plus every subdomain (`lib/analytics.ts:237-258`). The UI then states that every matching referral means a person asked an assistant, received this site, and clicked through (`components/admin-analytics.tsx:270-282`; the same claim is in `README.md:234-238`). A hostname alone cannot distinguish an ordinary Bing/DuckDuckGo search result or an OpenAI corporate/documentation link from an assistant answer.

Why it matters: “arrived from an assistant” is one of the four headline audience numbers, and this rule biases it upward while presenting an inference as an observed fact.

Fix: restrict the strong label to product hosts known to identify an assistant UI, split ambiguous search hosts into a separate “assistant/search surface” bucket, and word hostname inference as inference. Severity: **Medium**.

### F-13 — The operator is part of the audience count

`Beacon` is mounted in the root layout for every route, including `/admin` (`app/layout.tsx:80-92`). It sends that pathname (`components/beacon.tsx:96-103`); `/api/track` excludes agents but has no admin/operator exclusion (`app/api/track/route.ts:87-107`); `record()` therefore increments `v:/admin` and `t:human` (`lib/analytics.ts:143-154`). Only someone who passed the admin gate can render that page, so this is predominantly the operator measuring their own dashboard use.

Why it matters: low-traffic human totals and “pages people read” can be materially skewed by routine operator checks.

Fix: do not mount/send the beacon for `/admin`, or reject admin paths in `/api/track`. Severity: **Low**.

## Detail: upgrades

### U-1 — Commit the analytics audit as tests

The JavaScript test script runs only `tests/agreement.test.mjs` (`package.json:5-10`), and CI runs that one file (`.github/workflows/ci.yml:35-40`). There is no committed test for `proxy.ts`, `/api/track`, `lib/analytics.ts`, `lib/rate-limit.ts`, or `scripts/sync_analytics.py`. The latest commit describes a useful 17-case manual audit, but none of those cases can prevent regression.

Add a fake Redis that asserts the entire hash/list after one event at a time, route tests for agent rejection and untrusted fields, failure tests for invalid/slow Redis, archive tests that distinguish expiry from outage, and a wrapper test with fake git exit codes. This is the highest-value upgrade because recent defects were plausible totals that burst-level checks could not see. Severity/value: **High**.

### U-2 — Publish the derived metric once

The original audit found Python, production TypeScript, and test JavaScript copies of standings. They still exist at `src/unprompted/aggregate.py:59-123`, `lib/data.ts:183-243`, and `tests/agreement.test.mjs:22-80`. F-8 is new evidence of the cost: the interactive client needed a denominator that the duplicated `BrandStanding` shape did not retain, so it reconstructed the wrong one.

Have Python persist a versioned aggregate containing global and per-question `{named, first, answered}` counts. Let Next validate and render it; keep a recomputation tool as an audit, not production logic. This closes both the old three-copy drift and the new UI denominator error. Severity/value: **High**.

### U-3 — Treat the archive as an operated backup

After F-6, the small next step is not a new datastore. Give the sync a manifest/cursor of days successfully captured, atomic temp-and-replace writes, explicit missing/error results, and a nonzero/alerting scheduled result. `write_raw()` currently writes directly to the destination (`scripts/sync_analytics.py:107-126`), while `sync-vault.cmd` merely runs the scripts (`scripts/sync-vault.cmd:7-14`). A daily task installer or documented registration would also make the “scheduled daily” comment reproducible from the repository.

Severity/value: **Medium**.

### U-4 — Simplify and bound rate limiting

The current sliding window (`lib/rate-limit.ts:49-55`) is more precise and more command-expensive than this coarse “stop an accidental loop” use case needs. Use a fixed window, configure the Redis SDK's abort signal and retry budget, and decide explicitly whether the IP boundary belongs in Vercel Firewall or in a disclosed short-lived pseudonymous key. This reduces metered commands and fixes F-4/F-5 without adding identity.

Severity/value: **Medium**.

### U-5 — Cache build-time file reads

`latestRun()` reparses all history through `loadHistory()` (`lib/data.ts:109-145`), and several pages call both in one render. `components/chart-board.tsx:98-101` calls `loadQuestionText(category.slug)` once per question inside `map`, rereading the same YAML about fifteen times. Sitemap likewise calls `latestRun()` and then `allBrands()` per category (`app/sitemap.ts:30-44`), both of which scan history.

Use a per-build memoized loader keyed by category and hoist question text before the loop. Do not add a runtime cache service; these are immutable files during a build. Severity/value: **Low**.

### U-6 — Take narrow dependency housekeeping, not major churn

At audit time, `npm outdated` reported patch/minor-in-range updates for Next 16.3.3, `@upstash/redis` 1.38.3, `js-yaml` 5.4.0, and `@types/react-dom` 19.2.5. CI runs Node 24 while `@types/node` is constrained to 22 (`package.json:21-25`, `.github/workflows/ci.yml:28-34`). Take those through the existing build/tests, align Node types to 24, and move `@types/js-yaml` as in D-5.

I would not jump to React 19.2 or TypeScript 7 merely because they are newer: `npm audit --omit=dev` reports zero vulnerabilities, and there is no verified defect here that major toolchain churn would fix. Severity/value: **Low**.

## What I would not bother with

- **Do not add cookies, visitor IDs, fingerprinting, or sessions to improve audience accuracy.** They would destroy the useful privacy property for a dashboard whose numbers are operational, not billing or experimentation data.
- **Do not move `data/runs` into a database.** The High findings are preflight, adapter, and wrapper-control failures; a database would not fix them and would weaken the public audit trail.
- **Do not replace the Obsidian archive with a general analytics platform.** Make the existing daily copy observable and safe first.
- **Do not delete the two identical `.agents/skills` and `.claude/skills` trees merely because they duplicate 123,731 bytes each.** They target two different agent clients and are tooling, not runtime code; consolidate only if both clients support one shared location.
- **Do not reformat or split the 1,790-line Python test file as part of these fixes.** Add the missing boundary tests first; moving existing tests has no correctness payoff.

## Checked and found genuinely fine

- **Daily Redis growth is bounded.** Daily hashes expire after ninety days (`lib/analytics.ts:49`, `lib/analytics.ts:170-174`), the event feed is trimmed to 200 rows (`lib/analytics.ts:174-190`), and the non-expiring cadence hash has only two fields per classified agent (`lib/analytics.ts:192-199`). A day aging out does not overwrite a previously captured archive with `{}` (`scripts/sync_analytics.py:107-125`). F-6 is about never-captured days, not this overwrite guard.
- **The human/agent split is structurally sensible.** Humans are omitted from the proxy and counted by the beacon; self-declared agents are rejected by `/api/track` (`lib/analytics.ts:208-227`, `app/api/track/route.ts:90-95`). The recent fixes prevent a human 404 from becoming a page view and split human from agent brand lookups (`lib/analytics.ts:143-165`).
- **The main analytics payload has no cookie, device ID, fingerprint, or durable IP.** Referrers are reduced to hostnames and queries to three address keys (`app/api/track/route.ts:32-60`). F-4 is the explicit exception in the rate-limit key.
- **Secrets remain server-side.** Upstash credentials are read only by server modules (`lib/analytics.ts:27-41`); `GITHUB_TOKEN` is confined to the authenticated commit route (`app/api/admin/commit/route.ts:25-38`). `NEXT_PUBLIC_WEB3FORMS_KEY` is public by design and can submit only to Web3Forms (`components/contact.tsx:18-29`, `components/contact.tsx:60-70`); it does not reach Redis, GitHub, or admin authentication.
- **Admin writes remain tightly scoped.** The route rechecks authorization, maps targets to exact paths, caps content at 64 KiB, parses it, and pins CLI command+arguments (`app/api/admin/commit/route.ts:14-29`, `app/api/admin/commit/route.ts:47-64`, `app/api/admin/commit/route.ts:149-176`). F-1 is the missing API-extractor adapter validation, not a path or command injection.
- **Public React and Atom rendering escape untrusted record text.** There is no model-controlled `dangerouslySetInnerHTML`; the two uses in `app/layout.tsx:27-78` are compile-time constants, and Atom uses `esc()` (`app/feed.xml/route.ts:53-80`, `app/feed.xml/route.ts:105-110`). F-7 is specific to the separate Markdown renderer.
- **Batch failure containment is substantially better.** Schema construction is inside the protected block, timed-out batches are cancelled, missing results become errors, and already returned results survive a later batch failure (`src/unprompted/extract.py:431-530`). The original staging/checkpoint gap remains open and is not repeated here.
- **The extraction invention floor is real.** Extracted names absent from their source answer are dropped on live, CLI, and batch paths (`src/unprompted/extract.py:246-312`). This does not replace the still-open human-labelled benchmark from the first audit.
- **Normal weekly category containment and push verification work.** Categories are caught independently (`src/unprompted/run.py:301-347`), commit and push failures return 3, and the wrapper compares local with upstream SHA (`scripts/weekly-run.cmd:58-88`). F-3 is the unhandled staging step before those checks.
- **Current stored artifacts are structurally clean.** All six run/held JSON files parsed; across 1,500 extraction rows there were zero duplicate `(question_id, engine, run_index)` keys, zero duplicate canonical brands inside an answer, and zero non-sequential stored positions.
- **The agent registry is internally valid today.** All 32 names are unique and every regular expression compiles. The dashboard duplicate currently covers the same names; D-2/F-9 concern the next registry edit and historical semantics.
- **No declared dependency is wholly unused.** Anthropic, OpenAI, Pydantic, PyYAML, Next, React, `js-yaml`, and both Upstash packages have real imports. D-5 is dependency placement, not dead-package removal.

## Verification performed

- Read `AUDIT-REPORT.md` first and treated its open/fixed list as an exclusion list. This report does not re-list the unsandboxed local CLIs, missing human-labelled extractor benchmark, denominator policy, shallow run schema, Python lockfile, cost assumptions, manual cloud workflow, obsolete `PRODUCT.md`, or the previously identified unused helpers unless new code exposed a distinct failure.
- Read the current executable, configuration, documentation, new analytics, public-page, admin, scheduler, and test surfaces; inspected the diffs from the first report's publication commit through `789d639`.
- `npx tsc --noEmit --incremental false`: passed.
- `npx tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters`: found the already-reported unused `DISCLOSURE` import plus the independently verified no-reference exports/CSS listed in D-1. The `DISCLOSURE` item is not repeated because the first audit already found it.
- `npm test`: passed, 1/1. It still runs only the agreement test.
- `npm audit --omit=dev --audit-level=low`: zero reported vulnerabilities.
- `npm outdated --long`: completed using a temporary cache outside the repository; results are summarized in U-6.
- Python tests were attempted with both `python` and `py -3.12`, but neither executable is available in this execution environment. No claim is made that the current Python suite was rerun here; CI configuration targets Python 3.12 and the stored suite contains 106 test functions.
- A production build was deliberately not run because `next build` writes `.next` inside the repository and the brief prohibited modifying anything except this report. Type checking and the Node test were run without repository writes.
- No model/provider, GitHub write, Web3Forms, Buttondown, Redis mutation, admin action, scheduler registration, or vault write was attempted.
- `git status` was clean before this report was created. This report is the only intended repository change.

## Recommended order

1. Make extractor selection typed, available-aware, and adapter-backed; reject unknown API extractors (F-1).
2. Refuse dirty method/code trees and check staging before any success path (F-2, F-3).
3. Correct the live board denominator and persist per-question counts once (F-8, U-2).
4. Fix Redis privacy/timeout behavior and escape the archive boundary (F-4, F-5, F-7).
5. Make archive failures nonzero and observable, then snapshot agent metadata (F-6, F-9, U-3).
6. Close the public-surface accuracy gaps: all-category questions, entry timestamps, referrer wording, and admin self-counting (F-10 through F-13).
7. Commit the analytics contract suite, then do the dead-code and dependency housekeeping (U-1, D-1 through D-5, U-5/U-6).
