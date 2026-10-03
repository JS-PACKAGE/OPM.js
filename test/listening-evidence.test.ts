import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluateListeningEvidence, evaluateListeningEvidenceFiles } from '../scripts/listening-evidence-model.js';
import { LISTENING_CRITERIA, listeningInput, patchIdentity } from '../demo/audition-listening.js';
import type { ListeningInput } from '../demo/audition-listening.js';
import { examples } from '../src/voices/examples.js';
import { parseVoiceBank } from '../src/voices/schema.js';

// Synthetic preference declarations test review software, never preset listening acceptance.
const criteria = (): ListeningInput['criteria'] => ({ attack: 'A', body: 'B', brightness: 'no-preference', decay: 'not-assessed',
  release: 'not-assessed', controlTransition: 'not-assessed', gainComfort: 'A' });
function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: 'opm-listening-finding-1', packageVersion: '1.8.0', recordedAt: '2026-01-01T00:00:00.000Z',
    selection: { sourceA: 'test-recipe-a', sourceB: 'test-recipe-b', patchA: `sha256:${'a'.repeat(64)}`, patchB: `sha256:${'b'.repeat(64)}`,
      quality: 'standard', material: 'phrase', phraseRevision: 'isolated-six-v2', controlRevision: 'ratio-feedback-adsr-v1',
      seed: 20261002, note: 60, velocity: 0.6, gainMode: 'energy-matched' },
    listener: 'anonymous-test-label', device: 'Test browser/OS', output: 'Test headphones at unchanged comfortable setting',
    notes: 'Synthetic validator data only.', gainNotes: 'Matched A felt louder; subjective, not LUFS.', listened: true, criteria: criteria(),
    playback: { renderedSampleRate: 48000, contextSampleRate: 44100, masterGain: 0.12, sourceGains: [0.5, 0.25] },
    evidence: 'Human subjective entries only. Numerical reports are separate and are not listening findings.', ...overrides };
}
const report = (findings: unknown[]) => JSON.stringify({ schema: 'opm-listening-findings-1', findings });
const selection = (overrides: Record<string, unknown>) => ({ ...(finding().selection as Record<string, unknown>), ...overrides });

test('existing exports retain human declarations and only actual assessed counts/preferences', () => {
  const legacy = finding(); delete legacy.listened; delete legacy.playback; delete legacy.gainNotes;
  const summary = evaluateListeningEvidence(report([legacy]));
  assert.equal(summary.valid, true);
  assert.equal(summary.uniqueFindings, 1);
  assert.equal(summary.assessedCriteria, 4);
  assert.deepEqual(summary.groups[0]!.criteria.attack, { assessed: 1, A: 1, B: 0, noPreference: 0, notAssessed: 0 });
  assert.deepEqual(summary.groups[0]!.criteria.body, { assessed: 1, A: 0, B: 1, noPreference: 0, notAssessed: 0 });
  assert.deepEqual(summary.groups[0]!.criteria.brightness, { assessed: 1, A: 0, B: 0, noPreference: 1, notAssessed: 0 });
  assert.equal(summary.groups[0]!.criteria.release.assessed, 0);
  assert.equal(summary.findings[0]!.listened, null);
  assert.equal(summary.findings[0]!.playback, null);
  assert.equal(summary.findings[0]!.gainNotes, null);
  assert.match(summary.warnings.join(';'), /legacy human entry/);
  assert.match(summary.warnings.join(';'), /gains\/sample rates unrecorded/);
  assert.equal(Object.hasOwn(summary, 'complete'), false);
  assert.equal(Object.hasOwn(summary, 'listeningStatus'), false);
});

test('review retains exact conditions, gain notes and filename/index provenance without modifying sources', () => {
  const source = report([finding()]);
  const summary = evaluateListeningEvidenceFiles([{ file: 'listener.json', source }]);
  assert.equal(source, report([finding()]));
  const reviewed = summary.findings[0]!;
  assert.deepEqual(reviewed.sources, [{ file: 'listener.json', findingIndex: 0 }]);
  assert.deepEqual(reviewed.playback, { renderedSampleRate: 48000, contextSampleRate: 44100, masterGain: 0.12, sourceGains: [0.5, 0.25] });
  assert.equal(reviewed.selection.gainMode, 'energy-matched');
  assert.equal(reviewed.gainNotes, 'Matched A felt louder; subjective, not LUFS.');
  assert.equal(reviewed.listened, true);
  assert.match(reviewed.identity, /^sha256:[0-9a-f]{64}$/);
});

