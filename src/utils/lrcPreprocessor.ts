import { LRCLine } from '../types';

const MAX_CHARS_PER_LINE = 45;
const IDEAL_CHARS_PER_LINE = 35; // Leave some buffer

export interface PreprocessedLRC {
  lines: LRCLine[];
  metadata: {
    averageLineLength: number;
    shortLinesCount: number;
    longLinesCount: number;
    totalLines: number;
  };
}

export function preprocessLRC(lrcLines: LRCLine[]): PreprocessedLRC {
  const processedLines: LRCLine[] = [];
  let i = 0;
  
  const metadata = {
    averageLineLength: 0,
    shortLinesCount: 0,
    longLinesCount: 0,
    totalLines: lrcLines.length
  };
  
  // Calculate initial statistics
  const totalChars = lrcLines.reduce((sum, line) => sum + line.text.length, 0);
  metadata.averageLineLength = totalChars / lrcLines.length;
  metadata.shortLinesCount = lrcLines.filter(l => l.text.length < 15).length;
  metadata.longLinesCount = lrcLines.filter(l => l.text.length > MAX_CHARS_PER_LINE).length;
  
  while (i < lrcLines.length) {
    const currentLine = lrcLines[i];
    const nextLine = lrcLines[i + 1];
    const prevLine = i > 0 ? lrcLines[i - 1] : null;
    
    // Handle very long lines by splitting them
    if (currentLine.text.length > MAX_CHARS_PER_LINE) {
      const splitLines = splitLongLine(currentLine);
      processedLines.push(...splitLines);
      i++;
      continue;
    }
    
    // Check if we should merge with next line
    if (nextLine && shouldMergeLines(currentLine, nextLine, prevLine)) {
      const mergedLine = mergeTwoLines(currentLine, nextLine);
      
      // If merged line is still reasonable length, use it
      if (mergedLine.text.length <= MAX_CHARS_PER_LINE) {
        processedLines.push(mergedLine);
        i += 2;
        continue;
      }
    }
    
    // Keep line as is
    processedLines.push(currentLine);
    i++;
  }
  
  return {
    lines: processedLines,
    metadata
  };
}

function shouldMergeLines(
  current: LRCLine, 
  next: LRCLine, 
  prev: LRCLine | null
): boolean {
  // Don't merge if combined would be too long
  const combinedLength = current.text.length + next.text.length + 1; // +1 for space
  if (combinedLength > MAX_CHARS_PER_LINE) {
    return false;
  }
  
  // Both lines are very short (likely fragments)
  if (current.text.length < 15 && next.text.length < 15) {
    return true;
  }
  
  // Lines are close in time (likely same phrase)
  const timeDiff = next.timestamp - (current.endTime || current.timestamp);
  if (timeDiff < 1.0) { // Less than 1 second gap
    return true;
  }
  
  // Check for incomplete sentences
  const currentEnding = current.text.trim().slice(-1);
  const nextStartsLower = next.text.trim()[0] === next.text.trim()[0].toLowerCase();
  
  // Current line doesn't end with sentence terminator
  if (!['.', '!', '?'].includes(currentEnding)) {
    // Next line starts with lowercase (continuation)
    if (nextStartsLower && !['i', 'a'].includes(next.text.trim().split(' ')[0].toLowerCase())) {
      return true;
    }
    
    // Current line ends with comma or no punctuation
    if (currentEnding === ',' || /[a-zA-Z]$/.test(current.text.trim())) {
      return true;
    }
  }
  
  // Check for common patterns that should be merged
  const currentLower = current.text.toLowerCase().trim();
  const nextLower = next.text.toLowerCase().trim();
  
  // Question/answer pattern
  if (currentEnding === '?' && nextLower.length < 20) {
    return true;
  }
  
  // Common continuations
  const continuationWords = ['but', 'and', 'or', 'so', 'because', 'when', 'while', 'if'];
  const firstWordNext = nextLower.split(' ')[0];
  if (continuationWords.includes(firstWordNext)) {
    return true;
  }
  
  return false;
}

function mergeTwoLines(line1: LRCLine, line2: LRCLine): LRCLine {
  // Determine appropriate separator
  const line1Ending = line1.text.trim().slice(-1);
  let separator = ' ';
  
  if (line1Ending === ',') {
    separator = ' ';
  } else if (['.', '!', '?'].includes(line1Ending)) {
    separator = ' ';
  } else if (/[a-zA-Z]$/.test(line1.text.trim())) {
    // No punctuation, check if we need a comma
    const line2Start = line2.text.trim().split(' ')[0].toLowerCase();
    if (['but', 'and', 'or', 'so'].includes(line2Start)) {
      separator = ', ';
    }
  }
  
  return {
    timestamp: line1.timestamp,
    text: line1.text.trim() + separator + line2.text.trim(),
    endTime: line2.endTime || line2.timestamp + 2
  };
}

function splitLongLine(line: LRCLine): LRCLine[] {
  const words = line.text.trim().split(' ');
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const word of words) {
    const testChunk = currentChunk ? currentChunk + ' ' + word : word;
    
    if (testChunk.length <= IDEAL_CHARS_PER_LINE) {
      currentChunk = testChunk;
    } else {
      // Try to find a good break point
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = word;
      } else {
        // Single word is too long, add it anyway
        chunks.push(word);
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  // Create LRCLine objects for each chunk
  const duration = (line.endTime || line.timestamp + 2) - line.timestamp;
  const chunkDuration = duration / chunks.length;
  
  return chunks.map((chunk, index) => ({
    timestamp: line.timestamp + (chunkDuration * index),
    text: chunk,
    endTime: line.timestamp + (chunkDuration * (index + 1))
  }));
}

// Helper function to analyze line patterns
export function analyzeLRCPatterns(lines: LRCLine[]): {
  hasShortLines: boolean;
  hasLongLines: boolean;
  averageGap: number;
  recommendPreprocessing: boolean;
} {
  let totalGap = 0;
  let gapCount = 0;
  let shortLines = 0;
  let longLines = 0;
  
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i + 1].timestamp - (lines[i].endTime || lines[i].timestamp);
    totalGap += gap;
    gapCount++;
    
    if (lines[i].text.length < 15) shortLines++;
    if (lines[i].text.length > MAX_CHARS_PER_LINE) longLines++;
  }
  
  const averageGap = gapCount > 0 ? totalGap / gapCount : 0;
  const shortLineRatio = shortLines / lines.length;
  const hasShortLines = shortLineRatio > 0.3; // More than 30% short lines
  const hasLongLines = longLines > 0;
  
  return {
    hasShortLines,
    hasLongLines,
    averageGap,
    recommendPreprocessing: hasShortLines || hasLongLines || averageGap < 1.5
  };
}