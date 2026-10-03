import { CommandRejectedError, OPM, createLookaheadScheduler, playSequence, streamSequence, createTransport, createPerformance, renderSequenceInWorker, createArrangement, createMidiAdapter, requestMidiAccess, quantizeBeat, swingBeat, swingBeatEvents, VERSION } from 'opm.js';
import type { Arrangement, ArrangementLayer, ArrangementGainOptions, MidiAdapter, MidiAccessLike, MidiControllerMapping, WorkerRenderPhaseStatus, TempoPoint } from 'opm.js';
import { copyAssets, checkDeployment } from 'opm.js/tools/assets.js';
import type { CommandEvent, CommandWaitOptions, NoteControls, OPMEvent, PitchEnvelope, VoiceInput, SequenceEvent, TuningOptions, SequenceStream, MusicalTransport, Performance, PerformanceNoteOffOptions } from 'opm.js';
import { Synth, renderNote, renderSequence, prepareLongSequence, estimateSequenceCapacity, renderSequenceChunks, normalizeTuning, tuningFrequency, lfoValue, encodeWav, createWavEncoder, beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat, envelopeAt, ALGORITHMS, normalizeVoice, prepareVoice, parseScoreProject, serializeScoreProject, compileBeatSequence } from 'opm.js/core';
import type { PreparedVoice, SequenceCapacity, ChunkedSequenceOptions, ChunkedSequenceRender, SequenceChunk, QualityProfile, WavFormat, WavEncoder, ScoreProject, BeatSequenceOptions } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
import { parseVoiceBank, validateVoice, bounded, LIMITS, MAX_BANK_BYTES, type FrozenVoice } from 'opm.js/voices/schema.js';
import { normalizeVoice as normalizeModule } from 'opm.js/voices/normalize.js';
import { importDX7, describeDX7, type DX7ImportDescription } from 'opm.js/voices/dx7.js';
import { examples } from 'opm.js/voices/examples.js';
import { voiceSchema } from 'opm.js/voices/voice.schema.js';
import { importMidiFile, exportMidiFile } from 'opm.js/midi-file';
import type { MidiImportResult, MidiExportOptions } from 'opm.js/midi-file';
import { parseArrangementProject, serializeArrangementProject } from 'opm.js';
import type { ArrangementProject, ArrangementDefinition, MidiFileLossSummary, MidiFileControlKind, MidiFilePreservedControl } from 'opm.js';

const patch: VoiceInput = {
  algorithm: 7, feedback: 0,
  version: 7,
  pitchEnvelope: { a: 0.01, d: 0.1, r: 0.2, initial: 0, peak: 100, sustain: 0, final: -100 },
  lfo: { rate: 5, amDepth: 0.1, pmDepth: 0.1, delay: 0.05, sync: 'global', phase: 0.25 },
  ops: [brass.ops[0], brass.ops[1], brass.ops[2], brass.ops[3]],
};
const normalized = normalizeModule(patch);
const finiteLevel: number = normalized.ops[0].level;
const complete: FrozenVoice = validateVoice(brass);
const bank: Map<string, FrozenVoice> = parseVoiceBank([brass]);
const synth = new Synth(48000, 8);
synth.onVoiceEnded = (id, reason) => {
  const terminal: 'stolen' | 'ended' | 'error' | 'cancelled' = reason;
  console.log(id, terminal);
};
const id: number = synth.noteOn(complete, 60.5, undefined, { velocity: 0.5, pan: -0.5 });
const prepared: PreparedVoice = prepareVoice(patch);
const controlledId = synth.noteOn(prepared, 60);
const controls: NoteControls = { pitch: 7, glide: 0.1, expression: 0.7, gain: 0.5, pan: 1, modulation: 0.5, ramp: 0.02,
  operatorLevels: [1, 0.5, 0.5, 1] };
const timbreControls: NoteControls = { feedback: 2.5, lfoRate: 4, amDepth: 0.2, pmDepth: 30,
  operatorRatios: [1, 2, 3, 4], operatorFrequencies: [null, 200, null, 400],
  operatorADSR: [brass.ops[0].adsr, brass.ops[1].adsr, brass.ops[2].adsr, brass.ops[3].adsr], ramp: 0.02 };