test('duplicate copies cannot inflate findings, assessed criteria or declared listener labels', () => {
  const source = report([finding()]);
  const inputs = [{ file: 'original.json', source }, { file: 'copy.json', source }];
  const summary = evaluateListeningEvidenceFiles(inputs);
  assert.deepEqual([summary.submittedFindings, summary.uniqueFindings, summary.duplicateFindings, summary.assessedCriteria], [2, 1, 1, 4]);
  assert.equal(summary.groups[0]!.declaredListenerLabels, 1);
  assert.equal(summary.findings[0]!.sources.length, 2);
  assert.deepEqual(evaluateListeningEvidenceFiles([...inputs].reverse()).groups, summary.groups);
  assert.deepEqual(evaluateListeningEvidenceFiles([...inputs].reverse()).findings, summary.findings);
  assert.throws(() => evaluateListeningEvidence(report([finding(), finding({ selection: selection({ sourceA: 'renamed-copy' }) })])), /conflicting content/);
  const conflicting = finding({ criteria: { ...criteria(), attack: 'B' } });
  assert.throws(() => evaluateListeningEvidenceFiles([{ file: 'original.json', source }, { file: 'contradiction.json', source: report([conflicting]) }]), /conflicting content/);
});

test('exact hashes, profiles, material, register, velocity, revisions, seed, gain and versions scope groups', () => {
  for (const change of [
    { patchA: `sha256:${'c'.repeat(64)}` }, { patchB: `sha256:${'c'.repeat(64)}` }, { quality: 'high' }, { material: 'single' },
    { note: 48 }, { velocity: 0.25 }, { phraseRevision: 'isolated-six-v3' }, { controlRevision: 'ratio-feedback-adsr-v2' }, { seed: 1 },
  ]) {
    const summary = evaluateListeningEvidence(report([finding(), finding({ recordedAt: '2026-01-01T00:00:01.000Z', selection: selection(change) })]));
    assert.equal(summary.groups.length, 2, JSON.stringify(change));
  }
  const dry = finding({ recordedAt: '2026-01-01T00:00:01.000Z', selection: selection({ gainMode: 'dry' }),
    playback: { renderedSampleRate: 48000, contextSampleRate: 44100, masterGain: 0.12, sourceGains: [1, 1] } });
  assert.equal(evaluateListeningEvidence(report([finding(), dry])).groups.length, 2);
  assert.equal(evaluateListeningEvidence(report([finding(), finding({ packageVersion: '1.7.0', recordedAt: '2026-01-01T00:00:01.000Z' })])).groups.length, 2);
  assert.equal(evaluateListeningEvidence(report([finding(), finding({ recordedAt: '2026-01-01T00:00:01.000Z',
    playback: { renderedSampleRate: 48000, contextSampleRate: 48000, masterGain: 0.12, sourceGains: [0.5, 0.25] } })])).groups.length, 2);
  const renamed = finding({ recordedAt: '2026-01-01T00:00:01.000Z', selection: selection({ sourceA: 'same-patch-alias' }) });
  const summary = evaluateListeningEvidence(report([finding(), renamed]));
  assert.equal(summary.groups.length, 1);
  assert.deepEqual(summary.groups[0]!.sourceNames.A, ['same-patch-alias', 'test-recipe-a']);
  assert.equal(summary.groups[0]!.findingCount, 2);
  assert.equal(summary.groups[0]!.declaredListenerLabels, 1); // Labels are not authenticated distinct people.
});

test('capture requires explicit actual-listening confirmation and at least one assessed criterion', async () => {
  const input: ListeningInput = { listener: 'anonymous', device: 'Browser/OS', output: 'Headphones, setting unchanged',
    notes: '', gainNotes: 'Dry A felt louder.', listened: true, criteria: criteria() };
  assert.throws(() => listeningInput({ ...input, listened: false }), /actually listened/);
  assert.throws(() => listeningInput({ ...input, criteria: Object.fromEntries(LISTENING_CRITERIA.map(key => [key, 'not-assessed'])) as ListeningInput['criteria'] }), /at least one/);
  assert.equal(listeningInput(input).gainNotes, input.gainNotes);
  const voice = parseVoiceBank(examples).get('wood_mallet')!;
  const identity = await patchIdentity(voice);
  assert.equal(identity.id, `sha256:${createHash('sha256').update(JSON.stringify(identity.patch)).digest('hex')}`);
  assert.equal((await patchIdentity(voice)).id, identity.id);
});

