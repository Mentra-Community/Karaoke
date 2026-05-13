/**
 * HistoryManager
 *
 * Keeps a per-user chronological log of every song detected, plus a
 * set of "favorited" songs. Both persist to the SDK's SimpleStorage
 * so they survive app restarts and session reconnects — the user can
 * leave Karaoke running all day and scroll back through what played.
 *
 * Two pieces in storage:
 *   karaoke.events.v1     JSON array of detection events, newest last.
 *                         Capped at MAX_EVENTS so it never balloons.
 *   karaoke.favorites.v1  JSON object { [songKey]: true } where songKey
 *                         is "title|artist" lowercased. Per-song, not
 *                         per-event — favoriting "Killer Queen" lights
 *                         up every occurrence in the history.
 *
 * In-memory state is the source of truth at runtime; writes are passed
 * to SimpleStorage which does its own 3s-idle / 10s-max debouncing.
 * On a fresh session we load both keys from storage in `init()`.
 */

import {AppSession} from "@mentra/sdk"
import {CurrentSong, SongHistoryEntry} from "../types"

const KEY_EVENTS = "karaoke.events.v1"
const KEY_FAVS = "karaoke.favorites.v1"

interface StorageProvider {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}

export interface PersistedEvent {
  /** Synthesized unique id (random) — separate from the song key. */
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  identifiedAt: number
  confidence: number
  artworkUrl?: string
}

export class HistoryManager {
  private events: PersistedEvent[] = []
  private favorites = new Set<string>()
  private storage: StorageProvider | null = null
  private readonly MAX_EVENTS = 500
  private readonly DUPLICATE_WINDOW_MS = 30000
  private logger?: AppSession["logger"]

  /** Lower-cased "title|artist" key used by the favorites set. */
  static songKey(title: string, artist: string): string {
    return `${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`
  }

  /**
   * Wire up persistent storage and warm the in-memory caches from
   * whatever's already on disk. Safe to call even when storage is
   * unavailable — we just operate fully in-memory.
   */
  async init(storage: StorageProvider | null, logger?: AppSession["logger"]): Promise<void> {
    this.storage = storage
    this.logger = logger
    if (!storage) return

    try {
      const [rawEvents, rawFavs] = await Promise.all([
        storage.get(KEY_EVENTS),
        storage.get(KEY_FAVS),
      ])
      if (rawEvents) {
        const parsed = JSON.parse(rawEvents)
        if (Array.isArray(parsed)) {
          this.events = parsed
            .filter((e) => e && typeof e.title === "string" && typeof e.artist === "string" && typeof e.identifiedAt === "number")
            .slice(-this.MAX_EVENTS)
        }
      }
      if (rawFavs) {
        const parsed = JSON.parse(rawFavs)
        if (parsed && typeof parsed === "object") {
          this.favorites = new Set(Object.keys(parsed).filter((k) => parsed[k]))
        }
      }
      this.logger?.info(
        {events: this.events.length, favorites: this.favorites.size},
        "HistoryManager hydrated from storage",
      )
    } catch (err) {
      this.logger?.warn({err: (err as Error).message}, "Failed to load history from storage")
    }
  }

  /**
   * Append a detection event. Skips if the same title+artist was
   * already detected in the last DUPLICATE_WINDOW_MS (i.e. spam from
   * the recognizer firing twice on the same song). Persists async.
   */
  addSong(song: CurrentSong, artworkUrl?: string): void {
    if (this.isDuplicate(song)) return

    const event: PersistedEvent = {
      id: Math.random().toString(36).slice(2, 12),
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration || undefined,
      identifiedAt: Date.now(),
      confidence: song.confidence,
      artworkUrl,
    }
    this.events.push(event)

    if (this.events.length > this.MAX_EVENTS) {
      this.events = this.events.slice(-this.MAX_EVENTS)
    }

    this.persistEvents().catch(() => {})
  }

