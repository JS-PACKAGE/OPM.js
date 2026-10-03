/** Program/drum note numbers 0..127 mapped to named FM voices. */
export type MidiVoiceMap = Readonly<Record<number, string>> | ReadonlyMap<number, string>;

export function midiVoiceName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new TypeError('MIDI voice must be a named voice');
  return value;
}

export function midiVoiceMap(input: unknown): ReadonlyMap<number, string> {
  const result = new Map<number, string>();
  if (input === undefined) return result;
  function add(key: unknown, value: unknown): void {
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key > 127) throw new RangeError('MIDI voice mapping keys must be integers in 0..127');
    result.set(key, midiVoiceName(value));
  }
  if (input !== null && typeof input === 'object' && Object.getPrototypeOf(input) === Map.prototype) {
    const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(input) as number;
    if (size > 128) throw new RangeError('MIDI voice mapping exceeds 128 entries');
    if (Reflect.ownKeys(input).length !== 0) throw new TypeError('MIDI voice Map must not have own properties');
    for (const [key, value] of Map.prototype.entries.call(input) as MapIterator<[unknown, unknown]>) add(key, value);
    return result;
  }
  if (input === null || typeof input !== 'object' || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError('MIDI voice mapping must be a plain data object or native Map');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > 128) throw new RangeError('MIDI voice mapping exceeds 128 entries');
  for (const key of keys) {
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]{0,2})$/.test(key)) throw new TypeError('Invalid MIDI voice mapping key');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('MIDI voice mapping must contain own data');
    add(Number(key), descriptor.value);
  }
  return result;
}

export interface MidiRpnState { msb: number; lsb: number; semitones: number; cents: number; range: number }
export function midiRpnState(range: number): MidiRpnState {
  return { msb: 127, lsb: 127, semitones: Math.floor(range), cents: (range % 1) * 100, range };
}
/** Selection wins over CC mappings; data entry wins only while RPN 0 is selected. */
export function midiRpnControl(state: MidiRpnState, controller: number, value: number): boolean {
  if (controller === 101) { state.msb = value; return true; }
  if (controller === 100) { state.lsb = value; return true; }
  if (controller === 98 || controller === 99) { state.msb = 127; state.lsb = 127; return false; }
  if (state.msb !== 0 || state.lsb !== 0 || controller !== 6 && controller !== 38) return false;
  if (controller === 6) state.semitones = Math.min(48, value);
  else state.cents = Math.min(99, value);
  state.range = Math.min(48, state.semitones + state.cents / 100);
  return true;
}
