import { RecognitionResult } from '../types';
import { ACRCloudService } from '../services/ACRCloudService';
import { combineAudioBuffers, trimAudioBuffer, audioRMS } from '../utils/audioUtils';
import { 
  RecognitionState, 
  RecognitionConfig, 
  DEFAULT_RECOGNITION_CONFIG,
  PendingRecognition,
  RecognitionHistoryEntry 
} from '../types/recognition';

export class RecognitionManager {
  private audioBuffer: Buffer[] = [];
  private isRecording: boolean = false;
  private lastRecognitionTime: number = 0;
  private acrService: ACRCloudService;
  private onRecognition: (result: RecognitionResult | null) => void;
  private logger: any;
  private sampleRate: number = 16000; // Default sample rate
  
  // State machine
  private state: RecognitionState = RecognitionState.LISTENING;
  private config: RecognitionConfig = DEFAULT_RECOGNITION_CONFIG;
  private pendingRecognition: PendingRecognition | null = null;
  private recognitionHistory: RecognitionHistoryEntry[] = [];
  private lastConfidentRecognition: number = 0;

  // Detection cadence tracking.
  //   probesSinceWake: incremented on every recognition attempt. While
  //     < INITIAL_PROBE_COUNT we use the fast initial interval. Reset
  //     when we drop back to LISTENING from a song.
  //   consecutiveMisses: counts ACR responses with no music. Drives
  //     the silence-backoff multiplier. Reset on any successful
  //     recognition OR when audio energy crosses back above the
  //     silence threshold.
  //   songConfirmedAt: epoch ms when the current song was confirmed.
  //     Used to identify the "fresh" window where ACR samples need to
  //     be tighter so we catch version mismatches early.
  private probesSinceWake: number = 0;
  private consecutiveMisses: number = 0;
  private songConfirmedAt: number = 0;
  /**
   * Epoch ms until which we stay in "alert mode" — right after a song
   * ends we expect another to start soon, so we probe more often
   * before letting the silence-backoff regime take over. 0 = no alert
   * window active.
   */
  private alertModeUntil: number = 0;

  constructor(
    acrService: ACRCloudService,
    onRecognition: (result: RecognitionResult | null) => void,
    parentLogger: any
  ) {
    this.acrService = acrService;
    this.onRecognition = onRecognition;
    this.logger = parentLogger.child({ service: 'RecognitionManager' });
  }

  startListening(): void {
    this.logger.info({}, 'Starting audio recording');
    this.isRecording = true;
    this.audioBuffer = [];
    this.lastRecognitionTime = 0;
    this.probesSinceWake = 0;
    this.consecutiveMisses = 0;
  }

  processAudioChunk(audioData: Buffer): void {
    if (!this.isRecording) {
      this.logger.debug({}, 'Ignoring audio chunk - not recording');
      return;
    }

    // Only log occasionally to reduce spam
    if (Math.random() < 0.01) {
      this.logger.debug({ 
        chunkSize: audioData.length,
        bufferCount: this.audioBuffer.length 
      }, 'Processing audio chunk (sample)');
    }

    this.audioBuffer.push(audioData);
    
    const combinedBuffer = combineAudioBuffers(this.audioBuffer);
    const bufferDuration = this.getAudioBufferDuration();
    const trimmedBuffer = trimAudioBuffer(combinedBuffer, bufferDuration);
    this.audioBuffer = [trimmedBuffer];

    if (this.shouldRecognize()) {
      const interval = this.getRecognitionInterval();
      const rms = audioRMS(this.audioBuffer[0] ?? Buffer.alloc(0));

      // Silence gate. When no song is playing and the mic feed is
      // basically dead air, skip the API call entirely — saves ACR
      // credits and stops us from "detecting" random remixes off
      // background noise.
      //
      // BUT — the gate is only applied in steady-state LISTENING.
      // During the initial probe budget (first N probes after waking)
      // and during alert mode (60s after a song ends) we explicitly
      // expect a song to be starting; gating those probes makes the
      // next song take 30-60+ seconds to detect because RMS for the
      // intro/buildup of a track can be well under 800 (~the
      // background-noise threshold). We'd rather burn 6-12 extra
      // ACR calls per minute than miss the next song.
      const isListening =
        this.state === RecognitionState.LISTENING ||
        this.state === RecognitionState.SONG_ENDING;
      const inExpectedSongWindow =
        this.probesSinceWake < this.config.RECOGNITION_INITIAL_PROBE_COUNT ||
        this.isInAlertMode();
      if (isListening && !inExpectedSongWindow && rms < this.config.SILENCE_RMS_THRESHOLD) {
        this.logger.debug(
          {state: RecognitionState[this.state], rms: Math.round(rms), threshold: this.config.SILENCE_RMS_THRESHOLD, interval},
          'Silence gate: skipping ACR call (no audio energy)',
        );
        this.lastRecognitionTime = Date.now();
        this.consecutiveMisses++;
        return;
      }

      this.logger.info({
        state: RecognitionState[this.state],
        interval,
        bufferDuration,
        rms: Math.round(rms),
        probe: this.probesSinceWake + 1,
        misses: this.consecutiveMisses,
      }, 'Recognition interval reached');
      // Set the time immediately to prevent multiple calls
      this.lastRecognitionTime = Date.now();
      this.probesSinceWake++;
      this.performRecognition().catch(err => {
        this.logger.error(err, 'Error performing recognition');
      });
    }
  }