const quality: QualityProfile = 'eco';
const format: WavFormat = 'pcm24';
const encoder: WavEncoder = createWavEncoder({ sampleRate: 48000, channels: 2, format, totalFrames: 128 });
encoder.header();
encoder.encode({ left: new Float32Array(128), right: new Float32Array(128) });
encoder.finalize();
const seconds: number = beatsToSeconds(4, [{ beat: 0, bpm: 120 }, { beat: 2, bpm: 90 }]);
const beat: number = secondsToBeats(seconds, [{ beat: 0, bpm: 120 }, { beat: 2, bpm: 90 }]);
const musicalBeat: number = barBeatToBeat(beatToBarBeat(beat, { numerator: 6, denominator: 8 }), { numerator: 6, denominator: 8 });
void [timbreControls, quality, musicalBeat];
const changed: boolean = synth.updateNote(controlledId, controls);
const pitchEnvelope: PitchEnvelope | undefined = normalized.pitchEnvelope;
const left = new Float32Array(128), right = new Float32Array(128);
synth.render(left, right);
const released: boolean = synth.noteOff(id);
const stolen: number | null = synth.lastStolenId;
const audio = renderNote({ voice: complete, pan: 1 });
const wav: Uint8Array = encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate });
const mono: Uint8Array = encodeWav({ left: audio.samples, sampleRate: audio.sampleRate });
const tuning: TuningOptions = { referenceHz: 442, offsets: Array<number>(128).fill(0) };
const frequency: number = tuningFrequency(60.5, normalizeTuning(tuning));
const lfo: number = lfoValue(0.25, 'triangle');
const sequence: readonly SequenceEvent[] = [
  { type: 'note', id: 1, voice: brass, time: 0, note: 60.5, duration: 0.1 },
  { type: 'control', id: 1, time: 0.05, controls: { expression: 0.5, ramp: 0.01 } },
];
const sequenceAudio = renderSequence(sequence, { sampleRate: 48000, tuning, mixGain: 0.5, stealing: 'release-first' });
const chunkOptions: ChunkedSequenceOptions = { sampleRate: 96000, chunkFrames: 4096, maxFrames: 8_000_000 };
const longScore = prepareLongSequence([{ type: 'note', id: 1, time: 0, duration: 61, note: 60 }]);
const capacity: SequenceCapacity = estimateSequenceCapacity(longScore.events, chunkOptions);
const chunks: ChunkedSequenceRender = renderSequenceChunks(longScore.events, chunkOptions);
const next = chunks.next();
if (!next.done) {
  const chunk: SequenceChunk = next.value;
  const validFrames: number = chunk.frames;
  void validFrames;
}
chunks.cancel();
void capacity;
synth.setMixGain(0.5);
synth.setTuning(tuning);
synth.allNotesOff();
synth.panic();
const imports = importDX7(new Uint8Array(163));
const descriptions: DX7ImportDescription[] = describeDX7(new Uint8Array(163));
const carrier: number = ALGORITHMS[normalized.algorithm].carriers[0];
const gain: number = envelopeAt(0.1, 1, normalized.ops[0].adsr);
normalizeVoice(complete);
bounded(finiteLevel, ...LIMITS.level);

