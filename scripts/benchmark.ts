import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { Synth } from '../src/core/index.js';
import { brass } from '../src/voices/brass.js';
import type { VoiceInput } from '../src/voices/schema.js';
import type { QualityProfile } from '../src/core/synth.js';
import type { OPMProcessor } from '../src/worklet/processor.js';
import { VERSION } from '../src/version.js';
import { capacityEligibility } from './benchmark-capacity.js';

interface Diagnostics { errors: number; activeVoices: number; pendingEvents: number; rejectedNotes: number; voiceLimit?: number }
interface BenchmarkRun { (): void; diagnostics(): Diagnostics; finiteOutput(): boolean }
interface Workload {
  kind: 'idle' | 'held-lfo' | 'held-no-lfo' | 'raw-burst' | 'prepared-burst' | 'independent-engines';
  path: 'core' | 'processor-node-shell';
  quality: QualityProfile;
  maxVoices: number;
  engineCount: number;
  voicesPerEngine: number;
  patchId: 'brass' | 'brass-no-lfo';
}
interface BenchmarkCase { scenario: string; run: BenchmarkRun; reportOnly?: boolean; workload: Workload }

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
const capacityP99Ratio = budgetSetting('OPM_BENCH_CAPACITY_P99_RATIO') ?? 0.5;
// Reuse the same policy validation before allocating or measuring workloads.
capacityEligibility({ p99Ms: 0, deadlineMs: 1, missedDeadlines: 0, diagnosticIssues: [], capacityApplicable: true }, capacityP99Ratio);
const blockSize = 128;
const deadlineMs = blockSize / sampleRate * 1000;
const left = new Float32Array(blockSize);
const right = new Float32Array(blockSize);
const steady = { ...brass, lfo: { rate: 0, amDepth: 0, pmDepth: 0 } };

function realtime(count: number, patch: VoiceInput = brass, quality: QualityProfile = 'standard', maxVoices = 8,
  outputLeft = left, outputRight = right): BenchmarkRun {
  const synth = new Synth(sampleRate, maxVoices, { quality });
  for (let i = 0; i < count; i++) synth.noteOn(patch, 48 + i * 3 % 60);
  const run = () => synth.render(outputLeft, outputRight);
  run.diagnostics = () => ({ errors: synth.errorCount, activeVoices: synth.voices.length, pendingEvents: 0, rejectedNotes: 0, voiceLimit: maxVoices });
  run.finiteOutput = () => outputLeft.every(Number.isFinite) && outputRight.every(Number.isFinite);
  return run;
}
/** Sequential core engines model combined DSP cost, not browser graph/AudioWorklet overhead. */
function engines(count: number, voices: number): BenchmarkRun {
  const runs = Array.from({ length: count }, () => realtime(voices, brass, 'standard', 8,
    new Float32Array(blockSize), new Float32Array(blockSize)));
  const run = () => { for (const item of runs) item(); };
  run.diagnostics = () => ({ errors: runs.reduce((sum, item) => sum + item.diagnostics().errors, 0),
    activeVoices: runs.reduce((sum, item) => sum + item.diagnostics().activeVoices, 0), pendingEvents: 0, rejectedNotes: 0, voiceLimit: count * 8 });
  run.finiteOutput = () => runs.every(item => item.finiteOutput());
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
    return { errors: processor.errorCount + processor.synth.errorCount,
      activeVoices: processor.synth.voices.length, pendingEvents: processor.events.length, rejectedNotes, voiceLimit: 8 };
  };
  run.finiteOutput = () => left.every(Number.isFinite) && right.every(Number.isFinite);
  return run;
}

