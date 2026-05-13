# 005 — Persistent history + favorites

**Landed:** [`7cb059f`](https://github.com/Mentra-Community/Karaoke/commit/7cb059f)

## Problem

Karaoke wants to be ambient. The expected use case isn't "open the
app, find a song, close it" — it's "leave it running through the
day and check what played later." That requires:

- A history feed that survives session reconnects (BLE drops, phone
  sleep, app restart).
- A way to favorite specific songs the user liked so they can find
  them again.
- A UI that scales past the 8-item dropdown we had in the Now Playing
  panel.

## Alternatives considered

- **Keep history in memory only.** Loses everything on disconnect.
- **Store in a backend database we control.** Overkill — SimpleStorage
  already gives us cloud-synced KV per user.
- **Store on the glasses.** Storage is tiny and ephemeral; wrong
  layer.

## What we shipped

`HistoryManager` persists to `session.simpleStorage` under two keys:

- `karaoke.events.v1` — append-only chronological event log
  (`PersistedEvent[]`), capped at `MAX_EVENTS = 500`.
- `karaoke.favorites.v1` — `{songKey: true}` map where `songKey` is
  `"<title>|<artist>".toLowerCase()`. Per-song, not per-event, so
  favoriting a track lights up every occurrence in the history.

### Lifecycle

- `init(simpleStorage, logger)` called once from `UserSession`
  constructor. Hydrates both keys in parallel. Safe to call without
  storage (just runs in-memory).
- `addSong(song, artworkUrl?)` pushes a new event. Duplicate-window
  filter (30 s) prevents the recognizer firing twice on the same song
  from inflating playCount.
- `updateArtworkForLatest(...)` backfills the iTunes-resolved album
  art onto the just-added event so older list rows keep their
  covers across reloads.
- `toggleFavorite(title, artist)` flips the per-song flag, persists
  async.

Writes piggyback on `SimpleStorage`'s 3 s-idle / 10 s-max debounce
— tapping the heart on a song doesn't fire an immediate network
write.

## UI

The webview gained two tabs (`Now Playing` / `History`):

- **History** feed is day-grouped (`Today` / `Yesterday` / weekday
  name) with newest first. Each row: album art, title, artist, time,
  favorite toggle. Filter chips at top toggle "All" vs "Favorites".
- A stats line shows `N plays · M unique · K favorited`.
- Tab count chip updates every 10 s even when on Now Playing so the
  user sees new detections accumulating.

## Open questions

- **Event log vs unique-song table.** Current model: append-only event
  log + per-song favorite map. Alternative: unique-song table keyed
  by `songKey` with `firstSeenAt / lastSeenAt / playCount` columns.
  Cleaner data model, slightly worse for chronological scrolling
  (need to denormalize for the daily-grouped view). Decide if
  500-event cap becomes a real ceiling.
- **History on prod cluster (aws-us-west-2 5692).** The dev cluster
  has its own storage namespace; favorites won't carry over.
  Acceptable for now.
- **Search.** No search inside the history feed yet. Hundreds of
  songs over weeks of use will need it.
- **Export.** Useful for "what was I listening to in March?" — a
  CSV export from the History tab is a small follow-up.