function observe(event: OPMEvent) {
  if (event.type === 'note') {
    const state: 'accepted' | 'started' | 'released' | 'ended' | 'stolen' | 'cancelled' | 'rejected' = event.state;
    const frame: number = event.frame;
    const time: number = event.time;
    console.log(event.id, state, event.reason, frame, time);
  } else if (event.type === 'diagnostics') console.log(event.pendingEvents, event.rejectedNotes);
  else if (event.type === 'error') { const error: Error = event.error; console.error(error); }
  else if (event.type === 'command') console.log(event.commandId, event.command, event.state, event.reason);
  else if (event.type === 'reset') console.log(event.reason);
  else console.log(event.state);
}
async function browserConsumer(context: AudioContext, destination: AudioNode) {
  const opm = new OPM({ context, destination: null, onEvent: observe, mixGain: 0.5, tuning,
    stealing: 'quietest', interruption: 'cancel', workletUrl: new URL('/opm/worklet/processor.js', location.href) });
  opm.loadVoice('custom', complete);
  opm.replaceVoiceBank([{ ...brass, name: 'custom' }]);
  const bankJSON: string = opm.exportVoiceBank();
  const removed: boolean = opm.removeVoice('unused');
  void [bankJSON, removed];
  const unsubscribe: () => void = opm.subscribe(observe);
  await opm.start();
  opm.connect(destination).disconnect(destination).connect(destination);
  const held: number = opm.playNote({ note: 64, velocity: 0.5, pan: -1 });
  opm.updateNote(held, controls, { at: context.currentTime + 0.1 });
  opm.stop(held, { at: context.currentTime + 0.2 });
  const absolute: number = opm.playNote({ note: 60, at: context.currentTime + 0.3, late: 'drop' });
  opm.stop(absolute);
  const playback = playSequence(opm, sequence, { at: context.currentTime + 0.1 });
  const sequenceIds: ReadonlyMap<number, number> = playback.ids;
  playback.stop();
  const mixCommand: number = opm.setMixGain(0.25);
  const tuningCommand: number = opm.setTuning(tuning);
  const releaseCommand: number = opm.allNotesOff();
  const panicCommand: number = opm.panic();
  const waitOptions: CommandWaitOptions = { timeout: 2000, signal: new AbortController().signal };
  const acknowledgement: CommandEvent = await opm.waitForCommand(panicCommand, waitOptions);
  const admissionError = new CommandRejectedError({ ...acknowledgement, state: 'rejected', reason: 'capacity' });
  const reason: string | undefined = admissionError.event.reason;
  const stream: SequenceStream = streamSequence(opm, sequence, { horizon: 0.2, interval: 0.025, onError: console.error });
  await stream.start();
  stream.stop();
  stream.dispose();
  const transport: MusicalTransport = createTransport(opm, [{ type: 'note', id: 1, beat: 0, duration: 4, note: 60 }],
    { bpm: 120, startupLead: 0.05, tempoMap: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 90 }], timeSignature: { numerator: 4, denominator: 4 } });
  await transport.start();
  transport.pause();
  transport.seek(2);
  transport.setTempo(100);
  transport.setLoop({ enabled: true, from: 0, to: 4 });
  await transport.resume();
  const position: number = transport.position;
  transport.dispose();
  const performance: Performance = createPerformance(opm);
  performance.configurePart(0, { voice: 'custom', mode: 'mono', legato: true, priority: 'high', glide: 0.05 });
  const physicalKey: number = performance.noteOn(0, 60, { velocity: 0.7 });
  performance.sustain(0, true);
  performance.noteOff(0, physicalKey);
  performance.sustain(0, false);
  performance.updatePart(0, { expression: 0.5 });
  performance.allNotesOff(0);
  performance.dispose();
  await renderSequenceInWorker(sequence, { format: 'float32', quality: 'eco', sink: { write: bytes => { console.log(bytes.byteLength); } },
    onProgress: progress => console.log(progress.frames, progress.totalFrames), signal: new AbortController().signal });
  void position;
  void reason;
  void [sequenceIds, mixCommand, tuningCommand, releaseCommand, panicCommand];
  const voices: ReadonlyMap<string, VoiceInput> = opm.voices;
  const scheduler = createLookaheadScheduler(opm, ({ from, to, maxNotes }) => {
    console.log(to, maxNotes);
    return [{ note: 60, at: from, duration: 0.1 }];
  }, { onError: console.error });
  await scheduler.start();
  scheduler.stop();
  scheduler.dispose();
  void voices;
  opm.stop(held);
  await opm.resume();
  const diagnostics = await opm.getDiagnostics();
  const errors: number = diagnostics.errors;
  await opm.close();
  unsubscribe();
  await opm.dispose();
  return errors;
}

// Invalid public contracts must remain type errors, not silently become any.
// @ts-expect-error duration does not accept strings
new OPM().playNote({ note: 60, duration: 'held' });
// @ts-expect-error exactly four operators are required
normalizeVoice({ algorithm: 0, feedback: 0, ops: [brass.ops[0]] });
// @ts-expect-error legacy voices cannot add v2 key scaling
const legacyOperator: VoiceInput = { version: 1, algorithm: 7, feedback: 0, ops: [{ ...brass.ops[0], keyScale: { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 6 } }, brass.ops[1], brass.ops[2], brass.ops[3]] };
// @ts-expect-error WAV PCM uses Float32Array, not arbitrary arrays
encodeWav({ left: [0, 1], sampleRate: 44100 });
// @ts-expect-error DX7 parser consumes binary bytes
importDX7('not binary');
// @ts-expect-error prepared identity is opaque
const forged: PreparedVoice = normalized;
// @ts-expect-error controls are numeric, not strings
synth.updateNote(id, { expression: 'loud' });
// @ts-expect-error unsupported lateness policy
new OPM().playNote({ note: 60, at: 1, late: 'retry' });
// @ts-expect-error relative and absolute scheduling are mutually exclusive
new OPM().playNote({ note: 60, at: 1, time: 0 });
// @ts-expect-error named voice maps are read-only snapshots
new OPM().voices.set('bypass', normalized);
// @ts-expect-error listener must accept OPM events, not arbitrary strings
new OPM().subscribe((event: string) => console.log(event));
// @ts-expect-error worklet module options accept only a URL or string
new OPM({ workletUrl: {} });
// @ts-expect-error operatorLevels requires exactly four numeric entries
synth.updateNote(id, { operatorLevels: [1, 1, 1] });
// @ts-expect-error cumulative render budgets are numeric
renderSequenceChunks(sequence, { maxFrames: 'unbounded' });
void [bank, released, stolen, wav, mono, imports, descriptions, carrier, gain, browserConsumer, legacyOperator, changed, forged];

