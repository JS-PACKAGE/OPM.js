import { CommandRejectedError, OPM, createLookaheadScheduler, playSequence, streamSequence } from 'opm.js';
import type { CommandEvent, CommandWaitOptions, NoteControls, OPMEvent, PitchEnvelope, VoiceInput, SequenceEvent, TuningOptions, SequenceStream } from 'opm.js';
import { Synth, renderNote, renderSequence, prepareLongSequence, estimateSequenceCapacity, renderSequenceChunks, normalizeTuning, tuningFrequency, lfoValue, encodeWav, envelopeAt, ALGORITHMS, normalizeVoice, prepareVoice } from 'opm.js/core';
import type { PreparedVoice, SequenceCapacity, ChunkedSequenceOptions, ChunkedSequenceRender, SequenceChunk } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
import { parseVoiceBank, validateVoice, bounded, LIMITS, MAX_BANK_BYTES, type FrozenVoice } from 'opm.js/voices/schema.js';
import { normalizeVoice as normalizeModule } from 'opm.js/voices/normalize.js';
import { importDX7, describeDX7, type DX7ImportDescription } from 'opm.js/voices/dx7.js';
import { examples } from 'opm.js/voices/examples.js';
import { voiceSchema } from 'opm.js/voices/voice.schema.js';

const patch: VoiceInput = {
  algorithm: 7, feedback: 0,
  version: 5,
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
const controls: NoteControls = { pitch: 7, glide: 0.1, expression: 0.7, pan: 1, modulation: 0.5, ramp: 0.02,
  operatorLevels: [1, 0.5, 0.5, 1] };
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
declare const opmAdapter: Pick<OPM, 'sampleRate' | 'voices' | 'context' | 'node' |
  'loadVoice' | 'start' | 'resume' | 'connect' | 'disconnect' | 'playNote' | 'stop' | 'updateNote' |
  'allNotesOff' | 'panic' | 'setMixGain' | 'setTuning' | 'getDiagnostics' | 'subscribe' | 'waitForCommand' | 'close' | 'dispose'>;
const compatibleOPM: OPM = opmAdapter;
declare const synthAdapter: Pick<Synth, 'sampleRate' | 'maxVoices' | 'currentFrame' | 'errorCount' |
  'lastStolenId' | 'noteOn' | 'noteOff' | 'updateNote' | 'allNotesOff' | 'panic' | 'setMixGain' | 'setTuning' | 'render'>;
const compatibleSynth: Synth = synthAdapter;
const literalBankLimit: 262144 = MAX_BANK_BYTES;
void [compatibleOPM, compatibleSynth, literalBankLimit];
const bundledBank: Map<string, FrozenVoice> = parseVoiceBank(examples);
const schemaVersion: number = voiceSchema.properties.version.const;
void [bundledBank, schemaVersion];
void [frequency, lfo, sequenceAudio, pitchEnvelope];
