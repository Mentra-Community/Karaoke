# 007 — Persisted history vanished every restart (SDK SimpleStorage URL bug)

**Landed:** this commit. Adds `src/services/CloudStorage.ts`. The
workaround should be removed once `@mentra/sdk` fixes the upstream
regex (track in SDK repo).

## Problem

[Issue 005](005-persistent-history-and-favorites.md) wired
`HistoryManager` to `session.simpleStorage` and looked like it
worked: writes returned, the in-memory cache hydrated, the UI behaved.
But every code push / restart, the history was empty again.

Pino logs on each session start showed:

```
Failed to fetch storage from cloud: {"error":"Not found",
  "path":"/ws/miniapp/api/sdk/simple-storage/isaiahballah%40gmail.com",...}
```

Cloud was 404ing every storage call. The SDK's debounced writer was
silently swallowing the errors (it logs but doesn't surface to the
caller), so we kept writing into a black hole.

## Root cause

`@mentra/sdk@3.0.0-alpha.4`'s `SimpleStorage.getBaseUrl()`:

```ts
getBaseUrl() {
  const serverUrl = this.appSession.getServerUrl();
  if (!serverUrl) return "http://localhost:8002";
  return serverUrl.replace(/\/app-ws$/, "").replace(/^ws/, "http");
}
```

The actual WebSocket URL is `wss://api.mentra.glass/ws/miniapp/app-ws`.
The regex only strips the trailing `/app-ws`, leaving
`/ws/miniapp` in the base URL. Every REST call ends up at

```
https://api.mentra.glass/ws/miniapp/api/sdk/simple-storage/...
```

instead of the correct

```
https://api.mentra.glass/api/sdk/simple-storage/...
```

## Alternatives considered

- **Wait for the SDK fix.** Real fix, but blocks our persistence
  story for an unknown amount of time. Pass.
- **Monkey-patch the SDK's private `baseUrl`.** Private field with no
  setter; would need reflection hacks. Brittle.
- **Local-disk JSON file.** Works for local dev. Doesn't work on
  Porter (ephemeral filesystem) — defeats the point.
- **Build our own cloud client.** Cheap, mirrors what the SDK does
  internally, fixes the URL. Picked this.

## What we shipped

`src/services/CloudStorage.ts` — a minimal replacement that:

- Reads the WebSocket URL from `session.getServerUrl()`, parses it
  with `URL()`, keeps the host (`api.mentra.glass`) and drops the
  path. Rewrites `wss:` → `https:`.
- Sends `Authorization: Bearer <packageName>:<apiKey>` and
  `Content-Type: application/json` — same shape the SDK uses
  internally.
- Hits `/api/sdk/simple-storage/<userId>/<key>` with `GET` (read)
  and `PUT` (write). Follows the cloud's staging-redirect via
  `fetch`'s default redirect handling.
- Implements the `StorageProvider` interface `HistoryManager.init()`
  already accepts — no changes to `HistoryManager` needed.

`UserSession` constructor now also takes `{packageName, apiKey}` so
it can mint a `CloudStorage` instance (the SDK's `apiKey` isn't
exposed via `session`). `KaraokeApp` passes them from `process.env`.

## Why writes weren't surfacing the failure

`SimpleStorage` debounces writes (3 s idle / 10 s max). The write
returns immediately to the caller after queueing; the actual HTTP
attempt happens in the background and only logs to console on
failure. Combined with our in-memory cache hydrating from the empty
GET response, the whole flow felt like it worked: hearts toggled,
history rows appeared, until the next restart blew it all away.

## Open questions

- **Should we report this upstream?** Yes — the SDK fix is one line:
  parse the URL and keep only the origin. Track in SDK repo.
- **Audit other SDK REST modules for the same bug.** Photo upload,
  RGB LED control, etc. all probably use the same `getBaseUrl`.
  When the SDK fix lands they all get fixed for free.
- **Remove this wrapper.** When the SDK ships the fix, drop
  `CloudStorage` and switch `HistoryManager.init` back to
  `session.simpleStorage`. The `StorageProvider` interface means it's
  a one-line swap.
