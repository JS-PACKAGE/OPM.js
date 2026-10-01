import { OPM, type OPMEvent, type VoiceInput } from 'opm.js';
import { Synth, renderNote, encodeWav, envelopeAt, ALGORITHMS, normalizeVoice } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
import { parseVoiceBank, validateVoice, bounded, LIMITS, type FrozenVoice } from 'opm.js/voices/schema.js';
import { normalizeVoice as normalizeModule } from 'opm.js/voices/normalize.js';
import { importDX7, describeDX7, type DX7ImportDescription } from 'opm.js/voices/dx7.js';

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
    console.log(event.id, state, event.reason);
  } else if (event.type === 'diagnostics') console.log(event.pendingEvents, event.rejectedNotes);
  else { const error: Error = event.error; console.error(error); }
}
async function browserConsumer(context: AudioContext, destination: AudioNode) {
  const opm = new OPM({ context, destination: null, onEvent: observe });
  opm.loadVoice('custom', complete);
  await opm.start();
  opm.connect(destination).disconnect(destination).connect(destination);
  const held: number = opm.playNote({ note: 64, velocity: 0.5, pan: -1 });
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
void [bank, released, stolen, wav, mono, imports, descriptions, carrier, gain, browserConsumer, legacyOperator];
