import test from 'node:test';
import assert from 'node:assert/strict';
import { FM_INDEX, FM_ORDER, FM_REFERENCE_RATES, besselJ, besselTailBound } from './fm-reference-fixtures.js';
import { verifyPMSpectrum } from './fm-reference-quality.js';
import { verifyLongStream } from './fm-reference-streaming.js';
import { verifyFeedbackSpectrum } from './fm-reference-feedback.js';
import { verifyFourOperator } from './fm-reference-four-operator.js';
import { verifyDecimator } from './decimator-quality.js';

test('independent Bessel expansion reconstructs continuous high-index phase modulation', () => {
  const coefficients = Array.from({ length: FM_ORDER * 2 + 1 }, (_, i) => besselJ(i - FM_ORDER, FM_INDEX));
  let energy = 0;
  for (const coefficient of coefficients) energy += coefficient * coefficient;
  assert.ok(Math.abs(energy - 1) < 1e-11, 'Bessel Parseval identity accounts for all source power');
  assert.ok(besselTailBound(FM_INDEX, FM_ORDER) < 1e-16);
  for (let i = 0; i < 37; i++) {
    const phase = 2 * Math.PI * i / 37, carrierPhase = 0.37;
    let reconstructed = 0;
    for (let n = -FM_ORDER; n <= FM_ORDER; n++) {
      reconstructed += coefficients[n + FM_ORDER] * Math.sin(carrierPhase + n * phase);
    }
    assert.ok(Math.abs(reconstructed - Math.sin(carrierPhase + FM_INDEX * Math.sin(phase))) < 1e-11,
      'sideband magnitudes and alternating signs follow the continuous PM identity');
  }
});

for (const sampleRate of FM_REFERENCE_RATES) {
  test(`${sampleRate} Hz high-index PM matches independent sidebands, brightness loss and folded-product bounds`, () => {
    verifyPMSpectrum(sampleRate);
  });
  test(`${sampleRate} Hz feedback7 matches a contractive delayed reference and full-level spectral-energy bounds`, () => {
    verifyFeedbackSpectrum(sampleRate);
  });
  test(`${sampleRate} Hz four-operator chain, branch and multicarrier equations preserve routing and envelope transitions`, () => {
    verifyFourOperator(sampleRate);
  });
  test(`${sampleRate} Hz flatter decimator preserves folded-alias rejection, phase and causal latency`, () => {
    verifyDecimator(sampleRate);
  });
}

test('two-minute held/LFO and repeated interrupted glides stream deterministically, settle and terminate', () => {
  verifyLongStream();
});
