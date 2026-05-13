import { AppSession, AudioChunk } from '@mentra/sdk';
import { AppState, CurrentSong, RecognitionResult } from '../types';
import { RecognitionManager } from './RecognitionManager';
import { LyricsManager } from './LyricsManager';
import { PositionTracker } from './PositionTracker';
import { DisplayManager } from './DisplayManager';
import { HistoryManager } from './HistoryManager';
import { ACRCloudService } from '../services/ACRCloudService';
import { LRCService } from '../services/LRCService';
import { 
  RecognitionState, 
  PendingRecognition, 
  RecognitionConfig,
  DEFAULT_RECOGNITION_CONFIG 
} from '../types/recognition';
import { isSameSong, getSimilarityConfidenceBoost } from '../utils/songMatcher';

export class UserSession {
  userId: string;
  sessionId: string;
  session: AppSession;
  
  currentSong?: CurrentSong;
  appState: AppState = AppState.LISTENING;
  
  recognitionManager: RecognitionManager;
  lyricsManager: LyricsManager;
  positionTracker: PositionTracker;
  displayManager: DisplayManager;
  historyManager: HistoryManager;

  private acrService: ACRCloudService;
  private lrcService: LRCService;
  private logger: AppSession['logger'];
  private verificationTimer?: NodeJS.Timeout;
  private config: RecognitionConfig = DEFAULT_RECOGNITION_CONFIG;

  constructor(
    userId: string, 
    sessionId: string, 
    session: AppSession,
    acrConfig: { host: string; accessKey: string; secretKey: string }
  ) {
    this.userId = userId;
    this.sessionId = sessionId;
    this.session = session;
    this.logger = session.logger.child({ service: 'UserSession' });

    this.logger.info({ userId, sessionId }, 'Initializing UserSession');

    this.acrService = new ACRCloudService(
      acrConfig.host,
      acrConfig.accessKey,
      acrConfig.secretKey
    );
    this.lrcService = new LRCService();

    this.recognitionManager = new RecognitionManager(
      this.acrService,
      this.handleRecognitionResult.bind(this),
      this.logger
    );
    this.lyricsManager = new LyricsManager(this.lrcService);
    this.positionTracker = new PositionTracker();
    this.displayManager = new DisplayManager(session);
    this.historyManager = new HistoryManager();

    this.setupAudioStream();
  }

  startListening(): void {
    this.logger.info({}, 'Starting listening mode');
    this.appState = AppState.LISTENING;
    this.displayManager.showListening();
    this.recognitionManager.startListening();
    
    this.displayManager.startUpdateTimer(() => {
      this.updateDisplay();
    }, 500);
  }

  private setupAudioStream(): void {
    this.logger.info({}, 'Setting up audio stream subscription');
    
    // Set up handlers for audio chunks
    this.session.events.onAudioChunk(async (chunk: AudioChunk) => {
      this.handleAudioChunk(chunk);
    });
    
    this.logger.info({}, 'Audio stream subscription setup complete');
  }

  private handleAudioChunk(chunk: AudioChunk): void {
    if (!chunk || !chunk.arrayBuffer) {
      this.logger.warn({}, 'Received empty or invalid audio chunk');
      return;
    }
    
    try {
      // Convert ArrayBuffer to Buffer
      const uint8Array = new Uint8Array(chunk.arrayBuffer);
      const audioBuffer = Buffer.from(uint8Array);
      
      // Log sample rate on first chunk
      if (!this.recognitionManager.hasSampleRate() && chunk.sampleRate) {
        this.logger.info({ 
          sampleRate: chunk.sampleRate 
        }, 'Audio stream sample rate detected');
        this.recognitionManager.setSampleRate(chunk.sampleRate);
      }
      
      // Only log every 100th chunk to reduce spam
      if (Math.random() < 0.01) {
        this.logger.debug({ 
          bufferLength: audioBuffer.length,
          sampleRate: chunk.sampleRate 
        }, 'Processing audio buffer (sample)');
      }
      
      this.recognitionManager.processAudioChunk(audioBuffer);
    } catch (err) {
      this.logger.error(err as Error, 'Error handling audio chunk');
    }
  }

