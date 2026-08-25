# Unprompted design system

**Direction:** The Terminal, played straight. Seed `5e1f2e83`.
**Craft bar:** Linear, Vercel. Set by the operator, matched detail for detail.

This document describes the world as built. It was written after the build, from
the build, so it reports rather than prescribes. It replaces the previous
Algorave source floor world (seed `06ec8236`) entirely.

---

## The one idea

A market-data board for machine recommendations. **The numbers are the design.**
Anything on a page that is not a number earns its place by making a number
easier to read, or it goes.

This is the category standard executed at full fidelity, chosen deliberately
over four more expressive worlds. It carries no irony and no smuggled quirk: a
visitor who reads market data all day should find everything where they expect
it, and the only thing that surprises them should be what the data says.

What it refuses: the decorated hero, the gradient card grid, the accent colour
sprayed across a dashboard, and the ornamented world an AI-visibility tool
reaches for when it wants to look serious.

---

## Colour

Dark is the default. The physical scene decides it: this is a data board read at
a desk, usually beside other dark tools, often late.

Colour is **rationed to meaning**. There is no decorative hue anywhere in the
system, which is what keeps green and red legible as signals rather than
styling.

| Role | Meaning | Dark | Light |
|---|---|---|---|
| `--bg` | page ground | `#08090a` | `#ffffff` |
| `--surface` | any raised panel | `#0e0f11` | `#fafafa` |
| `--surface-2` | table heads, inputs | `#141518` | `#f2f2f2` |
| `--fg` | primary text | `#f7f8f8` | `#0a0a0a` |
| `--fg-2` | secondary text | `#9ba1a9` | `#545454` |
| `--fg-3` | labels, metadata | `#6a6f77` | `#8a8a8a` |
| `--rule` | hairline separators | `#1e2024` | `#e6e6e6` |
| `--accent` | interactive only | `#4d8dff` | `#0060df` |
| `--up` | movement up | `#4cc38a` | `#10714b` |
| `--down` | movement down | `#f2555a` | `#bc3229` |
| `--warn` | needs a human | `#e5a03c` | `#9a6200` |

The board's step ramp (`--cell-0` through `--cell-4`) is a five-stop blue scale.
It reads as intensity, not as category, which is the point: a step is *how
often*, never *which kind*.

**Rules that hold everywhere.** Green and red mean movement and nothing else.
Blue means "you can interact with this" and nothing else. A brand never gets its
own colour. The leader is marked by weight, never by hue.

### Themes

Three states, not two. Bare `:root` carries the complete light palette. The
`prefers-color-scheme: dark` block is guarded `:root:not([data-theme="light"])`
so an explicit light choice beats a dark OS. `:root[data-theme="dark"]` repeats
the dark values so the toggle wins in both directions. Every colour is defined
on `:root` first; nothing gets its only definition inside a media block.

---

## Type

**Geist** for everything read as language. **Geist Mono** for everything read as
data: figures, labels, timestamps, hostnames, engine names, question text.

That split is the system's main typographic idea. If a thing is a measurement or
an identifier, it is monospaced; if it is a sentence, it is not. A reader can
tell what kind of thing they are looking at before reading it.

`font-variant-numeric: tabular-nums` is set on `body`, not per component,
because every figure on this site is read against another figure and a column
that shifts by digit width is a defect.

| Role | Size | Weight | Notes |
|---|---|---|---|
| `.display` | `clamp(30px, 5vw, 46px)` | 640 | The week's verdict, one per page |
| `h2` | 19-22px | inherit | Section heads |
| body | 15px | 400 | `-0.005em` tracking |
| `.label` | 10.5px mono | 500 | `0.09em`, uppercase |
| board figures | 12-12.5px mono | 400-500 | tabular |

---

## Material and structure

There is **one radius** (`--r: 6px`, with `--r-sm: 4px` for controls). There are
no shadows. Elevation is expressed by a hairline border against a slightly
lifted surface, which is what a dense interface can afford without the page
turning soft.

Panels are the same object everywhere: `--surface` ground, 1px `--rule` border,
6px radius, `overflow: hidden` so rows clip cleanly to the corner.

`TrimTop` renders the single hairline that separates a panel's head from its
body. It is the surviving structural role of the previous world's carbon-fibre
trim; the material is gone, the separation it provided is not.

---

## The board

The signature object, and the only place the system spends real invention.

Each row carries five things, in this order of visual weight:

1. **Brand name**, with a rotation bar beneath it. The bar exists so ranking is
   readable without reading a number.
2. **Per-question steps.** One step per question, four intensity levels. The
   steps flex to fill their column because they are the argument, not a
   decoration beside it.
3. **Named**, as a raw fraction. The denominator stays visible so the sample
   size is never hidden behind a percentage.
4. **First**, the share of runs where the brand was named first.
5. **Movement**, carried by the glyph and the sign. Colour reinforces; it never
   carries the meaning alone, so the board is correct in greyscale.

### Reading one question down the board

Every step is one question, which was true and invisible: a sighted reader had
no way to ask *which*, while the row's `aria-label` carried the counts for
everyone else. Hovering a step now dims the other columns so a single question
can be read down the whole board, and a readout above it names the question and
the brand that leads it.

