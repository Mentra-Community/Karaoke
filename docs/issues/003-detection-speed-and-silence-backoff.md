# 003 — First-detect latency + silent-room API cost

**Landed:** [`7c240ed`](https://github.com/Mentra-Community/Karaoke/commit/7c240ed)

## Problem

Two related bottlenecks in `RecognitionManager`:

**Slow first detection.** A song already playing when the app starts
took ~25–30 s to be recognized:

- Audio buffer fills to 3 s → first ACR call → miss (still warming
  up).
- Wait full `RECOGNITION_INTERVAL_LISTENING = 15 s` for the next
  attempt.
- 8 s of audio buffer + ~1.5 s ACR roundtrip → ~25 s total.

**Wasted ACR credits in quiet rooms.** While no song is playing we
still fired one ACR call every 15 s, forever. Every call costs a
credit. A user who leaves Karaoke running through a workday burns
~240 calls/hour matching against silence.

## Alternatives considered

- **Constant short interval (e.g., 5 s always).** Catches songs fast
  but burns 12× more API credits when nothing is playing.
- **Long interval always.** Saves credits but makes first detection
  feel broken.
- **VAD-based gating.** Overkill — we don't need to detect speech,
  just "is there audible energy?"

## What we shipped

Three pieces working together:

1. **Fast initial probes.** `shouldRecognize()` fires the first call
   as soon as 3 s of audio is buffered. The next
   `RECOGNITION_INITIAL_PROBE_COUNT` (3) probes use
   `RECOGNITION_INITIAL_INTERVAL` (5 s) instead of the steady 15 s.
   First-detect floor drops to ~5–10 s.

2. **Audio energy gate.** `audioRMS()` (`src/utils/audioUtils.ts`)
   computes RMS amplitude of the 16-bit PCM buffer in single-digit ms
   (sampled every 8th frame). If RMS < `SILENCE_RMS_THRESHOLD` (800,
   hand-tuned for the G1 mic), skip the ACR call entirely. Idle
   probes still tick so the backoff clock advances.

3. **Silence backoff.** After `SILENT_BACKOFF_AFTER_MISSES` (4)
   consecutive ACR misses, the LISTENING interval doubles per
   additional miss up to `SILENT_BACKOFF_MAX_INTERVAL` (2 min).
   Resets the moment audio passes the RMS gate or a song is matched.

### Cost model

Idle / silent room:

- Old: 1 ACR call / 15 s = 4 calls/min, indefinitely.
- New: 0 ACR calls. RMS gate kills them all. The cadence keeps
  advancing toward backoff, but with no API hits at all.

Idle / noisy room (typing, conversation):

- Old: same 4 calls/min.
- New: 0 calls — typing RMS is ~400, well under the 800 threshold.

Music starts after long quiet:

- Old: up to 15 s wait + 8 s buffer = 23 s.
- New: RMS jumps over threshold → next 5 s interval → ~5–10 s.

## Implementation note

The energy threshold is conservative on purpose. Background music
in a coffee shop sits around RMS 1500–4000; truly faint background
music at 600–1000 will be missed by the gate. We'd rather miss a
faint-music edge case than spend credits matching silence. Knob is
exposed as `SILENCE_RMS_THRESHOLD` in `DEFAULT_RECOGNITION_CONFIG`.

## Open questions

- **Adaptive threshold.** Sample the room's median RMS over a window
  and set the gate to `median × 1.5` or similar. Would handle a wider
  range of input gains without a hand-tuned constant.
- **Lower the steady-state interval too.** Currently 15 s when the
  fresh-probe budget is spent. Worth measuring whether 10 s would
  catch DJ-set transitions noticeably better.
