import crypto from 'crypto';
import { RecognitionResult } from '../types';

export class ACRCloudService {
  private host: string;
  private accessKey: string;
  private secretKey: string;

  constructor(host: string, accessKey: string, secretKey: string) {
    this.host = host;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
  }

  async recognize(audioBuffer: Buffer): Promise<RecognitionResult> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.buildSignature(timestamp);
    
    try {
      const formData = this.createFormData(audioBuffer, signature, timestamp);
      
      const response = await fetch(`https://${this.host}/v1/identify`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`ACRCloud API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status.code !== 0) {
        return {
          title: '',
          artist: '',
          confidence: 0,
          error: data.status.msg || 'Recognition failed'
        };
      }

      const music = data.metadata?.music?.[0];
      if (!music) {
        return {
          title: '',
          artist: '',
          confidence: 0,
          error: 'No music detected'
        };
      }

      return {
        title: music.title || '',
        artist: music.artists?.[0]?.name || '',
        album: music.album?.name,
        duration: music.duration_ms ? music.duration_ms / 1000 : undefined,
        offsetSeconds: music.play_offset_ms ? music.play_offset_ms / 1000 : undefined,
        confidence: music.score ? music.score / 100 : 0.5
      };
    } catch (error) {
      return {
        title: '',
        artist: '',
        confidence: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private buildSignature(timestamp: number): string {
    const stringToSign = `POST\n/v1/identify\n${this.accessKey}\naudio\n1\n${timestamp}`;
    return crypto
      .createHmac('sha1', this.secretKey)
      .update(Buffer.from(stringToSign, 'utf-8'))
      .digest('base64');
  }

  private createFormData(audioBuffer: Buffer, signature: string, timestamp: number): FormData {
    const formData = new FormData();
    formData.append('access_key', this.accessKey);
    formData.append('sample_bytes', audioBuffer.length.toString());
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('data_type', 'audio');
    formData.append('signature_version', '1');
    formData.append('sample', new Blob([audioBuffer], { type: 'audio/wav' }));
    
    return formData;
  }
}