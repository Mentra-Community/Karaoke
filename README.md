# Real-time Karaoke System for Smart Glasses

## Overview

This system provides real-time song recognition and synchronized lyric display for smart glasses using MentraOS. Users wearing smart glasses can see song information and synchronized lyrics for any music playing around them, creating an immersive karaoke experience.

## Core Features

1. **Real-time Audio Recognition** - Continuously identify songs from ambient audio
2. **Synchronized Lyrics Display** - Show timed lyrics chunked for smart glasses
3. **Position Tracking** - Track current position in detected songs with error correction
4. **Song History** - Maintain log of all identified songs
5. **Fallback Display** - Show song info + timestamp when lyrics unavailable

## Architecture

### Main Application Class
```typescript
class KaraokeApp extends AppServer {
  private userSessions = new Map<string, UserSession>();
  
  // Handles new user connections, creates UserSession instances
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void>
  
  // Cleanup when users disconnect
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void>
}
```

### UserSession Class
Each connected user gets an isolated UserSession containing all managers:

```typescript
class UserSession {
  // Core identification
  userId: string;
  sessionId: string;
  session: AppSession;  // MentraOS session for audio/display
  
  // State management
  currentSong?: CurrentSong;
  appState: AppState;
  
  // Managers (each handles specific functionality)
  recognitionManager: RecognitionManager;
  lyricsManager: LyricsManager;
  positionTracker: PositionTracker;
  displayManager: DisplayManager;
  historyManager: HistoryManager;
  
  constructor(userId: string, sessionId: string, session: AppSession)
  startListening(): void
  cleanup(): void
}
```

## Core Types and Interfaces

```typescript
enum AppState {
  LISTENING,                    // Waiting for song detection
  SONG_DETECTED_NO_LYRICS,     // Song found but no LRC available
  SONG_DETECTED_WITH_LYRICS,   // Song found with synchronized lyrics
  PROCESSING                   // Fetching lyrics/processing
}

interface CurrentSong {
  title: string;
  artist: string;
  album?: string;
  duration: number;           // Total song length in seconds
  detectedAt: number;         // Timestamp when first detected
  hasLyrics: boolean;
  lrcData?: LRCLine[];
  confidence: number;         // Recognition confidence (0-1)
}

interface LRCLine {
  timestamp: number;          // Time in seconds
  text: string;              // Lyric text
  endTime?: number;          // Optional end time for line
}

interface RecognitionResult {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  offsetSeconds?: number;     // Where in song detection occurred
  confidence: number;
  error?: string;
}

interface LyricsChunk {
  lines: string[];           // Max 2 lines
  startTime: number;         // When chunk should start displaying
  endTime: number;           // When chunk should end
  wordsPerLine: number[];    // Words count per line for validation
}

interface RecognitionPoint {
  timestamp: number;         // When recognition occurred
  detectedOffset: number;    // Where in song we detected
  confidence: number;
  apiLatency: number;        // How long API call took
}

interface SongHistoryEntry {
  title: string;
  artist: string;
  album?: string;
  identifiedAt: number;      // Timestamp
  duration?: number;
  confidence: number;
}
```

## Manager Responsibilities

### RecognitionManager
Handles continuous audio processing and ACRCloud integration:

```typescript
class RecognitionManager {
  private audioBuffer: Buffer[];
  private isRecording: boolean;
  private lastRecognitionTime: number;
  private readonly RECOGNITION_INTERVAL = 12000; // 12 seconds between checks
  private readonly AUDIO_BUFFER_DURATION = 8000; // 8 seconds of audio
  
  startListening(): void                          // Begin audio capture
  processAudioChunk(audioData: Buffer): void      // Handle incoming audio
  performRecognition(): Promise<RecognitionResult | null>  // Call ACRCloud
  shouldRecognize(): boolean                      // Check if time for next recognition
  reset(): void                                   // Clear buffers and state
}
```

### LyricsManager
Fetches and processes LRC files, chunks lyrics for display:

```typescript
class LyricsManager {
  private cachedLRC = new Map<string, LRCLine[]>();
  
  fetchLyrics(song: CurrentSong): Promise<LRCLine[] | null>    // Get LRC from sources
  chunkLyrics(lrcData: LRCLine[]): LyricsChunk[]              // Split into display chunks
  getCurrentChunk(position: number): LyricsChunk | null        // Get chunk for current time
  private parseLRC(lrcContent: string): LRCLine[]             // Parse LRC format
  private smartChunk(lines: LRCLine[]): LyricsChunk[]         // Apply 8-word/60-char limits
}
```

**Chunking Rules:**
- Max 8 words per line
- Max 60 characters per line  
- Max 2 lines per chunk
- Never break words in middle
- If single word exceeds 60 chars, show on its own line

### PositionTracker
Tracks song position with continuous calibration:

```typescript
class PositionTracker {
  private songStartTime?: number;
  private detectedOffset?: number;
  private recognitionHistory: RecognitionPoint[];
  private estimatedDrift: number;
  
  startSong(detectedAt: number, songOffset: number, apiLatency: number): void
  getCurrentPosition(): number                    // Current seconds into song
  validatePosition(newOffset: number, detectionTime: number): boolean
  recalibrate(newOffset: number, detectionTime: number): void
  getConfidence(): number                         // How confident we are in timing
  reset(): void
}
```

