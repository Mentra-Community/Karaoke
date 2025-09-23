# Karaoke App - Project Status

## Current State (as of 2024-01-03)

### ✅ Working Features

1. **Audio Recognition**
   - Successfully recognizing songs via ACRCloud API
   - Fixed "Can't generate fingerprint" error by adding WAV headers
   - Recognition happens every 12 seconds (no more API spam)
   - Confidence scores working (67-100% typical)

2. **Basic Display**
   - Song info showing on smart glasses
   - Position tracking working (counts up in real-time)
   - Display updates every 500ms

3. **Lyrics System**
   - LRC fetching from LRCLib implemented
   - Basic lyrics chunking working
   - Lyrics display on glasses functional

### 🐛 Known Issues

1. **Song Switching**
   - When a new song is detected, display doesn't always update
   - Example: Detected "Another One Bites The Dust" but kept showing "O Koronoios"
   - Position tracking continues from previous song instead of resetting

2. **Timing Accuracy**
   - Position might be off by a few seconds (ahead or behind)
   - No recalibration happening on subsequent recognitions

3. **Display Issues**
   - "Processing..." sometimes shows even when lyrics are already displayed
   - Mostly showing 1 line at a time instead of 2
   - Character limit discoveries: ~45 chars per line on smart glasses

### 📱 Smart Glasses Constraints

- **Max 5 lines** of text can be displayed
- **~45 characters** per line (tested with: "this is a test of how many characters can be")
- No dimming/highlighting capabilities
- Underlines use a full row (wasteful)
- Non-uniform font makes exact character counting difficult

### 🧪 Test Results

From logs we can see:
- Audio chunks arriving properly (4096 bytes each)
- Sample rate not being detected from chunks (using default 16000)
- ACRCloud working with WAV format
- LRC files being fetched and parsed

### 💡 Proposed Improvements

#### 1. Enhanced Logging
- Log state transitions (LISTENING → PROCESSING → WITH_LYRICS)
- Clear song change detection logs
- Lyrics flow logging (fetch, chunk, display)
- Position recalibration events

#### 2. Smart Lyrics Display
Given 5-line constraint, proposed layouts:

**During Lyrics:**
```
I ain't happy, I'm feeling glad
I got sunshine in a bag
-----
The future is coming on...
2:45 / 4:32
```

**Song Start/No Lyrics:**
```
♪ Clint Eastwood
  Gorillaz
  Produced by Dan the Automator
  
  2:45 / 4:32
```

#### 3. Intelligent LRC Preprocessing
- Merge short adjacent lines based on:
  - Timing gaps (< 2 seconds = probably same phrase)
  - Sentence boundaries
  - Natural phrase breaks
- Balance line lengths for better display
- Handle repeated sections intelligently

#### 4. Test Suite & Visualizer
Create a test environment to:
- Visualize how lyrics look on 5-line display
- Test different chunking algorithms
- Validate character limits
- Preview timing with simulated drift

### 📊 Metrics from Current Run

- Recognition interval: 12 seconds ✓
- API latency: 180-385ms
- Display update rate: 500ms
- Typical confidence: 67-100%
- Audio buffer: 8 seconds / 256KB

### 🚀 Next Steps

1. **Fix song switching bug** - Ensure display updates when new song detected
2. **Implement smart chunking** - Preprocess LRC for better 2-line display
3. **Add position recalibration** - Use subsequent recognitions to fix drift
4. **Build test suite** - Visualize display output before deploying
5. **Optimize for 5-line display** - New layouts that maximize lyrics visibility

### 🔧 Technical Decisions

- Using WAV format for ACRCloud (PCM16, mono)
- 8-second audio buffer seems optimal
- 12-second recognition interval balances accuracy vs API usage
- 500ms display updates smooth enough without overwhelming

### 📝 Configuration

Current settings that work well:
```typescript
{
  recognition: {
    intervalMs: 12000,
    bufferDurationMs: 8000,
    confidenceThreshold: 0.7,
    maxDriftSeconds: 3
  },
  display: {
    maxWordsPerLine: 8,      // May need adjustment
    maxCharsPerLine: 45,     // Updated from testing
    linesPerChunk: 2,
    updateIntervalMs: 500
  }
}
```