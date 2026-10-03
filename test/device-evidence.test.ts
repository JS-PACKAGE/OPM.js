import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ENVIRONMENTS, POLICIES, SCENARIOS, evaluateDeviceEvidence, evaluateDeviceEvidenceFiles } from '../scripts/device-evidence-model.js';

// Synthetic validator inputs only: none of these records are stored physical evidence.
function run(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const startedAt = String(overrides.startedAt ?? new Date(Date.UTC(2026, 0, 1) + id * 1000).toISOString());
  const durationSeconds = Number(overrides.durationSeconds ?? 120);
  return { id, scenario: 'lock-unlock', policy: 'cancel', startedAt,
    endedAt: new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString(), durationSeconds,
    environment: 'physical-ios-safari', device: 'Test phone', os: 'iOS 99', browser: 'Safari 99',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 99_0 like Mac OS X)', sampleRate: 48000, endSampleRate: 48000, endPolicy: 'cancel',
    packageVersion: '1.8.0', loadProfile: { revision: 'synthetic-test-only', synth: { quality: 'standard', maxVoices: 8 } },
    manualJudgment: 'pass', acceptanceStatus: 'pass', listened: true, notes: '', observations: [], droppedObservations: 0, markers: [], ...overrides };
}
const report = (runs: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ format: 'opm-local-device-acceptance', version: 1, runs, ...extra });
const android = { environment: 'physical-android-chrome', device: 'Other test phone', os: 'Android 99', browser: 'Chrome 99', userAgent: 'Mozilla/5.0 (Linux; Android 99) Chrome/99' };
function matrix(overrides: Record<string, unknown> = {}): Record<string, unknown>[] {
  return SCENARIOS.flatMap((scenario, index) => POLICIES.map((policy, p) => run(index * 2 + p + 1,
    { ...overrides, scenario, policy, endPolicy: policy, durationSeconds: scenario === 'long-play' ? 900 : 120 })));
}

