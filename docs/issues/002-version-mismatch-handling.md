# 002 — Version mismatch: when ACR and LRC disagree on which cut you're hearing

**Landed:** [`6749243`](https://github.com/Mentra-Community/Karaoke/commit/6749243)
(title cleaning), [`48f27e0`](https://github.com/Mentra-Community/Karaoke/commit/48f27e0)
(Resync + version picker).

## Problem

Real-world test cases that exposed this:

- **Killer Queen "Sped Up 204"** — TikTok-style 1.25× speed cut.
  ACR identifies it as `"killer queen — Sped Up 204"` (a remix
  upload) with `duration: 3:12` instead of canonical `3:01`. LRClib
  has no LRC for the remix; our title-only fallback returned 20
  hits, all *canonical* Killer Queens. We used the canonical
  timestamps against a faster audio playback → lyrics drift
  continuously by ~250 ms/sec.

- **Hey Jude 8-min YouTube upload** — canonical recording wrapped in
  extra silence/padding/extended outro. Total `duration: 8:01`,
  canonical is `7:11`. ACR fingerprints the canonical body, returns
  the correct `offsetSeconds`. Position is in sync with the canonical
  recording for as long as the cut is playing canonical material —
  then the cut hits its extended outro, canonical has long since
  ended, lyrics keep ticking past LRC's last entry → glasses go blank.

Root cause is the same in both: **ACR ↔ LRC ↔ audio cut form a
three-way mismatch**. There's no algorithm that can recover this
without either (a) more samples (re-fingerprinting) or (b) a hint
from the user.

## Alternatives considered

- **Detect tempo from duration ratio and scale LRC timestamps.**
  Would fix Killer Queen. Wouldn't fix Hey Jude (the extension is
  structural padding, not uniform stretch). Adds a non-trivial code
  path that can mis-fire on legitimately-different remixes that just
  happen to be the same length.
- **Reject non-canonical ACR results.** Brittle: "killer queen Sped
  Up 204" is the *correct* match — there really is an upload with
  that name; we just don't have its LRC.
- **Try to score LRC entries against ACR's reported duration.**
  Helps a bit (prefer the 7:11 LRC for a 7:11 cut, the 8:01 LRC for
  an 8:01 cut). Doesn't help when no LRClib entry exists for the
  unusual cut.

## What we shipped

Two manual recovery levers and a smarter auto-selector:

1. **Title cleaning fallback in LRC search.** Strip `"Sped Up"`,
   `"Slowed"`, `"Reverb"`, parenthesised tags, trailing numeric junk
   like `"204"`, `"Remastered 2011"`, etc. before searching LRClib.
   Gets us a canonical LRC for non-canonical cuts most of the time.
   ([`src/services/LRCService.ts`](../../src/services/LRCService.ts) — `cleanTrackTitle`).

2. **Resync button.** Force an immediate ACR re-fingerprint via
   `POST /api/resync`. Catches the cases where drift is small enough
   to be under the recalibrate threshold but big enough that the
   user notices.

3. **Wrong-version picker.** `GET /api/versions` lists every LRClib
   hit for the current song. `POST /api/lrc {lrcId}` swaps the
   active LRC in place. The user gives us the right hint with one
   tap — no fragile auto-detection required.

## Implementation note

`UserSession.switchLRCVersion(id)` deliberately does **not** reset
the `PositionTracker`. The user is telling us "this LRC is for the
current playback" — we should trust their hint and let the existing
clock keep running against the new chunks.

## Open questions

- **Auto-prefer LRC whose duration matches ACR's duration.** Easy
  win: if ACR says `duration: 481` and one LRClib entry says `481`
  while another says `431`, pick the matching one. Currently
  unimplemented.
- **Cache user version picks.** If a user manually picked the
  "Remastered 2011" LRC for `Hey Jude` once, next time we detect
  Hey Jude we should pick it again. Storage already exists
  (`SimpleStorage`) — add a `karaoke.lrcPicks.v1` map keyed by song.
- **Drift recalibration on Resync currently goes through the normal
  recognition path.** Works, but means we only recalibrate if the
  result counts as the same song. For "totally wrong song" recovery
  we'd want a force-snap-to-position pathway.
