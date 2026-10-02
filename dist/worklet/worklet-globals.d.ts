export {};
declare global {
    abstract class AudioWorkletProcessor {
        constructor(options?: AudioWorkletNodeOptions);
        readonly port: MessagePort;
        abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
    }
    const sampleRate: number;
    const currentFrame: number;
    function registerProcessor(name: string, processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;
}