test('single-file statuses are rederived, and declared coverage cannot upgrade a capture', () => {
  const summary = evaluateDeviceEvidence(report([run(1)], { coverage: 'ignored', evidence: 'ignored' }));
  assert.equal(summary.cells.length, ENVIRONMENTS.length * SCENARIOS.length * POLICIES.length);
  assert.equal(summary.counts.pass, 1);
  assert.equal(summary.complete, false);
  const lying = evaluateDeviceEvidence(report([run(1, { listened: false })]));
  assert.equal(lying.counts.pass, 0);
  assert.match(lying.warnings.join(';'), /differs from independently derived unverified/);
  for (const [override, reason] of [
    [{ endedAt: null }, /did not finish/], [{ environment: 'desktop-automation' }, /not a declared physical/],
    [{ endPolicy: 'preserve' }, /policy changed/], [{ sampleRate: null }, /sample rate missing/],
    [{ scenario: 'long-play', durationSeconds: 599 }, /600 seconds/], [{ device: '' }, /exact device/],
    [{ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/1' }, /look like iOS/], [{ loadProfile: null }, /setup did not finish/],
  ] as [Record<string, unknown>, RegExp][]) {
    const result = evaluateDeviceEvidence(report([run(1, override)])).runResults[0]!;
    assert.equal(result.status, 'unverified');
    assert.match(result.reasons.join(';'), reason);
  }
  assert.equal(evaluateDeviceEvidence(report([run(1, { manualJudgment: 'fail', acceptanceStatus: 'fail' })])).counts.fail, 1);
});

test('two 18-run files collectively cover 36 cells with exact filename and run identities', () => {
  const inputs = [{ file: 'ios.json', source: report(matrix()) }, { file: 'android.json', source: report(matrix(android)) }];
  const summary = evaluateDeviceEvidenceFiles(inputs);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.counts, { pass: 36, fail: 0, unverified: 0 });
  assert.equal(summary.groups.length, 4);
  assert.equal(summary.campaigns.length, 1);
  assert.equal(summary.runs, 36);
  assert.equal(summary.uniqueRuns, 36);
  assert.ok(summary.cells.every(cell => cell.groupId && cell.sources.length === 1 && /^sha256:[a-f0-9]{64}$/.test(cell.sources[0]!.identity)));
  assert.deepEqual(new Set(summary.cells.flatMap(cell => cell.sources.map(source => source.file))), new Set(['ios.json', 'android.json']));
  assert.deepEqual(evaluateDeviceEvidenceFiles([...inputs].reverse()).cells, summary.cells);
});

test('versions, load profiles, model, OS, browser and sample rates never stitch fragmented scopes', () => {
  for (const differing of [{ packageVersion: '1.7.0' }, { loadProfile: { revision: 'different-workload', quality: 'high' } }]) {
    const summary = evaluateDeviceEvidenceFiles([{ file: 'ios.json', source: report(matrix()) }, { file: 'android.json', source: report(matrix({ ...android, ...differing })) }]);
    assert.equal(summary.complete, false);
    assert.equal(summary.campaigns.length, 2);
    assert.match(summary.warnings.join(';'), /separate campaigns/);
  }
  for (const differing of [{ device: 'Second test phone' }, { os: 'iOS 100' }, { browser: 'Safari 100' }, { sampleRate: 44100, endSampleRate: 44100 }]) {
    const ios = matrix().map((item, i) => i < 8 ? item : { ...item, ...differing });
    const summary = evaluateDeviceEvidenceFiles([{ file: 'ios.json', source: report(ios) }, { file: 'android.json', source: report(matrix(android)) }]);
    assert.equal(summary.complete, false);
    assert.equal(summary.groups.length, 6);
    assert.ok(summary.groups.filter(group => group.scope.environment === 'physical-ios-safari').every(group => !group.complete));
  }
});

test('legacy v1 exports remain reviewable but cannot claim recorded version/workload compatibility', () => {
  const legacy = matrix().map(({ packageVersion: _version, loadProfile: _profile, ...item }) => item);
  const summary = evaluateDeviceEvidenceFiles([{ file: 'legacy-ios.json', source: report(legacy) }, { file: 'android.json', source: report(matrix(android)) }]);
  assert.equal(evaluateDeviceEvidence(report(legacy)).counts.pass, 18);
  assert.equal(summary.complete, false);
  assert.match(summary.warnings.join(';'), /unrecorded.*recapture/);
  assert.equal(summary.campaigns.find(campaign => campaign.packageVersion === null)!.metadataRecorded, false);
});

test('latest finished timestamps, not file order or run ID, select the scoped result', () => {
  const newer = run(1, { startedAt: '2026-02-01T00:00:00.000Z', manualJudgment: 'fail', acceptanceStatus: 'fail' });
  const older = run(99, { startedAt: '2026-01-01T00:00:00.000Z' });
  const unfinished = run(100, { startedAt: '2026-03-01T00:00:00.000Z', endedAt: null });
  for (const files of [
    [{ file: 'new.json', source: report([newer]) }, { file: 'old.json', source: report([older, unfinished]) }],
    [{ file: 'old.json', source: report([unfinished, older]) }, { file: 'new.json', source: report([newer]) }],
  ]) {
    const cell = evaluateDeviceEvidenceFiles(files).cells.find(item => item.scenario === 'lock-unlock' && item.policy === 'cancel' && item.environment === ENVIRONMENTS[0])!;
    assert.deepEqual([cell.status, cell.runId, cell.sources[0]!.file], ['fail', 1, 'new.json']);
  }
});

test('duplicate originals do not inflate coverage; conflicting identities and equal-time judgments remain unverified', () => {
  const source = report([run(1)]);
  const copies = evaluateDeviceEvidenceFiles([{ file: 'original.json', source }, { file: 'copy.json', source }]);
  assert.equal(copies.uniqueRuns, 1);
  assert.equal(copies.counts.pass, 1);
  assert.equal(copies.cells.find(cell => cell.runId !== null)!.sources.length, 2);
  for (const id of [1, 2]) {
    const conflict = evaluateDeviceEvidenceFiles([{ file: 'pass.json', source }, { file: 'fail.json', source: report([run(id,
      { startedAt: '2026-01-01T00:00:01.000Z', manualJudgment: 'fail', acceptanceStatus: 'fail' })]) }]);
    assert.equal(conflict.counts.pass, 0);
    assert.equal(conflict.counts.fail, 0);
    assert.match(conflict.warnings.join(';'), /conflicting/);
  }
});

test('impossible duration/start/end and marker contradictions cannot earn passing long play', () => {
  for (const overrides of [
    { endedAt: '2026-01-01T00:00:00.000Z' },
    { scenario: 'long-play', durationSeconds: 900, endedAt: '2026-01-01T00:02:01.000Z' },
    { markers: [{ elapsedSeconds: 999, wallTime: '2026-01-01T00:02:00.000Z' }] },
  ]) {
    const result = evaluateDeviceEvidence(report([run(1, overrides)])).runResults[0]!;
    assert.equal(result.status, 'unverified');
    assert.match(result.reasons.join(';'), /precedes|contradicts|exceeds/);
  }
  assert.equal(evaluateDeviceEvidence(report([run(1, { durationSeconds: 120.1, endedAt: '2026-01-01T00:02:01.000Z' })])).counts.pass, 1);
});

test('malformed, oversized, duplicate IDs, unknown metadata and out-of-bounds own JSON are rejected', () => {
  for (const bad of [
    '{', JSON.stringify({ format: 'other', version: 1, runs: [] }), JSON.stringify({ format: 'opm-local-device-acceptance', version: 2, runs: [] }),
    report([run(1), run(1)]), report([run(1, { scenario: 'unknown' })]), report([run(1, { policy: 'maybe' })]),
    report([run(1, { durationSeconds: -1 })]), report([run(1, { sampleRate: 5 })]), report([run(1, { notes: 'x'.repeat(1201) })]),
    report([run(1, { startedAt: '2026-02-30T00:00:00.000Z' })]), report([run(1, { packageVersion: 'latest' })]),
    report([run(1, { packageVersion: '1.8.0-01' })]), report([run(1, { packageVersion: '1.8.0+' })]),
    report([run(1, { loadProfile: {} })]), report([run(1, { droppedObservations: -1 })]), report([run(1, { observations: [null] })]),
    report([run(1, { loadProfile: { values: Array(129).fill(0) } })]), report([run(1, { markers: [{ elapsedSeconds: -1 }] })]),
    report([run(1, { observations: [{ note: 'x'.repeat(241) }] })]), report([run(1, { observations: [{ values: Array(33).fill(0) }] })]),
    report([run(1, { observations: [{ a: { b: { c: { d: {} } } } }] })]),
    report([run(1, { observations: Array.from({ length: 257 }, () => ({})) })]), report(Array.from({ length: 25 }, (_, i) => run(i + 1))),
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) assert.throws(() => evaluateDeviceEvidence(bad));
  assert.throws(() => evaluateDeviceEvidenceFiles([]));
  assert.throws(() => evaluateDeviceEvidenceFiles(Array.from({ length: 17 }, (_, i) => ({ file: `${i}.json`, source: report([]) }))));
  assert.throws(() => evaluateDeviceEvidenceFiles([{ file: 'same.json', source: report([]) }, { file: 'same.json', source: report([]) }]));
  assert.equal(evaluateDeviceEvidence(report([])).counts.unverified, 36);
});

test('CLI --require-complete evaluates supplied files collectively and exports separate review JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opm-device-validator-'));
  try {
    const ios = join(directory, 'ios.json'), phone = join(directory, 'android.json');
    await writeFile(ios, report(matrix()));
    await writeFile(phone, report(matrix(android)));
    const cli = fileURLToPath(new URL('../scripts/device-evidence.js', import.meta.url));
    const complete = spawnSync(process.execPath, [cli, '--require-complete', ios, phone], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(complete.status, 0, complete.stderr);
    const review: unknown = JSON.parse(complete.stdout);
    assert.ok(review !== null && typeof review === 'object' && 'schema' in review && 'complete' in review && 'counts' in review);
    assert.ok(review.counts !== null && typeof review.counts === 'object' && 'pass' in review.counts);
    assert.equal(review.schema, 'opm-device-evidence-review-1');
    assert.equal(review.complete, true);
    assert.equal(review.counts.pass, 36);
    const incomplete = spawnSync(process.execPath, [cli, '--require-complete', ios], { encoding: 'utf8' });
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stderr, /Collective review is incomplete/);
    const incompleteReview: unknown = JSON.parse(incomplete.stdout);
    assert.ok(incompleteReview !== null && typeof incompleteReview === 'object' && 'complete' in incompleteReview);
    assert.equal(incompleteReview.complete, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
