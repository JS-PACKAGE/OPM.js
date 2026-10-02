import { renderNote, encodeWav } from '../src/core/index.js';
import { examples } from '../src/voices/examples.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import type { FrozenVoice } from '../src/voices/schema.js';

const selector = document.querySelector<HTMLSelectElement>('#voice')!;
const pitch = document.querySelector<HTMLInputElement>('#pitch')!;
const duration = document.querySelector<HTMLInputElement>('#duration')!;
const sampleRate = document.querySelector<HTMLSelectElement>('#sample-rate')!;
const render = document.querySelector<HTMLButtonElement>('#render')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
const result = document.querySelector<HTMLOutputElement>('#render-result')!;
const diagnostics = document.querySelector<HTMLOutputElement>('#diagnostics-state')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
let bank: Map<string, FrozenVoice> | null = null;
let resultURL: string | null = null;

function releaseDownload(): void {
  download.hidden = true;
  download.removeAttribute('href');
  download.removeAttribute('download');
  if (resultURL !== null) URL.revokeObjectURL(resultURL);
  resultURL = null;
}

try {
  bank = parseVoiceBank(examples);
  for (const [name] of bank) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selector.append(option);
  }
  selector.value = 'brass';
  render.disabled = false;
  status.textContent = 'Voice bank validated. Click Synthesize and create WAV to render real offline audio.';
} catch (error) {
  status.textContent = `Voice loading failed: ${error instanceof Error ? error.message : String(error)}`;
}

render.addEventListener('click', () => {
  render.disabled = true;
  releaseDownload();
  result.textContent = 'Current render not completed';
  diagnostics.textContent = 'Current render not completed';
  try {
    const voice = bank?.get(selector.value);
    if (!voice) throw new Error('Choose a valid voice from the bank.');
    if (!pitch.reportValidity() || !duration.reportValidity()) {
      throw new RangeError('Enter an integer MIDI pitch from 0 to 127 and a duration from 0.1 to 3 seconds.');
    }
    const note = pitch.valueAsNumber;
    const gateSeconds = duration.valueAsNumber;
    const rate = Number(sampleRate.value);
    if (!Number.isInteger(note) || note < 0 || note > 127) {
      throw new RangeError('MIDI pitch must be an integer from 0 to 127.');
    }
    if (!Number.isFinite(gateSeconds) || gateSeconds < 0.1 || gateSeconds > 3) {
      throw new RangeError('Duration must be between 0.1 and 3 seconds.');
    }
    if (![22050, 44100, 48000].includes(rate)) throw new RangeError('Choose a valid sample rate.');

    const audio = renderNote({ voice, note, duration: gateSeconds, sampleRate: rate });
    // encodeWav accepts only these PCM fields, not the full RenderResult object.
    const bytes = encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate });
    // encodeWav allocates a native ArrayBuffer-backed Uint8Array; no PCM copy is needed.
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
    resultURL = URL.createObjectURL(blob);
    download.href = resultURL;
    download.download = `${voice.name}-midi${note}-${rate}Hz.wav`;
    download.hidden = false;
    const frames = audio.left.length;
    result.textContent = `${frames} frames/channel; 2 channels; ${audio.sampleRate} Hz; note duration ${gateSeconds} s; total length ${frames} / ${audio.sampleRate} = ${(frames / audio.sampleRate).toFixed(6)} s (including tail); PCM16 WAV ${bytes.byteLength} bytes.`;
    diagnostics.textContent = `DSP errors: ${audio.diagnostics.errors}.`;
    status.textContent = `Synthesized ${voice.name}, MIDI ${note}, offline. Download ready; no audio file was played or read.`;
  } catch (error) {
    releaseDownload();
    status.textContent = `Render failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    render.disabled = bank === null;
  }
});

window.addEventListener('pagehide', releaseDownload);
