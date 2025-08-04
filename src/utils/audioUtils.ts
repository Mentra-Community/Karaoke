export function combineAudioBuffers(buffers: Buffer[]): Buffer {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
  return Buffer.concat(buffers, totalLength);
}

export function trimAudioBuffer(buffer: Buffer, maxDurationMs: number, sampleRate: number = 16000): Buffer {
  const bytesPerSecond = sampleRate * 2;
  const maxBytes = Math.floor((maxDurationMs / 1000) * bytesPerSecond);
  
  if (buffer.length <= maxBytes) {
    return buffer;
  }
  
  return buffer.slice(buffer.length - maxBytes);
}

export function calculateAudioDuration(bufferLength: number, sampleRate: number = 16000): number {
  const bytesPerSecond = sampleRate * 2;
  return (bufferLength / bytesPerSecond) * 1000;
}