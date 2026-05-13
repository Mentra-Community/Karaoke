# 004 — Fresh-detection window: catching wrong-version cuts early

**Landed:** [`931e8d7`](https://github.com/Mentra-Community/Karaoke/commit/931e8d7)

## Problem

The Hey Jude / Killer Queen sync issues (see [issue 002](002-version-mismatch-handling.md))
share a common signal: drift between our predicted playback position
and ACR's reported `offsetSeconds` shows up *early*. By the time the
steady-state recalibration logic kicks in (12 s polling, 3 s drift
threshold from `PositionTracker.MAX_DRIFT_SECONDS`), the user has
already seen ~30 s of misaligned lyrics.

If we sampled more often in the first half-minute after a detection,
we'd have ≥ 5 drift samples and could:

- Catch the wrong-cut case before lyrics get noticeably off.
- Confirm the right-cut case fast, and gracefully fall back to
  steady-state cadence.

## Alternatives considered

- **Always poll fast.** Burns ACR credits and bandwidth for songs
  that are perfectly synced. Most songs don't need it.
- **Detect tempo factor from drift slope.** Right idea, more complex
  to implement reliably. Save for v2.
- **Make the user manually verify.** Friction. The Resync button
  exists for that, but we want auto-recovery to handle most cases.

## What we shipped

A "fresh window" concept in `RecognitionManager`:

```
RECOGNITION_INTERVAL_FRESH:        6000   // 6 s between probes
FRESH_DETECTION_DURATION:          45000  // 45 s after confirmation
FRESH_DRIFT_RECALIBRATE_THRESHOLD: 1.5    // seconds; tighter than steady 3 s
```

When a song transitions LISTENING → CONFIRMED, we stamp
`songConfirmedAt = Date.now()`. While `Date.now() - songConfirmedAt
< FRESH_DETECTION_DURATION` we use the 6 s cadence; after that we
fall back to the steady 12 s.

`handlePlayingState` reads `recognitionManager.isInFreshWindow()` to
pick the drift threshold. Inside the window, a 1.5 s drift triggers
recalibration; outside, we keep the 3 s threshold so we don't
chase normal-latency noise.

### Sample timeline

| Time after detection | Old behavior         | New behavior                   |
| -------------------- | -------------------- | ------------------------------ |
| T+0 s                | Initial chunk shown  | Same                           |
| T+6 s                | (idle, 12 s tick)    | ACR re-recognize, 1.5 s check  |
| T+12 s               | ACR, 3 s check       | ACR, 1.5 s check               |
| T+18 s               | idle                 | ACR                            |
| T+24 s               | ACR                  | ACR (4th sample)               |
| T+30 s               | idle                 | ACR                            |
| T+36 s               | ACR                  | ACR                            |
| T+42 s               | idle                 | ACR                            |
| T+45 s               | —                    | falls back to 12 s steady-state |

## Implementation note

Window resets on the `setState(LISTENING)` transition so a new song
gets its own budget. Three CONFIRMED entry points all call
`markSongConfirmed()`: `handleListeningState`, the verified path in
`handlePendingState`, and the verified path in `handleSwitchPendingState`.

Every ACR tick now logs `expected`/`detected`/`drift`/`inFreshWindow`/
`recalibrateThreshold` to pino. Combined with the on-disk
`display-log.txt`, that gives us a clean dataset for tuning the
constants against real listening sessions.

## Open questions

- **Tempo factor scaling.** The current "snap" recalibration is okay
  for one-off offset cases (Hey Jude's extended intro). For
  continuous tempo mismatch (Killer Queen Sped Up) we still drift
  between recalibrations. Worth scoping a v2 that tracks the drift
  *slope* and applies a multiplier to LRC lookups.
- **Cap the recalibrate frequency.** Currently every fresh-window ACR
  result can recalibrate. If ACR reports come in noisy we might
  bounce. Add a "min 8 s between recalibrations" guard if we see
  that in real data.
