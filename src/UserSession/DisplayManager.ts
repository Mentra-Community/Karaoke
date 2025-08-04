import { AppSession } from '@mentra/sdk';
import { CurrentSong, LyricsChunk, AppState } from '../types';
import { formatTimestamp } from '../utils/lrcParser';
import { FiveLineDisplayFormatter } from './FiveLineDisplayFormatter';

export class DisplayManager {
  private currentDisplay: string = '';
  private lastUpdateTime: number = 0;
  private session: AppSession;
  private updateInterval?: NodeJS.Timeout;
  private logger: AppSession['logger'];
  private formatter: FiveLineDisplayFormatter;
  private useNewFormatter: boolean = true; // Feature flag

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
    
    this.logger.debug({
      appState: AppState[appState],
      linesCount: lines.length,
      hasCurrentChunk: !!currentChunk,
      hasNextChunk: !!nextChunk
    }, 'Using 5-line formatter');

    this.updateDisplay(formattedText);
  }
}