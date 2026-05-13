# 007 — SDK SimpleStorage 404s every call (URL parsing bug)

**Landed:** patch via `bun patch @mentra/sdk@3.0.0-alpha.4`, stored
at `patches/@mentra%2Fsdk@3.0.0-alpha.4.patch`. Re-applied on every
`bun install` (locally and inside the Porter Docker build).

## Problem

[Issue 005](005-persistent-history-and-favorites.md) wired
`HistoryManager` to `session.simpleStorage` and looked like it
worked: writes returned, the in-memory cache hydrated, the UI behaved.
But every code push / restart, the history was empty again.

Pino logs on each session start showed:

```
Failed to fetch storage from cloud: {"error":"Not found",
  "path":"/ws/miniapp/api/sdk/simple-storage/<userId>",...}
```

Cloud was 404ing every storage call. The SDK's debounced writer was
silently swallowing the errors (it logs but doesn't surface to the
caller), so we kept writing into a black hole. The reason it *seemed*
to work in the moment: writes are debounced 3 s / 10 s — they return
synchronously after queueing, and the in-memory cache happily hydrated
from an empty GET. So the heart toggle worked, the history list
rendered, everything felt right — until the next restart wiped it.

## Root cause

`@mentra/sdk@3.0.0-alpha.4` derives the REST base URL by stripping
the trailing `/app-ws` from the WebSocket URL with `.replace(/\/app-ws$/, "")`.
The actual WS path is `/ws/miniapp/app-ws`, so the regex only strips
the trailing segment and leaves `/ws/miniapp` in the base. Every
REST call ends up at

```
https://api.mentra.glass/ws/miniapp/api/sdk/simple-storage/...
```

instead of the correct

```
https://api.mentra.glass/api/sdk/simple-storage/...
```

Five copies of the same broken pattern in the bundled `dist/index.js`:

| Location                | Used by                |
| ----------------------- | ---------------------- |
| `StorageManager.resolveBaseUrl`  | Internal storage     |
| `SimpleStorage.getBaseUrl`       | `session.simpleStorage` |
| `SettingsManager.convertToHttps` (static) | Settings cloud-sync |
| Incident upload (inline)         | Telemetry logging    |
| `WifiManager.getHttpsServerUrl`  | WiFi status            |

## Alternatives considered

- **Wait for the SDK fix.** Real fix, but blocks our persistence
  story for an unknown amount of time. Pass.
- **Monkey-patch the SDK's private `baseUrl` field.** No setter,
  would need reflection hacks. Brittle.
- **Build a parallel `CloudStorage` REST client in this repo.** First
  approach I tried. Works, but only fixes SimpleStorage — the four
  other broken sites (incident upload, WiFi, settings, etc.) keep
  silently failing.
- **`bun patch`.** Picked this. Fixes all five sites in one place.
  Patch survives `bun install` in both local dev and Porter's
  Docker build. Trivial to remove when the SDK ships an upstream fix.

## What we shipped

Use `bun patch @mentra/sdk@3.0.0-alpha.4` and apply the same fix at
each broken site:

```js
// Before (broken):
return serverUrl.replace(/\/app-ws$/, "").replace(/^ws/, "http");

// After:
try {
  const u = new URL(serverUrl);
  const proto = u.protocol === "wss:" ? "https:" : "http:";
  return `${proto}//${u.host}`;
} catch {
  // fall back to the old regex for non-URL strings (shouldn't happen
  // in practice — every real WS URL parses cleanly)
  return serverUrl.replace(/\/app-ws$/, "").replace(/^ws/, "http");
}
```

`bun patch --commit 'node_modules/@mentra/sdk'` wrote
`patches/@mentra%2Fsdk@3.0.0-alpha.4.patch` and added
`patchedDependencies` to `package.json` + `bun.lock`. Every install
re-applies it.

`UserSession` is back on `session.simpleStorage`. The standalone
`src/services/CloudStorage.ts` wrapper was deleted.

## Why patch over upstream PR

Both. The patch unblocks us right now; the upstream PR fixes it for
everyone using the SDK. Don't skip the PR step.

## Open questions

- **Upstream PR.** Land the same fix in the SDK monorepo. Once that
  releases, bump the version in `package.json`, drop the patch entry,
  delete `patches/@mentra%2Fsdk@3.0.0-alpha.4.patch`.
- **Audit other potentially-broken REST paths.** The five sites we
  patched are everything in `dist/index.js` that matched the broken
  regex. Worth checking the SDK source repo for any pattern that
  manipulates the WS URL we missed.