  private async handleRecognitionResult(result: RecognitionResult | null): Promise<void> {
    const state = this.recognitionManager.getState();
    const now = Date.now();
    
    // No result or error
    if (!result || result.error) {
      this.logger.debug({ 
        hasResult: !!result,
        error: result?.error,
        state: RecognitionState[state]
      }, 'No recognition result');
      
      // Handle verification timeout
      if (state === RecognitionState.SONG_DETECTED_PENDING) {
        const pending = this.recognitionManager.getPendingRecognition();
        if (pending && now - pending.timestamp > this.config.VERIFICATION_TIMEOUT) {
          this.logger.info({}, 'Verification timeout, returning to listening');
          this.recognitionManager.setState(RecognitionState.LISTENING);
          this.recognitionManager.setPendingRecognition(null);
        }
      }
      return;
    }

    const isSameAsCurrent = this.currentSong &&
      isSameSong(
        { title: this.currentSong.title, artist: this.currentSong.artist },
        { title: result.title, artist: result.artist }
      );

    // Get confidence threshold based on current state
    const threshold = this.getConfidenceThreshold(state, isSameAsCurrent);
    
    this.logger.info({
      state: RecognitionState[state],
      currentSong: this.currentSong?.title,
      detectedSong: result.title,
      confidence: result.confidence,
      threshold,
      isSameSong
    }, 'Recognition result analysis');

    // Handle based on current state
    switch (state) {
      case RecognitionState.LISTENING:
        await this.handleListeningState(result);
        break;
        
      case RecognitionState.SONG_DETECTED_PENDING:
        await this.handlePendingState(result);
        break;
        
      case RecognitionState.SONG_PLAYING:
      case RecognitionState.SONG_DETECTED_CONFIRMED:
        await this.handlePlayingState(result, isSameAsCurrent);
        break;
        
      case RecognitionState.SONG_SWITCH_PENDING:
        await this.handleSwitchPendingState(result);
        break;
        
      case RecognitionState.SONG_ENDING:
        await this.handleEndingState(result);
        break;
    }
  }

  private async handleNewSong(result: RecognitionResult): Promise<void> {
    this.logger.info({ 
      previousState: AppState[this.appState],
      newState: AppState[AppState.PROCESSING],
      recognitionState: RecognitionState[this.recognitionManager.getState()]
    }, 'State transition: Processing new song');
    
    // Only show "Processing..." if we're not already showing a song
    // This prevents lyrics from disappearing during song switches
    if (!this.currentSong || this.appState === AppState.LISTENING) {
      this.appState = AppState.PROCESSING;
      this.updateDisplay(); // This will show "Processing..."
    }

    const newSong: CurrentSong = {
      title: result.title,
      artist: result.artist,
      album: result.album,
      duration: result.duration || 0,
      detectedAt: Date.now(),
      hasLyrics: false,
      confidence: result.confidence
    };

    this.currentSong = newSong;
    this.historyManager.addSong(newSong);

    if (result.offsetSeconds !== undefined) {
      this.positionTracker.startSong(
        Date.now(),
        result.offsetSeconds,
        0
      );
    }

    this.logger.info({}, 'Fetching lyrics for new song');
    const lrcData = await this.lyricsManager.fetchLyrics(newSong);
    
    if (lrcData && lrcData.length > 0) {
      this.currentSong.lrcData = lrcData;
      this.currentSong.hasLyrics = true;
      
      this.logger.info({ 
        previousState: AppState[this.appState],
        newState: AppState[AppState.SONG_DETECTED_WITH_LYRICS],
        lyricsCount: lrcData.length
      }, 'State transition: Lyrics found');
      
      this.appState = AppState.SONG_DETECTED_WITH_LYRICS;
    } else {
      this.logger.info({ 
        previousState: AppState[this.appState],
        newState: AppState[AppState.SONG_DETECTED_NO_LYRICS]
      }, 'State transition: No lyrics available');
      
      this.appState = AppState.SONG_DETECTED_NO_LYRICS;
    }
    
    // Update recognition state to playing
    this.recognitionManager.setState(RecognitionState.SONG_PLAYING);

    this.updateDisplay();
  }

  private updateDisplay(): void {
    const position = this.positionTracker.getCurrentPosition();
    
    // Use the new 5-line formatter
    const currentChunk = this.currentSong && this.appState === AppState.SONG_DETECTED_WITH_LYRICS
      ? this.lyricsManager.getCurrentChunk(position)
      : null;
    
    const nextChunk = this.currentSong && this.appState === AppState.SONG_DETECTED_WITH_LYRICS
      ? this.lyricsManager.getNextChunk(position)
      : null;
    
    this.displayManager.displayFormatted(
      this.appState,
      this.currentSong,
      currentChunk,
      nextChunk,
      position
    );

    // Check if song ended
    if (this.currentSong && position > this.currentSong.duration && this.currentSong.duration > 0) {
      const overdueBy = position - this.currentSong.duration;
      if (overdueBy > this.config.SONG_END_GRACE_PERIOD / 1000) {
        this.logger.info({ overdueBy }, 'Song ended, resetting to listening');
        this.resetToListening();
      } else if (this.recognitionManager.getState() !== RecognitionState.SONG_ENDING) {
        this.logger.info({}, 'Song ending soon');
        this.recognitionManager.setState(RecognitionState.SONG_ENDING);
      }
    }
  }

