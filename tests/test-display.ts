#!/usr/bin/env bun

import { FiveLineDisplayFormatter } from '../src/UserSession/FiveLineDisplayFormatter';
import { AppState, CurrentSong, LyricsChunk, LRCLine } from '../src/types';
import { parseLRC } from '../src/utils/lrcParser';
import { chunkLyrics } from '../src/utils/textChunker';
import { preprocessLRC, analyzeLRCPatterns } from '../src/utils/lrcPreprocessor';
import fs from 'fs';
import path from 'path';

const formatter = new FiveLineDisplayFormatter();

function testSong(lrcPath: string, songInfo: CurrentSong) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${songInfo.title} - ${songInfo.artist}`);
  console.log('='.repeat(50));
  
  const content = fs.readFileSync(lrcPath, 'utf8');
  const rawLrcLines = parseLRC(content);
  
  // Analyze and potentially preprocess
  const analysis = analyzeLRCPatterns(rawLrcLines);
  let lrcLines = rawLrcLines;
  
  if (analysis.recommendPreprocessing) {
    const preprocessed = preprocessLRC(rawLrcLines);
    lrcLines = preprocessed.lines;
    console.log(`\nPreprocessed: ${rawLrcLines.length} lines → ${lrcLines.length} lines`);
    console.log(`Average line length: ${preprocessed.metadata.averageLineLength.toFixed(1)} chars`);
    console.log(`Short lines: ${preprocessed.metadata.shortLinesCount}, Long lines: ${preprocessed.metadata.longLinesCount}`);
  }
  
  const chunks = chunkLyrics(lrcLines, 8, 60, 2);
  console.log(`\nChunked into ${chunks.length} display chunks`);
  
  // Test different positions
  const testPositions = [0, 30, 60, 90, 120, 150];
  
  for (const position of testPositions) {
    if (position > songInfo.duration) continue;
    
    const currentChunk = chunks.find(c => position >= c.startTime && position < c.endTime);
    const currentIndex = currentChunk ? chunks.indexOf(currentChunk) : -1;
    const nextChunk = currentIndex >= 0 && currentIndex < chunks.length - 1 
      ? chunks[currentIndex + 1] 
      : null;
    
    console.log(`\n📍 At ${Math.floor(position / 60)}:${(position % 60).toString().padStart(2, '0')}:`);
    console.log('-'.repeat(45));
    
    const lines = formatter.formatDisplay(
      AppState.SONG_DETECTED_WITH_LYRICS,
      songInfo,
      currentChunk,
      nextChunk,
      position
    );
    
    lines.forEach((line, i) => {
      const charCount = line.length;
      const marker = charCount > 45 ? ' ⚠️ OVERFLOW' : '';
      console.log(`${i + 1}: ${line}${marker}`);
    });
    
    if (currentChunk) {
      console.log(`\n   Current chunk: "${currentChunk.lines.join(' / ')}"`);
    }
  }
}

// Test with sample files
const samplesDir = path.join(__dirname, 'visualizer/samples');
const samples = [
  { 
    file: 'clint_eastwood.lrc', 
    song: {
      title: 'Clint Eastwood', 
      artist: 'Gorillaz', 
      album: 'Gorillaz',
      duration: 340,
      detectedAt: Date.now(),
      hasLyrics: true,
      confidence: 0.9
    }
  },
  { 
    file: 'imagine.lrc', 
    song: {
      title: 'Imagine', 
      artist: 'John Lennon',
      album: 'Imagine', 
      duration: 183,
      detectedAt: Date.now(),
      hasLyrics: true,
      confidence: 0.9
    }
  },
  { 
    file: 'bohemian_rhapsody.lrc', 
    song: {
      title: 'Bohemian Rhapsody', 
      artist: 'Queen',
      album: 'A Night at the Opera',
      duration: 354,
      detectedAt: Date.now(),
      hasLyrics: true,
      confidence: 0.9
    }
  }
];

// Character limit test
console.log(`\n${'='.repeat(50)}`);
console.log('CHARACTER LIMIT TEST:');
console.log('='.repeat(50));
console.log('45 chars: |' + '='.repeat(45) + '|');
console.log('Test line: |this is a test of how many characters can be|');
console.log(`           |${' '.repeat(45)}|`);

// Test each song
samples.forEach(sample => {
  const lrcPath = path.join(samplesDir, sample.file);
  if (fs.existsSync(lrcPath)) {
    testSong(lrcPath, sample.song);
  } else {
    console.log(`\n⚠️  Skipping ${sample.file} - file not found`);
  }
});

// Test different app states
console.log(`\n${'='.repeat(50)}`);
console.log('APP STATE TESTS:');
console.log('='.repeat(50));

console.log('\n📱 LISTENING state:');
console.log('-'.repeat(45));
formatter.formatDisplay(AppState.LISTENING).forEach((line, i) => {
  console.log(`${i + 1}: ${line}`);
});

console.log('\n📱 PROCESSING state:');
console.log('-'.repeat(45));
formatter.formatDisplay(AppState.PROCESSING).forEach((line, i) => {
  console.log(`${i + 1}: ${line}`);
});

console.log('\n📱 SONG_DETECTED_NO_LYRICS state:');
console.log('-'.repeat(45));
const noLyricsSong: CurrentSong = {
  title: 'Have Mercy',
  artist: 'YBN Cordae',
  album: 'The Lost Boy',
  duration: 240,
  detectedAt: Date.now(),
  hasLyrics: false,
  confidence: 0.67
};
formatter.formatDisplay(AppState.SONG_DETECTED_NO_LYRICS, noLyricsSong, null, null, 153.94).forEach((line, i) => {
  console.log(`${i + 1}: ${line}`);
});

console.log('\n✅ Test complete!');