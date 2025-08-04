import { CurrentSong, LyricsChunk, AppState } from '../types';
import { formatTimestamp } from '../utils/lrcParser';

export interface DisplayLine {
  text: string;
  type: 'header' | 'lyrics' | 'info' | 'empty';
}

export class FiveLineDisplayFormatter {
  private readonly MAX_LINES = 5;
  private readonly MAX_CHARS = 45;

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
    lines.push(this.truncate(`♪ ${song.title}`));
    
    // Line 2: Artist
    lines.push(this.truncate(`  ${song.artist}`));
    
    // Line 3: Album (if available)
    if (song.album) {
      lines.push(this.truncate(`  ${song.album}`));
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
    
    // Strategy: Show current lyrics with minimal header
    const hasMultipleLines = currentChunk.lines.length > 1;
    const showTimeOnBottom = true;
    
    if (hasMultipleLines) {
      // Two line chunk - use most space for lyrics
      lines.push(this.truncate(currentChunk.lines[0]));
      lines.push(this.truncate(currentChunk.lines[1]));
      lines.push('-----');
      
      // Show next preview if available
      if (nextChunk && nextChunk.lines.length > 0) {
        const preview = this.truncate(nextChunk.lines[0]);
        lines.push(preview.length > 42 ? preview.substring(0, 39) + '...' : preview);
      } else {
        lines.push('');
      }
      
      // Time at bottom
      lines.push(`${formatTimestamp(position)} / ${formatTimestamp(song.duration)}`);
    } else {
      // Single line chunk - add more context
      lines.push(this.truncate(currentChunk.lines[0]));
      lines.push('');
      
      // Show next chunk preview
      if (nextChunk) {
        lines.push('-----');
        const preview = this.truncate(nextChunk.lines[0]);
        lines.push(preview.length > 42 ? preview.substring(0, 39) + '...' : preview);
      } else {
        lines.push('');
        lines.push('');
      }
      
      // Time at bottom
      lines.push(`${formatTimestamp(position)} / ${formatTimestamp(song.duration)}`);
    }
    
    return lines;
  }

  private truncate(text: string): string {
    if (text.length <= this.MAX_CHARS) {
      return text;
    }
    
    // Try to break at word boundary
    const truncated = text.substring(0, this.MAX_CHARS - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > this.MAX_CHARS - 10) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
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
      const truncated = this.truncate('... ' + previousLine);
      lines.push(truncated);
    } else {
      lines.push('');
    }
    
    // Current lyrics
    if (currentChunk) {
      if (currentChunk.lines.length === 2) {
        lines.push(this.truncate(currentChunk.lines[0]));
        lines.push(this.truncate(currentChunk.lines[1]));
      } else {
        lines.push(this.truncate(currentChunk.lines[0]));
        lines.push('');
      }
    } else {
      lines.push('');
      lines.push('');
    }
    
    // Next preview (if room)
    if (lines.length < this.MAX_LINES && nextChunk) {
      const preview = this.truncate(nextChunk.lines[0] + ' ...');
      lines.push(preview);
    }
    
    // Ensure exactly 5 lines
    while (lines.length < this.MAX_LINES) {
      lines.push('');
    }
    
    return lines.slice(0, this.MAX_LINES);
  }
}