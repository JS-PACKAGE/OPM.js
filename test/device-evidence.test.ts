import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENTS, POLICIES, SCENARIOS, evaluateDeviceEvidence } from '../scripts/device-evidence-model.js';

// Synthetic shapes exercise the validator only; they are never evidence for the support matrix.
function run(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, scenario: 'lock-unlock', policy: 'cancel', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:02:00.000Z',
    durationSeconds: 120, environment: 'physical-ios-safari', device: 'Test phone', os: 'iOS 99', browser: 'Safari 99',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 99_0 like Mac OS X)', sampleRate: 48000, endSampleRate: 48000, endPolicy: 'cancel',
    manualJudgment: 'pass', acceptanceStatus: 'pass', listened: true, notes: '', observations: [], droppedObservations: 0, markers: [], ...overrides };
}
const report = (runs: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ format: 'opm-local-device-acceptance', version: 1, runs, ...extra });

test('only complete declared physical captures can fill a matrix cell, and the file cannot upgrade itself', () => {
  const summary = evaluateDeviceEvidence(report([run(1)], { coverage: 'ignored', evidence: 'ignored' }));
  assert.equal(summary.cells.length, ENVIRONMENTS.length * SCENARIOS.length * POLICIES.length);
  assert.equal(summary.counts.pass, 1);
  assert.equal(summary.complete, false);
  const lying = evaluateDeviceEvidence(report([run(1, { listened: false, acceptanceStatus: 'pass' })]));
  assert.equal(lying.counts.pass, 0);
  assert.match(lying.warnings[0]!, /differs from independently derived unverified/);
  for (const [override, reason] of [
    [{ endedAt: null }, /did not finish/], [{ environment: 'desktop-automation' }, /not a declared physical/],
    [{ endPolicy: 'preserve' }, /policy changed/], [{ sampleRate: null }, /sample rate missing/],
    [{ scenario: 'long-play', durationSeconds: 599 }, /600 seconds/], [{ device: '' }, /exact device/],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/1' }, /look like iOS/], [{ manualJudgment: 'fail', acceptanceStatus: 'fail' }, null],
  ] as [Record<string, unknown>, RegExp | null][]) {
    const result = evaluateDeviceEvidence(report([run(1, override)])).runResults[0]!;
    if (reason === null) assert.equal(result.status, 'fail');
    else {
      assert.equal(result.status, 'unverified');
      assert.match(result.reasons.join(';'), reason);
    }
  }
});

test('latest finished physical run represents a cell and unfinished retries never replace it', () => {
  const summary = evaluateDeviceEvidence(report([run(1), run(2, { manualJudgment: 'fail', acceptanceStatus: 'fail' }), run(3, { endedAt: null, manualJudgment: 'pass' })]));
  const cell = summary.cells.find(item => item.scenario === 'lock-unlock' && item.policy === 'cancel' && item.environment === 'physical-ios-safari')!;
  assert.deepEqual([cell.status, cell.runId], ['fail', 2]);
  // The 24-run export bound means a full 36-cell matrix needs separate files per device; the model still evaluates each file alone.
  const ios = ENVIRONMENTS[0];
  const partial = evaluateDeviceEvidence(report(SCENARIOS.slice(0, 12).map((scenario, index) => run(index + 1, { environment: ios, scenario, durationSeconds: 900 }))));
  assert.equal(partial.counts.pass, SCENARIOS.slice(0, 12).length);
  assert.equal(partial.complete, false);
  const android = evaluateDeviceEvidence(report([run(1, { environment: 'physical-android-chrome', userAgent: 'Mozilla/5.0 (Linux; Android 99) Chrome/99' })]));
  assert.equal(android.counts.pass, 1);
});

test('malformed, oversized, duplicate and unknown evidence is rejected rather than interpreted', () => {
  for (const bad of [
    '{', JSON.stringify({ format: 'other', version: 1, runs: [] }), JSON.stringify({ format: 'opm-local-device-acceptance', version: 2, runs: [] }),
    report([run(1), run(1)]), report([run(1, { scenario: 'unknown' })]), report([run(1, { policy: 'maybe' })]),
    report([run(1, { durationSeconds: -1 })]), report([run(1, { sampleRate: 5 })]), report([run(1, { notes: 'x'.repeat(1201) })]),
    report([run(1, { observations: Array.from({ length: 257 }, () => ({})) })]), report(Array.from({ length: 25 }, (_, i) => run(i + 1))),
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) assert.throws(() => evaluateDeviceEvidence(bad));
  assert.equal(evaluateDeviceEvidence(report([])).counts.unverified, 36);
});