  private resetToListening(): void {
    this.currentSong = undefined;
    this.appState = AppState.LISTENING;
    this.positionTracker.reset();
    this.recognitionManager.setState(RecognitionState.LISTENING);
    this.recognitionManager.setPendingRecognition(null);
    this.clearVerificationTimer();
    // Don't update display here - let updateDisplay handle it
  }
  
  private getConfidenceThreshold(state: RecognitionState, isSameSong: boolean): number {
    // Position update for same song - very low threshold
    if (isSameSong) {
      return 0.5;
    }
    
    // No current song or ending - use lower threshold
    if (state === RecognitionState.LISTENING || state === RecognitionState.SONG_ENDING) {
      return this.config.CONFIDENCE_THRESHOLD_NO_SONG;
    }
    
    // Verification pass
    if (state === RecognitionState.SONG_DETECTED_PENDING || 
        state === RecognitionState.SONG_SWITCH_PENDING) {
      return this.config.CONFIDENCE_THRESHOLD_VERIFY;
    }
    
    // Song switch from playing state
    return this.config.CONFIDENCE_THRESHOLD_SWITCH;
  }
  
  private async handleListeningState(result: RecognitionResult): Promise<void> {
    if (result.confidence < this.config.CONFIDENCE_THRESHOLD_NO_SONG) {
      this.logger.debug({ confidence: result.confidence }, 'Confidence too low for detection');
      return;
    }
    
    // When listening, trust ACRCloud - instant accept anything above threshold
    this.logger.info({ 
      confidence: result.confidence,
      song: `${result.title} - ${result.artist}`
    }, 'Song detected while listening, instant acceptance');
    
    this.recognitionManager.setState(RecognitionState.SONG_DETECTED_CONFIRMED);
    this.recognitionManager.updateLastConfidentRecognition();
    await this.handleNewSong(result);
  }
  
  private async handlePendingState(result: RecognitionResult): Promise<void> {
    const pending = this.recognitionManager.getPendingRecognition();
    if (!pending) return;
    
    const isSamePending = isSameSong(
      { title: pending.song.title, artist: pending.song.artist },
      { title: result.title, artist: result.artist }
    );
    
    // Apply confidence boost for similar songs (handles remixes)
    const confidenceBoost = isSamePending ? 
      getSimilarityConfidenceBoost(
        { title: pending.song.title, artist: pending.song.artist },
        { title: result.title, artist: result.artist }
      ) : 0;
    
    const adjustedConfidence = Math.min(1, result.confidence + confidenceBoost);
    
    if (isSamePending && adjustedConfidence >= this.config.CONFIDENCE_THRESHOLD_VERIFY) {
      // Verification successful
      this.logger.info({
        pendingSong: `${pending.song.title} - ${pending.song.artist}`,
        verifiedAs: `${result.title} - ${result.artist}`,
        originalConfidence: result.confidence,
        adjustedConfidence,
        boost: confidenceBoost
      }, 'Pending song verified (with similarity matching)');
      
      this.recognitionManager.setState(RecognitionState.SONG_DETECTED_CONFIRMED);
      this.recognitionManager.updateLastConfidentRecognition();
      this.recognitionManager.setPendingRecognition(null);
      await this.handleNewSong(result);
    } else {
      // Verification failed - different song or low confidence
      this.logger.info({
        pendingSong: `${pending.song.title} - ${pending.song.artist}`,
        newSong: `${result.title} - ${result.artist}`,
        isSame: isSamePending,
        confidence: result.confidence,
        adjustedConfidence,
        threshold: this.config.CONFIDENCE_THRESHOLD_VERIFY
      }, 'Pending verification failed');
      this.recognitionManager.setState(RecognitionState.LISTENING);
      this.recognitionManager.setPendingRecognition(null);
    }
  }
  
