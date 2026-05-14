# 008 — Greedy LRC packing: break at phrase boundaries, not mid-phrase

## Problem

The combining chunker built each chunk's HUD lines by joining all of
its LRC text snippets with spaces and re-wrapping the joined string.
That produces the fewest possible HUD rows, but it ignores phrase
boundaries when the joined text overflows.

Eleanor Rigby exposed the failure mode:

```
LRC 1 @ 22.0:  "All the lonely people (ah, look at all the lonely people)"
LRC 2 @ 25.5:  "Where do they all belong?"
```

Joined → wrapped becomes:

```
| - All the lonely people (ah, look at all the lonely people) Where do
|   they all belong?
```

The break lands in the middle of LRC 2's phrase ("Where do" / "they
all belong?") even though LRC 1 by itself fits cleanly on one row and
LRC 2 by itself fits cleanly on one row. The natural break sits right
between the two LRC entries — the chunker just wasn't looking for it.

## Decision

Replace `wrapJoined` with **greedy LRC packing** in
[`src/utils/textChunker.ts`](../../src/utils/textChunker.ts).

For each candidate chunk's list of LRC texts:

1. Pack LRC lines onto a HUD row, accumulating with `" "` between them,
   while the resulting string still wraps to **exactly one** HUD row
   (measured via the same pixel wrapper).
2. As soon as appending the next LRC line would cause the row to wrap
   to two or more lines, **break at that LRC boundary** — flush the
   current row, start a new row with the next LRC line.
3. Final pass: if any single packed row is itself wider than the HUD
   (i.e. one LRC line is long on its own), wrap that row internally
   so chunk line-count is still measured against reality.

The chunker's existing `maxLines` / `maxLrcLines` / `maxGapSeconds` /
`maxChunkDurationSeconds` veto rules stay unchanged. The only thing
that changes is **how a set of LRC texts gets turned into HUD rows**.

## Results

| Case | Before (`wrapJoined`) | After (`wrapGreedy`) |
|---|---|---|
| Eleanor Rigby (two phrases, joined wraps) | `…Where do` / `they all belong?` | LRC 1 / LRC 2 ✓ |
| Space Oddity (short trailing phrase, joined fits) | single row ✓ | single row ✓ |
| Bohemian Rhapsody trio (two fit, third doesn't) | mid-trio break | LRC 1+2 / LRC 3 ✓ |
| Single long LRC line | internally wrapped ✓ | internally wrapped ✓ |

The win is biggest on songs with parenthetical asides or call-and-
response phrasing where adjacent LRC lines are short enough to tempt
the combining loop but long enough together to spill over one row.

## Why not "split on punctuation"

Cleaner break candidates exist inside a single LRC line (comma at end
of `"lonely people),"`, for instance), but LRC line boundaries are
*authored* phrase boundaries — whoever timed the file already decided
where one sung phrase ends and the next begins. Honoring those
boundaries gives us the right answer without parsing English.

## Why not "force one LRC per HUD row"

Some LRC files split a single thought across two timestamps for
karaoke-style emphasis (`"Now it's time to leave the capsule"` /
`"if you dare"`). Forcing one-LRC-per-row there would waste HUD
rows on phrases that read better together. Greedy packing handles
both cases without a knob.
