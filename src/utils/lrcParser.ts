import { LRCLine } from '../types';

/**
 * LRClib serves some entries with HTML-encoded characters
 * ("I know it&apos;s", "books&apos; written pages", "&amp;", "&quot;").
 * The browser renders them correctly in the webview because it does
 * HTML entity decoding automatically. The glasses HUD does not — it
 * just shows whatever raw bytes we hand to `session.layouts.showTextWall`,
 * so "I know it&apos;s" appears literally on screen.
 *
 * Decode the handful of entities lyrics actually use, plus numeric
 * decimal/hex escapes for safety. Anything else stays as-is.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // &amp; last so we don't double-decode things like "&amp;apos;"
    .replace(/&amp;/g, '&');
}

export function parseLRC(lrcContent: string): LRCLine[] {
  // Normalize Windows (CRLF) and old-Mac (CR) line endings to LF so
  // the line-by-line regex match doesn't silently drop every line
  // when LRClib serves a CRLF file (issue 007).
  const lines = lrcContent.replace(/\r\n?/g, '\n').split('\n');
  const lrcLines: LRCLine[] = [];

  // Some LRClib entries have multiple timestamps on one line:
  //   [00:42.52][01:04.10]Domo Arigato
  // Capture each leading [mm:ss.xx] tag and emit one entry per stamp.
  const timeRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    const stamps: number[] = [];
    let m = line.match(timeRegex);
    while (m) {
      const minutes = parseInt(m[1], 10);
      const seconds = parseInt(m[2], 10);
      const milliseconds = parseInt(m[3].padEnd(3, '0'), 10);
      stamps.push(minutes * 60 + seconds + milliseconds / 1000);
      line = line.slice(m[0].length);
      m = line.match(timeRegex);
    }

    if (stamps.length === 0) continue;

    const text = decodeHtmlEntities(line.trim());
    if (!text) continue;

    for (const timestamp of stamps) {
      lrcLines.push({ timestamp, text });
    }
  }
  
  lrcLines.sort((a, b) => a.timestamp - b.timestamp);
  
  for (let i = 0; i < lrcLines.length - 1; i++) {
    lrcLines[i].endTime = lrcLines[i + 1].timestamp;
  }
  
  if (lrcLines.length > 0) {
    const lastLine = lrcLines[lrcLines.length - 1];
    lastLine.endTime = lastLine.timestamp + 5;
  }
  
  return lrcLines;
}

export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}