/**
 * webview.ts
 *
 * Mounts the phone-side webview for the Karaoke miniapp on the new
 * Hono-based AppServer (@mentra/sdk@^3.0.0-alpha).
 *
 * Two endpoints:
 *   GET /webview      Renders the EJS shell. Live state comes from
 *                     polling /api/stats every second.
 *   GET /api/stats    JSON snapshot of the authenticated user's
 *                     current song, app state, and recent history.
 *
 * Both routes read `authUserId` from the Hono context variables that
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
        displayHistory: [],
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
      displayHistory: session.getDisplayHistory(40),
    })
  })
}
