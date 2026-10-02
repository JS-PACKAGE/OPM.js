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
export declare const presetMetadata: Readonly<Record<string, PresetMetadata>>;
/** The separate default brass export is not the bank brass recipe. */
export declare const defaultBrassMetadata: PresetMetadata;
