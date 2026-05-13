import { AppSession } from '@mentra/sdk';
import * as fs from 'fs';
import { CurrentSong, LyricsChunk, AppState } from '../types';
import { formatTimestamp } from '../utils/lrcParser';
import { FiveLineDisplayFormatter } from './FiveLineDisplayFormatter';

/**
 * Where the audit log of glasses HUD frames gets appended.
 * One entry per text change. Plain text, greppable, intended for
 * after-the-fact debugging not UI.
 *
 * Curl it from a running app via GET /api/display-log.
 */
const DISPLAY_LOG_PATH = './display-log.txt';

interface PreviousFrameMeta {
  at: number;
  text: string;
}

export class DisplayManager {
  private currentDisplay: string = '';
  private lastUpdateTime: number = 0;
  private session: AppSession;
  private updateInterval?: NodeJS.Timeout;
  private logger: AppSession['logger'];
  private formatter: FiveLineDisplayFormatter;
  private useNewFormatter: boolean = true; // Feature flag

  private previousFrame: PreviousFrameMeta | null = null;

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
   * Append one frame to ./display-log.txt for after-the-fact audit.
   * Dedupes on identical text. Records how long the previous frame
   * stayed on screen.
   *
   * Format (per frame):
   *
   *   [ISO timestamp]  +<duration>ms  <APP_STATE>  pos=<m:ss>/<m:ss>  song="Title — Artist"
   *   | line 1 of the HUD
   *   | line 2
   *   | ...
   *
   * Plain text so it greps cleanly. Newlines between frames.
   */
  private recordDisplayFrame(
    text: string,
    lines: string[],
    appState: AppState,
    position: number,
    song: CurrentSong | undefined,
  ): void {
    if (this.previousFrame && this.previousFrame.text === text) {
      // No actual change — skip. Previous frame's durationMs grows.
      return;
    }
    const now = Date.now();
    const durationMs = this.previousFrame ? now - this.previousFrame.at : 0;

    const songStr = song
      ? `song="${song.title.replace(/"/g, '\\"')} — ${song.artist.replace(/"/g, '\\"')}"`
      : 'song=none';
    const posStr = song
      ? `pos=${formatTimestamp(position)}/${formatTimestamp(song.duration)}`
      : 'pos=-';
    const header = `[${new Date(now).toISOString()}]  +${durationMs}ms  ${AppState[appState]}  ${posStr}  ${songStr}`;
    const body = lines.map((l) => `| ${l}`).join('\n');
    const block = header + '\n' + body + '\n\n';

    fs.appendFile(DISPLAY_LOG_PATH, block, (err) => {
      if (err) this.logger.warn({err: err.message}, 'Failed to append display-log.txt');
    });

    this.previousFrame = {at: now, text};
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
    position?: number,
    previousChunk?: LyricsChunk | null,
  ): void {
    if (!this.useNewFormatter) {
      return;
    }

    const lines = this.formatter.formatDisplay(
      appState,
      currentSong,
      currentChunk,
      nextChunk,
      position,
      previousChunk,
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