export interface WavOptions {
    left: Float32Array;
    right?: Float32Array;
    sampleRate: number;
}
/** PCM16 little-endian RIFF/WAVE, mono if right is omitted, stereo otherwise. */
export declare function encodeWav(input: WavOptions): Uint8Array;
