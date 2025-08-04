#!/usr/bin/env bun

// Test confidence thresholds
const confidenceLevels = [0.5, 0.6, 0.67, 0.7, 0.8, 0.9];
const THRESHOLD = 0.6; // New threshold

console.log('Testing confidence threshold of', THRESHOLD);
console.log('='.repeat(40));

confidenceLevels.forEach(confidence => {
  const accepted = confidence >= THRESHOLD;
  const emoji = accepted ? '✅' : '❌';
  console.log(`${emoji} Confidence ${confidence}: ${accepted ? 'ACCEPTED' : 'REJECTED'}`);
});

console.log('\nExample songs that would now be accepted:');
console.log('- "Have Mercy" by YBN Cordae (0.67) ✅');
console.log('- Songs with 0.6+ confidence ✅');
console.log('- Songs with <0.6 confidence ❌');