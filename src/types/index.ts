export enum AppState {
  LISTENING,
  SONG_DETECTED_NO_LYRICS,
  SONG_DETECTED_WITH_LYRICS,
  PROCESSING
}

export interface CurrentSong {
  title: string;
  artist: string;
  album?: string;
  duration: number;
  detectedAt: number;
  /**
   * True once an LRC has been loaded for this song. Always false
   * while `lyricsLoading` is true, then resolves to true (LRC found)
   * or stays false (no LRC available).
   */
  hasLyrics: boolean;
  /**
   * True between song-detect and the LRC fetch resolving either way.
   * The webview uses this to show "Loading lyrics…" instead of
   * "No lyrics" during the fetch, so the user can tell the app is
   * working not failing.
   */
  lyricsLoading: boolean;
  lrcData?: LRCLine[];
  confidence: number;
}

export interface LRCLine {
  timestamp: number;
  text: string;
  endTime?: number;
}

export interface RecognitionResult {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  offsetSeconds?: number;
  confidence: number;
  error?: string;
  apiLatency?: number;
}

export interface LyricsChunk {
  lines: string[];
  startTime: number;
  endTime: number;
  wordsPerLine: number[];
}

export interface RecognitionPoint {
  timestamp: number;
  detectedOffset: number;
  confidence: number;
  apiLatency: number;
}

export interface SongHistoryEntry {
  title: string;
  artist: string;
  album?: string;
  identifiedAt: number;
  duration?: number;
  confidence: number;
}

export interface KaraokeConfig {
  recognition: {
    intervalMs: number;
    bufferDurationMs: number;
    confidenceThreshold: number;
    maxDriftSeconds: number;
  };
  display: {
    maxWordsPerLine: number;
    maxCharsPerLine: number;
    linesPerChunk: number;
    updateIntervalMs: number;
  };
  history: {
    maxEntries: number;
    duplicateWindowMs: number;
  };
}

export interface LRCSource {
  name: string;
  url: string;
  searchEndpoint: string;
  downloadEndpoint: string;
}