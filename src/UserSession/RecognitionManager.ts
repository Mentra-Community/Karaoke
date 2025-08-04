import { RecognitionResult } from '../types';
import { ACRCloudService } from '../services/ACRCloudService';
import { combineAudioBuffers, trimAudioBuffer } from '../utils/audioUtils';

export class RecognitionManager {
  private audioBuffer: Buffer[] = [];
  private isRecording: boolean = false;
  private lastRecognitionTime: number = 0;
  private readonly RECOGNITION_INTERVAL = 12000;
  private readonly AUDIO_BUFFER_DURATION = 8000;
  private acrService: ACRCloudService;
  private onRecognition: (result: RecognitionResult | null) => void;
  private logger: any;
  private sampleRate: number = 16000; // Default sample rate

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
    const trimmedBuffer = trimAudioBuffer(combinedBuffer, this.AUDIO_BUFFER_DURATION);
    this.audioBuffer = [trimmedBuffer];

    if (this.shouldRecognize()) {
      this.logger.info({}, 'Recognition interval reached, performing recognition');
      // Set the time immediately to prevent multiple calls
      this.lastRecognitionTime = Date.now();
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
      duration: this.AUDIO_BUFFER_DURATION 
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
        // Don't update lastRecognitionTime here since we already set it before calling
        this.onRecognition(enrichedResult);
        return enrichedResult;
      }
      
      this.logger.debug({}, 'No valid recognition result');
      this.onRecognition(null);
      return null;
    } catch (error) {
      this.logger.error(error as Error, 'Recognition error');
      this.onRecognition(null);
      return null;
    }
  }

  shouldRecognize(): boolean {
    const now = Date.now();
    // If we've never recognized before, check immediately
    if (this.lastRecognitionTime === 0) {
      return true;
    }
    return now - this.lastRecognitionTime >= this.RECOGNITION_INTERVAL;
  }

  reset(): void {
    this.isRecording = false;
    this.audioBuffer = [];
    this.lastRecognitionTime = 0;
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