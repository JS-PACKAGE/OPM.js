export type WavFormat = 'pcm16' | 'pcm24' | 'float32';
export interface WavOptions {
    left: Float32Array;
    right?: Float32Array;
    sampleRate: number;
    format?: WavFormat;
}
export interface WavEncoderOptions {
    sampleRate: number;
    channels: 1 | 2;
    format?: WavFormat;
    totalFrames: number;
}
export interface WavChunk {
    left: Float32Array;
    right?: Float32Array;
}
export interface WavEncoder {
    readonly totalFrames: number;
    readonly framesEncoded: number;
    /** Entire file length, including the header and any RIFF alignment byte. */
    readonly byteLength: number;
    readonly finished: boolean;
    /** Emit exactly once, before encoding PCM. */
    header(): Uint8Array;
    /** Atomic accounting: invalid chunks never consume frames. Maximum65536 frames per call. */
    encode(chunk: WavChunk): Uint8Array;
    /** Require exact totalFrames; returns the RIFF alignment byte, or an empty array. */
    finalize(): Uint8Array;
}
/** Streaming RIFF32 output with known length; retains no PCM or emitted bytes. */
export declare function createWavEncoder(options: WavEncoderOptions): WavEncoder;
/** Full-buffer WAV convenience export; defaultPCM16, at most4000000 frames. */
export declare function encodeWav(input: WavOptions): Uint8Array;
