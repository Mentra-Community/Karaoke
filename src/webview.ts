/**
 * webview.ts
 *
 * Mounts the phone-side webview for the Karaoke miniapp on the new
 * Hono-based AppServer (@mentra/sdk@^3.0.0-alpha).
 *
 * Endpoints:
 *   GET  /webview          EJS shell. Polls /api/stats every second.
 *   GET  /api/stats        Live now-playing state for the Now Playing tab.
 *   GET  /api/history      Persistent detection log for the History tab.
 *                          Query: ?limit=200&favoritesOnly=true
 *   POST /api/favorite     Toggle favorite for a {title, artist} pair.
 *   POST /api/resync       Force an immediate ACR re-recognition.
 *   GET  /api/versions     LRClib alternatives for the current song.
 *   POST /api/lrc          Switch active LRC. Body: {lrcId: number}.
 *   GET  /api/display-log  Plain-text HUD frame audit (debug only).
 *
 * All routes read `authUserId` from the Hono context variables that
 * the SDK auth middleware populates. We resolve the active
 * UserSession by that userId so the webview never trusts query
 * strings or headers.
 */

import path from "path"
import * as ejs from "ejs"
import type {MentraAuthHonoContext} from "@mentra/sdk"
import type {KaraokeApp} from "./index"

export function setupWebviewRoutes(app: KaraokeApp): void {
  // Static /public is already served by the SDK (publicDir in
  // AppServerConfig), so /css/karaoke.css resolves automatically.

  app.get("/webview", async (c: MentraAuthHonoContext) => {
    const userId = c.get("authUserId") ?? null
    const html = await ejs.renderFile(
      path.join(__dirname, "views", "webview.ejs"),
      {userId},
    )
    return c.html(html)
  })

  app.get("/api/stats", (c: MentraAuthHonoContext) => {
    const userId = c.get("authUserId")
    if (!userId) {
      return c.json({error: "Not authenticated"}, 401)
    }

    const session = app.getSessionByUserId(userId)
    if (!session) {
      return c.json({
        connected: false,
        state: "DISCONNECTED",
        currentSong: null,
        lyrics: null,
        history: [],
      })
    }

    const stats = session.getStats()
    const recent = session.historyManager.getRecentSongs(8)

    return c.json({
      connected: true,
      state: stats.currentState,
      currentSong: stats.currentSong,
      lyrics: session.getLiveLyrics(),
      history: recent.map((h) => ({
        title: h.title,
        artist: h.artist,
        identifiedAt: h.identifiedAt,
      })),
    })
  })

  // Persistent history feed for the History tab. Returns the same
  // detection events that get written to SimpleStorage by
  // HistoryManager — they outlast the current session and follow the
  // user across reconnects.
  app.get("/api/history", (c: MentraAuthHonoContext) => {
    const userId = c.get("authUserId")
    if (!userId) return c.json({error: "Not authenticated"}, 401)

    const session = app.getSessionByUserId(userId)
    if (!session) return c.json({events: [], stats: null})

    const url = new URL(c.req.url)
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10)))
    const favoritesOnly = url.searchParams.get("favoritesOnly") === "true"

    return c.json({
      events: session.historyManager.getEvents({limit, favoritesOnly}),
      stats: session.historyManager.getStatistics(),
    })
  })

  // Toggle favorite for a song. Body: {title, artist}.
  app.post("/api/favorite", async (c: MentraAuthHonoContext) => {
    const userId = c.get("authUserId")
    if (!userId) return c.json({error: "Not authenticated"}, 401)

    const session = app.getSessionByUserId(userId)
    if (!session) return c.json({error: "No active session"}, 404)

    let body: {title?: string; artist?: string}
    try {
      body = await c.req.json()
    } catch {
      return c.json({error: "Invalid JSON body"}, 400)
    }
    const title = (body.title ?? "").trim()
    const artist = (body.artist ?? "").trim()
    if (!title || !artist) {
      return c.json({error: "title and artist are required"}, 400)
    }

    const favorite = session.historyManager.toggleFavorite(title, artist)
    return c.json({title, artist, favorite})
  })

  // Force an immediate ACR re-fingerprint. The "Resync" button in
  // the webview hits this when lyrics have drifted but auto-correct
  // hasn't fired (drift below threshold, stale buffer, etc.).
  app.post("/api/resync", async (c: MentraAuthHonoContext) => {
    const userId = c.get("authUserId")
    if (!userId) return c.json({error: "Not authenticated"}, 401)
    const session = app.getSessionByUserId(userId)
    if (!session) return c.json({error: "No active session"}, 404)
    const out = await session.requestResync()
    return c.json(out)
  })

  // Alternative LRC versions for the currently-playing song. Powers
  // the "Wrong version?" picker. Returns LRClib hits ranked by
  // synced-lyrics availability.
  app.get("/api/versions", async (c: MentraAuthHonoContext) => {
    const userId = c.get("authUserId")
    if (!userId) return c.json({error: "Not authenticated"}, 401)
    const session = app.getSessionByUserId(userId)
    if (!session) return c.json({versions: []})
    const versions = await session.getAlternativeVersions()
    return c.json({versions})
  })

  // Swap the active LRC to a user-picked LRClib entry.
  // Body: {lrcId: number}.
  app.post("/api/lrc", async (c: MentraAuthHonoContext) => {
    const userId = c.get("authUserId")
    if (!userId) return c.json({error: "Not authenticated"}, 401)
    const session = app.getSessionByUserId(userId)
    if (!session) return c.json({error: "No active session"}, 404)

    let body: {lrcId?: unknown}
    try {
      body = await c.req.json()
    } catch {
      return c.json({error: "Invalid JSON body"}, 400)
    }
    const lrcId = typeof body.lrcId === "number" ? body.lrcId : parseInt(String(body.lrcId ?? ""), 10)
    if (!Number.isFinite(lrcId)) {
      return c.json({error: "lrcId must be a number"}, 400)
    }

    const ok = await session.switchLRCVersion(lrcId)
    if (!ok) return c.json({error: "Could not load that LRC version"}, 422)
    return c.json({lrcId, switched: true})
  })

  // Audit log of every frame pushed to the glasses HUD. Plain text,
  // append-only. Useful for diagnosing chunk timing / formatter
  // choices after the fact.
  //
  //   curl https://<your-app>/api/display-log -o display-log.txt
  app.get("/api/display-log", async (c: MentraAuthHonoContext) => {
    if (!c.get("authUserId")) return c.text("Not authenticated", 401)
    try {
      const text = await Bun.file("./display-log.txt").text()
      return c.text(text)
    } catch {
      return c.text("(no frames recorded yet)\n")
    }
  })
}
