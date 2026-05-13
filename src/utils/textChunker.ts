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
   * Cap on chunk's VOCAL time-span (first LRC timestamp → last LRC
   * timestamp). Measures how long the chunk is actually being sung,
   * not how long it sits on the HUD. A chunk whose last word is at
   * 1:41 followed by a 6 s instrumental until the next phrase has a
   * vocal span of 0 s past whatever combined lines preceded it —
   * the trailing silence is the chunk lingering on screen, not the
   * user being asked to read too much at once.
   */
  maxChunkDurationSeconds?: number;
  /** 'word' (default) | 'character' | 'strict-word'. */
  breakMode?: "character" | "word" | "strict-word";
}

interface WrappedItem {
  lrc: LRCLine;
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

  /**
   * Join a list of LRC text snippets with single spaces, then wrap the
   * combined string into HUD-fitting lines. Re-wrapping the joined
   * text (vs concatenating individually-wrapped pieces) is the key:
   * "Now it's time to leave the capsule" + "if you dare" wraps to
   * ONE 47-char line, not two short lines. The user gets a single
   * coherent phrase as one chunk.
   */
  const wrapJoined = (texts: string[]): string[] => {
    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    if (!joined) return [];
    const result = wrapper.wrap(joined, {
      maxWidthPx,
      maxLines: Infinity,
      maxBytes: Infinity,
    });
    return result.lines.length > 0 ? result.lines : [joined];
  };

  const items: WrappedItem[] = lrcData
    .filter((line) => !!line.text)
    .map((line) => ({
      lrc: line,
      endTime: line.endTime ?? line.timestamp + 3,
    }));

  const chunks: LyricsChunk[] = [];
  let i = 0;
  while (i < items.length) {
    const start = items[i];
    const startTime = start.lrc.timestamp;
    let texts = [start.lrc.text];
    let lines = wrapJoined(texts);
    let endTime = start.endTime;
    let combinedLrcCount = 1;
    let j = i + 1;

    // Greedy absorption: at each step compute what the chunk WOULD
    // look like if we added the next LRC line. If the resulting
    // wrapped block still fits and stays coherent, keep it.
    while (j < items.length) {
      const next = items[j];
      const gap = next.lrc.timestamp - endTime;
      if (gap > maxGap) break;
      if (combinedLrcCount + 1 > maxLrcLines) break;

      const candidateTexts = [...texts, next.lrc.text];
      const candidateLines = wrapJoined(candidateTexts);
      if (candidateLines.length > maxLines) break;

      // Measure VOCAL time-span: first LRC timestamp → next LRC line's
      // timestamp (i.e. when the last word of the prospective chunk
      // starts being sung). Excludes any trailing instrumental gap
      // before the next phrase — that silence is just the chunk
      // lingering on screen, not active vocals.
      const candidateVocalSpan = next.lrc.timestamp - startTime;
      if (candidateVocalSpan > maxChunkDuration) break;

      texts = candidateTexts;
      lines = candidateLines;
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