// Published classes remain structural contracts, without implementation state.
declare const opmAdapter: Pick<OPM, 'sampleRate' | 'quality' | 'maxVoices' | 'voices' | 'context' | 'node' |
  'loadVoice' | 'replaceVoiceBank' | 'removeVoice' | 'exportVoiceBank' | 'start' | 'resume' | 'connect' | 'disconnect' | 'playNote' | 'stop' | 'updateNote' |
  'allNotesOff' | 'panic' | 'setMixGain' | 'setTuning' | 'getDiagnostics' | 'subscribe' | 'waitForCommand' | 'close' | 'dispose'>;
const compatibleOPM: OPM = opmAdapter;
declare const synthAdapter: Pick<Synth, 'sampleRate' | 'quality' | 'maxVoices' | 'currentFrame' | 'errorCount' |
  'lastStolenId' | 'noteOn' | 'noteOff' | 'updateNote' | 'allNotesOff' | 'panic' | 'setMixGain' | 'setTuning' | 'render'>;
const compatibleSynth: Synth = synthAdapter;
const literalBankLimit: 262144 = MAX_BANK_BYTES;
void [compatibleOPM, compatibleSynth, literalBankLimit];
const bundledBank: Map<string, FrozenVoice> = parseVoiceBank(examples);
const schemaVersion: number = voiceSchema.properties.version.const;
void [bundledBank, schemaVersion];
void [frequency, lfo, sequenceAudio, pitchEnvelope];

// 1.8 surfaces: voice priority, adaptive arrangement, expressive Performance, optional MIDI and asset tooling.
const prioritized = new OPM({ maxVoices: 32 }).playNote({ note: 60, voicePriority: 100 });
const wideSynth = new Synth(48000, 32);
wideSynth.noteOn(complete, 60, undefined, { voicePriority: 5 });
const adaptiveLayer: ArrangementLayer = { name: 'pad', length: 16, gain: 0.5, voicePriority: 10, events: [{ type: 'note', id: 1, beat: 0, duration: 16, note: 48, voicePriority: 3 }] };
declare const adaptiveOPM: OPM;
const adaptive: Arrangement = createArrangement(adaptiveOPM, { layers: [adaptiveLayer], sections: [{ name: 'explore', layers: ['pad'] }], initialSection: 'explore' });
const boundary: number = adaptive.switchSection('explore', { quantize: 'bar', preserveNotes: true, fade: 0.25 });
const rampMap: TempoPoint[] = [{ beat: 0, bpm: 90, curve: 'linear', endBpm: 110 }, { beat: 8, bpm: 120 }];
const gridded: number = quantizeBeat(1.2, 0.5, 'next') + swingBeat(0.5, 0.5, 0.6) + beatsToSeconds(4, rampMap);
declare const performanceHost: ReturnType<typeof createPerformance>;
performanceHost.configurePart(0, { voice: 'brass', voiceLimit: 4, voicePriority: 9 });
const keyUpdated: boolean = performanceHost.updateKey(0, 1, { feedback: 3, operatorRatios: [1, 2, 3, 4] });
performanceHost.updatePartNotes(0, { modulation: 1.5 });
declare const midiAccess: MidiAccessLike;
const midiAdapter: MidiAdapter = createMidiAdapter(performanceHost, midiAccess, { parts: 2, pitchBendRange: 7 });
const midiPromise: Promise<MidiAccessLike> = requestMidiAccess();
const phaseCallback = (status: WorkerRenderPhaseStatus) => status.phase;
const workerOptions = { sink: { write() {} }, startupTimeoutMs: 5000, phaseDiagnostics: true, onPhase: phaseCallback };
const assetResult = copyAssets({ destination: 'public/opm-1.8.0' }).then(deployment => deployment.reused);
const assetCheck = checkDeployment('https://example.test/opm/', { timeoutMs: 5000 }).then(check => check.files);
void [prioritized, wideSynth, adaptive, boundary, gridded, keyUpdated, midiAdapter, midiPromise, workerOptions, renderSequenceInWorker, assetResult, assetCheck, swingBeatEvents, VERSION];

