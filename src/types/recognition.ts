// Recognition state machine types
export enum RecognitionState {
  LISTENING = 'LISTENING',
  SONG_DETECTED_PENDING = 'SONG_DETECTED_PENDING',
  SONG_DETECTED_CONFIRMED = 'SONG_DETECTED_CONFIRMED',
  SONG_PLAYING = 'SONG_PLAYING',
  SONG_SWITCH_PENDING = 'SONG_SWITCH_PENDING',
  SONG_ENDING = 'SONG_ENDING'
}

export interface RecognitionConfig {
  // Confidence Thresholds
  CONFIDENCE_THRESHOLD_NO_SONG: number;
  CONFIDENCE_THRESHOLD_SWITCH: number;
  CONFIDENCE_THRESHOLD_VERIFY: number;
  CONFIDENCE_THRESHOLD_INSTANT: number;

  // Recognition Intervals (ms)
  RECOGNITION_INTERVAL_LISTENING: number;
  RECOGNITION_INTERVAL_PLAYING: number;
  RECOGNITION_INTERVAL_VERIFY: number;
  RECOGNITION_INTERVAL_UNCERTAIN: number;

  // Fast-detect mode: when we just started listening (or just woke
  // from silence backoff), fire a flurry of short-interval ACR calls
  // so a freshly-started song gets caught quickly.
  RECOGNITION_INITIAL_INTERVAL: number;    // ms between the first few probes
  RECOGNITION_INITIAL_PROBE_COUNT: number; // how many fast probes before settling into LISTENING cadence
  RECOGNITION_INITIAL_MIN_AUDIO: number;   // min ms of audio needed before firing the very first probe

  // Silence-backoff mode: after this many consecutive ACR misses,
  // exponentially extend the gap between attempts. Resets the moment
  // a song is detected (or audio passes the RMS gate again).
  SILENT_BACKOFF_AFTER_MISSES: number;
  SILENT_BACKOFF_FACTOR: number;           // each successive miss multiplies the wait
  SILENT_BACKOFF_MAX_INTERVAL: number;     // cap so we still wake up to check periodically

  // Audio energy gate. RMS amplitude (16-bit PCM, 0..32768).
  // Buffers under this are considered silence and skip the API call.
  SILENCE_RMS_THRESHOLD: number;

  // Audio Buffer Durations (ms)
  AUDIO_BUFFER_DURATION_NORMAL: number;
  AUDIO_BUFFER_DURATION_VERIFY: number;

  // Timeouts
  SONG_END_GRACE_PERIOD: number;
  VERIFICATION_TIMEOUT: number;
  CONFIDENCE_DECAY_TIME: number;
}

export const DEFAULT_RECOGNITION_CONFIG: RecognitionConfig = {
  // Confidence Thresholds
  CONFIDENCE_THRESHOLD_NO_SONG: 0.3,      // Much lower - trust ACRCloud when nothing playing
  CONFIDENCE_THRESHOLD_SWITCH: 0.75,
  CONFIDENCE_THRESHOLD_VERIFY: 0.5,       // Lower verify threshold too
  CONFIDENCE_THRESHOLD_INSTANT: 0.85,

  // Recognition Intervals (ms)
  RECOGNITION_INTERVAL_LISTENING: 15000,
  RECOGNITION_INTERVAL_PLAYING: 12000,
  RECOGNITION_INTERVAL_VERIFY: 5000,
  RECOGNITION_INTERVAL_UNCERTAIN: 8000,

  // Fast-detect mode tuning. 3 probes at 5s = first-detect floor of ~5s
  // (assuming the user starts a song at session start). After that we
  // fall back to the steady 15s cadence.
  RECOGNITION_INITIAL_INTERVAL: 5000,
  RECOGNITION_INITIAL_PROBE_COUNT: 3,
  RECOGNITION_INITIAL_MIN_AUDIO: 3000,

  // Silence-backoff: after 4 misses (4 × 15s = 60s of silence), start
  // doubling the wait. Cap at 2 minutes so we don't go fully asleep —
  // user can start a song and we'll catch it within 2 min worst case.
  SILENT_BACKOFF_AFTER_MISSES: 4,
  SILENT_BACKOFF_FACTOR: 2,
  SILENT_BACKOFF_MAX_INTERVAL: 120000,

  // Hand-tuned for 16kHz 16-bit input. Background room noise on the
  // G1 mic sits at 200–600 RMS; music ramps past 1500.
  SILENCE_RMS_THRESHOLD: 800,

  // Audio Buffer Durations (ms)
  AUDIO_BUFFER_DURATION_NORMAL: 8000,
  AUDIO_BUFFER_DURATION_VERIFY: 5000,

  // Timeouts
  SONG_END_GRACE_PERIOD: 5000,
  VERIFICATION_TIMEOUT: 10000,
  CONFIDENCE_DECAY_TIME: 30000
};

export interface PendingRecognition {
  song: {
    title: string;
    artist: string;
    album?: string;
    duration: number;
  };
  confidence: number;
  timestamp: number;
  offsetSeconds?: number;
}

export interface RecognitionHistoryEntry {
  timestamp: number;
  song: string;
  artist: string;
  confidence: number;
  accepted: boolean;
  reason: 'instant' | 'verified' | 'rejected' | 'timeout' | 'position_update';
  state: RecognitionState;
}