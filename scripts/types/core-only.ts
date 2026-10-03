// A Node offline consumer must not require Web Audio or any DOM declarations.
import { parseScoreProject, serializeScoreProject, compileBeatSequence, renderSequence, encodeWav } from 'opm.js/core';
import type { BeatSequenceEvent, SequenceEvent, ScoreProject } from 'opm.js/core';
import { importMidiFile, exportMidiFile } from 'opm.js/midi-file';
import { brass } from 'opm.js/voices/brass.js';

const beats: BeatSequenceEvent[] = [{ type: 'note', id: 1, voice: 'brass', note: 60, beat: 0, duration: 1 }];
const midi: Uint8Array = exportMidiFile(beats, { voiceChannels: { brass: 0 } });
const imported = importMidiFile(midi, { defaultVoice: 'brass' });
const project: ScoreProject = parseScoreProject({
  version: 1, events: imported.events, tempoMap: imported.tempoMap,
  timeSignature: imported.timeSignature, voices: { brass },
});
const voices = new Map(Object.entries(project.voices));
const events: SequenceEvent[] = compileBeatSequence(project.events, { tempoMap: project.tempoMap, voices });
const audio = renderSequence(events, { ...project.settings, voices });
const wav: Uint8Array = encodeWav({ left: audio.left, right: audio.right, sampleRate: project.settings.sampleRate, format: 'pcm16' });
const saved: string = serializeScoreProject(project);
console.log(wav.byteLength, saved);
