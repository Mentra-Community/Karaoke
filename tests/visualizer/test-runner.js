#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple formatter for testing without TypeScript
class FiveLineDisplayFormatter {
  constructor() {
    this.MAX_LINES = 5;
    this.MAX_CHARS = 45;
  }

  formatDisplay(appState, currentSong, currentChunk, nextChunk, currentPosition) {
    switch (appState) {
      case 'LISTENING':
        return this.formatListening();
      case 'PROCESSING':
        return this.formatProcessing();
      case 'SONG_DETECTED_NO_LYRICS':
        return this.formatSongInfo(currentSong, currentPosition || 0);
      case 'SONG_DETECTED_WITH_LYRICS':
        return this.formatLyricsDisplay(currentSong, currentChunk, nextChunk, currentPosition || 0);
      default:
        return this.formatListening();
    }
  }

  formatListening() {
    return ['♪ Listening...', '', '', '', ''];
  }

  formatProcessing() {
    return ['Processing...', '', '', '', ''];
  }

  formatSongInfo(song, position) {
    const lines = [];
    lines.push(this.truncate(`♪ ${song.title}`));
    lines.push(this.truncate(`  ${song.artist}`));
    lines.push(song.album ? this.truncate(`  ${song.album}`) : '');
    lines.push('');
    lines.push(`  ${this.formatTimestamp(position)} / ${this.formatTimestamp(song.duration)}`);
    return lines;
  }

  formatLyricsDisplay(song, currentChunk, nextChunk, position) {
    const lines = [];
    
    if (!currentChunk) {
      return this.formatSongInfo(song, position);
    }
    
    if (currentChunk.lines.length > 1) {
      lines.push(this.truncate(currentChunk.lines[0]));
      lines.push(this.truncate(currentChunk.lines[1]));
      lines.push('-----');
      
      if (nextChunk && nextChunk.lines.length > 0) {
        const preview = this.truncate(nextChunk.lines[0]);
        lines.push(preview.length > 42 ? preview.substring(0, 39) + '...' : preview);
      } else {
        lines.push('');
      }
      
      lines.push(`${this.formatTimestamp(position)} / ${this.formatTimestamp(song.duration)}`);
    } else {
      lines.push(this.truncate(currentChunk.lines[0]));
      lines.push('');
      
      if (nextChunk) {
        lines.push('-----');
        const preview = this.truncate(nextChunk.lines[0]);
        lines.push(preview.length > 42 ? preview.substring(0, 39) + '...' : preview);
      } else {
        lines.push('');
        lines.push('');
      }
      
      lines.push(`${this.formatTimestamp(position)} / ${this.formatTimestamp(song.duration)}`);
    }
    
    return lines;
  }

  truncate(text) {
    if (text.length <= this.MAX_CHARS) {
      return text;
    }
    
    const truncated = text.substring(0, this.MAX_CHARS - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > this.MAX_CHARS - 10) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

// Parse LRC file
function parseLRC(content) {
  const lines = content.split('\n');
  const lrcLines = [];
  
  for (const line of lines) {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (match) {
      const mins = parseInt(match[1]);
      const secs = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const timestamp = mins * 60 + secs + ms / 1000;
      const text = match[4].trim();
      
      if (text) {
        lrcLines.push({
          timestamp,
          text,
          endTime: timestamp + 2
        });
      }
    }
  }
  
  // Update end times
  for (let i = 0; i < lrcLines.length - 1; i++) {
    lrcLines[i].endTime = lrcLines[i + 1].timestamp;
  }
  
  return lrcLines;
}

// Chunk lyrics
function chunkLyrics(lrcLines) {
  const chunks = [];
  let i = 0;
  
  while (i < lrcLines.length) {
    const chunk = {
      lines: [lrcLines[i].text],
      startTime: lrcLines[i].timestamp,
      endTime: lrcLines[i].endTime
    };
    
    // Check if we can add the next line
    if (i + 1 < lrcLines.length) {
      const combinedLength = chunk.lines[0].length + lrcLines[i + 1].text.length;
      const timeDiff = lrcLines[i + 1].timestamp - lrcLines[i].endTime;
      
      if (combinedLength < 80 && timeDiff < 1.5) {
        chunk.lines.push(lrcLines[i + 1].text);
        chunk.endTime = lrcLines[i + 1].endTime;
        i++;
      }
    }
    
    chunks.push(chunk);
    i++;
  }
  
  return chunks;
}

// Test with sample files
function testSong(lrcPath, songInfo) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${songInfo.title} - ${songInfo.artist}`);
  console.log('='.repeat(50));
  
  const content = fs.readFileSync(lrcPath, 'utf8');
  const lrcLines = parseLRC(content);
  const chunks = chunkLyrics(lrcLines);
  
  console.log(`Parsed ${lrcLines.length} lines into ${chunks.length} chunks\n`);
  
  const formatter = new FiveLineDisplayFormatter();
  
  // Test different positions
  const testPositions = [0, 30, 60, 90, 120];
  
  for (const position of testPositions) {
    if (position > songInfo.duration) continue;
    
    const currentChunk = chunks.find(c => position >= c.startTime && position < c.endTime);
    const currentIndex = currentChunk ? chunks.indexOf(currentChunk) : -1;
    const nextChunk = currentIndex >= 0 && currentIndex < chunks.length - 1 
      ? chunks[currentIndex + 1] 
      : null;
    
    console.log(`\nAt ${formatter.formatTimestamp(position)}:`);
    console.log('-'.repeat(45));
    
    const lines = formatter.formatDisplay(
      'SONG_DETECTED_WITH_LYRICS',
      songInfo,
      currentChunk,
      nextChunk,
      position
    );
    
    lines.forEach((line, i) => {
      const charCount = line.length;
      const marker = charCount > 45 ? ' ⚠️' : '';
      console.log(`${i + 1}: ${line}${marker}`);
    });
  }
}

// Test all sample songs
const samplesDir = path.join(__dirname, 'samples');
const samples = [
  { file: 'clint_eastwood.lrc', title: 'Clint Eastwood', artist: 'Gorillaz', duration: 340 },
  { file: 'imagine.lrc', title: 'Imagine', artist: 'John Lennon', duration: 183 },
  { file: 'bohemian_rhapsody.lrc', title: 'Bohemian Rhapsody', artist: 'Queen', duration: 354 }
];

samples.forEach(sample => {
  const lrcPath = path.join(samplesDir, sample.file);
  if (fs.existsSync(lrcPath)) {
    testSong(lrcPath, sample);
  } else {
    console.log(`\nSkipping ${sample.file} - file not found`);
  }
});

console.log(`\n${'='.repeat(50)}`);
console.log('Character limit test:');
console.log('='.repeat(50));
console.log('45 chars: |' + 'x'.repeat(45) + '|');
console.log('Test line: |this is a test of how many characters can be|');