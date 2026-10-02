// Original parameter recipes, not downloaded patches. Layout: Yamaha DX7 manual
// pp. 30–31 (VCED) and DX7II manual Add-11 (VMEM).
export interface SyntheticDX7Fixture {
  id: string;
  label: string;
  purpose: string;
  bytes: Uint8Array;
}

function payload(name: string, algorithm: number): Uint8Array {
  const data = new Uint8Array(155);
  for (let number = 1; number <= 6; number++) {
    data.set([99, 72, 65, 82, 99, 85, 70, 0, 39, 0, 0, 0, 0, 0, 0, 0,
      78, 0, number === 1 ? 1 : number, 0, 7], (6 - number) * 21);
  }
  data.set([99, 99, 99, 99, 50, 50, 50, 50, algorithm - 1, 0, 1,
    0, 0, 0, 0, 1, 0, 0, 24], 126);
  for (let n = 0; n < 10; n++) data[145 + n] = n < name.length ? name.charCodeAt(n) : 32;
  return data;
}

function setOperator(data: Uint8Array, number: number, parameter: number, value: number): void {
  data[(6 - number) * 21 + parameter] = value;
}

function frame(data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 8);
  bytes.set([0xf0, 0x43, 0, data.length === 155 ? 0 : 9, data.length >> 7, data.length & 127]);
  bytes.set(data, 6);
  let sum = 0;
  for (const value of data) sum += value;
  bytes[bytes.length - 2] = (-sum) & 127;
  bytes[bytes.length - 1] = 0xf7;
  return bytes;
}

function pack(data: Uint8Array): Uint8Array {
  const packed = new Uint8Array(128);
  for (let slot = 0; slot < 6; slot++) {
    const at = slot * 21;
    const target = slot * 17;
    packed.set(data.subarray(at, at + 11), target);
    packed[target + 11] = data[at + 11] | (data[at + 12] << 2);
    packed[target + 12] = data[at + 13] | (data[at + 20] << 3);
    packed[target + 13] = data[at + 14] | (data[at + 15] << 2);
    packed[target + 14] = data[at + 16];
    packed[target + 15] = data[at + 17] | (data[at + 18] << 1);
    packed[target + 16] = data[at + 19];
  }
  packed.set(data.subarray(126, 134), 102);
  packed[110] = data[134];
  packed[111] = data[135] | (data[136] << 3);
  packed.set(data.subarray(137, 141), 112);
  packed[116] = data[141] | (data[142] << 1) | (data[143] << 4);
  packed[117] = data[144];
  packed.set(data.subarray(145, 155), 118);
  return packed;
}

/** Fresh valid-checksum dumps on each call; safe for callers to mutate independently. */
export function syntheticDX7Fixtures(): SyntheticDX7Fixture[] {
  const paired = payload('PAIR LAB', 5);
  setOperator(paired, 1, 16, 96);
  setOperator(paired, 3, 16, 88);
  setOperator(paired, 5, 16, 80);
  const carriers = payload('SIX SINES', 32);
  for (let number = 1; number <= 6; number++) setOperator(carriers, number, 16, 99 - (number - 1) * 7);
  const fixed = payload('FIXED LAB', 32);
  for (let number = 2; number <= 6; number++) setOperator(fixed, number, 16, 0);
  setOperator(fixed, 1, 16, 99);
  setOperator(fixed, 1, 17, 1);
  setOperator(fixed, 1, 18, 2);
  setOperator(fixed, 1, 19, 42); // 263 Hz: close to MIDI60, intentionally not exact.
  const velocity = payload('VEL LAB', 16);
  setOperator(velocity, 1, 16, 96);
  setOperator(velocity, 2, 16, 92);
  setOperator(velocity, 2, 15, 7);
  setOperator(velocity, 2, 18, 2);
  for (let number = 3; number <= 6; number++) setOperator(velocity, number, 16, 0);
  const bank = new Uint8Array(4096);
  const packed = pack(paired);
  for (let index = 0; index < 32; index++) bank.set(packed, index * 128);
  return [
    { id: 'dx7_pairs', label: 'DX7: three paired carriers (algorithm 5)',
      purpose: 'Three source carriers compete for four slots; some modulation is dropped.', bytes: frame(paired) },
    { id: 'dx7_carriers', label: 'DX7: six additive carriers (algorithm 32)',
      purpose: 'Six carriers reduce to the four loudest. Compare missing upper partials.', bytes: frame(carriers) },
    { id: 'dx7_fixed', label: 'DX7: fixed-frequency carrier',
      purpose: 'A fixed 263 Hz source becomes a MIDI-60 ratio: low/high notes track the keyboard, unlike a DX7.', bytes: frame(fixed) },
    { id: 'dx7_velocity', label: 'DX7: velocity-sensitive modulator',
      purpose: 'Operator velocity is a dB attenuation heuristic, not Yamaha response curves. Compare soft/hard brightness.', bytes: frame(velocity) },
    { id: 'dx7_bank', label: 'DX7: packed bank of paired-carrier recipe',
      purpose: '32 identical original recipes in packed VMEM layout; first voice should match the single dump.', bytes: frame(bank) },
  ];
}
