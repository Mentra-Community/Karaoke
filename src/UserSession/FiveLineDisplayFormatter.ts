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
    currentPosition?: number,
    previousChunk?: LyricsChunk | null,
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
        return this.formatLyricsDisplay(currentSong!, currentChunk, nextChunk, currentPosition || 0, previousChunk);
        
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

    // Line 4: while the LRC fetch is in flight, show a loading hint
    // so the user knows we're working on lyrics, not just sitting on
    // the song info. Once fetchLyrics resolves, lyricsLoading flips
    // false and either the state moves to SONG_DETECTED_WITH_LYRICS
    // (full lyric view) or stays here with the line cleared.
    if (song.lyricsLoading) {
      lines.push('  Lyrics loading…');
    } else {
      lines.push('');
    }

    // Line 5: Time. During the song-end grace window position keeps
    // ticking past duration; clamp so the HUD never displays nonsense
    // like "4:45 / 4:40".
    const shownPosition = song.duration > 0 ? Math.min(position, song.duration) : position;
    const timeStr = `  ${formatTimestamp(shownPosition)} / ${formatTimestamp(song.duration)}`;
    lines.push(timeStr);

    return lines;
  }

  /**
   * New 5-line layout for SONG_DETECTED_WITH_LYRICS:
   *
   *   Line 1: ♪ Song title          (truncated to one line, never wraps)
   *   Line 2: previous lyric line   (read-along buffer above)
   *   Line 3: - current lyric line  (the one we think is sung right now)
   *   Line 4: next lyric line       (read-ahead buffer below)
   *   Line 5: 0:42 / 3:12           (position / duration)
   *
   * The "-" prefix on line 3 tells the user which line we believe is
   * active, so if our timing is off by a phrase the user can still
   * follow along by reading the line above or below.
   *
   * Each lyric slot is pixel-fit to one HUD line. When a chunk
   * naturally wraps to multiple lines we take just the first line of
   * its wrapped content here — the user gets coverage by reading the
   * surrounding context lines from prev/next chunks.
   */
  private formatLyricsDisplay(
    song: CurrentSong,
    currentChunk?: LyricsChunk | null,
    nextChunk?: LyricsChunk | null,
    position: number = 0,
    previousChunk?: LyricsChunk | null,
  ): string[] {
    const lines: string[] = [];

    // Line 1: song title (truncated if it doesn't fit one line)
    lines.push(this.fitOneLine(`♪ ${song.title}`));

    // Lines 2–4: 3-row lyric context. The chunker combines adjacent
    // LRC lines when they fit and are close in time, so the current
    // chunk may occupy 1, 2, or 3 of those rows. We adapt:
    //
    //   1 line current → prev / "- " current / next   (full context)
    //   2 line current → "- " line1 / line2 / next    (sacrifice prev)
    //   3 line current → "- " line1 / line2 / line3   (no prev or next)
    //
    // The "- " marker always rides line 1 of the current chunk so the
    // user knows where our timing guess starts.
    const curLines = currentChunk?.lines ?? [];

    if (curLines.length >= 3) {
      lines.push(this.fitOneLine(`- ${curLines[0]}`));
      lines.push(this.fitOneLine(`  ${curLines[1]}`));
      lines.push(this.fitOneLine(`  ${curLines[2]}`));
    } else if (curLines.length === 2) {
      lines.push(this.fitOneLine(`- ${curLines[0]}`));
      lines.push(this.fitOneLine(`  ${curLines[1]}`));
      lines.push(this.fitOneLine(nextChunk?.lines?.[0] ?? ''));
    } else {
      // 0 or 1 line in current chunk. 0 means we're between phrases —
      // hold an empty marker row so the prev/next rows don't shift.
      const prevText = previousChunk?.lines?.[0];
      lines.push(prevText ? this.fitOneLine(prevText) : '');
      const curText = curLines[0];
      lines.push(this.fitOneLine(curText ? `- ${curText}` : '-'));
      const nextText = nextChunk?.lines?.[0];
      lines.push(nextText ? this.fitOneLine(nextText) : '');
    }

    // Line 5: clock — clamp position so we never show "4:45 / 4:40"
    const shownPosition = song.duration > 0 ? Math.min(position, song.duration) : position;
    lines.push(`${formatTimestamp(shownPosition)} / ${formatTimestamp(song.duration)}`);

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