  private async handlePlayingState(result: RecognitionResult, isSameSong: boolean): Promise<void> {
    if (isSameSong) {
      // Position update
      if (result.offsetSeconds !== undefined) {
        const isValid = this.positionTracker.validatePosition(
          result.offsetSeconds,
          Date.now(),
          result.confidence,
          result.apiLatency || 0
        );

        if (!isValid) {
          this.logger.info({ 
            expectedPosition: this.positionTracker.getCurrentPosition(),
            detectedPosition: result.offsetSeconds,
            drift: Math.abs(this.positionTracker.getCurrentPosition() - result.offsetSeconds)
          }, 'Position drift detected, recalibrating');
          
          this.positionTracker.recalibrate(
            result.offsetSeconds,
            Date.now(),
            result.confidence,
            result.apiLatency || 0
          );
        }
        
        this.recognitionManager.updateLastConfidentRecognition();
      }
    } else {
      // Different song detected
      if (result.confidence < this.config.CONFIDENCE_THRESHOLD_SWITCH) {
        this.logger.debug({
          confidence: result.confidence,
          threshold: this.config.CONFIDENCE_THRESHOLD_SWITCH
        }, 'Confidence too low for song switch');
        return;
      }
      
      // Mark for verification (even high confidence to prevent jarring switches)
      this.logger.info({}, 'Different song detected, pending switch verification');
      this.recognitionManager.setState(RecognitionState.SONG_SWITCH_PENDING);
      this.recognitionManager.setPendingRecognition({
        song: {
          title: result.title,
          artist: result.artist,
          album: result.album,
          duration: result.duration || 0
        },
        confidence: result.confidence,
        timestamp: Date.now(),
        offsetSeconds: result.offsetSeconds
      });
      // Keep showing current song/lyrics - no interruption
    }
  }
  
  private async handleSwitchPendingState(result: RecognitionResult): Promise<void> {
    const pending = this.recognitionManager.getPendingRecognition();
    if (!pending) return;
    
    const isPendingSong = isSameSong(
      { title: pending.song.title, artist: pending.song.artist },
      { title: result.title, artist: result.artist }
    );
    const isCurrentSong = this.currentSong && isSameSong(
      { title: this.currentSong.title, artist: this.currentSong.artist },
      { title: result.title, artist: result.artist }
    );
    
    if (isPendingSong && result.confidence >= this.config.CONFIDENCE_THRESHOLD_VERIFY) {
      // Switch verified
      this.logger.info({}, 'Song switch verified');
      this.recognitionManager.setState(RecognitionState.SONG_DETECTED_CONFIRMED);
      this.recognitionManager.updateLastConfidentRecognition();
      this.recognitionManager.setPendingRecognition(null);
      await this.handleNewSong(result);
    } else if (isCurrentSong) {
      // False alarm - stay with current
      this.logger.info({}, 'Song switch cancelled - staying with current');
      this.recognitionManager.setState(RecognitionState.SONG_PLAYING);
      this.recognitionManager.setPendingRecognition(null);
    } else {
      // Third song or low confidence - too unstable
      this.logger.info({
        currentSong: this.currentSong?.title,
        pendingSong: pending.song.title,
        detectedSong: result.title
      }, 'Unstable detection - staying with current');
      this.recognitionManager.setState(RecognitionState.SONG_PLAYING);
      this.recognitionManager.setPendingRecognition(null);
    }
  }
  
  private async handleEndingState(result: RecognitionResult): Promise<void> {
    // Treat like listening state but with awareness that we're transitioning
    await this.handleListeningState(result);
  }
  
  private clearVerificationTimer(): void {
    if (this.verificationTimer) {
      clearTimeout(this.verificationTimer);
      this.verificationTimer = undefined;
    }
  }

  cleanup(): void {
    this.displayManager.stopUpdateTimer();
    this.displayManager.clear();
    this.recognitionManager.stop();
    this.positionTracker.reset();
  }

  getStats(): any {
    return {
      userId: this.userId,
      sessionId: this.sessionId,
      currentState: AppState[this.appState],
      currentSong: this.currentSong ? {
        title: this.currentSong.title,
        artist: this.currentSong.artist,
        position: this.positionTracker.getCurrentPosition(),
        duration: this.currentSong.duration,
        hasLyrics: this.currentSong.hasLyrics
      } : null,
      history: this.historyManager.getStatistics(),
      cacheSize: this.lyricsManager.getCacheSize()
    };
  }

  /**
   * Audit log of frames that have been shown on the glasses HUD.
   * Latest at the end. Used by the webview to let us debug timing and
   * formatter behavior after the fact.
   */
  getDisplayHistory(limit?: number) {
    return this.displayManager.getDisplayHistory(limit);
  }

  /**
   * Current playback position + currently-active and upcoming lyrics
   * chunks. Used by the webview to mirror what the glasses HUD is
   * showing.
   */
  getLiveLyrics(): {
    position: number;
    current: {lines: string[]; startTime: number; endTime: number} | null;
    next: {lines: string[]; startTime: number; endTime: number} | null;
  } | null {
    if (this.appState !== AppState.SONG_DETECTED_WITH_LYRICS || !this.currentSong) {
      return null;
    }
    const position = this.positionTracker.getCurrentPosition();
    const current = this.lyricsManager.getCurrentChunk(position);
    const next = this.lyricsManager.getNextChunk(position);
    return {
      position,
      current: current ? {lines: current.lines, startTime: current.startTime, endTime: current.endTime} : null,
      next: next ? {lines: next.lines, startTime: next.startTime, endTime: next.endTime} : null,
    };
  }
}