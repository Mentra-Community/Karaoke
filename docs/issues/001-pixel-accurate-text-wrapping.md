# 001 — Pixel-accurate text wrapping for the HUD

**Landed:** [`e055763`](https://github.com/Mentra-Community/Karaoke/commit/e055763)

## Problem

We were chunking LRC lines with a hardcoded `maxCharsPerLine = 60`
and `maxWordsPerLine = 8`. Both numbers are guesses against the G1's
576-pixel display. Two specific failures:

1. **Under-fill.** Character widths vary widely. An "i" is ~4 px, an
   "m" is ~12 px. A 60-char line of narrow characters fits in ~270 px
   and leaves 300+ px of empty HUD. Real-world lyrics like
   `"She keeps the Möet & Chandon in her pretty cabinet"` (50 chars,
   easily fits 576 px) was getting split across two HUD lines.

2. **Bad timing as a knock-on effect.** The chunker was splitting *one
   LRC line* into multiple chunks, each with the same `startTime`
   but different `endTime` slices. So a single phrase would appear,
   then half-of-it would pop a second later as if it were a new
   lyric — the user perceived this as "the lyric is glitching."

## Alternatives considered

- **Bump the char-count guess.** Fragile — Latin would over-fill,
  CJK would still wrap weirdly.
- **Use word-count only.** Same problem inverted: 8 long words
  ("supercalifragilisticexpialidocious") overflows; 8 short ones
  ("a is by in on of or to") under-fills.
- **Wrap on the glasses themselves.** Not our code, can't ship.

## What we shipped

Use `@mentra/sdk@^3.0.0-alpha`'s `display-utils.TextWrapper` with
`G1_PROFILE`. The wrapper knows every glyph's actual width in the G1
font and packs lines to the real pixel budget.

- `src/utils/textChunker.ts` — replaced the manual word/char split
  with `TextWrapper.wrap(text, {maxWidthPx: 576, breakMode: 'word'})`.
- `src/UserSession/FiveLineDisplayFormatter.ts` — dropped the 45-char
  `truncate()` helper for a `TextWrapper`-backed `fitOneLine()`.
- **One LRC line = one chunk.** If a phrase fits on one HUD line it
  stays on one HUD line (and one timestamp). No more half-phrases
  popping mid-sentence.

Test data (Killer Queen LRC):

| Line                                                  | Before  | After   |
| ----------------------------------------------------- | ------- | ------- |
| "She keeps the Möet & Chandon in her pretty cabinet"  | 2 lines | 1 line  |
| "Let them eat cake, she says, just like Marie Antoinette" | 2 lines | 1 line |
| "Caviar and cigarettes, well-versed in etiquette"     | 2 lines | 1 line  |

## Implementation note

`@mentra/sdk@3.0.0-alpha.4`'s `./display-utils` subpath re-exports
types from an unpublished workspace package (`@mentra/display-utils`),
so `tsc` resolution fails for downstream consumers. We work around
it with [`src/utils/displayUtils.ts`](../../src/utils/displayUtils.ts) —
a local shim that declares the type surface locally and `require()`s
the runtime path. Bun resolves the JS fine. Delete this file once a
later SDK inlines the types.

## Open questions

- **G2 profile.** Live-captions imports a `Z100_PROFILE` and a
  `NEX_PROFILE` from a newer SDK; our alpha.4 only exports G1.
  When the SDK ships them we should detect `session.device.state.modelName`
  and pick the right profile (live-captions has this code we can copy).
- **Character break mode.** We use `'word'`. Live-captions uses
  `'character'` for 100 % utilization. Worth A/B-testing on real
  G1 hardware once we have user feedback — character mode squeezes
  ~10 % more text per HUD line but adds mid-word hyphens.
