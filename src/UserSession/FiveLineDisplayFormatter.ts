import {TextMeasurer, TextWrapper, G1_PROFILE} from '../utils/displayUtils';
import { CurrentSong, LyricsChunk, AppState } from '../types';
import { formatTimestamp } from '../utils/lrcParser';

export interface DisplayLine {
  text: string;
  type: 'header' | 'lyrics' | 'info' | 'empty';
}

export class FiveLineDisplayFormatter {
  private readonly MAX_LINES = 5;

  // Pixel-accurate width budget for the G1 HUD (576px). Used for any
  // ad-hoc per-line measurement we still do in this file (the song
  // info screen and the next-chunk preview truncation). Lyric chunks
  // themselves are pre-wrapped by textChunker.
  private readonly measurer = new TextMeasurer(G1_PROFILE);
  private readonly wrapper = new TextWrapper(this.measurer, {
    breakMode: 'word',
    hyphenChar: '-',
  });
  private readonly displayWidthPx = G1_PROFILE.displayWidthPx;

  formatDisplay(
    appState: AppState,
    currentSong?: CurrentSong,
    currentChunk?: LyricsChunk | null,
    nextChunk?: LyricsChunk | null,
    currentPosition?: number
  ): string[] {
    const lines: DisplayLine[] = [];

    switch (appState) {
      case AppState.LISTENING:
        return this.formatListening();
        
      case AppState.PROCESSING:
        return this.formatProcessing();
        
      case AppState.SONG_DETECTED_NO_LYRICS:
        return this.formatSongInfo(currentSong!, currentPosition || 0);
        
      case AppState.SONG_DETECTED_WITH_LYRICS:
        return this.formatLyricsDisplay(currentSong!, currentChunk, nextChunk, currentPosition || 0);
        
      default:
        return this.formatListening();
    }
  }

  private formatListening(): string[] {
    return [
      '♪ Listening...',
      '',
      '',
      '',
      ''
    ];
  }

  private formatProcessing(): string[] {
    return [
      'Processing...',
      '',
      '',
      '',
      ''
    ];
  }

  private formatSongInfo(song: CurrentSong, position: number): string[] {
    const lines: string[] = [];
    
    // Line 1: Song title
    lines.push(this.fitOneLine(`♪ ${song.title}`));
    
    // Line 2: Artist
    lines.push(this.fitOneLine(`  ${song.artist}`));
    
    // Line 3: Album (if available)
    if (song.album) {
      lines.push(this.fitOneLine(`  ${song.album}`));
    } else {
      lines.push('');
    }
    
    // Line 4: Empty
    lines.push('');
    
    // Line 5: Time
    const timeStr = `  ${formatTimestamp(position)} / ${formatTimestamp(song.duration)}`;
    lines.push(timeStr);
    
    return lines;
  }

  private formatLyricsDisplay(
    song: CurrentSong,
    currentChunk?: LyricsChunk | null,
    nextChunk?: LyricsChunk | null,
    position: number = 0
  ): string[] {
    const lines: string[] = [];

    if (!currentChunk) {
      // No current chunk, show song info
      return this.formatSongInfo(song, position);
    }

    // The chunker already wrapped these lines pixel-accurately for the
    // G1's display width — pass them through verbatim. We just decide
    // how many to show and what to put in the rest of the slots.
    const hasMultipleLines = currentChunk.lines.length > 1;

    if (hasMultipleLines) {
      // Two-line chunk: most of the screen real estate goes to lyrics.
      lines.push(currentChunk.lines[0]);
      lines.push(currentChunk.lines[1]);
      lines.push('-----');

      if (nextChunk && nextChunk.lines.length > 0) {
        lines.push(this.fitOneLine(nextChunk.lines[0]));
      } else {
        lines.push('');
      }
    } else {
      // Single-line chunk: leave the next-line slot blank so it doesn't
      // crowd the active lyric, and use the bottom rows for preview.
      lines.push(currentChunk.lines[0]);
      lines.push('');

      if (nextChunk) {
        lines.push('-----');
        lines.push(this.fitOneLine(nextChunk.lines[0]));
      } else {
        lines.push('');
        lines.push('');
      }
    }

    // Bottom row: time / duration
    lines.push(`${formatTimestamp(position)} / ${formatTimestamp(song.duration)}`);
    return lines;
  }

  /**
   * Pixel-accurate single-line fit for the next-chunk preview slot.
   * If the line overflows the HUD width, wrap and take just the first
   * line so it doesn't bleed into the time/separator rows.
   */
  private fitOneLine(text: string): string {
    if (!text) return '';
    const result = this.wrapper.wrap(text, {
      maxWidthPx: this.displayWidthPx,
      maxLines: 1,
      maxBytes: Infinity,
    });
    return result.lines[0] ?? text;
  }

  // Alternative format for instrumental breaks
  formatInstrumental(song: CurrentSong, position: number): string[] {
    return [
      `♪ ${song.title}`,
      `  ${song.artist}`,
      '',
      '  ♪ Instrumental ♪',
      `  ${formatTimestamp(position)} / ${formatTimestamp(song.duration)}`
    ];
  }

  // Format for showing previous/current/next context
  formatWithContext(
    currentChunk?: LyricsChunk | null,
    previousLine?: string,
    nextChunk?: LyricsChunk | null,
    position: number = 0,
    duration: number = 0
  ): string[] {
    const lines: string[] = [];
    
    // Compact time header
    lines.push(`♪ ${formatTimestamp(position)} / ${formatTimestamp(duration)}`);
    
    // Previous context (if available)
    if (previousLine) {
      const truncated = this.fitOneLine('... ' + previousLine);
      lines.push(truncated);
    } else {
      lines.push('');
    }
    
    // Current lyrics
    if (currentChunk) {
      if (currentChunk.lines.length === 2) {
        lines.push(this.fitOneLine(currentChunk.lines[0]));
        lines.push(this.fitOneLine(currentChunk.lines[1]));
      } else {
        lines.push(this.fitOneLine(currentChunk.lines[0]));
        lines.push('');
      }
    } else {
      lines.push('');
      lines.push('');
    }
    
    // Next preview (if room)
    if (lines.length < this.MAX_LINES && nextChunk) {
      const preview = this.fitOneLine(nextChunk.lines[0] + ' ...');
      lines.push(preview);
    }
    
    // Ensure exactly 5 lines
    while (lines.length < this.MAX_LINES) {
      lines.push('');
    }
    
    return lines.slice(0, this.MAX_LINES);
  }
}