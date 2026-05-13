import { AppSession } from '@mentra/sdk';
import { CurrentSong, LyricsChunk, AppState } from '../types';
import { formatTimestamp } from '../utils/lrcParser';
import { FiveLineDisplayFormatter } from './FiveLineDisplayFormatter';

/**
 * One frame in the audit log of what the glasses HUD has shown. We
 * record on every actual text change (deduped) so the webview can
 * replay the sequence and we can see where the formatter / position
 * sync is doing the wrong thing.
 */
export interface DisplayHistoryEntry {
  /** epoch ms when the frame was pushed to the glasses */
  at: number;
  /** full multi-line text that was sent */
  text: string;
  /** split lines for convenience in the UI */
  lines: string[];
  /** app state at the time the frame was emitted */
  appState: string;
  /** current song position in seconds (0 if no song) */
  position: number;
  /** title/artist of the active song, null when listening */
  song: {title: string; artist: string; duration: number} | null;
  /** how long this frame stayed on screen before the next change (filled in retroactively) */
  durationMs?: number;
}

export class DisplayManager {
  private currentDisplay: string = '';
  private lastUpdateTime: number = 0;
  private session: AppSession;
  private updateInterval?: NodeJS.Timeout;
  private logger: AppSession['logger'];
  private formatter: FiveLineDisplayFormatter;
  private useNewFormatter: boolean = true; // Feature flag

  private history: DisplayHistoryEntry[] = [];
  private readonly HISTORY_CAP = 500;

  constructor(session: AppSession) {
    this.session = session;
    this.logger = session.logger.child({ service: 'DisplayManager' });
    this.formatter = new FiveLineDisplayFormatter();
  }

  showListening(): void {
    this.updateDisplay('♪ Listening...');
  }

  showSongInfo(song: CurrentSong, position: number): void {
    this.logger.info({
      title: song.title,
      artist: song.artist,
      position: formatTimestamp(position),
      duration: song.duration
    }, 'Showing song info');
    const display = this.formatSongInfo(song, position);
    this.updateDisplay(display);
  }

  showLyrics(chunk: LyricsChunk): void {
    this.logger.debug({
      lines: chunk.lines.length,
      startTime: chunk.startTime,
      endTime: chunk.endTime
    }, 'Showing lyrics chunk');
    const display = this.formatLyrics(chunk);
    this.updateDisplay(display);
  }

  showProcessing(): void {
    this.updateDisplay('Processing...');
  }

  startUpdateTimer(callback: () => void, intervalMs: number = 500): void {
    this.stopUpdateTimer();
    this.updateInterval = setInterval(callback, intervalMs);
  }

  stopUpdateTimer(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }

  private formatSongInfo(song: CurrentSong, position: number): string {
    const currentTime = formatTimestamp(position);
    const totalTime = song.duration ? formatTimestamp(song.duration) : '?:??';
    
    let display = `♪ ${song.title}\n  ${song.artist}`;
    
    if (song.album) {
      display += ` - ${song.album}`;
    }
    
    display += `\n  ${currentTime} / ${totalTime}`;
    
    return display;
  }

  private formatLyrics(chunk: LyricsChunk): string {
    return chunk.lines.join('\n');
  }

  private updateDisplay(text: string): void {
    if (text !== this.currentDisplay) {
      this.logger.debug({
        newText: text,
        previousText: this.currentDisplay
      }, 'Updating display text');
      this.currentDisplay = text;
      this.lastUpdateTime = Date.now();
      this.session.layouts.showTextWall(text);
    }
  }

  /**
   * Append one frame to the audit history. Called by displayFormatted
   * with the full state context so the webview can replay what the
   * glasses were showing and at what timing. Dedupes on identical
   * text. Closes out the previous entry's durationMs.
   */
  private recordDisplayFrame(
    text: string,
    lines: string[],
    appState: AppState,
    position: number,
    song: CurrentSong | undefined,
  ): void {
    const last = this.history[this.history.length - 1];
    if (last && last.text === text) {
      // No change — extend the previous frame's duration on read instead.
      return;
    }
    const now = Date.now();
    if (last) last.durationMs = now - last.at;

    this.history.push({
      at: now,
      text,
      lines,
      appState: AppState[appState],
      position,
      song: song ? {title: song.title, artist: song.artist, duration: song.duration} : null,
    });

    if (this.history.length > this.HISTORY_CAP) {
      this.history.splice(0, this.history.length - this.HISTORY_CAP);
    }
  }

  /**
   * Return the last `limit` frames. Latest is at the end. Read-only
   * snapshot (callers don't mutate the internal buffer).
   */
  getDisplayHistory(limit = 50): DisplayHistoryEntry[] {
    const slice = this.history.slice(-limit);
    // Patch the running-frame's durationMs so the UI can render an
    // "active" frame without waiting for the next change.
    if (slice.length > 0) {
      const last = slice[slice.length - 1];
      if (last.durationMs === undefined) {
        slice[slice.length - 1] = {...last, durationMs: Date.now() - last.at};
      }
    }
    return slice;
  }

  getCurrentDisplay(): string {
    return this.currentDisplay;
  }

  getLastUpdateTime(): number {
    return this.lastUpdateTime;
  }

  clear(): void {
    this.stopUpdateTimer();
    this.updateDisplay('');
  }

  // New display method using 5-line formatter
  displayFormatted(
    appState: AppState,
    currentSong?: CurrentSong,
    currentChunk?: LyricsChunk | null,
    nextChunk?: LyricsChunk | null,
    position?: number
  ): void {
    if (!this.useNewFormatter) {
      return;
    }

    const lines = this.formatter.formatDisplay(
      appState,
      currentSong,
      currentChunk,
      nextChunk,
      position
    );

    const formattedText = lines.join('\n');

    // Only log when state changes or when displaying actual lyrics
    if (appState === AppState.SONG_DETECTED_WITH_LYRICS ||
        formattedText !== this.currentDisplay) {
      this.logger.debug({
        appState: AppState[appState],
        linesCount: lines.length,
        hasCurrentChunk: !!currentChunk,
        hasNextChunk: !!nextChunk
      }, 'Display state changed');
    }

    // Record the frame BEFORE updateDisplay so we can compare against
    // the current text. updateDisplay dedupes on its own.
    this.recordDisplayFrame(formattedText, lines, appState, position ?? 0, currentSong);
    this.updateDisplay(formattedText);
  }
}