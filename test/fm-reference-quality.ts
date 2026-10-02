import assert from 'node:assert/strict';
import { HEADROOM, Synth } from '../src/core/index.js';
import type { QualityProfile } from '../src/core/decimator.js';
import {
  COEFFICIENT_TOLERANCE, FM_LEVEL, FM_ORDER, besselTailBound, energyDb, fourierBin,
  pmFixtures, pmVoice, referenceSidebands, unsaturatedWindow,
} from './fm-reference-fixtures.js';

export function verifyPMSpectrum(sampleRate: number, quality: QualityProfile = 'standard') {
  return pmFixtures(sampleRate).map(fixture => {
    const synth = new Synth(sampleRate, 8, { quality });
    synth.noteOn(pmVoice(fixture), 69); // 440 Hz keeps even the slow modulator above the 0.125 ratio minimum.
    const offset = Math.ceil(sampleRate / 4);
    const samples = new Float32Array(offset + sampleRate);
    const right = new Float32Array(samples.length);
    synth.render(samples, right);
    assert.equal(synth.errorCount, 0);
    assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) < HEADROOM));
    const window = unsaturatedWindow(samples, HEADROOM, offset, sampleRate);
    const normalization = HEADROOM * FM_LEVEL;
    const reference = referenceSidebands(fixture, sampleRate, quality);
    const bins = new Set(reference.map(row => row.binHz));
    assert.equal(bins.size, reference.length, 'fixture sidebands and folded products must not collide');
    assert.ok(reference.every(row => row.binHz > 0 && row.binHz < sampleRate / 2));
    const tailBound = besselTailBound(fixture.index, FM_ORDER);
    assert.ok(tailBound < COEFFICIENT_TOLERANCE / 1000, 'unmeasured mathematical tail is negligible');

    let idealPassbandEnergy = 0, expectedPassbandEnergy = 0, measuredPassbandEnergy = 0;
    let idealAliasEnergy = 0, expectedAliasEnergy = 0, measuredAliasEnergy = 0, aliasEnergyBound = 0;
    let maximumCoefficientError = 0;
    const sidebands = reference.map(row => {
      const measured = fourierBin(window, sampleRate, row.binHz).amplitude / normalization;
      const error = Math.abs(measured - row.expected);
      maximumCoefficientError = Math.max(maximumCoefficientError, error);
      assert.ok(error <= COEFFICIENT_TOLERANCE + tailBound,
        `${sampleRate} ${fixture.name} n=${row.order} ${row.sourceHz}->${row.binHz} Hz: ` +
        `normalized ${measured}, Bessel/filter ${row.expected}, error ${error}`);
      if (row.alias) {
        idealAliasEnergy += row.coefficient ** 2;
        expectedAliasEnergy += row.expected ** 2;
        measuredAliasEnergy += measured ** 2;
        aliasEnergyBound += (row.expected + COEFFICIENT_TOLERANCE + tailBound) ** 2;
      } else {
        idealPassbandEnergy += row.coefficient ** 2;
        expectedPassbandEnergy += row.expected ** 2;
        measuredPassbandEnergy += measured ** 2;
      }
      return { order: row.order, sourceHz: row.sourceHz, binHz: row.binHz, alias: row.alias,
        unfilteredMagnitude: Math.abs(row.coefficient), expected: row.expected, measured, error };
    });
    assert.ok(measuredAliasEnergy <= aliasEnergyBound, 'alias energy obeys the independently derived filter budget');

    // Neighbor bins are mathematically empty; sideband-only checks would miss
    // a noisy oscillator, a noncoherent clock or extra algorithm connections.
    const guards = reference.filter(row => Math.abs(row.order) <= 1).map(row => {
      let binHz = row.binHz + 1;
      while (bins.has(binHz)) binHz++;
      const measured = fourierBin(window, sampleRate, binHz).amplitude / normalization;
      assert.ok(measured < COEFFICIENT_TOLERANCE + tailBound,
        `${sampleRate} ${fixture.name}: unexpected neighboring ${binHz} Hz energy ${measured}`);
      return { binHz, measured };
    });
    return {
      sampleRate, quality, fixture: fixture.name, index: fixture.index,
      carrierHz: fixture.carrierHz, modulatorHz: fixture.modulatorHz,
      coherentWindowFrames: sampleRate, settledFramesSkipped: offset,
      coefficientTolerance: COEFFICIENT_TOLERANCE, maximumCoefficientError, omittedTailAmplitudeBound: tailBound,
      passband: {
        idealEnergy: idealPassbandEnergy, expectedEnergy: expectedPassbandEnergy, measuredEnergy: measuredPassbandEnergy,
        expectedBrightnessLossDb: energyDb(expectedPassbandEnergy, idealPassbandEnergy),
        measuredBrightnessLossDb: energyDb(measuredPassbandEnergy, idealPassbandEnergy),
      },
      aliases: {
        idealUltrasonicEnergy: idealAliasEnergy, expectedFoldedEnergy: expectedAliasEnergy,
        measuredFoldedEnergy: measuredAliasEnergy, acceptedFoldedEnergyBound: aliasEnergyBound,
        expectedRejectionDb: energyDb(expectedAliasEnergy, idealAliasEnergy),
        measuredRejectionDb: energyDb(measuredAliasEnergy, idealAliasEnergy),
        measuredRelativeToFilteredPassbandDb: energyDb(measuredAliasEnergy, measuredPassbandEnergy),
      },
      sidebands: sidebands.filter(row => row.unfilteredMagnitude >= 1e-4), guards,
    };
  });
}
