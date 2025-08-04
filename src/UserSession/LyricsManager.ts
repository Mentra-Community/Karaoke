import { CurrentSong, LRCLine, LyricsChunk } from '../types';
import { LRCService } from '../services/LRCService';
import { parseLRC } from '../utils/lrcParser';
import { chunkLyrics } from '../utils/textChunker';

export class LyricsManager {
  private cachedLRC = new Map<string, LRCLine[]>();
  private lrcService: LRCService;
  private currentChunks: LyricsChunk[] = [];

  constructor(lrcService: LRCService) {
    this.lrcService = lrcService;
  }

  async fetchLyrics(song: CurrentSong): Promise<LRCLine[] | null> {
    const cacheKey = `${song.artist}-${song.title}`;
    
    if (this.cachedLRC.has(cacheKey)) {
      return this.cachedLRC.get(cacheKey)!;
    }

    try {
      const lrcContent = await this.lrcService.fetchLRC(song.title, song.artist);
      if (!lrcContent) {
        return null;
      }

      const lrcData = parseLRC(lrcContent);
      if (lrcData.length > 0) {
        this.cachedLRC.set(cacheKey, lrcData);
        this.currentChunks = this.chunkLyrics(lrcData);
        return lrcData;
      }

      return null;
    } catch (error) {
      console.error('Error fetching lyrics:', error);
      return null;
    }
  }

  chunkLyrics(lrcData: LRCLine[]): LyricsChunk[] {
    return chunkLyrics(lrcData, 8, 60, 2);
  }

  getCurrentChunk(position: number): LyricsChunk | null {
    if (this.currentChunks.length === 0) {
      return null;
    }

    for (const chunk of this.currentChunks) {
      if (position >= chunk.startTime && position < chunk.endTime) {
        return chunk;
      }
    }

    const nextChunk = this.currentChunks.find(chunk => chunk.startTime > position);
    if (nextChunk && nextChunk.startTime - position < 1) {
      return nextChunk;
    }

    return null;
  }

  clearCache(): void {
    this.cachedLRC.clear();
    this.currentChunks = [];
  }

  getCacheSize(): number {
    return this.cachedLRC.size;
  }
}