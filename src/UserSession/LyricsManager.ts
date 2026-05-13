import { CurrentSong, LRCLine, LyricsChunk } from '../types';
import { LRCService } from '../services/LRCService';
import { parseLRC } from '../utils/lrcParser';
import { chunkLyrics } from '../utils/textChunker';
import { preprocessLRC, analyzeLRCPatterns } from '../utils/lrcPreprocessor';

export class LyricsManager {
  private cachedLRC = new Map<string, LRCLine[]>();
  private lrcService: LRCService;
  private currentChunks: LyricsChunk[] = [];
  /** Which LRClib id the current chunks were built from, if any. Lets the
   *  UI show "current version: <id>" and hide it from the alternatives list. */
  private currentLRCId: number | null = null;

  constructor(lrcService: LRCService) {
    this.lrcService = lrcService;
  }

  getCurrentLRCId(): number | null {
    return this.currentLRCId;
  }

  /**
   * Replace the active LRC with one specified by LRClib id. Used by
   * the webview's "Wrong version?" picker — the user has decided we
   * picked the wrong cut and wants to switch.
   *
   * Returns the parsed LRC lines on success, null if the id isn't
   * available or has no synced lyrics.
   */
  async switchToLRCById(id: number): Promise<LRCLine[] | null> {
    const lrcContent = await this.lrcService.fetchById(id);
    if (!lrcContent) return null;
    const lines = this.processLRCText(lrcContent);
    if (!lines) return null;
    this.currentLRCId = id;
    this.currentChunks = this.chunkLyrics(lines);
    return lines;
  }

  /** Shared parse + preprocess pipeline used by fetchLyrics and switchToLRCById. */
  private processLRCText(lrcContent: string): LRCLine[] | null {
    const raw = parseLRC(lrcContent);
    if (raw.length === 0) return null;
    const analysis = analyzeLRCPatterns(raw);
    if (analysis.recommendPreprocessing) {
      const preprocessed = preprocessLRC(raw);
      return preprocessed.lines;
    }
    return raw;
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
    // Pixel-accurate wrapping via display-utils, plus the combining
    // heuristics (max 3 HUD lines per chunk, max 3 combined LRC
    // lines, max 2s gap, max 6s total chunk duration). Defaults
    // live in textChunker.ts.
    return chunkLyrics(lrcData, {breakMode: "word"});
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

  /**
   * The chunk that just finished, used as the "buffer above" line on
   * the HUD so the user can read along even when our timing is a
   * little ahead of the audio. If there's no active current chunk
   * (gap between LRC lines), this returns the most-recently-passed
   * chunk so the HUD doesn't go blank between phrases.
   */
  getPreviousChunk(position: number): LyricsChunk | null {
    if (this.currentChunks.length === 0) return null;

    const current = this.getCurrentChunk(position);

    if (current) {
      const idx = this.currentChunks.findIndex(c => c.startTime === current.startTime);
      return idx > 0 ? this.currentChunks[idx - 1] : null;
    }

    // No active chunk → pick the most recently passed one.
    let best: LyricsChunk | null = null;
    for (const chunk of this.currentChunks) {
      if (chunk.startTime <= position) {
        if (!best || chunk.startTime > best.startTime) best = chunk;
      }
    }
    return best;
  }

  clearCache(): void {
    this.cachedLRC.clear();
    this.currentChunks = [];
  }

  getCacheSize(): number {
    return this.cachedLRC.size;
  }
}