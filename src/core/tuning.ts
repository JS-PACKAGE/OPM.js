export interface TuningOptions { referenceHz?: number; offsets?: readonly number[] }
export interface NormalizedTuning { readonly referenceHz: number; readonly offsets: readonly number[] }

// A null-prototype array-like creates own elements, never reaching inherited indexed accessors.
const ZERO_OFFSETS: readonly number[] = Object.freeze(Array.from({ __proto__: null, length: 128 } as ArrayLike<number>, () => 0));
// Only frozen output tables may reuse validation; raw inputs are never registered.
const validatedOffsets = new WeakSet<readonly number[]>();
validatedOffsets.add(ZERO_OFFSETS);

/** Validate own data; detach raw cents tables and reuse only our frozen output tables. */
export function normalizeTuning(input: TuningOptions): NormalizedTuning {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError('tuning must be a plain object');
  }
  for (const key of Reflect.ownKeys(input)) {
    if (key !== 'referenceHz' && key !== 'offsets') throw new TypeError('tuning has an unknown field');
  }
  const referenceDescriptor = Object.getOwnPropertyDescriptor(input, 'referenceHz');
  if (referenceDescriptor !== undefined && !Object.hasOwn(referenceDescriptor, 'value')) {
    throw new TypeError('tuning.referenceHz must be data');
  }
  const referenceHz: unknown = referenceDescriptor === undefined ? 440 : referenceDescriptor.value;
  if (typeof referenceHz !== 'number' || !Number.isFinite(referenceHz) || referenceHz < 20 || referenceHz > 20000) {
    throw new RangeError('referenceHz must be finite and in 20..20000');
  }
  let offsets = ZERO_OFFSETS;
  const offsetsDescriptor = Object.getOwnPropertyDescriptor(input, 'offsets');
  if (offsetsDescriptor !== undefined) {
    if (!Object.hasOwn(offsetsDescriptor, 'value')) throw new TypeError('tuning.offsets must be data');
    const source: unknown = offsetsDescriptor.value;
    if (!Array.isArray(source)) {
      throw new TypeError('offsets must contain exactly 128 own data cents values');
    }
    const known = validatedOffsets.has(source);
    if (!known) {
      const length = Object.getOwnPropertyDescriptor(source, 'length');
      if (length === undefined || !Object.hasOwn(length, 'value') || length.value !== 128 ||
          Reflect.ownKeys(source).length !== 129) {
        throw new TypeError('offsets must contain exactly 128 own data cents values');
      }
    }
    // Identity membership guarantees immutable own cells; raw or merely frozen copies still detach.
    const copy: number[] = known ? source : [];
    if (!known) {
      // A null prototype keeps inherited indexed accessors out of these own-data writes.
      Object.setPrototypeOf(copy, null);
      for (let i = 0; i < 128; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('offsets must contain own data');
        const value: unknown = descriptor.value;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < -4800 || value > 4800) {
          throw new RangeError('offsets must be finite cents in -4800..4800');
        }
        copy[i] = value;
      }
      Object.setPrototypeOf(copy, Array.prototype);
    }
    offsets = known ? copy : Object.freeze(copy);
    if (!known) validatedOffsets.add(offsets);
  }
  return Object.freeze({ referenceHz, offsets });
}

/** Fractional MIDI notes interpolate cents, not frequencies, between adjacent keys. */
export function tuningFrequency(note: number, tuning: NormalizedTuning): number {
  if (!Number.isFinite(note) || note < 0 || note > 127) throw new RangeError('note must be finite and in 0..127');
  const lower = Math.floor(note);
  const upper = Math.min(127, lower + 1);
  const cents = tuning.offsets[lower] + (tuning.offsets[upper] - tuning.offsets[lower]) * (note - lower);
  return tuning.referenceHz * 2 ** ((note - 69) / 12 + cents / 1200);
}
