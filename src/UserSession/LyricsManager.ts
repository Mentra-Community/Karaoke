import { CurrentSong, LRCLine, LyricsChunk } from '../types';
import { LRCService } from '../services/LRCService';
import { parseLRC } from '../utils/lrcParser';
import { chunkLyrics } from '../utils/textChunker';
import { preprocessLRC, analyzeLRCPatterns } from '../utils/lrcPreprocessor';

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

      const rawLrcData = parseLRC(lrcContent);
      if (rawLrcData.length > 0) {
        // Analyze if preprocessing would help
        const analysis = analyzeLRCPatterns(rawLrcData);
        
        let lrcData = rawLrcData;
        if (analysis.recommendPreprocessing) {
          const preprocessed = preprocessLRC(rawLrcData);
          lrcData = preprocessed.lines;
          console.log('LRC preprocessed:', {
            originalLines: rawLrcData.length,
            processedLines: lrcData.length,
            metadata: preprocessed.metadata
          });
        }
        
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
    // Pixel-accurate wrapping via display-utils. Defaults to G1_PROFILE
    // (576px / 5 lines) and word-boundary breaks.
    return chunkLyrics(lrcData, {maxLinesPerChunk: 2, breakMode: "word"});
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

  getNextChunk(position: number): LyricsChunk | null {
    if (this.currentChunks.length === 0) {
      return null;
    }

    const currentChunk = this.getCurrentChunk(position);
    if (!currentChunk) {
      return this.currentChunks.find(chunk => chunk.startTime > position) || null;
    }

    const currentIndex = this.currentChunks.findIndex(
      chunk => chunk.startTime === currentChunk.startTime
    );
    
    if (currentIndex >= 0 && currentIndex < this.currentChunks.length - 1) {
      return this.currentChunks[currentIndex + 1];
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