import { LRCSource } from '../types';

/**
 * Strip remix / re-recording / version modifiers from a track or artist
 * name so LRC catalog lookups succeed for sources that don't index the
 * variant. Examples:
 *
 *   "killer queen Sped Up 204"            → "killer queen"
 *   "Mr. Brightside (Slowed + Reverb)"    → "Mr. Brightside"
 *   "Bohemian Rhapsody - Remastered 2011" → "Bohemian Rhapsody"
 *   "Levitating (feat. DaBaby)"           → "Levitating"
 *
 * Returns the cleaned string. If nothing changes, the result equals
 * the input — callers use that signal to skip a redundant retry.
 */
export function cleanTrackTitle(input: string): string {
  let s = input;

  // Drop parenthesised / bracketed annotations (remix tags, features, etc.)
  s = s.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ');

  // Drop trailing "- something" (Remastered, Live at X, Anniversary Edition)
  s = s.replace(/\s+-\s+.+$/i, ' ');

  // Drop common modifier keywords + anything that trails them
  const modifiers = [
    'sped\\s*[-\\s]?up',
    'sped\\s*up\\s*version',
    'slowed(?:\\s*\\+?\\s*reverb)?',
    'slowed\\s*down',
    'reverb',
    'nightcore',
    'remix',
    'remastered',
    'remaster',
    'extended\\s*mix',
    'radio\\s*edit',
    'acoustic',
    'instrumental',
    'live',
    'demo',
    'feat\\.?\\s+\\w[^,]*',
    'ft\\.?\\s+\\w[^,]*',
    'featuring\\s+\\w[^,]*',
  ];
  const modifierRe = new RegExp(`\\s*\\b(?:${modifiers.join('|')})\\b.*$`, 'i');
  s = s.replace(modifierRe, '');

  // Trailing numeric/code junk like " 204" or " v2"
  s = s.replace(/\s+\d+\s*$/, '');
  s = s.replace(/\s+v\d+\s*$/i, '');

  return s.replace(/\s+/g, ' ').trim();
}

/** A single LRC entry surfaced to the UI. id+syncedLyrics is enough
 *  for the user to switch to it; the rest is metadata for picking. */
export interface LRCVersion {
  /** LRClib's numeric id, used by /api/get/<id> */
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  /** Track duration in seconds as reported by LRClib. */
  duration?: number;
  /** True iff this entry has timed lyrics (we filter to these). */
  hasSyncedLyrics: boolean;
  /** First 80 chars of plain lyrics, for a preview in the picker. */
  preview: string;
}

export class LRCService {
  private sources: LRCSource[] = [
    {
      name: 'LRCLib',
      url: 'https://lrclib.net',
      searchEndpoint: '/api/search',
      downloadEndpoint: '/api/get'
    }
  ];

  async fetchLRC(title: string, artist: string): Promise<string | null> {
    // Build the search attempt list. We try the verbatim title/artist
    // first (best precision), then a cleaned variant if it differs
    // (handles "Sped Up 204", "Slowed + Reverb", etc.), and finally
    // title-only as a last-resort fuzzier search.
    const attempts: Array<{title: string; artist: string; label: string}> = [
      {title, artist, label: 'verbatim'},
    ];

    const cleanedTitle = cleanTrackTitle(title);
    const cleanedArtist = cleanTrackTitle(artist);
    if (cleanedTitle !== title || cleanedArtist !== artist) {
      attempts.push({title: cleanedTitle, artist: cleanedArtist, label: 'cleaned'});
    }

    if (cleanedTitle.length >= 3) {
      attempts.push({title: cleanedTitle, artist: '', label: 'title-only'});
    }

    for (const source of this.sources) {
      for (const attempt of attempts) {
        try {
          const lrc = await this.trySource(source, attempt.title, attempt.artist);
          if (lrc) {
            if (attempt.label !== 'verbatim') {
              console.log(`LRC match via ${attempt.label} attempt: "${attempt.title}" / "${attempt.artist}"`);
            }
            return lrc;
          }
        } catch (error) {
          console.error(`Error fetching from ${source.name} (${attempt.label}):`, error);
        }
      }
    }
    return null;
  }

