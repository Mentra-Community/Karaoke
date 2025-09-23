import { LRCLine, LyricsChunk } from '../types';

export function chunkLyrics(
  lrcData: LRCLine[], 
  maxWordsPerLine: number = 8, 
  maxCharsPerLine: number = 60,
  linesPerChunk: number = 2
): LyricsChunk[] {
  const chunks: LyricsChunk[] = [];
  
  for (let i = 0; i < lrcData.length; i++) {
    const currentLine = lrcData[i];
    const lines = splitLineIntoChunks(currentLine.text, maxWordsPerLine, maxCharsPerLine);
    
    for (let j = 0; j < lines.length; j += linesPerChunk) {
      const chunkLines = lines.slice(j, j + linesPerChunk);
      const wordsPerLine = chunkLines.map(line => line.split(' ').filter(w => w).length);
      
      const startTime = currentLine.timestamp;
      let endTime = currentLine.endTime || currentLine.timestamp + 3;
      
      if (lines.length > linesPerChunk) {
        const progress = (j + chunkLines.length) / lines.length;
        endTime = startTime + (endTime - startTime) * progress;
      }
      
      chunks.push({
        lines: chunkLines,
        startTime,
        endTime,
        wordsPerLine
      });
    }
  }
  
  return chunks;
}

function splitLineIntoChunks(text: string, maxWords: number, maxChars: number): string[] {
  const words = text.split(' ').filter(w => w);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;
  
  for (const word of words) {
    if (word.length > maxChars) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }
      chunks.push(word);
      continue;
    }
    
    const wordLength = word.length + (currentChunk.length > 0 ? 1 : 0);
    
    if (currentChunk.length >= maxWords || currentLength + wordLength > maxChars) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
        currentLength = 0;
      }
    }
    
    currentChunk.push(word);
    currentLength += wordLength;
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks.length > 0 ? chunks : [''];
}