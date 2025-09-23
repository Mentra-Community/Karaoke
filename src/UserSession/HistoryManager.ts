import { CurrentSong, SongHistoryEntry } from '../types';

export class HistoryManager {
  private history: SongHistoryEntry[] = [];
  private readonly MAX_HISTORY_SIZE = 100;
  private readonly DUPLICATE_WINDOW_MS = 30000;

  addSong(song: CurrentSong): void {
    if (this.isDuplicate(song)) {
      return;
    }

    const entry: SongHistoryEntry = {
      title: song.title,
      artist: song.artist,
      album: song.album,
      identifiedAt: Date.now(),
      duration: song.duration,
      confidence: song.confidence
    };

    this.history.unshift(entry);

    if (this.history.length > this.MAX_HISTORY_SIZE) {
      this.history = this.history.slice(0, this.MAX_HISTORY_SIZE);
    }
  }

  getRecentSongs(limit?: number): SongHistoryEntry[] {
    const maxLimit = limit || this.history.length;
    return this.history.slice(0, maxLimit);
  }

  isDuplicate(song: CurrentSong): boolean {
    const now = Date.now();
    const recentCutoff = now - this.DUPLICATE_WINDOW_MS;

    return this.history.some(entry => 
      entry.title === song.title &&
      entry.artist === song.artist &&
      entry.identifiedAt > recentCutoff
    );
  }

  clearHistory(): void {
    this.history = [];
  }

  exportHistory(): string {
    return JSON.stringify(this.history, null, 2);
  }

  importHistory(jsonData: string): boolean {
    try {
      const imported = JSON.parse(jsonData);
      if (Array.isArray(imported)) {
        this.history = imported.filter(entry => 
          entry.title && 
          entry.artist && 
          typeof entry.identifiedAt === 'number'
        ).slice(0, this.MAX_HISTORY_SIZE);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error importing history:', error);
      return false;
    }
  }

  getHistorySize(): number {
    return this.history.length;
  }

  findSong(title: string, artist: string): SongHistoryEntry | undefined {
    return this.history.find(entry => 
      entry.title.toLowerCase() === title.toLowerCase() &&
      entry.artist.toLowerCase() === artist.toLowerCase()
    );
  }

  getStatistics(): {
    totalSongs: number;
    uniqueSongs: number;
    avgConfidence: number;
    mostPlayedSong?: { song: string; count: number };
  } {
    const totalSongs = this.history.length;
    
    if (totalSongs === 0) {
      return { totalSongs: 0, uniqueSongs: 0, avgConfidence: 0 };
    }

    const uniqueMap = new Map<string, number>();
    let totalConfidence = 0;

    this.history.forEach(entry => {
      const key = `${entry.artist} - ${entry.title}`;
      uniqueMap.set(key, (uniqueMap.get(key) || 0) + 1);
      totalConfidence += entry.confidence;
    });

    const uniqueSongs = uniqueMap.size;
    const avgConfidence = totalConfidence / totalSongs;

    let mostPlayedSong: { song: string; count: number } | undefined;
    let maxCount = 0;

    uniqueMap.forEach((count, song) => {
      if (count > maxCount) {
        maxCount = count;
        mostPlayedSong = { song, count };
      }
    });

    return {
      totalSongs,
      uniqueSongs,
      avgConfidence,
      mostPlayedSong
    };
  }
}