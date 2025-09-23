import { RecognitionPoint } from '../types';

export class PositionTracker {
  private songStartTime?: number;
  private detectedOffset?: number;
  private recognitionHistory: RecognitionPoint[] = [];
  private estimatedDrift: number = 0;
  private readonly MAX_DRIFT_SECONDS = 3;
  private readonly HISTORY_SIZE = 5;

  startSong(detectedAt: number, songOffset: number, apiLatency: number): void {
    this.songStartTime = detectedAt - (songOffset * 1000) - (apiLatency / 2);
    this.detectedOffset = songOffset;
    this.estimatedDrift = 0;
    this.recognitionHistory = [{
      timestamp: detectedAt,
      detectedOffset: songOffset,
      confidence: 1.0,
      apiLatency
    }];
  }

  getCurrentPosition(): number {
    if (!this.songStartTime) {
      return 0;
    }

    const elapsed = Date.now() - this.songStartTime;
    const position = (elapsed / 1000) - this.estimatedDrift;
    
    return Math.max(0, position);
  }

  validatePosition(newOffset: number, detectionTime: number, confidence: number = 1.0, apiLatency: number = 0): boolean {
    const currentPosition = this.getCurrentPosition();
    const drift = Math.abs(currentPosition - newOffset);
    
    return drift <= this.MAX_DRIFT_SECONDS;
  }

  recalibrate(newOffset: number, detectionTime: number, confidence: number = 1.0, apiLatency: number = 0): void {
    if (!this.songStartTime) {
      this.startSong(detectionTime, newOffset, apiLatency);
      return;
    }

    this.recognitionHistory.push({
      timestamp: detectionTime,
      detectedOffset: newOffset,
      confidence,
      apiLatency
    });

    if (this.recognitionHistory.length > this.HISTORY_SIZE) {
      this.recognitionHistory.shift();
    }

    const weightedDrifts = this.recognitionHistory.map((point, index) => {
      const expectedPosition = (point.timestamp - this.songStartTime!) / 1000;
      const actualPosition = point.detectedOffset + (point.apiLatency / 2000);
      const drift = expectedPosition - actualPosition;
      const weight = point.confidence * (index + 1) / this.recognitionHistory.length;
      
      return { drift, weight };
    });

    const totalWeight = weightedDrifts.reduce((sum, d) => sum + d.weight, 0);
    this.estimatedDrift = weightedDrifts.reduce((sum, d) => sum + d.drift * d.weight, 0) / totalWeight;

    const currentPosition = this.getCurrentPosition();
    const drift = Math.abs(currentPosition - newOffset);
    
    if (drift > this.MAX_DRIFT_SECONDS) {
      this.songStartTime = detectionTime - (newOffset * 1000) - (apiLatency / 2);
      this.estimatedDrift = 0;
    }
  }

  getConfidence(): number {
    if (this.recognitionHistory.length === 0) {
      return 0;
    }

    const recentPoints = this.recognitionHistory.slice(-3);
    const avgConfidence = recentPoints.reduce((sum, p) => sum + p.confidence, 0) / recentPoints.length;
    
    const driftVariance = this.calculateDriftVariance();
    const driftPenalty = Math.min(1, driftVariance / this.MAX_DRIFT_SECONDS);
    
    return avgConfidence * (1 - driftPenalty * 0.5);
  }

  private calculateDriftVariance(): number {
    if (this.recognitionHistory.length < 2) {
      return 0;
    }

    const drifts = this.recognitionHistory.map(point => {
      const expectedPosition = (point.timestamp - this.songStartTime!) / 1000;
      const actualPosition = point.detectedOffset;
      return expectedPosition - actualPosition;
    });

    const avgDrift = drifts.reduce((sum, d) => sum + d, 0) / drifts.length;
    const variance = drifts.reduce((sum, d) => sum + Math.pow(d - avgDrift, 2), 0) / drifts.length;
    
    return Math.sqrt(variance);
  }

  reset(): void {
    this.songStartTime = undefined;
    this.detectedOffset = undefined;
    this.recognitionHistory = [];
    this.estimatedDrift = 0;
  }

  isActive(): boolean {
    return this.songStartTime !== undefined;
  }
}