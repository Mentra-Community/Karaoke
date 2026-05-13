/**
 * ArtworkService
 *
 * Best-effort album art lookup via the public iTunes Search API.
 * Free, no auth, no rate-limit headaches for the volumes we see.
 *
 * Returns the highest-res square crop URL Apple exposes (replaces the
 * `100x100` segment in the URL with `600x600`).
 *
 * Caches by lowercased "<title>|<artist>" so the same song doesn't
 * re-hit the API on every recognition tick.
 */

interface ITunesResult {
  artworkUrl100?: string;
  artworkUrl60?: string;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
}

interface ITunesResponse {
  resultCount: number;
  results: ITunesResult[];
}

export class ArtworkService {
  private cache = new Map<string, string | null>();

  private keyFor(title: string, artist: string): string {
    return `${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
  }

  /**
   * Resolve an album art URL for the given track. Returns null if no
   * match is found or the lookup fails. Cached after the first
   * resolution (including null) to avoid repeated hits.
   */
  async fetchArtwork(title: string, artist: string): Promise<string | null> {
    const key = this.keyFor(title, artist);
    if (this.cache.has(key)) return this.cache.get(key) ?? null;

    try {
      const term = encodeURIComponent(`${title} ${artist}`);
      const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1&media=music`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(url, {signal: controller.signal});
      clearTimeout(timer);

      if (!res.ok) {
        this.cache.set(key, null);
        return null;
      }

      const data = (await res.json()) as ITunesResponse;
      const hit = data.results?.[0];
      const small = hit?.artworkUrl100 ?? hit?.artworkUrl60 ?? null;
      // iTunes lets you upscale the square crop by swapping the size
      // segment. 600 is enough for a webview tile and still a small download.
      const upscaled = small ? small.replace(/\/\d+x\d+(bb)?\.([a-z]+)$/i, '/600x600bb.$2') : null;
      this.cache.set(key, upscaled);
      return upscaled;
    } catch {
      this.cache.set(key, null);
      return null;
    }
  }

  /** Synchronous cache read — no I/O, returns whatever's cached or undefined. */
  peek(title: string, artist: string): string | null | undefined {
    return this.cache.get(this.keyFor(title, artist));
  }
}
