/**
 * textChunker
 *
 * Build LyricsChunks from parsed LRC lines, pixel-accurately wrapping
 * each LRC line via @mentra/sdk's display-utils (G1_PROFILE @ 576 px),
 * then GREEDILY combining adjacent LRC lines into one chunk when:
 *
 *   1. They fit in `maxLinesPerChunk` HUD rows together (pixel measured)
 *   2. The time gap between them is < `maxGapSeconds` — long pauses
 *      mean the next phrase is its own thought, not a continuation
 *   3. The combined chunk's total time-on-screen ≤ `maxChunkDurationSeconds`
 *   4. We haven't already combined `maxLrcLinesPerChunk` LRC lines
 *
 * Why combine at all:
 *   - The HUD has room for 3 lyric context rows. If two adjacent LRC
 *     lines fit on one row each and are sung back-to-back (~1 s apart),
 *     showing them as ONE chunk that occupies 2 of the 3 context rows
 *     reads better than flipping rapidly between two single-line chunks.
 *   - When LRC has a short trailing word like just "Yeah" 0.8 s after
 *     the previous line, that's a continuation — combine.
 *   - When LRC has a 20-second gap before the next phrase, that's a
 *     verse boundary — don't combine.
 *
 * Why NOT combine more aggressively:
 *   - Past 6 s on screen, the user loses the sense of which line is
 *     "active right now."
 *   - Combining across a long gap means the prev-line stays on screen
 *     during instrumentals, which looks broken.
 */

import {TextMeasurer, TextWrapper, G1_PROFILE, type DisplayProfile} from "./displayUtils";
import {LRCLine, LyricsChunk} from "../types";

export interface ChunkerOptions {
  /** Hardware profile. Default G1_PROFILE (576 px wide, 5 lines). */
  profile?: DisplayProfile;
  /** Width override in px. */
  widthPx?: number;
  /**
   * Maximum HUD rows a chunk can occupy. The new formatter renders
   * the current chunk across up to 3 context rows (no prev/next when
   * the chunk uses all 3). Default 3.
   */
  maxLinesPerChunk?: number;
  /**
   * Maximum LRC lines combined into one chunk. Past 3 the chunk
   * carries too much text and the timing window gets diluted.
   */
  maxLrcLinesPerChunk?: number;
  /**
   * Don't combine across a gap larger than this. A long silence
   * between adjacent LRC lines is a phrase boundary — keep them
   * separate so the prev one falls off naturally.
   */
  maxGapSeconds?: number;
  /**
   * Cap on chunk total duration. Combining 3 short LRC lines that
   * together span 10 s would dilute the karaoke feel; we'd rather
   * break them into two chunks of 5 s each.
   */
  maxChunkDurationSeconds?: number;
  /** 'word' (default) | 'character' | 'strict-word'. */
  breakMode?: "character" | "word" | "strict-word";
}

interface WrappedLine {
  lrc: LRCLine;
  /** HUD-wrapped lines for this single LRC entry. Always ≥ 1. */
  lines: string[];
  /** This line's effective end time (next line's start or +3 s for last). */
  endTime: number;
}

export function chunkLyrics(lrcData: LRCLine[], options: ChunkerOptions = {}): LyricsChunk[] {
  const profile = options.profile ?? G1_PROFILE;
  const maxWidthPx = options.widthPx ?? profile.displayWidthPx;
  const maxLines = options.maxLinesPerChunk ?? 3;
  const maxLrcLines = options.maxLrcLinesPerChunk ?? 3;
  const maxGap = options.maxGapSeconds ?? 2.0;
  const maxChunkDuration = options.maxChunkDurationSeconds ?? 6.0;
  const breakMode = options.breakMode ?? "word";

  const measurer = new TextMeasurer(profile);
  const wrapper = new TextWrapper(measurer, {breakMode, hyphenChar: "-"});

  // Pre-wrap each LRC line so combining decisions know exact HUD-line cost.
  const wrapped: WrappedLine[] = lrcData
    .filter((line) => !!line.text)
    .map((line) => {
      const w = wrapper.wrap(line.text, {
        maxWidthPx,
        maxLines: Infinity,
        maxBytes: Infinity,
      });
      const ls = w.lines.length > 0 ? w.lines : [line.text];
      return {lrc: line, lines: ls, endTime: line.endTime ?? line.timestamp + 3};
    });

  const chunks: LyricsChunk[] = [];
  let i = 0;
  while (i < wrapped.length) {
    const start = wrapped[i];
    const startTime = start.lrc.timestamp;
    let lines = [...start.lines];
    let endTime = start.endTime;
    let combinedLrcCount = 1;
    let j = i + 1;

    // Greedily absorb the next LRC line if it still satisfies every rule.
    while (j < wrapped.length) {
      const next = wrapped[j];
      const gap = next.lrc.timestamp - endTime;
      const combinedDuration = (next.endTime - startTime);
      const combinedLineCount = lines.length + next.lines.length;

      if (gap > maxGap) break;
      if (combinedLineCount > maxLines) break;
      if (combinedLrcCount + 1 > maxLrcLines) break;
      if (combinedDuration > maxChunkDuration) break;

      lines.push(...next.lines);
      endTime = next.endTime;
      combinedLrcCount++;
      j++;
    }

    chunks.push({
      lines,
      startTime,
      endTime,
      wordsPerLine: lines.map((l) => l.split(/\s+/).filter(Boolean).length),
    });
    i = j;
  }

  return chunks;
}
