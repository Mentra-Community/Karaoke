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