  /** Update the most recent event's artwork URL once the iTunes call resolves. */
  updateArtworkForLatest(title: string, artist: string, artworkUrl: string): void {
    const key = HistoryManager.songKey(title, artist)
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]
      if (HistoryManager.songKey(e.title, e.artist) === key) {
        if (e.artworkUrl !== artworkUrl) {
          e.artworkUrl = artworkUrl
          this.persistEvents().catch(() => {})
        }
        return
      }
    }
  }

  isDuplicate(song: CurrentSong): boolean {
    const cutoff = Date.now() - this.DUPLICATE_WINDOW_MS
    return this.events.some(
      (e) =>
        e.title === song.title &&
        e.artist === song.artist &&
        e.identifiedAt > cutoff,
    )
  }

  /**
   * Return events in newest-first order. `limit` clamps the result;
   * `favoritesOnly` filters to songs the user marked as favorite.
   */
  getEvents(opts: {limit?: number; favoritesOnly?: boolean} = {}): Array<PersistedEvent & {favorite: boolean}> {
    let out = this.events.slice().reverse()
    if (opts.favoritesOnly) {
      out = out.filter((e) => this.favorites.has(HistoryManager.songKey(e.title, e.artist)))
    }
    if (opts.limit !== undefined) {
      out = out.slice(0, opts.limit)
    }
    return out.map((e) => ({...e, favorite: this.favorites.has(HistoryManager.songKey(e.title, e.artist))}))
  }

  /** Legacy shim — only used by /api/stats which wants the same shape it had before. */
  getRecentSongs(limit?: number): SongHistoryEntry[] {
    return this.getEvents({limit}).map((e) => ({
      title: e.title,
      artist: e.artist,
      album: e.album,
      identifiedAt: e.identifiedAt,
      duration: e.duration,
      confidence: e.confidence,
    }))
  }

  isFavorite(title: string, artist: string): boolean {
    return this.favorites.has(HistoryManager.songKey(title, artist))
  }

  /** Flip favorite state for a song. Returns the new state. */
  toggleFavorite(title: string, artist: string): boolean {
    const key = HistoryManager.songKey(title, artist)
    const next = !this.favorites.has(key)
    if (next) this.favorites.add(key)
    else this.favorites.delete(key)
    this.persistFavorites().catch(() => {})
    return next
  }

  clearHistory(): void {
    this.events = []
    this.persistEvents().catch(() => {})
  }

  getHistorySize(): number {
    return this.events.length
  }

  findSong(title: string, artist: string): PersistedEvent | undefined {
    const key = HistoryManager.songKey(title, artist)
    return this.events.find((e) => HistoryManager.songKey(e.title, e.artist) === key)
  }

  getStatistics(): {
    totalSongs: number
    uniqueSongs: number
    favoriteCount: number
    avgConfidence: number
    mostPlayedSong?: {song: string; count: number}
  } {
    const totalSongs = this.events.length
    if (totalSongs === 0) {
      return {totalSongs: 0, uniqueSongs: 0, favoriteCount: this.favorites.size, avgConfidence: 0}
    }

    const counts = new Map<string, number>()
    let totalConfidence = 0
    for (const e of this.events) {
      const key = `${e.artist} - ${e.title}`
      counts.set(key, (counts.get(key) || 0) + 1)
      totalConfidence += e.confidence
    }

    let mostPlayedSong: {song: string; count: number} | undefined
    let max = 0
    counts.forEach((c, song) => {
      if (c > max) {
        max = c
        mostPlayedSong = {song, count: c}
      }
    })

    return {
      totalSongs,
      uniqueSongs: counts.size,
      favoriteCount: this.favorites.size,
      avgConfidence: totalConfidence / totalSongs,
      mostPlayedSong,
    }
  }

  private async persistEvents(): Promise<void> {
    if (!this.storage) return
    try {
      await this.storage.set(KEY_EVENTS, JSON.stringify(this.events))
    } catch (err) {
      this.logger?.warn({err: (err as Error).message}, "Failed to persist history events")
    }
  }

  private async persistFavorites(): Promise<void> {
    if (!this.storage) return
    const obj: Record<string, true> = {}
    this.favorites.forEach((k) => (obj[k] = true))
    try {
      await this.storage.set(KEY_FAVS, JSON.stringify(obj))
    } catch (err) {
      this.logger?.warn({err: (err as Error).message}, "Failed to persist favorites")
    }
  }
}
