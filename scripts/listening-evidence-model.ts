import { createHash } from 'node:crypto';
import { LISTENING_CRITERIA } from '../demo/audition-listening.js';
import type { ListeningVerdict } from '../demo/audition-listening.js';

export interface ListeningEvidenceFile { readonly file: string; readonly source: string }
export interface ListeningSelection {
  sourceA: string; sourceB: string; patchA: string; patchB: string; quality: 'eco' | 'standard' | 'high';
  material: 'single' | 'phrase' | 'controls'; phraseRevision: string; controlRevision: string;
  seed: number; note: number; velocity: number; gainMode: 'energy-matched' | 'dry';
}
export interface ListeningPlayback {
  renderedSampleRate: number; contextSampleRate: number | null; masterGain: number; sourceGains: [number, number];
}
export interface ReviewedFinding {
  identity: string; packageVersion: string; recordedAt: string; selection: ListeningSelection;
  listener: string; device: string; output: string; notes: string; gainNotes: string | null; listened: true | null;
  criteria: Record<typeof LISTENING_CRITERIA[number], ListeningVerdict>; playback: ListeningPlayback | null; evidence: string;
  sources: { file: string; findingIndex: number }[];
}
export interface CriterionCounts { assessed: number; A: number; B: number; noPreference: number; notAssessed: number }
export interface ListeningGroup {
  id: string; packageVersion: string; selection: ListeningSelection; playback: ListeningPlayback | null;
  sourceNames: { A: readonly string[]; B: readonly string[] }; findings: readonly string[];
  findingCount: number; declaredListenerLabels: number; assessedCriteria: number;
  criteria: Record<typeof LISTENING_CRITERIA[number], CriterionCounts>;
}
export interface ListeningEvidenceSummary {
  valid: true; files: readonly string[]; submittedFindings: number; uniqueFindings: number; duplicateFindings: number;
  assessedCriteria: number; groups: readonly ListeningGroup[]; findings: readonly ReviewedFinding[]; warnings: readonly string[];
}
const MAX_BYTES = 2 * 1024 * 1024, MAX_FILES = 16, MAX_FINDINGS = 50;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new TypeError(`${label} must be a bounded${required ? ' nonempty' : ''} string (max ${max})`);
  return value;
}
function choice<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new TypeError(`${label} has an unsupported value`);
  return value as T;
}
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) throw new RangeError(`${label} is outside ${min}..${max}`);
  return value;
}
function digest(value: unknown): string { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function patch(value: unknown, label: string): string {
  const result = text(value, label, 71);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) throw new TypeError(`${label} must be a SHA-256 normalized patch identity`);
  return result;
}
function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 24);
  const parsed = Date.parse(result);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(result) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) throw new TypeError(`${label} must be a valid UTC ISO timestamp`);
  return result;
}
function parseFinding(raw: unknown, label: string): Omit<ReviewedFinding, 'identity' | 'sources'> {
  const finding = record(raw, label);
  if (finding.schema !== 'opm-listening-finding-1') throw new TypeError(`${label}: unsupported finding schema`);
  const packageVersion = text(finding.packageVersion, `${label} packageVersion`, 128);
  if (!VERSION.test(packageVersion)) throw new TypeError(`${label}: an exact semantic package version is required`);
  const rawSelection = record(finding.selection, `${label} selection`);
  const selection: ListeningSelection = {
    sourceA: text(rawSelection.sourceA, `${label} sourceA`, 160), sourceB: text(rawSelection.sourceB, `${label} sourceB`, 160),
    patchA: patch(rawSelection.patchA, `${label} patchA`), patchB: patch(rawSelection.patchB, `${label} patchB`),
    quality: choice(rawSelection.quality, `${label} quality`, ['eco', 'standard', 'high']),
    material: choice(rawSelection.material, `${label} material`, ['single', 'phrase', 'controls']),
    phraseRevision: text(rawSelection.phraseRevision, `${label} phraseRevision`, 80), controlRevision: text(rawSelection.controlRevision, `${label} controlRevision`, 80),
    seed: number(rawSelection.seed, `${label} seed`, 0, 0xffffffff, true), note: number(rawSelection.note, `${label} note`, 0, 127, true),
    velocity: number(rawSelection.velocity, `${label} velocity`, Number.MIN_VALUE, 1),
    gainMode: choice(rawSelection.gainMode, `${label} gainMode`, ['energy-matched', 'dry']),
  };
  const rawCriteria = record(finding.criteria, `${label} criteria`), criteria = {} as ReviewedFinding['criteria'];
  if (Object.keys(rawCriteria).length !== LISTENING_CRITERIA.length) throw new TypeError(`${label}: criteria must contain exactly the seven listening criteria`);
  for (const criterion of LISTENING_CRITERIA) criteria[criterion] = choice(rawCriteria[criterion], `${label} ${criterion}`, ['A', 'B', 'no-preference', 'not-assessed']);
  if (Object.values(criteria).every(value => value === 'not-assessed')) throw new TypeError(`${label}: at least one human criterion must be assessed`);
  if (finding.listened !== undefined && finding.listened !== true) throw new TypeError(`${label}: explicit listened confirmation must be true`);
  let playback: ListeningPlayback | null = null;
  if (finding.playback !== undefined) {
    const rawPlayback = record(finding.playback, `${label} playback`);
    if (!Array.isArray(rawPlayback.sourceGains) || rawPlayback.sourceGains.length !== 2) throw new TypeError(`${label}: playback sourceGains must be an A/B pair`);
    playback = { renderedSampleRate: number(rawPlayback.renderedSampleRate, `${label} renderedSampleRate`, 8000, 192000),
      contextSampleRate: rawPlayback.contextSampleRate === null ? null : number(rawPlayback.contextSampleRate, `${label} contextSampleRate`, 8000, 192000),
      masterGain: number(rawPlayback.masterGain, `${label} masterGain`, Number.MIN_VALUE, 1),
      sourceGains: [number(rawPlayback.sourceGains[0], `${label} source gain A`, Number.MIN_VALUE, 1), number(rawPlayback.sourceGains[1], `${label} source gain B`, Number.MIN_VALUE, 1)] };
    if (selection.gainMode === 'dry' && playback.sourceGains.some(gain => gain !== 1)) throw new TypeError(`${label}: dry means master-only gain, not source trims`);
  }
  return { packageVersion, recordedAt: timestamp(finding.recordedAt, `${label} recordedAt`), selection,
    listener: text(finding.listener, `${label} listener`, 80), device: text(finding.device, `${label} device`, 160), output: text(finding.output, `${label} output`, 160),
    notes: text(finding.notes, `${label} notes`, 1024, false), gainNotes: finding.gainNotes === undefined ? null : text(finding.gainNotes, `${label} gainNotes`, 1024, false),
    listened: finding.listened === undefined ? null : true, criteria, playback, evidence: text(finding.evidence, `${label} evidence disclaimer`, 1024) };
}
/** Parse the existing audition export. Human declarations remain subjective and unauthenticated. */
export function evaluateListeningEvidence(source: string): ListeningEvidenceSummary {
  return evaluateListeningEvidenceFiles([{ file: '<input>', source }]);
}
export function evaluateListeningEvidenceFiles(files: readonly ListeningEvidenceFile[]): ListeningEvidenceSummary {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new RangeError(`Review requires 1..${MAX_FILES} files`);
  const names = new Set<string>(), warnings: string[] = [], unique = new Map<string, ReviewedFinding>(), identities = new Map<string, string>();
  let submittedFindings = 0;
  for (const input of files) {
    const file = text(input.file, 'filename', 1024);
    if (names.has(file)) throw new TypeError(`Duplicate input filename: ${file}`);
    names.add(file);
    if (typeof input.source !== 'string' || Buffer.byteLength(input.source) > MAX_BYTES) throw new RangeError(`${file}: evidence exceeds the 2 MiB review budget`);
    const report = record(JSON.parse(input.source) as unknown, `${file} report`);
    if (report.schema !== 'opm-listening-findings-1') throw new TypeError(`${file}: unsupported listening export schema`);
    if (!Array.isArray(report.findings) || report.findings.length < 1 || report.findings.length > MAX_FINDINGS) throw new RangeError(`${file}: findings must contain 1..${MAX_FINDINGS} records`);
    for (const [findingIndex, raw] of report.findings.entries()) {
      submittedFindings++;
      const finding = parseFinding(raw, `${file} finding ${findingIndex}`), content = digest(finding);
      // The same timestamp/listener/conditions cannot be counted twice with contradictory preferences.
      const { sourceA: _sourceA, sourceB: _sourceB, ...identityConditions } = finding.selection;
      const identity = digest({ packageVersion: finding.packageVersion, recordedAt: finding.recordedAt, listener: finding.listener,
        device: finding.device, output: finding.output, selection: identityConditions });
      const previous = identities.get(identity);
      if (previous !== undefined && previous !== content) throw new TypeError(`${file} finding ${findingIndex}: conflicting content for the same finding identity`);
      identities.set(identity, content);
      const existing = unique.get(content);
      if (existing) existing.sources.push({ file, findingIndex });
      else {
        unique.set(content, { identity, ...finding, sources: [{ file, findingIndex }] });
        if (finding.listened === null) warnings.push(`${file} finding ${findingIndex}: legacy human entry has no explicit listened checkbox confirmation`);
        if (finding.playback === null) warnings.push(`${file} finding ${findingIndex}: applied host gains/sample rates unrecorded; do not infer them from current metadata`);
      }
    }
  }
  const findings = [...unique.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.identity.localeCompare(b.identity));
  const grouped = new Map<string, ReviewedFinding[]>();
  for (const finding of findings) {
    const { sourceA: _sourceA, sourceB: _sourceB, ...conditions } = finding.selection;
    const id = digest({ packageVersion: finding.packageVersion, selection: conditions, playback: finding.playback });
    const entries = grouped.get(id) ?? []; entries.push(finding); grouped.set(id, entries);
    finding.sources.sort((a, b) => a.file.localeCompare(b.file) || a.findingIndex - b.findingIndex);
  }
  const groups: ListeningGroup[] = [];
  for (const [id, entries] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const criteria = {} as ListeningGroup['criteria'];
    let assessedCriteria = 0;
    for (const criterion of LISTENING_CRITERIA) {
      const counts: CriterionCounts = { assessed: 0, A: 0, B: 0, noPreference: 0, notAssessed: 0 };
      for (const finding of entries) {
        const verdict = finding.criteria[criterion];
        if (verdict === 'not-assessed') counts.notAssessed++;
        else { counts.assessed++; if (verdict === 'no-preference') counts.noPreference++; else counts[verdict]++; }
      }
      assessedCriteria += counts.assessed; criteria[criterion] = counts;
    }
    const first = entries[0]!;
    groups.push({ id, packageVersion: first.packageVersion, selection: first.selection, playback: first.playback,
      sourceNames: { A: [...new Set(entries.map(finding => finding.selection.sourceA))].sort(), B: [...new Set(entries.map(finding => finding.selection.sourceB))].sort() },
      findings: entries.map(finding => finding.identity), findingCount: entries.length,
      declaredListenerLabels: new Set(entries.map(finding => JSON.stringify([finding.listener, finding.device, finding.output]))).size, assessedCriteria, criteria });
  }
  const duplicateFindings = submittedFindings - findings.length;
  if (duplicateFindings) warnings.push(`${duplicateFindings} duplicate finding copies were retained as source references, not additional assessments`);
  return { valid: true, files: [...names], submittedFindings, uniqueFindings: findings.length, duplicateFindings,
    assessedCriteria: groups.reduce((sum, group) => sum + group.assessedCriteria, 0), groups, findings, warnings };
}
