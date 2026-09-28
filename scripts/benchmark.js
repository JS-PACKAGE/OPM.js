import { performance } from 'node:perf_hooks';
import { Synth, renderNote } from '../src/core/index.js';
import { brass } from '../src/voices/brass.js';

const sampleRate = 48000;
const blockSize = 128;
const frames = sampleRate / 2;
const left = new Float32Array(blockSize);
const right = new Float32Array(blockSize);

function realtime(count, patch = brass) {
  const synth = new Synth(sampleRate);
  for (let i = 0; i < count; i++) synth.noteOn(patch, 48 + i * 3);
  const start = performance.now();
  for (let frame = 0; frame < frames; frame += blockSize) {
    synth.render(left, right, 0, Math.min(blockSize, frames - frame));
  }
  return performance.now() - start;
}

function offline() {
  const start = performance.now();
  renderNote({ voice: brass, note: 60, duration: 0.5, sampleRate });
  return performance.now() - start;
}

const steady = { ...brass, lfo: { rate: 0, amDepth: 0, pmDepth: 0 } };
const cases = [
  ['idle', () => realtime(0)],
  ['one voice + LFO', () => realtime(1)],
  ['eight voices + LFO', () => realtime(8)],
  ['eight voices, no LFO', () => realtime(8, steady)],
  ['offline note + release', offline],
];
const results = [];
for (const [scenario, run] of cases) {
  for (let i = 0; i < 3; i++) run();
  const measurements = Array.from({ length: 9 }, run).sort((a, b) => a - b);
  results.push({ scenario, medianMs: Number(measurements[4].toFixed(3)) });
}
console.log(JSON.stringify({ node: process.version, sampleRate, blockSize, results }, null, 2));
