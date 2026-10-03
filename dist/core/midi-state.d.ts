/** Program/drum note numbers 0..127 mapped to named FM voices. */
export type MidiVoiceMap = Readonly<Record<number, string>> | ReadonlyMap<number, string>;
export declare function midiVoiceName(value: unknown): string;
export declare function midiVoiceMap(input: unknown): ReadonlyMap<number, string>;
export interface MidiRpnState {
    msb: number;
    lsb: number;
    semitones: number;
    cents: number;
    range: number;
}
export declare function midiRpnState(range: number): MidiRpnState;
/** Selection wins over CC mappings; data entry wins only while RPN 0 is selected. */
export declare function midiRpnControl(state: MidiRpnState, controller: number, value: number): boolean;