  async performRecognition(): Promise<RecognitionResult | null> {
    if (this.audioBuffer.length === 0) {
      this.logger.warn({}, 'No audio buffer to recognize');
      return null;
    }

    const startTime = Date.now();
    const audioData = combineAudioBuffers(this.audioBuffer);
    
    // Create WAV format audio
    const wavBuffer = this.createWAVBuffer(audioData);
    
    this.logger.info({ 
      audioSize: audioData.length,
      wavSize: wavBuffer.length,
      sampleRate: this.sampleRate,
      duration: this.getAudioBufferDuration() 
    }, 'Sending audio to ACRCloud');
    
    try {
      const result = await this.acrService.recognize(wavBuffer);
      const apiLatency = Date.now() - startTime;
      
      this.logger.info({
        hasResult: !!result,
        hasError: !!(result && result.error),
        error: result?.error,
        confidence: result?.confidence,
        apiLatency
      }, 'ACRCloud response received');
      
      if (result && !result.error) {
        this.logger.info({
          title: result.title,
          artist: result.artist,
          confidence: result.confidence,
          offsetSeconds: result.offsetSeconds
        }, 'Song recognized');

        const enrichedResult = {
          ...result,
          apiLatency
        };
        // Reset the silence backoff: we found something.
        this.consecutiveMisses = 0;
        // Don't update lastRecognitionTime here since we already set it before calling
        this.onRecognition(enrichedResult);
        return enrichedResult;
      }

      this.logger.debug({}, 'No valid recognition result');
      this.consecutiveMisses++;
      this.onRecognition(null);
      return null;
    } catch (error) {
      this.logger.error(error as Error, 'Recognition error');
      this.consecutiveMisses++;
      this.onRecognition(null);
      return null;
    }
  }

  shouldRecognize(): boolean {
    const now = Date.now();
    // If we've never recognized before, fire as soon as we have enough
    // audio to fingerprint (configurable, default 3s). Cuts ~12s off
    // first-detect time vs waiting for the full LISTENING interval.
    if (this.lastRecognitionTime === 0) {
      const combinedBuffer = combineAudioBuffers(this.audioBuffer);
      const minBytes = this.sampleRate * 2 * (this.config.RECOGNITION_INITIAL_MIN_AUDIO / 1000);
      return combinedBuffer.length >= minBytes;
    }
    const interval = this.getRecognitionInterval();
    return now - this.lastRecognitionTime >= interval;
  }
  
  setState(state: RecognitionState): void {
    this.logger.info({
      previousState: RecognitionState[this.state],
      newState: RecognitionState[state]
    }, 'Recognition state change');

    // Re-enter LISTENING (song ended, switch failed, etc.) → reset
    // the fast-probe counter so we catch the next song quickly, and
    // clear the fresh-window so any prior song doesn't bleed into the
    // next detection's cadence. Don't reset consecutiveMisses here;
    // that only resets on a real detection or first audio that passes
    // the silence gate.
    if (state === RecognitionState.LISTENING && this.state !== RecognitionState.LISTENING) {
      this.probesSinceWake = 0;
      this.songConfirmedAt = 0;
    }

    this.state = state;
  }
  
  getState(): RecognitionState {
    return this.state;
  }
  
  setPendingRecognition(pending: PendingRecognition | null): void {
    this.pendingRecognition = pending;
  }
  
  getPendingRecognition(): PendingRecognition | null {
    return this.pendingRecognition;
  }
  
  updateLastConfidentRecognition(): void {
    this.lastConfidentRecognition = Date.now();
  }

  /**
   * Called by UserSession when a fresh song goes SONG_DETECTED_CONFIRMED.
   * Starts the tighter sampling window. Passing 0 (or just calling
   * setState(LISTENING) elsewhere) effectively clears it.
   */
  markSongConfirmed(): void {
    this.songConfirmedAt = Date.now();
  }

  isInFreshWindow(): boolean {
    if (this.songConfirmedAt === 0) return false;
    return Date.now() - this.songConfirmedAt < this.config.FRESH_DETECTION_DURATION;
  }

