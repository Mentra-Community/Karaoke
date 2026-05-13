/**
 * textChunker
 *
 * Build LyricsChunks from parsed LRC lines using @mentra/sdk's
 * display-utils for pixel-accurate text wrapping (G1_PROFILE @ 576px).
 *
 * Why this matters: a hardcoded `maxCharsPerLine = 60` either wraps
 * too early (when characters are narrow — "i", "l", "t") or overflows
 * (when characters are wide — "m", "w", "M"). The SDK's TextMeasurer
 * knows the real glyph widths for the G1's font and packs every line
 * to its actual pixel budget. That gets ~20% more text per line on
 * average compared to the character-count guess.
 *
 * One chunk now corresponds to one LRC line (one timestamp range).
 * The chunk's `.lines` is the wrapped result. If a single LRC line
 * overflows past `maxLinesPerChunk`, we keep all the lines together
 * in one chunk and trust the formatter to scroll/truncate — splitting
 * a phrase across two chunks (and therefore two time windows) makes
 * the second half pop on screen mid-sentence.
 */

import {TextMeasurer, TextWrapper, G1_PROFILE, type DisplayProfile} from "./displayUtils";
import {LRCLine, LyricsChunk} from "../types";

export interface ChunkerOptions {
  /** Hardware profile. Default G1_PROFILE (576px wide, 5 lines). */
  profile?: DisplayProfile;
  /**
   * Width override in pixels. When the user picks "Narrow / Medium /
   * Wide" we scale this; otherwise we use the profile's full width.
   */
  widthPx?: number;
  /**
   * Maximum lines the chunk can occupy. Defaults to 2 because we want
   * to leave HUD room for a "next" preview and the position counter.
   */
  maxLinesPerChunk?: number;
  /**
   * 'word' breaks at word boundaries (lyric-friendly).
   * 'character' packs harder but can break mid-word with a hyphen.
   * Default 'word' for lyrics.
   */
  breakMode?: "character" | "word" | "strict-word";
}

export function chunkLyrics(lrcData: LRCLine[], options: ChunkerOptions = {}): LyricsChunk[] {
  const profile = options.profile ?? G1_PROFILE;
  const maxWidthPx = options.widthPx ?? profile.displayWidthPx;
  const maxLines = options.maxLinesPerChunk ?? 2;
  const breakMode = options.breakMode ?? "word";

  const measurer = new TextMeasurer(profile);
  const wrapper = new TextWrapper(measurer, {breakMode, hyphenChar: "-"});

  const chunks: LyricsChunk[] = [];

  for (const line of lrcData) {
    if (!line.text) continue;

    const wrapped = wrapper.wrap(line.text, {
      maxWidthPx,
      // Don't truncate during wrapping — we want every line. If a
      // single LRC line happens to overflow 2 HUD lines (rare), we'd
      // rather keep it all than drop the tail.
      maxLines: Infinity,
      maxBytes: Infinity,
    });

    const lines = wrapped.lines.length > 0 ? wrapped.lines : [line.text];
    const finalLines = lines.length > maxLines ? lines.slice(0, maxLines) : lines;

    chunks.push({
      lines: finalLines,
      startTime: line.timestamp,
      endTime: line.endTime ?? line.timestamp + 3,
      wordsPerLine: finalLines.map((l) => l.split(/\s+/).filter(Boolean).length),
    });
  }

  return chunks;
}
