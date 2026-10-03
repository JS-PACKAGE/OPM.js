import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityEligibility } from '../scripts/benchmark-capacity.js';

const clean = { p99Ms: 1, deadlineMs: 2, missedDeadlines: 0, diagnosticIssues: [], capacityApplicable: true };

test('capacity selection includes the reserve boundary but rejects a stricter configured threshold', () => {
  assert.equal(capacityEligibility(clean).eligible, true);
  assert.equal(capacityEligibility(clean).p99ReserveRatio, 0.5);
  assert.equal(capacityEligibility(clean, 0.4).eligible, false);
  assert.equal(capacityEligibility({ ...clean, p99Ms: 1.000001 }).eligible, false);
  for (const ratio of [0, -1, 0.500001, NaN, Infinity]) {
    assert.throws(() => capacityEligibility(clean, ratio), RangeError);
  }
});

test('good p99 alone cannot hide misses, diagnostics or idle capacity', () => {
  assert.equal(capacityEligibility({ ...clean, missedDeadlines: 1 }).eligible, false);
  const dirty = capacityEligibility({ ...clean, diagnosticIssues: ['DSP errors', 'nonfinite final PCM'] });
  assert.equal(dirty.eligible, false);
  assert.deepEqual(dirty.reasons, ['diagnostics: DSP errors', 'diagnostics: nonfinite final PCM']);
  assert.equal(capacityEligibility({ ...clean, capacityApplicable: false }).eligible, false);
});

test('invalid observations remain explicitly ineligible rather than serializing a misleading reserve', () => {
  for (const p99Ms of [NaN, Infinity, -1]) {
    const result = capacityEligibility({ ...clean, p99Ms });
    assert.equal(result.eligible, false);
    assert.equal(result.p99ReserveRatio, null);
  }
  for (const deadlineMs of [0, -1, Infinity, NaN]) {
    assert.equal(capacityEligibility({ ...clean, deadlineMs }).eligible, false);
  }
  for (const missedDeadlines of [-1, 0.5, NaN]) {
    assert.equal(capacityEligibility({ ...clean, missedDeadlines }).eligible, false);
  }
});
