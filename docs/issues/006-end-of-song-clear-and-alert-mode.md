# 006 — End-of-song HUD clear + alert mode for the next track

**Landed:** this commit.

## Problems

Two UX issues at the song-end transition:

1. **HUD shows `4:45 / 4:40`.** During the
   `SONG_END_GRACE_PERIOD` (5 s) we keep the recognition state at
   `SONG_ENDING` while we wait for ACR to confirm the song really
   stopped. The display loop keeps rendering with the running
   `PositionTracker` clock, which is now past `song.duration`. User
   sees a stale `position / duration` frame with `position >
   duration`.

2. **Slow pickup on the next song.** After `resetToListening` we drop
   straight into the silence-backoff regime (issue 003). But in
   real listening flows — playlist auto-advance, DJ blending, manual
   skipping — the next song almost always starts within ~30 s of the
   previous one ending. The standard 15 s LISTENING interval (or
   worse, 30 s / 60 s after backoff misses) makes the next track
   feel like a cold start.

## Alternatives considered

For the HUD overflow:

- **Clamp `position` to `min(position, duration)` in the formatter.**
  Stops the literal overflow but still shows the song info card for
  5 s after the audio is over. Feels off.
- **Just clear the display immediately when position ≥ duration.**
  Better UX, decouples HUD state from internal recognition state.

For alert mode:

- **Permanent fast cadence.** Bad — burns ACR credits idly. We
  already optimized for the silent-room case (issue 003).
- **A dedicated `RecognitionState.POST_SONG`.** Possible but pollutes
  the state machine. The existing LISTENING state plus a time-windowed
  override is simpler.

## What we shipped

### HUD clear

`UserSession.updateDisplay` now computes `songOver = position >=
song.duration`. When true, it passes `LISTENING` + `undefined` song
to the formatter for *this frame only* — so the HUD shows
`♪ Listening...` immediately. Internal state machine still goes
through `SONG_ENDING` for grace-period confirmation, but the user
no longer sees the stale frame. As a belt-and-braces measure the
formatter also clamps `shownPosition = min(position, duration)` so
any other code path that renders song info during the grace window
displays correctly.

### Alert mode

`RecognitionManager.enterAlertMode()` stamps `alertModeUntil =
Date.now() + ALERT_MODE_DURATION` (60 s). While that window is
active, `getListeningInterval()` returns `RECOGNITION_INTERVAL_ALERT`
(5 s) instead of the standard 15 s. Priority order:

1. Fresh-detection probe budget (`probesSinceWake < INITIAL_PROBE_COUNT`).
2. Alert mode.
3. Steady-state LISTENING interval.
4. Silence backoff.

Alert mode resets `probesSinceWake` and `consecutiveMisses` so the
fresh-probe budget and backoff clock both restart — the post-song
window deserves a clean slate.

Triggered from `UserSession.resetToListening` so it kicks in
whenever a song wraps cleanly. Doesn't fire on hard resets
(`cleanup()` / `reset()`) because those are session lifecycle, not
listening-flow events.

### Cost model

| Scenario                              | Old        | New             |
| ------------------------------------- | ---------- | --------------- |
| 60 s after song end, no new song yet  | 4 calls    | ~12 calls       |
| 60 s after song end, next song at 20 s | found ~30 s in | found ~20 s in |
| Idle silent room (RMS gate still kills calls) | 0 calls | 0 calls (gate wins) |

The extra ~8 calls per song-end is acceptable for the latency win.
If we ever care, we can pair alert mode with a stricter RMS gate so
silent post-song windows don't probe.

## Open questions

- **Recursive alert mode.** If we detect a song *during* alert mode,
  we transition to PLAYING and the alert window is implicitly
  abandoned. When that song ends we re-enter alert mode fresh.
  Probably correct, but worth verifying we don't accidentally
  shorten the window if a song detection races a tail-end of a
  previous alert.
- **User-visible feedback.** Should the webview show "Listening for
  the next song" with an extra-bright state badge during alert mode?
  Maybe — keep it for v2.
