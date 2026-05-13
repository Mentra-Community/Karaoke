/**
 * webview.ts
 *
 * Mounts the phone-side webview for the Karaoke miniapp.
 *
 * Two endpoints:
 *   GET /webview      Renders the EJS shell. Live state comes from
 *                     polling /api/stats every second.
 *   GET /api/stats    JSON snapshot of the authenticated user's
 *                     current song, app state, and recent history.
 *
 * Both routes use the SDK's AuthenticatedRequest, so we resolve the
 * UserSession by the runtime-provided authUserId instead of trusting
 * any query string.
 */

import path from "path"
import express, {type Request, type Response} from "express"
import type {KaraokeApp} from "./index"

// The SDK auth middleware augments Express's Request with authUserId.
// We type-narrow locally instead of importing AuthenticatedRequest to
// avoid overload-conflict noise when registering routes.
type AuthedRequest = Request & {authUserId?: string}

const ejs = require("ejs")

export function setupExpressRoutes(app: KaraokeApp): void {
  const expressApp = app.getExpressApp()

  expressApp.set("view engine", "ejs")
  expressApp.engine("ejs", ejs.__express)
  expressApp.set("views", path.join(__dirname, "views"))

  // Serve /public (css, images) as static assets.
  expressApp.use(express.static(path.join(__dirname, "..", "public")))

  expressApp.get("/webview", (req: Request, res: Response) => {
    const userId = (req as AuthedRequest).authUserId ?? null
    res.render("webview", {userId})
  })

  expressApp.get("/api/stats", (req: Request, res: Response) => {
    const userId = (req as AuthedRequest).authUserId
    if (!userId) {
      res.status(401).json({error: "Not authenticated"})
      return
    }

    const session = app.getSessionByUserId(userId)
    if (!session) {
      res.json({
        connected: false,
        state: "DISCONNECTED",
        currentSong: null,
        history: [],
      })
      return
    }

    const stats = session.getStats()
    const recent = session.historyManager.getRecentSongs(8)

    res.json({
      connected: true,
      state: stats.currentState,
      currentSong: stats.currentSong,
      history: recent.map((h) => ({
        title: h.title,
        artist: h.artist,
        identifiedAt: h.identifiedAt,
      })),
    })
  })
}
