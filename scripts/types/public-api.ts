import { OPM, createLookaheadScheduler, type NoteControls, type OPMEvent, type VoiceInput } from 'opm.js';
import { Synth, renderNote, encodeWav, envelopeAt, ALGORITHMS, normalizeVoice, prepareVoice, type PreparedVoice } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
import { parseVoiceBank, validateVoice, bounded, LIMITS, MAX_BANK_BYTES, type FrozenVoice } from 'opm.js/voices/schema.js';
import { normalizeVoice as normalizeModule } from 'opm.js/voices/normalize.js';
import { importDX7, describeDX7, type DX7ImportDescription } from 'opm.js/voices/dx7.js';
import { examples } from 'opm.js/voices/examples.js';
import { voiceSchema } from 'opm.js/voices/voice.schema.js';

const patch: VoiceInput = {
  algorithm: 7, feedback: 0,
  ops: [brass.ops[0], brass.ops[1], brass.ops[2], brass.ops[3]],
};
const normalized = normalizeModule(patch);
const finiteLevel: number = normalized.ops[0].level;
const complete: FrozenVoice = validateVoice(brass);
const bank: Map<string, FrozenVoice> = parseVoiceBank([brass]);
const synth = new Synth(48000, 8);
synth.onVoiceEnded = (id, reason) => {
  const terminal: 'stolen' | 'ended' | 'error' = reason;
  console.log(id, terminal);
};
const id: number = synth.noteOn(complete, 60.5, undefined, { velocity: 0.5, pan: -0.5 });
const prepared: PreparedVoice = prepareVoice(patch);
const controlledId = synth.noteOn(prepared, 60);
const controls: NoteControls = { pitch: 7, glide: 0.1, expression: 0.7, pan: 1, modulation: 0.5 };
const changed: boolean = synth.updateNote(controlledId, controls);
const left = new Float32Array(128), right = new Float32Array(128);
synth.render(left, right);
const released: boolean = synth.noteOff(id);
const stolen: number | null = synth.lastStolenId;
const audio = renderNote({ voice: complete, pan: 1 });
const wav: Uint8Array = encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate });
const mono: Uint8Array = encodeWav({ left: audio.samples, sampleRate: audio.sampleRate });
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
  else { const error: Error = event.error; console.error(error); }
}
async function browserConsumer(context: AudioContext, destination: AudioNode) {
  const opm = new OPM({ context, destination: null, onEvent: observe });
  opm.loadVoice('custom', complete);
  await opm.start();
  opm.connect(destination).disconnect(destination).connect(destination);
  const held: number = opm.playNote({ note: 64, velocity: 0.5, pan: -1 });
  opm.updateNote(held, controls, { at: context.currentTime + 0.1 });
  opm.stop(held, { at: context.currentTime + 0.2 });
  const absolute: number = opm.playNote({ note: 60, at: context.currentTime + 0.3, late: 'drop' });
  opm.stop(absolute);
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
void [bank, released, stolen, wav, mono, imports, descriptions, carrier, gain, browserConsumer, legacyOperator, changed, forged];

// Published classes remain structural contracts, without implementation state.
declare const opmAdapter: Pick<OPM, 'sampleRate' | 'voices' | 'context' | 'node' |
  'loadVoice' | 'start' | 'resume' | 'connect' | 'disconnect' | 'playNote' | 'stop' | 'updateNote' | 'getDiagnostics' | 'close'>;
const compatibleOPM: OPM = opmAdapter;
declare const synthAdapter: Pick<Synth, 'sampleRate' | 'maxVoices' | 'currentFrame' | 'errorCount' |
  'lastStolenId' | 'noteOn' | 'noteOff' | 'updateNote' | 'render'>;
const compatibleSynth: Synth = synthAdapter;
const literalBankLimit: 262144 = MAX_BANK_BYTES;
void [compatibleOPM, compatibleSynth, literalBankLimit];
const bundledBank: Map<string, FrozenVoice> = parseVoiceBank(examples);
const schemaVersion: number = voiceSchema.properties.version.const;
void [bundledBank, schemaVersion];
