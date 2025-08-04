import { AppSession, AudioChunk } from '@mentra/sdk';
import { AppState, CurrentSong, RecognitionResult } from '../types';
import { RecognitionManager } from './RecognitionManager';
import { LyricsManager } from './LyricsManager';
import { PositionTracker } from './PositionTracker';
import { DisplayManager } from './DisplayManager';
import { HistoryManager } from './HistoryManager';
import { ACRCloudService } from '../services/ACRCloudService';
import { LRCService } from '../services/LRCService';

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
    if (!result || result.error || result.confidence < 0.7) {
      this.logger.debug({ 
        hasResult: !!result,
        error: result?.error,
        confidence: result?.confidence 
      }, 'Invalid recognition result');
      
      if (this.currentSong && this.positionTracker.getConfidence() < 0.5) {
        this.logger.info({}, 'Low position confidence, resetting to listening');
        this.resetToListening();
      }
      return;
    }

    const isSameSong = this.currentSong &&
      this.currentSong.title === result.title &&
      this.currentSong.artist === result.artist;

    this.logger.info({
      currentSong: this.currentSong?.title,
      currentArtist: this.currentSong?.artist,
      newSong: result.title,
      newArtist: result.artist,
      isSameSong,
      offsetSeconds: result.offsetSeconds
    }, 'Processing recognition result');

    if (isSameSong && result.offsetSeconds !== undefined) {
      const isValid = this.positionTracker.validatePosition(
        result.offsetSeconds,
        Date.now(),
        result.confidence,
        0 // apiLatency - we should pass this through
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
          0 // apiLatency
        );
      }
    } else if (!isSameSong) {
      this.logger.info({
        previousSong: this.currentSong?.title,
        newSong: result.title
      }, 'New song detected, switching');
      await this.handleNewSong(result);
    }
  }

  private async handleNewSong(result: RecognitionResult): Promise<void> {
    this.logger.info({ 
      previousState: AppState[this.appState],
      newState: AppState[AppState.PROCESSING]
    }, 'State transition: Processing new song');
    
    this.appState = AppState.PROCESSING;
    this.displayManager.showProcessing();

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
      this.resetToListening();
    }
  }

  private resetToListening(): void {
    this.currentSong = undefined;
    this.appState = AppState.LISTENING;
    this.positionTracker.reset();
    this.displayManager.showListening();
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
        hasLyrics: this.currentSong.hasLyrics
      } : null,
      history: this.historyManager.getStatistics(),
      cacheSize: this.lyricsManager.getCacheSize()
    };
  }
}