// Unreleased checkout: exact layer gain, explicit controller mapping and independent SMF adapter.
const fadeOptions: ArrangementGainOptions = { quantize: 'beat', fade: 0.1 };
const gainBoundary: number = adaptive.setLayerGain('pad', 0.2, fadeOptions);
const controllerMapping: MidiControllerMapping = { controller: 74, field: 'feedback', min: 0, max: 7, ramp: 0.02 };
const mappedMidi: MidiAdapter = createMidiAdapter(performanceHost, midiAccess, { controllerMap: [controllerMapping] });
const partControls: Readonly<NoteControls> = performanceHost.getPartControls(0);
const midiExportOptions: MidiExportOptions = { format: 1, ppqn: 480, tempoMap: [{ beat: 0, bpm: 120 }] };
const midiFile: Uint8Array = exportMidiFile([{ type: 'note', id: 1, beat: 0, duration: 1, note: 60, voice: 'brass' }], midiExportOptions);
const importedMidi: MidiImportResult = importMidiFile(midiFile, { channelVoices: { '0': 'brass' }, unsupported: 'warn' });
void [gainBoundary, mappedMidi, partControls, importedMidi];
const scoreProject: ScoreProject = parseScoreProject({ version: 1, voices: { brass }, events: [{ type: 'note', id: 1, beat: 0, duration: 1, note: 60, voice: 'brass' }] });
const projectJson: string = serializeScoreProject(scoreProject);
const beatOptions: BeatSequenceOptions = { tempoMap: scoreProject.tempoMap, voices: new Map(Object.entries(scoreProject.voices)) };
const compiledBeats: SequenceEvent[] = compileBeatSequence(scoreProject.events, beatOptions);
void [projectJson, compiledBeats];
const forceRelease: PerformanceNoteOffOptions = { force: true };
const forcedKeyReleased: boolean = performanceHost.noteOff(0, 1, forceRelease);
void forcedKeyReleased;
// @ts-expect-error voice priority is numeric
new OPM().playNote({ note: 60, voicePriority: 'high' });
// @ts-expect-error ramp curves are limited to step and linear
const badCurve: TempoPoint = { beat: 0, bpm: 90, curve: 'smooth' };
// @ts-expect-error per-key controls cannot use string values
performanceHost.updateKey(0, 1, { feedback: 'strong' });
void badCurve;

const arrangementDefinition: ArrangementDefinition = {
  layers: [{ name: 'lead', length: 4, gain: 0.5, events: [{ type: 'note', id: 1, beat: 0, duration: 1, voice: 'brass', note: 60 }] }],
  sections: [{ name: 'intro', layers: ['lead'] }], initialSection: 'intro',
};
const portableArrangement: ArrangementProject = parseArrangementProject({ version: 1, voices: { brass }, ...arrangementDefinition });
const arrangementJSON: string = serializeArrangementProject(portableArrangement);
const restoredDefinition = {
  layers: portableArrangement.layers, sections: portableArrangement.sections, initialSection: portableArrangement.initialSection,
  tempoMap: portableArrangement.tempoMap, timeSignature: portableArrangement.timeSignature,
};
const restoredArrangement: Arrangement = createArrangement(adaptiveOPM, restoredDefinition);
const expressiveFile: Uint8Array = exportMidiFile(importedMidi.events, { controls: 'preserve', pitchBendRange: 2 });
const expressiveImport: MidiImportResult = importMidiFile(expressiveFile, { controls: 'preserve', pitchBendRange: 2 });
const lossSummary: Readonly<MidiFileLossSummary> = expressiveImport.lossSummary;
const preservedKind: MidiFileControlKind = 'pitch-bend';
const preservedControl: MidiFilePreservedControl = { kind: preservedKind, count: 1 };
void [arrangementJSON, restoredArrangement, lossSummary, preservedControl];
