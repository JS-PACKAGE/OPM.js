import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { Synth } from '../src/core/index.js';
import { brass } from '../src/voices/brass.js';
import type { VoiceInput } from '../src/voices/schema.js';
import type { OPMProcessor } from '../src/worklet/processor.js';

interface Diagnostics { errors: number; activeVoices: number; pendingEvents: number; rejectedNotes: number }
interface BenchmarkRun { (): void; diagnostics(): Diagnostics }

function integerSetting(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  return value;
}
function budgetSetting(name: string): number | null {
  if (process.env[name] === undefined) return null;
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new RangeError(`${name} must be in (0,100]`);
  return value;
}
const sampleRate = integerSetting('OPM_BENCH_SAMPLE_RATE', 48000, 8000, 192000);
const iterations = integerSetting('OPM_BENCH_BLOCKS', 2000, 100, 100000);
const warmup = integerSetting('OPM_BENCH_WARMUP', 300, 1, 100000);
const p99BudgetRatio = budgetSetting('OPM_BENCH_P99_BUDGET_RATIO');
const worstBudgetRatio = budgetSetting('OPM_BENCH_WORST_BUDGET_RATIO');
const blockSize = 128;
const deadlineMs = blockSize / sampleRate * 1000;
const left = new Float32Array(blockSize);
const right = new Float32Array(blockSize);
const steady = { ...brass, lfo: { rate: 0, amDepth: 0, pmDepth: 0 } };

function realtime(count: number, patch: VoiceInput = brass): BenchmarkRun {
  const synth = new Synth(sampleRate);
  for (let i = 0; i < count; i++) synth.noteOn(patch, 48 + i * 3);
  const run = () => synth.render(left, right);
  run.diagnostics = () => ({ errors: synth.errorCount, activeVoices: synth.voices.length, pendingEvents: 0, rejectedNotes: 0 });
  return run;
}

// Exercise the real processor receive/queue/split-render/steal path. Only its
// Web Audio host shell is supplied in Node; DSP and scheduling are not mocked.
let Processor: (new () => OPMProcessor) | undefined;
const host = globalThis as unknown as {
  sampleRate: number;
  currentFrame: number;
  AudioWorkletProcessor: new () => { port: { postMessage(message: unknown): void } };
  registerProcessor(name: string, constructor: new () => OPMProcessor): void;
};
host.sampleRate = sampleRate;
host.currentFrame = 0;
host.AudioWorkletProcessor = class {
  constructor() { this.port = { postMessage(_message: unknown): void {} }; }
  port: { postMessage(message: unknown): void };
};
host.registerProcessor = (name, constructor) => {
  if (name !== 'opm-processor') throw new Error(`unexpected processor ${name}`);
  Processor = constructor;
};
// A static import would register the processor before its Node host shell exists.
await import('../src/worklet/processor.js');
function burst(prepared = false): BenchmarkRun {
  if (!Processor) throw new Error('opm-processor was not registered');
  const processor = new Processor();
  if (prepared) processor.receive({ type: 'prepareVoice', voiceId: 1, voice: brass });
  let rejectedNotes = 0;
  processor.port.postMessage = (message: unknown) => {
    if (message !== null && typeof message === 'object' && 'type' in message && 'state' in message &&
        message.type === 'note' && message.state === 'rejected') rejectedNotes++;
  };
  const outputs = [[left, right]];
  const inputs: Float32Array[][] = [];
  const voice = prepared ? { voiceId: 1 } : { voice: brass };
  let frame = 0;
  let id = 1;
  const run = () => {
    host.currentFrame = frame;
    // Four immediate and four sub-block future starts continually replace
    // eight held voices and exercise both event ordering and bounded fades.
    for (let i = 0; i < 8; i++) {
      processor.receive({ type: 'noteOn', id: id++, ...voice, note: 48 + i * 3,
        at: (frame + (i < 4 ? 0 : 64)) / sampleRate, duration: 0.02,
        velocity: 0.8, pan: i % 2 ? 0.5 : -0.5 });
    }
    processor.process(inputs, outputs);
    frame += blockSize;
  };
  run.diagnostics = () => {
    if (!processor.synth) throw new Error('burst workload has no synth');
    return { errors: processor.synth.errorCount,
      activeVoices: processor.synth.voices.length, pendingEvents: processor.events.length, rejectedNotes };
  };
  return run;
}

const cases: [string, BenchmarkRun][] = [
  ['idle', realtime(0)],
  ['one voice + LFO', realtime(1)],
  ['eight voices + LFO', realtime(8)],
  ['eight voices, no LFO', realtime(8, steady)],
  ['burst noteOn + steal + event queue + render', burst()],
  ['prepared burst noteOn + steal + event queue + render', burst(true)],
];
const results = [];
let failed = false;
for (const [scenario, run] of cases) {
  for (let i = 0; i < warmup; i++) run();
  const measurements = new Float64Array(iterations);
  let missedDeadlines = 0;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    run();
    const elapsed = performance.now() - start;
    measurements[i] = elapsed;
    if (elapsed > deadlineMs) missedDeadlines++;
  }
  const diagnostics = run.diagnostics();
  if (diagnostics.errors !== 0 || diagnostics.rejectedNotes !== 0 || diagnostics.activeVoices > 8 ||
      diagnostics.pendingEvents > 256 || !left.every(Number.isFinite) || !right.every(Number.isFinite)) {
    throw new Error(`${scenario} produced invalid workload diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  measurements.sort();
  const percentile = (fraction: number) => measurements[Math.ceil(iterations * fraction) - 1]!;
  const p99Ms = percentile(0.99);
  const worstMs = measurements[iterations - 1]!;
  const passed = (p99BudgetRatio === null || p99Ms <= deadlineMs * p99BudgetRatio) &&
    (worstBudgetRatio === null || worstMs <= deadlineMs * worstBudgetRatio);
  if (!passed) failed = true;
  results.push({ scenario, measuredBlocks: iterations, medianMs: percentile(0.5),
    p95Ms: percentile(0.95), p99Ms, worstMs, p99DeadlineRatio: p99Ms / deadlineMs,
    worstDeadlineRatio: worstMs / deadlineMs, missedDeadlines, diagnostics, passedConfiguredBudgets: passed });
}
console.log(JSON.stringify({
  node: process.version, host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  sampleRate, blockSize, deadlineMs, warmupBlocksExcluded: warmup,
  budgets: { p99DeadlineRatio: p99BudgetRatio, worstDeadlineRatio: worstBudgetRatio },
  caveat: 'Host-dependent wall-clock measurements include scheduler/GC pauses; report-only unless a budget is explicitly configured. Not a realtime guarantee.',
  results,
}, null, 2));
if (failed) process.exitCode = 1;
