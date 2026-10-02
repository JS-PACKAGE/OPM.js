export interface PresetMetadata {
  readonly family: 'bell' | 'brass' | 'bass' | 'keys' | 'organ' | 'lead' | 'strings' | 'mallet' | 'pluck' | 'reed' | 'pad' | 'metallic' | 'percussion' | 'inharmonic';
  readonly provenance: {
    readonly kind: 'repository-recipe' | 'original-recipe';
    readonly source: string;
    readonly license: 'Apache-2.0';
    readonly copiedEmulatorPatch: false;
  };
  readonly intendedMidi: readonly [number, number];
  readonly intendedVelocity: readonly [number, number];
  /** Extra attenuation before the common audition gain; never an operator-level compensation. */
  readonly hostTrimDb: number;
  readonly purpose: string;
}

function entry(family: PresetMetadata['family'], intendedMidi: readonly [number, number], hostTrimDb: number,
  purpose: string, source = 'src/voices/original.ts'): PresetMetadata {
  return Object.freeze({ family, intendedMidi: Object.freeze(intendedMidi), intendedVelocity: Object.freeze([0.25, 1] as const),
    hostTrimDb, purpose, provenance: Object.freeze({ kind: source === 'src/voices/original.ts' ? 'original-recipe' : 'repository-recipe',
      source, license: 'Apache-2.0', copiedEmulatorPatch: false }) });
}

// Keep curation outside the strict voice schema. Numerical trims are starting points,
// not listening results; use the fresh report and pair-specific matching for comparisons.
export const presetMetadata: Readonly<Record<string, PresetMetadata>> = Object.freeze({
  bell: entry('bell', [48, 84], -6, 'Two decaying inharmonic PM pairs.', 'src/voices/examples.ts'),
  brass: entry('brass', [48, 76], -6, 'Feedback-rich articulated stack.', 'src/voices/examples.ts'),
  bass: entry('bass', [36, 60], -6, 'Short low-register serial PM.', 'src/voices/examples.ts'),
  electric_piano: entry('keys', [48, 84], -6, 'Decaying paired carriers with key-scaled high partials.', 'src/voices/examples.ts'),
  organ: entry('organ', [48, 84], -6, 'Sustained additive drawbar-like ratios.', 'src/voices/examples.ts'),
  lead: entry('lead', [48, 84], -6, 'Sustained serial PM with pitch vibrato.', 'src/voices/examples.ts'),
  strings: entry('strings', [48, 84], -6, 'Slow detuned paired carriers.', 'src/voices/examples.ts'),
  wood_mallet: entry('mallet', [48, 84], -6, 'Fast high-partial decay; higher notes shorten through rate key scaling.'),
  glass_pluck: entry('pluck', [48, 84], -6, 'Velocity-brightened transient above a decaying fundamental.'),
  hollow_reed: entry('reed', [48, 76], -6, 'Even-ratio modulation emphasizes odd harmonics; delayed vibrato.'),
  slow_air_pad: entry('pad', [48, 76], -6, 'Slow detuned onset, shallow pitch envelope and globally synchronized modulation.'),
  bronze_plate: entry('metallic', [48, 72], -6, 'Noninteger ratios and unequal decays; pitched metallic strike, not a cymbal model.'),
  membrane_tom: entry('percussion', [36, 60], -6, 'Short body with a falling pitch transient; not an acoustic drum simulation.'),
  fixed_hz_chime: entry('inharmonic', [48, 84], -6, '317/523/829/1237 Hz additive partials do not transpose with MIDI keys.'),
  wire_kalimba: entry('pluck', [48, 84], -6, 'Key-tracking body with a fixed-Hz transient modulator.'),
});

/** The separate default brass export is not the bank brass recipe. */
export const defaultBrassMetadata = entry('brass', [48, 76], -6, 'Default paired brass with vibrato.', 'src/voices/brass.ts');