function heldCase(scenario: string, count: number, quality: QualityProfile = 'standard', maxVoices = 8,
  reportOnly = false, noLfo = false): BenchmarkCase {
  return { scenario, run: realtime(count, noLfo ? steady : brass, quality, maxVoices), reportOnly,
    workload: { kind: count === 0 ? 'idle' : noLfo ? 'held-no-lfo' : 'held-lfo', path: 'core',
      quality, maxVoices, engineCount: 1, voicesPerEngine: count, patchId: noLfo ? 'brass-no-lfo' : 'brass' } };
}
const cases: BenchmarkCase[] = [
  heldCase('idle', 0),
  heldCase('one voice + LFO', 1),
  heldCase('eight voices + LFO', 8),
  heldCase('eight voices, no LFO', 8, 'standard', 8, false, true),
  ...[false, true].map((prepared): BenchmarkCase => ({
    scenario: `${prepared ? 'prepared ' : ''}burst noteOn + steal + event queue + render`, run: burst(prepared),
    workload: { kind: prepared ? 'prepared-burst' : 'raw-burst', path: 'processor-node-shell',
      quality: 'standard', maxVoices: 8, engineCount: 1, voicesPerEngine: 8, patchId: 'brass' },
  })),
  heldCase('quality comparison: eco, eight voices + LFO', 8, 'eco', 8, true),
  heldCase('quality comparison: standard, eight voices + LFO', 8, 'standard', 8, true),
  heldCase('quality comparison: high, eight voices + LFO', 8, 'high', 8, true),
  heldCase('opt-in logical polyphony: 16 voices + LFO', 16, 'standard', 16, true),
  heldCase('opt-in logical polyphony: 32 voices + LFO', 32, 'standard', 32, true),
  heldCase('opt-in logical polyphony: 32 voices, eco', 32, 'eco', 32, true),
  ...[2, 4].map((count): BenchmarkCase => ({
    scenario: `independent engines: ${count === 2 ? 'two' : 'four'} buses x eight voices`,
    run: engines(count, 8), reportOnly: true,
    workload: { kind: 'independent-engines', path: 'core', quality: 'standard', maxVoices: 8,
      engineCount: count, voicesPerEngine: 8, patchId: 'brass' },
  })),
];
// Full-occupancy rows measure each logical limit; historical baseline/gates above stay unchanged.
for (const quality of ['eco', 'standard', 'high'] as const) {
  for (const count of [1, 4, 8, 16, 32]) {
    cases.push(heldCase(`steady matrix: ${quality}, ${count} held voices + LFO`, count, quality, count, true));
  }
}
const results = [];
let failed = false;
for (const [caseIndex, { scenario, run, reportOnly = false, workload }] of cases.entries()) {
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
  const diagnosticIssues: string[] = [];
  if (diagnostics.errors !== 0) diagnosticIssues.push('DSP/processor errors');
  if (diagnostics.rejectedNotes !== 0) diagnosticIssues.push('note admission rejections');
  if (diagnostics.activeVoices > (diagnostics.voiceLimit ?? 8)) diagnosticIssues.push('logical voice limit exceeded');
  if (diagnostics.pendingEvents > 256) diagnosticIssues.push('pending event limit exceeded');
  if (workload.path === 'core' && diagnostics.activeVoices !== workload.voicesPerEngine * workload.engineCount) {
    diagnosticIssues.push('held workload occupancy mismatch');
  }
  if (!run.finiteOutput()) diagnosticIssues.push('nonfinite final PCM');
  // Invalid rows remain inspectable in the JSON while retaining a failing exit status.
  if (diagnosticIssues.length !== 0) failed = true;
  measurements.sort();
  const percentile = (fraction: number) => measurements[Math.ceil(iterations * fraction) - 1]!;
  const p99Ms = percentile(0.99);
  const worstMs = measurements[iterations - 1]!;
  const passed = reportOnly || (p99BudgetRatio === null || p99Ms <= deadlineMs * p99BudgetRatio) &&
    (worstBudgetRatio === null || worstMs <= deadlineMs * worstBudgetRatio);
  if (!passed) failed = true;
  const capacity = capacityEligibility({ p99Ms, deadlineMs, missedDeadlines, diagnosticIssues,
    capacityApplicable: workload.kind !== 'idle' }, capacityP99Ratio);
  results.push({ caseId: `case-${caseIndex + 1}`, scenario, workload, reportOnly, measuredBlocks: iterations,
    medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms, worstMs, p99DeadlineRatio: p99Ms / deadlineMs,
    worstDeadlineRatio: worstMs / deadlineMs, missedDeadlines, diagnostics, diagnosticIssues,
    passedConfiguredBudgets: passed, capacity });
}
console.log(JSON.stringify({
  version: VERSION,
  node: process.version, host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  sampleRate, blockSize, deadlineMs, warmupBlocksExcluded: warmup, measuredBlocksPerCase: iterations,
  budgets: { p99DeadlineRatio: p99BudgetRatio, worstDeadlineRatio: worstBudgetRatio },
  patches: { brass, 'brass-no-lfo': steady },
  workloadDefinitions: {
    'held-lfo': 'Held notes; note i uses MIDI 48 + (i * 3 % 60), default velocity/pan, no dispatch in measured loop.',
    'held-no-lfo': 'Same held notes with rate/amDepth/pmDepth all zero.',
    'raw-burst': 'Eight raw-patch starts per block, MIDI 48 + i * 3, four at offset 0 and four at 64; 20 ms gates, velocity 0.8, alternating pan +/-0.5; real processor receive/process in Node shell.',
    'prepared-burst': 'Same burst using one pre-registered immutable brass patch.',
    'independent-engines': 'Two/four independent standard eight-voice core engines render sequentially into separate preallocated stereo buffers; no Web Audio graph.',
  },
  capacityGuidance: {
    scope: 'Candidates for this Node host and each exact measured workload only; not portable capacity or realtime certification.',
    criteria: { maximumP99DeadlineRatio: capacityP99Ratio, minimumP99ReserveRatio: 1 - capacityP99Ratio,
      requiredMissedDeadlines: 0, requiredCleanDiagnostics: true, finitePCMCheck: 'final block of each engine' },
    candidates: results.filter(result => result.capacity.eligible).map(result => ({
      caseId: result.caseId, scenario: result.scenario, workload: result.workload,
      p99DeadlineRatio: result.p99DeadlineRatio, p99ReserveRatio: result.capacity.p99ReserveRatio,
      worstMs: result.worstMs, missedDeadlines: result.missedDeadlines,
    })),
    nextStep: 'Repeat measurements under representative host load; verify the chosen exact workload in its browser/effects graph and on physical target devices. Do not auto-change quality.',
  },
  caveat: 'Host-dependent Node wall-clock measurements include scheduler/GC pauses. DSP/processor timings are not AudioWorklet underrun counters or mobile acceptance. Configured CI budgets gate only historical baseline rows; capacity selection is separate. No realtime guarantee.',
  results,
}, null, 2));
if (failed) process.exitCode = 1;