The readout is sticky, because the board is taller than a viewport and the
answer was otherwise off screen at the moment it was wanted. It sticks inside
the board's wrapper rather than to the page, so it leaves with the board instead
of following the reader into the next section.

**No colour is spent.** The active column simply stays as it was and the rest
recede, so the effect survives greyscale and takes nothing from the ration that
keeps green, red and blue meaningful. It is `filter: opacity()` rather than
`opacity`, because `.seq-cell` runs its entrance animation with `fill-mode:
both` and a filled animation keeps ownership of the property it animates.

Below 720px there is no hover to drive it and the question text would wrap to
three lines and push the board off screen, so the readout goes rather than
degrading.

This is the dimension the publication exists to report and no competitor
publishes: not who wins overall, but who wins *this question*. Sourcegraph Cody
is fifth on the coding board and wins "best for a large existing codebase"
fourteen times out of fifteen.

### Sorting, and the gap it exposes

The three figure columns sort. The rank column keeps the first-named ordering
whatever the sort is, because the gap between the two orderings is the finding:
Cursor is named in more runs than anything else and is third on first mentions.
That is the same argument the mark makes — four steps where the tallest is not
the coloured one — and re-ranking on sort would hide it.

Blue appears on the sort controls on hover and focus only, since it means "you
can interact with this". The column currently sorted is marked by weight and a
step up in foreground, never by hue, the same way the board marks its leader.

### The consensus row

The board's sibling on `/consensus`, and the second place the system spends
invention. One row per question, one column per engine, each cell naming the
brand that engine put first.

It carries no colour at all. When the engines agree the names are identical and
the row reads as a calm repetition; when they split, the divergent pick is set
in full weight and the eye lands on it without being pointed. The data does the
work the styling would otherwise have to, which is the same reason the board
marks its leader by weight.

### Tone

Sentiment is drawn in the neutral greys, never in `--up` and `--down`. Those two
mean movement week over week and nothing else, and a warm mention is not an
upward movement. Tone is also second-order evidence, read by the extraction
model rather than stated by the engine, so it is always shown with the sentence
that says so and never at the size of a name count.

**Why steps and not a line.** A line shows *when*. Steps show *which questions a
brand wins*, which is a dimension no competitor publishes and no line chart can
carry. Trend lines arrive as history accrues; they join the board rather than
replacing it.

### Responsive

The board is the primary scene, so it is never hidden. At 720px the rank and the
raw fraction drop and the steps stay. At 430px movement drops too. What survives
to the smallest screen is brand, steps, and first-named share, because that is
the smallest set that still answers the question the visitor arrived with.

The header is two rows below 620px: four nav links plus the wordmark do not fit
one phone row, and the page must never scroll sideways.

---

## Motion

Fast and few. `--fast: 120ms` for state, 380-560ms for entrance, all on
`cubic-bezier(0.16, 1, 0.3, 1)`.

Three animations exist in the whole system: board steps fade up on load, the
rotation bar grows from its left edge, and the caret in the question buffer
blinks. Everything else is a colour, filter or border transition on hover.

The board's column dimming is a state, not an animation: it transitions at
`--fast` and holds. Nothing on this site moves on its own except the caret.

`prefers-reduced-motion: reduce` collapses every animation and transition to
0.01ms globally, and the smooth scroll with it.

---

## Accessibility

- Focus is a 2px `--accent` ring at 2px offset, defined once on `:focus-visible`.
- Movement, self-preference gaps, and category status all pair colour with a
  glyph, a sign, or a word.
- The step row carries an `aria-label` stating the counts in prose, because a
  row of coloured divs is meaningless to a screen reader.
- Body text sits at or above 4.5:1 on both themes; `--fg-3` is reserved for
  labels and metadata that repeat information available elsewhere.

---

## Brand surfaces

The mark is four steps of unequal height. The third is coloured with the board's
full-intensity blue and is **not** the tallest. That encodes the finding the
whole publication exists to report: the brand named most often is frequently not
the brand recommended first. The logo is an argument, not a shape.

The favicon does not invert. It carries its own near-black ground, because a
browser tab is not our surface to theme.

**The social card is a primary brand surface, not an afterthought.** This
publication's growth engine is somebody screenshotting a number into an
argument, so the card renders the live standings rather than a static tagline.
It must never show a mocked-up number.

---

## What lives where

| File | Owns |
|---|---|
| `app/globals.css` | Every token and every class. There is no second stylesheet. |
| `app/layout.tsx` | Fonts, the no-flash theme script, the direction contract. |
| `components/ui.tsx` | Board rows, status bars, tone bars, chrome, the shared primitives. |
| `components/board-live.tsx` | The board's own behaviour: the question readout and the sort. The only stateful thing on the chart. |
| `lib/shared.ts` | The data layer's pure half, so a client component can import a constant without the bundler following it into `node:fs`. |
| `components/logo.tsx` | The mark, and the social card's step rhythm. |

The direction contract is emitted as a real HTML comment in the shipped markup,
not a JSX comment. A JSX comment is compiler syntax and reaches no output, which
makes it a contract nobody can audit. Grep the built output for the seed key.
