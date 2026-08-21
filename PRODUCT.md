# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router deployed on Vercel, at unprompted.report (domain acquired 2026-08-21). User-selected.

The measurement pipeline is a **separate Python 3.11+ program** that runs on a GitHub Actions weekly cron and writes append-only JSON into the same public repository. The web app reads that JSON at build time and statically generates the public pages. There is no database anywhere in the system, by design.

## Users

**Primary: the hobbyist settling an argument.** A Pokémon card collector on their phone, mid-thread in a Discord server or a comment section, arguing about whether PSA or CGC is the better grading company. They need a real number in about five seconds, and they need to be able to screenshot it and drop it back into the thread. Mobile-first is not a nicety here; it is the main scene.

**Secondary: the brand that just found out it is losing.** A marketer at a grading company or a card-supply brand who saw the chart and wants to understand why their competitor gets named and they do not. They arrive on desktop and want depth: which specific questions they lose, which sources feed the answers that beat them.

The two audiences share one artifact. Design priority favors the hobbyist, because that audience is the distribution engine that makes the second audience arrive at all.

## Product Purpose

Unprompted publishes a free, public, weekly chart of which brands AI assistants actually recommend when real buyers ask what to buy, category by category, tracked forever and never edited.

Success is an unbroken weekly record that becomes the reference people cite when they argue about who AI recommends. The archive is the product; a competitor starting a year later can never catch up, because they cannot go back and collect the past.

## Positioning

At least ten companies already sell software that checks whether AI mentions your brand (Rankscale ~$20/mo, Otterly $29, Peec $95 to $495, Scrunch $250, AthenaHQ $295, Profound $399 into five figures). Every one is private, behind a login, one customer at a time.

**Not one publishes a public scoreboard of an entire category, and they structurally cannot:** their customers are the brands being scored, and no customer pays for software that publicly announces they are losing. That conflict of interest is the opening and it does not close when a competitor notices.

The claim a neighbor cannot copy: an open, verifiable, unbroken public record of machine preference over time.

## Operating Context

Launch category is **Pokémon card grading services** (PSA, CGC, Beckett/BGS, TAG, ACE). Category two is planned as card supplies (Ultra Pro, Dragon Shield, Vault X, Gamegenic, BCW).

The weekly ritual: a cron fires, a fixed bank of roughly fifteen buyer questions is asked of several AI engines five or more times each, brand mentions are extracted into structured records, names are normalized against an alias map, the result is appended to git, four sanity checks run, and the site either regenerates and deploys or holds and opens a GitHub issue for human review.

Engines at launch: OpenAI (ChatGPT surface, ~92% of AI referral traffic), Anthropic, Perplexity. Google AI Overviews is planned for phase two via Apify, deferred because it loads asynchronously and sometimes does not appear at all.

## Capabilities and Constraints

- **Every public page is public.** No login, no signup wall, no email gate anywhere on the reading surfaces. Crawlers and AI assistants must be able to read everything, because being citable is a core goal.
- **The admin layer is the only gated surface**, and it is single-operator.
- **Admin configuration is git-backed.** Editing a question or an engine setting in the admin UI produces a commit against the public repository, so every method change is timestamped, attributed and publicly verifiable. Saving is a commit, not an instant write.
- **The methodology carries a version.** Every run record stamps the version it ran under. Changing questions, run count, or the engine list without versioning silently breaks every comparison the publication makes.
- **Run data is append-only.** Nothing is ever overwritten or edited. The past is never rewritten.
- **Unknown brand names never reach the chart.** They go to a quarantine queue for human review, so a hallucinated brand is an inconvenience rather than a published error.
- **Engine errors are recorded, never raised.** One dead engine must not lose a week of data.
- **Answers are nondeterministic.** Each question is asked multiple times per engine per week and reported as a frequency, not a single sample. Google AI Overviews additionally sometimes fail to appear for the same query on consecutive requests, and "no overview shown" is recorded as real data rather than discarded.
- **API answers are not identical to the consumer app.** Every competing tool shares this limitation and none disclose it; Unprompted discloses it in the published methodology.
- **Small-field consequence:** grading returns roughly five to eight brands, not the twenty to forty a fragmented category would. The leader's raw appearance rate will sit near 100% and never move, so the meaningful figures are ordering, first-named share, and challenger emergence.

## Brand Commitments

- **Name: Unprompted.** Chosen deliberately. Brands appear in AI answers unprompted: they did not bid, did not pay, did not ask. It also nods to "prompt" without joining the crowded prompt-prefixed competitor names (Rank Prompt, Promptwatch, PromptRush).
- **The metric is called Rotation.** Borrowed from radio airplay. `times_named / total_runs`.
- **The recurring weekly segment is called The Snub.** The biggest faller. Intended as the most shareable artifact the publication produces.
- **Tagline direction:** what AI recommends when nobody is paying.
- **Required binding constraints from the user:** dark and light mode both, modern and agentic coloring, heavily animated and visually pleasing, fully polished, working perfectly on desktop and mobile.
- **Disclosure obligation:** the operator is commercially active in the Pokémon hobby through No Bulk Cards. A one-line disclosure stating that he is a customer of graders and not a competitor appears in the page header on every page, not a footer link.

## Evidence on Hand

- Domain unprompted.report, acquired 2026-08-21.
- An existing warm audience in the Pokémon hobby through No Bulk Cards and the HitHQ family, which is what makes a launch land at all.
- Competitor pricing and positioning research, sourced and dated 2026-08-21.
- Market research establishing AI referral traffic to US retail up 393% year over year in Q1 2026, converting 42% better than non-AI traffic, while representing about 0.10% of all sessions.

**Absences future work must not fabricate:** there is no historical chart data yet, no traffic, no users, no revenue, no testimonials, no press, and no logo or visual assets of any kind. The first real dataset does not exist until the pipeline runs. Any chart shown before then is synthetic and must be labeled as such.

## Product Principles

1. **The archive is the asset.** Anything that risks a gap in the weekly record, or that makes week 40 incomparable to week 1, is more expensive than it looks.
2. **Report, never editorialize.** The publication states what machines said. It does not rank, judge, or recommend. This is what makes operating in a category you sell into survivable.
3. **Public and checkable beats polished and trusted.** Open method, open code, open data. "Check my work" is the entire pitch, and any feature that weakens verifiability costs more than it adds.
4. **Fail safe, never fail open.** When a sanity check trips, publish nothing and ask a human. An embarrassing published chart costs more than a missed week.
5. **Shareable is the growth engine.** The hobbyist screenshotting a number into an argument is how this reaches the brands who eventually pay for the adjacent service.

## Accessibility & Inclusion

Mobile-first is a hard requirement, not a breakpoint afterthought: the primary scene is a phone in a live conversation. Charts and comparisons must be legible and operable on a small screen and must not depend on hover. Heavy animation is a stated requirement, so a `prefers-reduced-motion` path is mandatory rather than optional. Numeric data must be readable without relying on color alone to distinguish series.
