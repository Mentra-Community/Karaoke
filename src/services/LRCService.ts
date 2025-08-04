import { LRCSource } from '../types';

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
    for (const source of this.sources) {
      try {
        const lrc = await this.trySource(source, title, artist);
        if (lrc) return lrc;
      } catch (error) {
        console.error(`Error fetching from ${source.name}:`, error);
      }
    }
    return null;
  }

  private async trySource(source: LRCSource, title: string, artist: string): Promise<string | null> {
    try {
      const searchUrl = `${source.url}${source.searchEndpoint}?` + 
        new URLSearchParams({
          track_name: title,
          artist_name: artist,
          get: 'lyrics'
        });

      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        return null;
      }

      const results = await searchResponse.json();
      
      if (!Array.isArray(results) || results.length === 0) {
        return null;
      }

      const bestMatch = results.find(r => 
        r.syncedLyrics && 
        r.trackName?.toLowerCase() === title.toLowerCase() &&
        r.artistName?.toLowerCase() === artist.toLowerCase()
      ) || results.find(r => r.syncedLyrics) || results[0];

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