test('malformed schemas, all-unassessed/empty data, bounds, hashes, versions and typed identities are rejected', () => {
  const unassessed = Object.fromEntries(LISTENING_CRITERIA.map(key => [key, 'not-assessed']));
  for (const bad of [
    '{', JSON.stringify({ schema: 'other', findings: [] }), report([]), report(Array.from({ length: 51 }, () => finding())),
    report([finding({ schema: 'other' })]), report([finding({ criteria: unassessed })]), report([finding({ criteria: { ...criteria(), attack: 'pass' } })]),
    report([finding({ criteria: { ...criteria(), unknown: 'A' } })]), report([finding({ criteria: { attack: 'A' } })]),
    report([finding({ listener: '' })]), report([finding({ device: '' })]), report([finding({ output: '' })]), report([finding({ evidence: '' })]),
    report([finding({ listened: false })]), report([finding({ packageVersion: 'latest' })]), report([finding({ packageVersion: '1.8' })]),
    report([finding({ packageVersion: '1.8.0-01' })]), report([finding({ packageVersion: '1.8.0+' })]),
    report([finding({ recordedAt: '2026-02-30T00:00:00.000Z' })]), report([finding({ notes: 'x'.repeat(1025) })]),
    report([finding({ gainNotes: 'x'.repeat(1025) })]), report([finding({ listener: 'x'.repeat(81) })]),
    report([finding({ selection: selection({ patchA: 'wood_mallet' }) })]), report([finding({ selection: selection({ patchB: `sha256:${'g'.repeat(64)}` }) })]),
    report([finding({ selection: selection({ seed: -1 }) })]), report([finding({ selection: selection({ seed: 0x100000000 }) })]),
    report([finding({ selection: selection({ note: 128 }) })]), report([finding({ selection: selection({ note: '60' }) })]),
    report([finding({ selection: selection({ velocity: 0 }) })]), report([finding({ selection: selection({ quality: 'best' }) })]),
    report([finding({ selection: selection({ material: 'song' }) })]), report([finding({ selection: selection({ gainMode: 'matched' }) })]),
    report([finding({ playback: { renderedSampleRate: 5, contextSampleRate: null, masterGain: 0.12, sourceGains: [1, 1] } })]),
    report([finding({ playback: { renderedSampleRate: 48000, contextSampleRate: null, masterGain: 0.12, sourceGains: [1] } })]),
    report([finding({ selection: selection({ gainMode: 'dry' }) })]), 'x'.repeat(2 * 1024 * 1024 + 1),
  ]) assert.throws(() => evaluateListeningEvidence(bad));
  assert.throws(() => evaluateListeningEvidenceFiles([]));
  assert.throws(() => evaluateListeningEvidenceFiles(Array.from({ length: 17 }, (_, i) => ({ file: `${i}.json`, source: report([finding()]) }))));
  assert.throws(() => evaluateListeningEvidenceFiles([{ file: 'same.json', source: report([finding()]) }, { file: 'same.json', source: report([finding()]) }]));
});

test('CLI exports assessed review counts and rejects unassessed input instead of reporting acceptance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opm-listening-validator-'));
  try {
    const original = join(directory, 'original.json'), copy = join(directory, 'copy.json'), invalid = join(directory, 'invalid.json');
    await writeFile(original, report([finding()]));
    await writeFile(copy, report([finding()]));
    await writeFile(invalid, report([finding({ criteria: Object.fromEntries(LISTENING_CRITERIA.map(key => [key, 'not-assessed'])) })]));
    const cli = fileURLToPath(new URL('../scripts/listening-evidence.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, original, copy], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const review: unknown = JSON.parse(result.stdout);
    assert.ok(review !== null && typeof review === 'object' && 'schema' in review && 'uniqueFindings' in review
      && 'assessedCriteria' in review && 'duplicateFindings' in review);
    assert.equal(review.schema, 'opm-listening-evidence-review-1');
    assert.deepEqual([review.uniqueFindings, review.assessedCriteria, review.duplicateFindings], [1, 4, 1]);
    assert.equal(Object.hasOwn(review, 'complete'), false);
    const rejected = spawnSync(process.execPath, [cli, invalid], { encoding: 'utf8' });
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, '');
    assert.match(rejected.stderr, /at least one human criterion/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
