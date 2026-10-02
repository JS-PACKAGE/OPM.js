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
  readonly suggestedPolyphony: number;
  readonly designRationale: string;
  /** Authoring intent and numerical checks are not a listener verdict. */
  readonly listeningStatus: 'unverified';
}

function entry(family: PresetMetadata['family'], intendedMidi: readonly [number, number], hostTrimDb: number,
  purpose: string, source = 'src/voices/original.ts', suggestedPolyphony = 4,
  designRationale = purpose, intendedVelocity: readonly [number, number] = [0.25, 1]): PresetMetadata {
  return Object.freeze({ family, intendedMidi: Object.freeze(intendedMidi), intendedVelocity: Object.freeze(intendedVelocity),
    hostTrimDb, purpose, suggestedPolyphony, designRationale, listeningStatus: 'unverified',
    provenance: Object.freeze({ kind: source === 'src/voices/original.ts' ? 'original-recipe' : 'repository-recipe',
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
  tide_keys: entry('keys', [48, 84], -9, 'Decaying chord keys with a stable fundamental and moving upper pair.',
    'src/voices/original.ts', 4, 'AM only on the second carrier creates a gentle upper-register pulse. PM on modulators changes brightness without vibrato on either carrier; velocity-sensitive, key-scaled modulators soften hard high notes. Try short chords, medium velocity, and leave release headroom.', [0.25, 0.9]),
  ember_bass: entry('bass', [36, 60], -9, 'Articulated bass with an unmodulated fundamental/sub pair.',
    'src/voices/original.ts', 1, 'AM on modulators moves sideband strength, not the bass floor; PM only on the upper modulator adds motion while fundamental and sub remain stable. Short modulator decay exposes a sustained low body. Use monophonic lines and moderate velocity.', [0.35, 0.9]),
  orbit_pad: entry('pad', [48, 76], -12, 'Slow harmonic pad with asymmetric spectral and amplitude movement.',
    'src/voices/original.ts', 3, 'Shallow AM on the lower carrier preserves the body while stronger upper-pair motion changes color. PM stays on modulators; detuned carriers provide width without LFO pitch wobble. Key-scaled upper modulation limits brightness in higher chords. Allow the attack to develop and release tails to clear.', [0.25, 0.8]),
});

/** The separate default brass export is not the bank brass recipe. */
export const defaultBrassMetadata = entry('brass', [48, 76], -6, 'Default paired brass with vibrato.', 'src/voices/brass.ts');
