# Design

Written from the built site, not ahead of it. Direction locked by seed
`06ec8236`, chosen over the assigned roll, palette overridden by brief.

---

## The world

**Algorave source floor.** A live-coding performance: the source that drives the
output is projected, visible, and edited in front of the room. Applied here, the
query is visible and the output is live — Unprompted shows the questions that
produced the chart, running in public.

What it refuses: the dashboard-of-cards arrangement every AI-visibility tool
ships. No rounded card grid, no gradient hero, no line-chart-as-decoration.

**Palette overridden by brief** from the world's native phosphor-on-black, which
is both the most predictable rendition of a live-code world and the near-black-
plus-neon cliché. Carbon fibre and Apple off-white replace it.

---

## Materials

Two flat surfaces carry everything. Carbon fibre is **trim**, never ground.

| Token | Value | Role |
|---|---|---|
| `--graphite` | `#121417` | Dark ground. Flat, never textured. |
| `--graphite-raise` | `#1a1d21` | Raised surface, dark |
| `--bone` | `#f5f4f0` | Light ground, and dark-mode ink |
| `--bone-shade` | `#e6e4dc` | Secondary surface, light |
| `--carbon-base` | `#15171a` | Trim material only |
| `--amber` | `#e8913c` | The one signal |
| `--rise` / `--fall` | `#3e7f6b` / `#a8523c` | Movement reinforcement only |

### Carbon fibre rules

Real 2×2 twill at a **4px tile**, matte, built from two crossed
`repeating-linear-gradient`s. Defined once, in the `.carbon` class, so the trim
budget for the whole site is auditable from one place.

- **Trim only.** Inlay rails (`--trim-w`, 6px), top strips (5px), the 18px
  wordmark chip. Never a background.
- **Never below ~5px of width.** An 8px weave inside a 6px rail shows roughly one
  crossing and reads as noise or a plain dark line. Hence the 4px tile. There is
  no 1px variant, because a 1px carbon border is just a dark line pretending.
- **Never behind text.** Data sits on flat bone or flat graphite, always.
- **No gloss, no specular.** High-contrast glossy carbon is the tackiest texture
  on the web and would sink the credibility this publication runs on.
- **Constant across themes.** Carbon does not invert when the theme flips. That
  is what makes it read as a material rather than a colour.

### Themes

Dark and light swap the two flat surfaces: graphite ground with bone ink, or
bone ground with graphite ink. Neither is a tinted version of the other.

Light is the CSS default because the primary scene is a screenshot dropped into
a thread, and light survives that trip better. The system preference still
decides for a visitor who has not chosen, via
`@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`,
with `:root[data-theme="dark"]` so an explicit toggle wins in both directions. A
pre-paint inline script applies the stored choice so a dark-mode visitor never
sees a white flash.

---

## Typography

- **Martian Mono** — data, labels, figures, the query buffer, the status bar.
  Mono is a requirement rather than a style choice: tabular figures are most of
  the page. `font-variant-numeric: tabular-nums` on every numeric column.
- **Mona Sans** — display headlines and long-form reading.

Both are free, and neither is one of the faces every generated interface reaches
for. The `.label` class (10px, `0.14em` tracking, uppercase, mono) is the single
recurring small-label treatment.

---

## Components

**`.seq-row` — the signature object.** One row per brand, one `.seq-cell` per
run, filled when that run named the brand. This exists because a live-coding
interface writes rhythm as filled and empty steps (`x . o . x . o x`) and
Unprompted asks each question five times and reports how often a brand was
named. They are the same object. It turns rotation from an abstract percentage
into something readable at a glance and screenshottable.

On screens under 640px the cells and first-share column drop out and the row
falls back to rank, brand, named and delta. The number survives; the ornament
does not.

**`.buffer` — the query buffer.** The real questions, monospaced and numbered,
with a blinking `.caret`. Not a decorative code block: it renders the actual
contents of `questions/*.yml`.

**`.statusbar`** — carbon-backed strip carrying run date, method version, runs
per question and active engines. Borrowed directly from the source world's
`RUNNING · BPM · CPU` bar.

**`.snub`** — amber-bordered callout for the week's biggest faller. Absent
entirely on a quiet week, because inventing drama from flat data is how a chart
loses trust.

---

## Movement and state

Rise and fall are carried by **glyph and position first** (`▲`/`▼`, rank order,
weight), with colour as reinforcement only. The board reads correctly in
greyscale and for anyone who cannot separate the two hues. This is a hard
requirement, not a preference: numeric data must never depend on colour alone.

**Amber is the only imported colour** and keeps exactly the job it has in the
source world — *something is about to change*. Pending runs, a held week, a
method version bump. Nothing else may use it.

---

## Motion

Three motions, each carrying information rather than decorating:

1. **Cells fill in run order** (`cell-in`, 220ms, staggered 26ms). You are
   watching the measurement replay.
2. **The caret blinks** (`steps(1)`), because the buffer is live.
3. **Pending warms to amber** (`pending`, 2.2s), as the source world flashes a
   pattern before it sounds.

`prefers-reduced-motion: reduce` collapses every animation to its final state.
Nothing is carried by motion alone, so nothing is lost.

---

## Layout

`.shell` is 1180px max with 20px gutters. Hard 1px rules (`--rule`), zero border
radius anywhere, grid-locked columns. The hero is a two-column grid collapsing
at 900px: verdict left, query buffer right.

Answer-first is structural, not stylistic. Every page states its complete answer
in the first sentence before any preamble, because citation research shows most
citations come from the top of a page and this publication exists to be quoted.

---

## What would break this design

- Carbon fibre used as a background, or at a size where the weave stops reading.
- A rounded corner, a drop shadow on a card, or a gradient.
- Colour used as the only carrier of rise and fall.
- Amber used for anything other than "about to change".
- A sample or placeholder chart. The site shows an honest empty state instead;
  fabricated data would cost more than an empty page ever could.
