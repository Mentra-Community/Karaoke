# Confidence-Based Recognition State Machine

## Overview
This document outlines an improved song recognition system that adapts confidence thresholds and verification strategies based on the current application state.

## Key Constants (Tunable)

```typescript
// Confidence Thresholds
const CONFIDENCE_THRESHOLD_NO_SONG = 0.6;      // When no song is playing
const CONFIDENCE_THRESHOLD_SWITCH = 0.75;       // When switching from current song
const CONFIDENCE_THRESHOLD_VERIFY = 0.7;        // For verification pass
const CONFIDENCE_THRESHOLD_INSTANT = 0.85;      // Instant acceptance (no verification)

// Recognition Intervals (ms)
const RECOGNITION_INTERVAL_LISTENING = 15000;   // No song playing (15s)
const RECOGNITION_INTERVAL_PLAYING = 12000;     // Song playing (12s)
const RECOGNITION_INTERVAL_VERIFY = 5000;       // Quick verify (5s)
const RECOGNITION_INTERVAL_UNCERTAIN = 8000;    // When uncertain (8s)

// Audio Buffer Durations (ms)
const AUDIO_BUFFER_DURATION_NORMAL = 8000;      // Standard 8s buffer
const AUDIO_BUFFER_DURATION_VERIFY = 5000;      // Quick 5s for verification

// Timeouts
const SONG_END_GRACE_PERIOD = 5000;             // 5s after song ends
const VERIFICATION_TIMEOUT = 10000;              // 10s to verify pending detection
const CONFIDENCE_DECAY_TIME = 30000;             // 30s before confidence drops
```

## States

### Primary States
1. **LISTENING** - No song detected, waiting for audio
2. **SONG_DETECTED_PENDING** - Low confidence detection, needs verification
3. **SONG_DETECTED_CONFIRMED** - High confidence or verified detection
4. **SONG_PLAYING** - Confirmed song with lyrics/position tracking
5. **SONG_SWITCH_PENDING** - Detected different song, needs verification
6. **SONG_ENDING** - Current song near end, ready for next

### Recognition Results
- **NO_MATCH** - No song detected
- **LOW_CONFIDENCE** - Below threshold for current state
- **PENDING_VERIFICATION** - Meets minimum but needs confirmation
- **HIGH_CONFIDENCE** - Above instant threshold
- **VERIFIED** - Confirmed through multiple detections

## State Transitions

### From LISTENING
```
LISTENING + detection(0.6-0.85) → SONG_DETECTED_PENDING
  - Store pending song info
  - Schedule quick re-check (5s)
  - Show song info with "Verifying..." indicator

LISTENING + detection(>0.85) → SONG_DETECTED_CONFIRMED
  - Instant acceptance
  - Start normal playback flow
```

### From SONG_DETECTED_PENDING
```
SONG_DETECTED_PENDING + same_song(>0.7) → SONG_DETECTED_CONFIRMED
  - Verification successful
  - Remove "Verifying..." indicator

SONG_DETECTED_PENDING + different_song → LISTENING
  - Verification failed
  - Clear pending song

SONG_DETECTED_PENDING + timeout(10s) → LISTENING
  - Verification timeout
  - Clear pending song
```

### From SONG_PLAYING
```
SONG_PLAYING + same_song → SONG_PLAYING
  - Update position
  - Reset confidence decay timer

SONG_PLAYING + different_song(<0.75) → SONG_PLAYING
  - Ignore (too low confidence)
  - Log as potential interference

SONG_PLAYING + different_song(0.75-0.85) → SONG_SWITCH_PENDING
  - Store pending new song
  - Keep playing current
  - Schedule quick verify (5s)

SONG_PLAYING + different_song(>0.85) → SONG_SWITCH_PENDING
  - High confidence but still verify
  - Prevents jarring switches

SONG_PLAYING + position > duration → SONG_ENDING
  - Natural song end
  - Lower thresholds for next song
```

### From SONG_SWITCH_PENDING
```
SONG_SWITCH_PENDING + new_song_confirmed → SONG_DETECTED_CONFIRMED
  - Switch to new song
  - Reset position tracking

SONG_SWITCH_PENDING + original_song → SONG_PLAYING
  - False alarm, stay with current
  - Clear pending switch

SONG_SWITCH_PENDING + third_song → SONG_PLAYING
  - Too unstable, stay with current
  - Wait for clearer signal
```

## Recognition Logic

### When to Check
```typescript
getRecognitionInterval(): number {
  switch (state) {
    case LISTENING:
      return RECOGNITION_INTERVAL_LISTENING;
    
    case SONG_DETECTED_PENDING:
    case SONG_SWITCH_PENDING:
      return RECOGNITION_INTERVAL_VERIFY;
    
    case SONG_PLAYING:
      if (timeSinceLastRecognition > CONFIDENCE_DECAY_TIME) {
        return RECOGNITION_INTERVAL_UNCERTAIN;
      }
      return RECOGNITION_INTERVAL_PLAYING;
    
    case SONG_ENDING:
      return RECOGNITION_INTERVAL_VERIFY;
  }
}
```

### Confidence Requirements
```typescript
getConfidenceThreshold(currentState, detectedSong): number {
  // Instant acceptance threshold
  if (!currentSong) {
    return CONFIDENCE_THRESHOLD_NO_SONG;
  }
  
  // Same song - just position update
  if (isSameSong(currentSong, detectedSong)) {
    return 0.5; // Very low threshold for position updates
  }
  
  // Different song - switching threshold
  if (currentState === SONG_ENDING) {
    return CONFIDENCE_THRESHOLD_NO_SONG; // Easier to switch after song ends
  }
  
  return CONFIDENCE_THRESHOLD_SWITCH;
}
```

## Implementation Benefits

1. **Reduces False Switches**: Verification prevents jarring song changes
2. **Faster Detection When Idle**: Can accept lower confidence when no disruption
3. **Adaptive Intervals**: Checks more frequently when uncertain
4. **Natural Transitions**: Handles song endings gracefully
5. **User Feedback**: Shows "Verifying..." for transparency

## Display Integration

During pending states, show subtle indicators:
- `♪ Song Title (Verifying...)` - During SONG_DETECTED_PENDING
- Keep current display stable during SONG_SWITCH_PENDING
- Add small confidence indicator: `●●●○○` (3/5 confidence)

## History Tracking

Track recognition patterns:
```typescript
interface RecognitionHistory {
  timestamp: number;
  song: string;
  confidence: number;
  accepted: boolean;
  reason: 'instant' | 'verified' | 'rejected' | 'timeout';
}
```

Use history to detect:
- Frequently alternating songs (environment too noisy)
- Consistent low confidence (need to adjust thresholds)
- Verification success rate