  /**
   * Called when a song ends and we drop back to LISTENING. Holds a
   * tight ACR cadence for ALERT_MODE_DURATION so we catch a quickly-
   * starting next track. The probes-since-wake counter is also reset
   * so the initial fast-probe budget gets a fresh ALERT_PROBE_COUNT
   * worth of room before backoff kicks in.
   */
  enterAlertMode(): void {
    this.alertModeUntil = Date.now() + this.config.ALERT_MODE_DURATION;
    this.probesSinceWake = 0;
    this.consecutiveMisses = 0;
  }

  isInAlertMode(): boolean {
    return this.alertModeUntil > 0 && Date.now() < this.alertModeUntil;
  }
  
  private getRecognitionInterval(): number {
    const now = Date.now();
    const timeSinceConfident = now - this.lastConfidentRecognition;

    switch (this.state) {
      case RecognitionState.LISTENING:
        return this.getListeningInterval();

      case RecognitionState.SONG_DETECTED_PENDING:
      case RecognitionState.SONG_SWITCH_PENDING:
        return this.config.RECOGNITION_INTERVAL_VERIFY;

      case RecognitionState.SONG_PLAYING:
      case RecognitionState.SONG_DETECTED_CONFIRMED:
        // First N seconds after confirmation: tight cadence so we
        // catch wrong-version cuts early (extended/sped-up tracks
        // that ACR fingerprints to a canonical recording).
        if (this.isInFreshWindow()) {
          return this.config.RECOGNITION_INTERVAL_FRESH;
        }
        if (timeSinceConfident > this.config.CONFIDENCE_DECAY_TIME) {
          return this.config.RECOGNITION_INTERVAL_UNCERTAIN;
        }
        return this.config.RECOGNITION_INTERVAL_PLAYING;

      case RecognitionState.SONG_ENDING:
        return this.config.RECOGNITION_INTERVAL_VERIFY;

      default:
        return this.config.RECOGNITION_INTERVAL_PLAYING;
    }
  }

  /**
   * LISTENING-state cadence priority:
   *  1. Fresh-detection probe budget: short interval until N probes fire.
   *  2. Alert mode (right after a song ended): tight cadence for ~60s.
   *  3. Steady state: normal LISTENING interval.
   *  4. After repeated misses past the threshold: exponential backoff.
   *
   * Alert mode beats steady-state but loses to the initial probe budget,
   * because once we boot a session we want the very first detection
   * window (3 probes at 5s) regardless of any prior alert.
   */
  private getListeningInterval(): number {
    if (this.probesSinceWake < this.config.RECOGNITION_INITIAL_PROBE_COUNT) {
      return this.config.RECOGNITION_INITIAL_INTERVAL;
    }

    if (this.isInAlertMode()) {
      return this.config.RECOGNITION_INTERVAL_ALERT;
    }

    const base = this.config.RECOGNITION_INTERVAL_LISTENING;
    const extraMisses = Math.max(0, this.consecutiveMisses - this.config.SILENT_BACKOFF_AFTER_MISSES);
    if (extraMisses === 0) return base;

    const scaled = base * Math.pow(this.config.SILENT_BACKOFF_FACTOR, extraMisses);
    return Math.min(scaled, this.config.SILENT_BACKOFF_MAX_INTERVAL);
  }
  
  private getAudioBufferDuration(): number {
    if (this.state === RecognitionState.SONG_DETECTED_PENDING ||
        this.state === RecognitionState.SONG_SWITCH_PENDING) {
      return this.config.AUDIO_BUFFER_DURATION_VERIFY;
    }
    return this.config.AUDIO_BUFFER_DURATION_NORMAL;
  }
  
  addToHistory(entry: RecognitionHistoryEntry): void {
    this.recognitionHistory.push(entry);
    // Keep only last 20 entries
    if (this.recognitionHistory.length > 20) {
      this.recognitionHistory.shift();
    }
  }

  reset(): void {
    this.isRecording = false;
    this.audioBuffer = [];
    this.lastRecognitionTime = 0;
    this.probesSinceWake = 0;
    this.consecutiveMisses = 0;
  }

  stop(): void {
    this.isRecording = false;
  }

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.logger.info({ sampleRate: rate }, 'Sample rate set');
  }

  hasSampleRate(): boolean {
    return this.sampleRate !== 16000; // Return true if not default
  }

  private createWAVHeader(dataLength: number, sampleRate: number): Buffer {
    const header = Buffer.alloc(44);
    
    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(dataLength + 36, 4); // File size - 8
    header.write('WAVE', 8);
    
    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20); // AudioFormat (PCM)
    header.writeUInt16LE(1, 22); // NumChannels (mono)
    header.writeUInt32LE(sampleRate, 24); // SampleRate
    header.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    header.writeUInt16LE(2, 32); // BlockAlign (NumChannels * BitsPerSample/8)
    header.writeUInt16LE(16, 34); // BitsPerSample
    
    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);
    
    return header;
  }

  private createWAVBuffer(audioData: Buffer): Buffer {
    const header = this.createWAVHeader(audioData.length, this.sampleRate);
    return Buffer.concat([header, audioData]);
  }
}