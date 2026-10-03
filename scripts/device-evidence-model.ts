import { createHash } from 'node:crypto';

// Exported acceptanceStatus/coverage are never trusted, and declared hardware is not authenticated.
export const ENVIRONMENTS = ['physical-ios-safari', 'physical-android-chrome'] as const;
export const SCENARIOS = ['lock-unlock', 'switch-app', 'call-interruption', 'bluetooth-route', 'headset-route', 'battery-saver', 'long-play', 'main-thread-stall', 'dispose-recreate'] as const;
export const POLICIES = ['cancel', 'preserve'] as const;
export type Status = 'pass' | 'fail' | 'unverified';
export interface EvidenceFile { readonly file: string; readonly source: string }
export interface RunReference { readonly file: string; readonly runId: number; readonly identity: string }
export interface CellResult {
  environment: string; scenario: string; policy: string; status: Status; runId: number | null; reasons: string[];
  groupId: string | null; sources: readonly RunReference[]; endedAt: string | null;
}
export interface DeviceScope {
  environment: string; device: string; os: string; browser: string; userAgent: string;
  sampleRate: number | null; endSampleRate: number | null; policy: string;
  packageVersion: string | null; loadProfile: Record<string, unknown> | null;
  unrecordedContextFile: string | null;
}
export interface DeviceGroup {
  id: string; scope: DeviceScope; cells: readonly CellResult[]; counts: Readonly<Record<Status, number>>;
  complete: boolean; latestFinishedAt: string | null;
}
export interface DeviceCampaign {
  id: string; packageVersion: string | null; loadProfile: Record<string, unknown> | null;
  metadataRecorded: boolean; cells: readonly CellResult[]; counts: Readonly<Record<Status, number>>; complete: boolean;
}
export interface RunResult {
  id: number; file: string; identity: string; scenario: string; policy: string; environment: string;
  status: Status; reasons: readonly string[]; groupId: string; startedAt: string; endedAt: string | null;
  notes: string; observations: readonly unknown[]; markers: readonly unknown[]; droppedObservations: number;
}
export interface EvidenceSummary {
  readonly valid: true; readonly cells: readonly CellResult[]; readonly counts: Readonly<Record<Status, number>>;
  readonly complete: boolean; readonly runs: number; readonly uniqueRuns: number; readonly files: readonly string[];
  readonly runResults: readonly RunResult[]; readonly groups: readonly DeviceGroup[]; readonly campaigns: readonly DeviceCampaign[];
  readonly representativeCampaignId: string | null; readonly warnings: readonly string[];
}
const MAX_BYTES = 2 * 1024 * 1024, MAX_FILES = 16;
const MAX_RUNS = 24, MAX_EVENTS = 256, MAX_MARKERS = 64, MAX_NOTES = 1200;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new TypeError(`${label} must be a${required ? ' nonempty' : ''} string of at most ${max} characters`);
  return value;
}
function judgment(value: unknown, label: string): Status {
  if (value !== 'pass' && value !== 'fail' && value !== 'unverified') throw new TypeError(`${label} must be pass, fail or unverified`);
  return value;
}
function rate(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 8000 || value > 192000) throw new RangeError(`${label} must be null or a plausible sample rate`);
  return value;
}
function time(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be a UTC ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new TypeError(`${label} must be a valid UTC ISO timestamp`);
  return parsed;
}
function counter(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return value;
}
function boundedJSON(value: unknown, label: string, depth = 0, observation = false): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') { text(value, label, observation ? 240 : 512); return; }
  if (depth >= (observation ? 4 : 8) || typeof value !== 'object') throw new TypeError(`${label} exceeds bounded JSON depth or types`);
  const entries = Array.isArray(value) ? value : Object.entries(record(value, label));
  if (entries.length > (observation ? 32 : 128)) throw new RangeError(`${label} exceeds bounded JSON entries`);
  if (Array.isArray(value)) value.forEach(item => boundedJSON(item, label, depth + 1, observation));
  else for (const [key, item] of Object.entries(record(value, label))) { text(key, label, 80); boundedJSON(item, label, depth + 1, observation); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) as string;
}
function digest(value: unknown): string { return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`; }
function counts(cells: readonly CellResult[]): Readonly<Record<Status, number>> {
  const result = { pass: 0, fail: 0, unverified: 0 };
  for (const cell of cells) result[cell.status]++;
  return Object.freeze(result);
}
function emptyCell(environment: string, scenario: string, policy: string, groupId: string | null): CellResult {
  return { environment, scenario, policy, groupId, status: 'unverified', runId: null, reasons: ['no finished physical capture in this exact scope'], sources: [], endedAt: null };
}
interface ParsedRun { result: RunResult; scope: DeviceScope; finished: number | null; content: string; reference: RunReference }

/** The single-file API remains a wrapper around the same collective derivation. */
export function evaluateDeviceEvidence(source: string): EvidenceSummary {
  return evaluateDeviceEvidenceFiles([{ file: '<input>', source }]);
}
/** Review bounded original exports together; no phone models, versions or workloads are blended into a group. */
export function evaluateDeviceEvidenceFiles(files: readonly EvidenceFile[]): EvidenceSummary {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new RangeError(`Review requires 1..${MAX_FILES} files`);
  const names = new Set<string>(), warnings: string[] = [], parsed: ParsedRun[] = [];
  for (const input of files) {
    const file = text(input.file, 'filename', 1024, true);
    if (names.has(file)) throw new TypeError(`Duplicate input filename: ${file}`);
    names.add(file);
    if (typeof input.source !== 'string' || Buffer.byteLength(input.source) > MAX_BYTES) throw new RangeError(`${file}: evidence exceeds the 2 MiB review budget`);
    const report = record(JSON.parse(input.source) as unknown, `${file} report`);
    if (report.format !== 'opm-local-device-acceptance' || report.version !== 1) throw new TypeError(`${file}: unsupported evidence format or version`);
    if (!Array.isArray(report.runs) || report.runs.length > MAX_RUNS) throw new RangeError(`${file}: runs must be an array of at most ${MAX_RUNS}`);
    for (const key of ['droppedRuns', 'totalObservedEvents'] as const) if (report[key] !== undefined) counter(report[key], `${file} ${key}`);
    if (report.exportedAt !== undefined) time(report.exportedAt, `${file} exportedAt`);
    const ids = new Set<number>();
    for (const [index, raw] of report.runs.entries()) {
      const run = record(raw, `${file} run ${index}`), label = `${file} run ${String(run.id)}`;
      const id = counter(run.id, `${label} id`);
      if (id < 1 || ids.has(id)) throw new TypeError(`${label}: invalid or duplicate id`);
      ids.add(id);
      if (!(SCENARIOS as readonly unknown[]).includes(run.scenario) || !(POLICIES as readonly unknown[]).includes(run.policy)) throw new TypeError(`${label}: unknown scenario or policy`);
      const environment = text(run.environment, `${label} environment`, 64, true);
      const device = text(run.device, `${label} device`, 512), os = text(run.os, `${label} os`, 512);
      const browser = text(run.browser, `${label} browser`, 512), userAgent = text(run.userAgent, `${label} userAgent`, 512);
      const notes = text(run.notes, `${label} notes`, MAX_NOTES);
      const started = time(run.startedAt, `${label} startedAt`), finished = run.endedAt === null ? null : time(run.endedAt, `${label} endedAt`);
      const duration = run.durationSeconds;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 86400) throw new RangeError(`${label}: invalid duration`);
      const declared = judgment(run.manualJudgment, `${label} manualJudgment`);
      judgment(run.acceptanceStatus, `${label} acceptanceStatus`);
      if (typeof run.listened !== 'boolean') throw new TypeError(`${label}: listened must be boolean`);
      if (run.endPolicy !== null && !(POLICIES as readonly unknown[]).includes(run.endPolicy)) throw new TypeError(`${label}: invalid endPolicy`);
      for (const [key, max] of [['observations', MAX_EVENTS], ['markers', MAX_MARKERS]] as const) {
        if (!Array.isArray(run[key]) || run[key].length > max) throw new RangeError(`${label}: ${key} must be an array of at most ${max}`);
        for (const item of run[key]) { record(item, `${label} ${key} entry`); boundedJSON(item, `${label} ${key}`, 0, true); }
      }
      const droppedObservations = counter(run.droppedObservations, `${label} droppedObservations`);
      const sampleRate = rate(run.sampleRate, `${label} sampleRate`), endSampleRate = rate(run.endSampleRate, `${label} endSampleRate`);
      let packageVersion: string | null = null, loadProfile: Record<string, unknown> | null = null;
      if (run.packageVersion !== undefined) {
        packageVersion = text(run.packageVersion, `${label} packageVersion`, 128, true);
        if (!VERSION.test(packageVersion)) throw new TypeError(`${label}: packageVersion must be an exact semantic version`);
      }
      if (run.loadProfile !== undefined && run.loadProfile !== null) {
        loadProfile = record(run.loadProfile, `${label} loadProfile`);
        if (!Object.keys(loadProfile).length) throw new TypeError(`${label}: loadProfile cannot be empty`);
        boundedJSON(loadProfile, `${label} loadProfile`);
        if (Buffer.byteLength(canonical(loadProfile)) > 32768) throw new RangeError(`${label}: loadProfile exceeds 32 KiB`);
      }
      if (packageVersion === null || loadProfile === null) warnings.push(`${label}: legacy version/workload metadata is unrecorded; retain original and recapture for strict complete review`);
      const scope: DeviceScope = { environment, device, os, browser, userAgent, sampleRate, endSampleRate, policy: String(run.policy), packageVersion, loadProfile,
        unrecordedContextFile: packageVersion === null || loadProfile === null ? file : null };
      const groupId = digest(scope), identity = digest({ scope, id, startedAt: run.startedAt });
      const reasons: string[] = [], physical = (ENVIRONMENTS as readonly string[]).includes(environment);
      if (run.loadProfile === null) reasons.push('workload setup did not finish');
      if (!physical) reasons.push('not a declared physical iOS Safari / Android Chrome environment');
      if (finished === null) reasons.push('capture did not finish');
      else if (finished < started) reasons.push('end precedes start');
      // Exporter rounds monotonic elapsed time to 0.1 seconds. Wall-clock jumps must be reviewed, not used to earn long-play pass.
      else if (Math.abs(duration - (finished - started) / 1000) > 1) reasons.push('duration contradicts start/end timestamps (or wall clock changed)');
      if (!run.listened) reasons.push('listening was not declared');
      if (run.endPolicy !== run.policy) reasons.push('interruption policy changed or was not recorded');
      if (sampleRate === null || endSampleRate === null) reasons.push('context sample rate missing');
      if (run.scenario === 'long-play' && duration < 600) reasons.push('long play shorter than 600 seconds');
      for (const rawMarker of run.markers as unknown[]) {
        const marker = record(rawMarker, `${label} marker`);
        if (marker.elapsedSeconds !== undefined) {
          const elapsed = marker.elapsedSeconds;
          if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86400) throw new RangeError(`${label}: invalid marker elapsedSeconds`);
          if (elapsed > duration + 1) reasons.push('marker elapsed time exceeds capture duration');
        }
        if (marker.wallTime !== undefined) time(marker.wallTime, `${label} marker wallTime`);
      }
      if (physical && (!device.trim() || !os.trim() || !browser.trim())) reasons.push('exact device, OS and browser versions are required');
      if (environment === 'physical-ios-safari' && !/(iPhone|iPad)/.test(userAgent)) reasons.push('user agent does not look like iOS');
      if (environment === 'physical-android-chrome' && !/Android/.test(userAgent)) reasons.push('user agent does not look like Android');
      const status: Status = reasons.length ? 'unverified' : declared;
      if (status !== run.acceptanceStatus) warnings.push(`${label}: exported acceptanceStatus ${String(run.acceptanceStatus)} differs from independently derived ${status}`);
      const result: RunResult = { id, file, identity, scenario: String(run.scenario), policy: String(run.policy), environment, status, reasons, groupId,
        startedAt: String(run.startedAt), endedAt: finished === null ? null : String(run.endedAt), notes,
        observations: run.observations as unknown[], markers: run.markers as unknown[], droppedObservations };
      parsed.push({ result, scope, finished, content: digest(run), reference: { file, runId: id, identity } });
    }
  }
  const identities = new Map<string, Set<string>>();
  for (const run of parsed) {
    const versions = identities.get(run.result.identity) ?? new Set<string>(); versions.add(run.content); identities.set(run.result.identity, versions);
  }
  for (const run of parsed) if (identities.get(run.result.identity)!.size > 1) {
    run.result.status = 'unverified';
    (run.result.reasons as string[]).push('conflicting content for the same scoped run identity');
    warnings.push(`${run.result.file} run ${run.result.id}: conflicting scoped run identity ${run.result.identity}`);
  }
  const grouped = new Map<string, ParsedRun[]>();
  for (const run of parsed) {
    if (!(ENVIRONMENTS as readonly string[]).includes(run.scope.environment)) continue;
    const entries = grouped.get(run.result.groupId) ?? []; entries.push(run); grouped.set(run.result.groupId, entries);
  }
  const groups: DeviceGroup[] = [];
  for (const [id, entries] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const scope = entries[0]!.scope;
    const cells = SCENARIOS.map(scenario => {
      const finished = entries.filter(run => run.result.scenario === scenario && run.finished !== null).sort((a, b) => b.finished! - a.finished! || a.content.localeCompare(b.content));
      const latest = finished[0];
      if (!latest) return emptyCell(scope.environment, scenario, scope.policy, id);
      const tied = finished.filter(run => run.finished === latest.finished);
      const conflicting = new Set(tied.map(run => run.result.status)).size > 1;
      if (conflicting) warnings.push(`group ${id} ${scenario}: conflicting judgments at the latest finished timestamp`);
      return { environment: scope.environment, scenario, policy: scope.policy, groupId: id, status: conflicting ? 'unverified' as const : latest.result.status,
        runId: latest.result.id, reasons: conflicting ? ['conflicting latest finished judgments; recapture or review originals'] : [...latest.result.reasons],
        sources: tied.map(run => run.reference).sort((a, b) => a.file.localeCompare(b.file) || a.runId - b.runId), endedAt: latest.result.endedAt };
    });
    const resultCounts = counts(cells);
    const latest = entries.filter(run => run.finished !== null).sort((a, b) => b.finished! - a.finished!)[0];
    groups.push({ id, scope, cells, counts: resultCounts, complete: resultCounts.pass === SCENARIOS.length, latestFinishedAt: latest?.result.endedAt ?? null });
  }
  const cohorts = new Map<string, DeviceGroup[]>();
  for (const group of groups) {
    const id = digest({ packageVersion: group.scope.packageVersion, loadProfile: group.scope.loadProfile });
    const entries = cohorts.get(id) ?? []; entries.push(group); cohorts.set(id, entries);
  }
  const campaigns: DeviceCampaign[] = [];
  for (const [id, entries] of [...cohorts].sort(([a], [b]) => a.localeCompare(b))) {
    const { packageVersion, loadProfile } = entries[0]!.scope;
    const selected: CellResult[] = [];
    for (const environment of ENVIRONMENTS) for (const policy of POLICIES) {
      // Select one complete exact device scope, never stitch nine scenarios from different models or rates.
      const candidates = entries.filter(group => group.scope.environment === environment && group.scope.policy === policy)
        .sort((a, b) => Number(b.complete) - Number(a.complete) || (b.latestFinishedAt ?? '').localeCompare(a.latestFinishedAt ?? '') || a.id.localeCompare(b.id));
      if (candidates.length > 1) warnings.push(`campaign ${id} ${environment}/${policy}: ${candidates.length} exact scopes kept separate; selected ${candidates[0]!.id}`);
      selected.push(...(candidates[0]?.cells ?? SCENARIOS.map(scenario => emptyCell(environment, scenario, policy, null))));
    }
    const cells = ENVIRONMENTS.flatMap(environment => SCENARIOS.flatMap(scenario => POLICIES.map(policy =>
      selected.find(cell => cell.environment === environment && cell.scenario === scenario && cell.policy === policy)!)));
    const resultCounts = counts(cells), metadataRecorded = packageVersion !== null && loadProfile !== null;
    campaigns.push({ id, packageVersion, loadProfile, metadataRecorded, cells, counts: resultCounts, complete: metadataRecorded && resultCounts.pass === 36 });
  }
  campaigns.sort((a, b) => Number(b.complete) - Number(a.complete) || a.id.localeCompare(b.id));
  if (campaigns.length > 1) warnings.push('Different package versions/workloads are separate campaigns, never combined for completeness');
  const representative = campaigns[0];
  const cells = representative?.cells ?? ENVIRONMENTS.flatMap(environment => SCENARIOS.flatMap(scenario => POLICIES.map(policy => emptyCell(environment, scenario, policy, null))));
  const uniqueRuns = new Set(parsed.map(run => run.content)).size;
  if (uniqueRuns < parsed.length) warnings.push(`${parsed.length - uniqueRuns} repeated original run copies do not increase coverage`);
  return Object.freeze({ valid: true as const, cells, counts: representative?.counts ?? counts(cells), complete: representative?.complete ?? false,
    runs: parsed.length, uniqueRuns, files: [...names], runResults: parsed.map(run => run.result), groups, campaigns,
    representativeCampaignId: representative?.id ?? null, warnings });
}
