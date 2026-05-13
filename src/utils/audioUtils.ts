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

/**
 * Compute the RMS amplitude of a 16-bit little-endian PCM buffer.
 *
 * Returns a value in [0, 32768]. Reference points for the G1 mic input:
 *   < 200      pure silence / mic dead
 *   200–600    background room noise (typing, fan, breath)
 *   600–1500   speech, distant music
 *   1500–4000  normal music playing nearby
 *   > 4000     loud music
 *
 * We sample every 8th frame so an 8s @ 16kHz buffer is processed in
 * single-digit milliseconds — cheap to call on every recognition tick.
 */
export function audioRMS(buffer: Buffer): number {
  if (buffer.length < 2) return 0;
  let sumSq = 0;
  let count = 0;
  // Stride 16 bytes (8 frames) to keep cost trivial on 8s buffers.
  // Random offset within first stride to avoid aliasing with silence patterns.
  const stride = 16;
  for (let i = 0; i + 1 < buffer.length; i += stride) {
    const s = buffer.readInt16LE(i);
    sumSq += s * s;
    count++;
  }
  if (count === 0) return 0;
  return Math.sqrt(sumSq / count);
}