  /**
   * Return every LRClib hit (with synced lyrics first) so the user
   * can pick the right cut when the auto-selected one is wrong.
   * Searches verbatim, then cleaned, then title-only; dedupes by id.
   */
  async searchAlternatives(title: string, artist: string): Promise<LRCVersion[]> {
    const source = this.sources[0]; // LRClib only for now
    const seen = new Set<number>();
    const out: LRCVersion[] = [];

    const cleanedTitle = cleanTrackTitle(title);
    const cleanedArtist = cleanTrackTitle(artist);
    const queries: Array<{title: string; artist: string}> = [
      {title, artist},
    ];
    if (cleanedTitle !== title || cleanedArtist !== artist) {
      queries.push({title: cleanedTitle, artist: cleanedArtist});
    }
    if (cleanedTitle.length >= 3) {
      queries.push({title: cleanedTitle, artist: ''});
    }

    for (const q of queries) {
      try {
        const params: Record<string, string> = {track_name: q.title};
        if (q.artist) params.artist_name = q.artist;
        const res = await fetch(`${source.url}${source.searchEndpoint}?` + new URLSearchParams(params));
        if (!res.ok) continue;
        const arr = (await res.json()) as Array<{
          id: number;
          trackName?: string;
          artistName?: string;
          albumName?: string;
          duration?: number;
          syncedLyrics?: string | null;
          plainLyrics?: string | null;
        }>;
        if (!Array.isArray(arr)) continue;
        for (const r of arr) {
          if (!r.id || seen.has(r.id)) continue;
          seen.add(r.id);
          out.push({
            id: r.id,
            trackName: r.trackName ?? "",
            artistName: r.artistName ?? "",
            albumName: r.albumName,
            duration: r.duration,
            hasSyncedLyrics: !!r.syncedLyrics,
            preview: (r.plainLyrics ?? "").slice(0, 80).replace(/\s+/g, " ").trim(),
          });
        }
        if (out.length >= 20) break;
      } catch {
        // try next query
      }
    }

    // Synced first, then by closest title match.
    out.sort((a, b) => {
      if (a.hasSyncedLyrics !== b.hasSyncedLyrics) return a.hasSyncedLyrics ? -1 : 1;
      return 0;
    });
    return out.slice(0, 20);
  }

  /** Fetch a single LRC by LRClib id. Returns null if no synced lyrics. */
  async fetchById(id: number): Promise<string | null> {
    const source = this.sources[0];
    try {
      const res = await fetch(`${source.url}${source.downloadEndpoint}/${id}`);
      if (!res.ok) return null;
      const data = (await res.json()) as {syncedLyrics?: string | null};
      return data.syncedLyrics ?? null;
    } catch {
      return null;
    }
  }

  private async trySource(source: LRCSource, title: string, artist: string): Promise<string | null> {
    try {
      const params: Record<string, string> = {
        track_name: title,
        get: 'lyrics',
      };
      if (artist) params.artist_name = artist;

      const searchUrl = `${source.url}${source.searchEndpoint}?` + new URLSearchParams(params);

      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        return null;
      }

      const results = await searchResponse.json();

      if (!Array.isArray(results) || results.length === 0) {
        return null;
      }

      const bestMatch =
        results.find(
          r =>
            r.syncedLyrics &&
            r.trackName?.toLowerCase() === title.toLowerCase() &&
            (!artist || r.artistName?.toLowerCase() === artist.toLowerCase())
        ) ||
        results.find(r => r.syncedLyrics) ||
        results[0];

      if (bestMatch?.syncedLyrics) {
        return bestMatch.syncedLyrics;
      }

      if (bestMatch?.id) {
        const lyricsUrl = `${source.url}${source.downloadEndpoint}/${bestMatch.id}`;
        const lyricsResponse = await fetch(lyricsUrl);

        if (lyricsResponse.ok) {
          const data = await lyricsResponse.json();
          return data.syncedLyrics || null;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error with ${source.name}:`, error);
      return null;
    }
  }
}