**Position Calculation:**
```
current_position = (now - song_start_time) + detected_offset - estimated_drift
```

### DisplayManager
Manages what appears on smart glasses:

```typescript
class DisplayManager {
  private currentDisplay: string;
  private lastUpdateTime: number;
  
  showListening(): void                           // "♪ Listening..." state
  showSongInfo(song: CurrentSong, position: number): void  // Song title/artist + timestamp
  showLyrics(chunk: LyricsChunk): void           // Chunked lyrics display
  showProcessing(): void                          // "Processing..." state
  private formatSongInfo(song: CurrentSong, position: number): string
  private formatLyrics(chunk: LyricsChunk): string
}
```

**Display Formats:**
- **Listening**: `♪ Listening...`
- **Song Info**: `♪ Bohemian Rhapsody\n  Queen\n  2:34 / 5:55`
- **Lyrics**: `Is this the real life?\nIs this just fantasy?`

### HistoryManager
Tracks identified songs over time:

```typescript
class HistoryManager {
  private history: SongHistoryEntry[];
  private readonly MAX_HISTORY_SIZE = 100;
  
  addSong(song: CurrentSong): void               // Add to history
  getRecentSongs(limit?: number): SongHistoryEntry[]  // Get recent entries
  isDuplicate(song: CurrentSong): boolean        // Check if song recently added
  clearHistory(): void                           // Reset history
  exportHistory(): string                        // JSON export of history
}
```

## External Services

### ACRCloudService
Wrapper for ACRCloud API calls:

```typescript
class ACRCloudService {
  private host: string;
  private accessKey: string;
  private secretKey: string;
  
  recognize(audioBuffer: Buffer): Promise<RecognitionResult>
  private buildSignature(timestamp: number): string
  private createFormData(audioBuffer: Buffer, signature: string, timestamp: number): FormData
}
```

### LRCService
Fetches LRC files from multiple sources:

```typescript
class LRCService {
  private sources: LRCSource[];
  
  fetchLRC(title: string, artist: string): Promise<string | null>
  private trySource(source: LRCSource, title: string, artist: string): Promise<string | null>
}

interface LRCSource {
  name: string;
  url: string;
  searchEndpoint: string;
  downloadEndpoint: string;
}
```

## Audio Processing Flow

1. **Audio Capture**: MentraOS streams audio chunks to RecognitionManager
2. **Buffer Management**: Maintain 8-second rolling buffer of audio
3. **Recognition Timing**: Perform recognition every 12 seconds
4. **Result Processing**: Parse ACRCloud response, extract song metadata
5. **State Update**: Update UserSession state, trigger appropriate actions

## Lyrics Processing Flow

1. **LRC Fetching**: Try multiple sources to find synchronized lyrics
2. **Parsing**: Convert LRC format to internal LRCLine objects
3. **Chunking**: Split lyrics into smart glasses friendly chunks
4. **Synchronization**: Match chunks to current song position
5. **Display**: Send formatted chunks to smart glasses

## Position Tracking Flow

1. **Initial Detection**: Record when song first detected + estimated offset
2. **Continuous Validation**: Re-recognize every 12 seconds
3. **Drift Calculation**: Compare predicted vs actual position
4. **Recalibration**: Adjust timing if drift exceeds threshold (±3 seconds)
5. **Confidence Scoring**: Weight recent recognitions more heavily

## Error Handling

### Recognition Errors
- **No match found**: Continue listening, show "♪ Listening..."
- **Low confidence**: Require multiple confirmations before state change
- **API failure**: Retry with exponential backoff

### Lyrics Errors
- **No LRC available**: Fall back to song info + timestamp display
- **Parse failure**: Log error, treat as no lyrics available
- **Chunk timing issues**: Skip problematic chunks, continue with valid ones

### Position Tracking Errors
- **Negative position**: Reset to 0, recalibrate on next recognition
- **Position beyond song**: Assume song ended, return to listening state
- **Large drift**: Force recalibration, log for debugging

## Performance Considerations

- **Caching**: Cache LRC files to avoid repeated API calls
- **Memory Management**: Limit audio buffer size, clear old data
- **Rate Limiting**: Respect ACRCloud API limits
- **Battery Optimization**: Efficient audio processing for mobile devices

## Configuration

```typescript
interface KaraokeConfig {
  recognition: {
    intervalMs: 12000;        // Time between recognitions
    bufferDurationMs: 8000;   // Audio buffer size
    confidenceThreshold: 0.7; // Minimum confidence for recognition
    maxDriftSeconds: 3;       // Max timing drift before recalibration
  };
  display: {
    maxWordsPerLine: 8;
    maxCharsPerLine: 60;
    linesPerChunk: 2;
    updateIntervalMs: 500;    // Display refresh rate
  };
  history: {
    maxEntries: 100;
    duplicateWindowMs: 30000; // Don't add same song within 30 seconds
  };
}
```

## Implementation Priority

1. **Phase 1**: Basic recognition + song info display
2. **Phase 2**: LRC fetching + basic lyrics display  
3. **Phase 3**: Smart chunking + position tracking
4. **Phase 4**: History management + error handling
5. **Phase 5**: Performance optimization + caching

This system creates a seamless real-time karaoke experience where users can see synchronized lyrics for any song playing around them, with intelligent fallbacks and continuous accuracy improvements.