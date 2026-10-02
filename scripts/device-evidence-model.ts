// Independent re-derivation of physical-device evidence. The exporting page's own acceptanceStatus and coverage
// are deliberately NOT trusted: every status below is recomputed from the declared run fields.
export const ENVIRONMENTS = ['physical-ios-safari', 'physical-android-chrome'] as const;
export const SCENARIOS = ['lock-unlock', 'switch-app', 'call-interruption', 'bluetooth-route', 'headset-route', 'battery-saver', 'long-play', 'main-thread-stall', 'dispose-recreate'] as const;
export const POLICIES = ['cancel', 'preserve'] as const;
export type Status = 'pass' | 'fail' | 'unverified';
export interface CellResult { environment: string; scenario: string; policy: string; status: Status; runId: number | null; reasons: string[] }
export interface EvidenceSummary {
  readonly valid: true;
  readonly cells: readonly CellResult[];
  readonly counts: Readonly<Record<Status, number>>;
  readonly complete: boolean;
  readonly runs: number;
  readonly runResults: readonly Readonly<{ id: number; scenario: string; policy: string; environment: string; status: Status; reasons: readonly string[] }>[];
  readonly warnings: readonly string[];
}
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RUNS = 24, MAX_EVENTS = 256, MAX_MARKERS = 64, MAX_NOTES = 1200;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || required && value.trim().length === 0) throw new TypeError(`${label} must be a${required ? ' nonempty' : ''} string of at most ${max} characters`);
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
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be an ISO timestamp`);
  return parsed;
}

/** Parse an exported JSON file (string) without trusting its derived fields. */
export function evaluateDeviceEvidence(source: string): EvidenceSummary {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_BYTES) throw new RangeError('Evidence exceeds the 2 MiB review budget');
  const report = record(JSON.parse(source) as unknown, 'report');
  if (report.format !== 'opm-local-device-acceptance' || report.version !== 1) throw new TypeError('Unsupported evidence format or version');
  if (!Array.isArray(report.runs) || report.runs.length > MAX_RUNS) throw new RangeError(`runs must be an array of at most ${MAX_RUNS}`);
  const warnings: string[] = [];
  const ids = new Set<number>();
  const runResults: { id: number; scenario: string; policy: string; environment: string; status: Status; reasons: string[] }[] = [];
  const best = new Map<string, CellResult>();
  for (const [index, raw] of report.runs.entries()) {
    const run = record(raw, `run ${index}`);
    const id = run.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new TypeError(`run ${index} has an invalid or duplicate id`);
    ids.add(id);
    if (!(SCENARIOS as readonly unknown[]).includes(run.scenario)) throw new TypeError(`run ${id} has an unknown scenario`);
    if (!(POLICIES as readonly unknown[]).includes(run.policy)) throw new TypeError(`run ${id} has an unknown policy`);
    const environment = text(run.environment, `run ${id} environment`, 64, true);
    for (const key of ['device', 'os', 'browser', 'userAgent'] as const) text(run[key], `run ${id} ${key}`, 512);
    const notes = text(run.notes, `run ${id} notes`, MAX_NOTES);
    void notes;
    const startedAt = time(run.startedAt, `run ${id} startedAt`);
    const duration = run.durationSeconds;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 86400) throw new RangeError(`run ${id} duration is invalid`);
    const declared = judgment(run.manualJudgment, `run ${id} manualJudgment`);
    judgment(run.acceptanceStatus, `run ${id} acceptanceStatus`);
    if (typeof run.listened !== 'boolean') throw new TypeError(`run ${id} listened must be boolean`);
    if (!Array.isArray(run.observations) || run.observations.length > MAX_EVENTS) throw new RangeError(`run ${id} observations exceed ${MAX_EVENTS}`);
    if (!Array.isArray(run.markers) || run.markers.length > MAX_MARKERS) throw new RangeError(`run ${id} markers exceed ${MAX_MARKERS}`);
    const sampleRate = rate(run.sampleRate, `run ${id} sampleRate`);
    const endSampleRate = rate(run.endSampleRate, `run ${id} endSampleRate`);
    const reasons: string[] = [];
    const physical = (ENVIRONMENTS as readonly string[]).includes(environment);
    if (!physical) reasons.push('not a declared physical iOS Safari / Android Chrome environment');
    if (run.endedAt === null) reasons.push('capture did not finish');
    else if (time(run.endedAt, `run ${id} endedAt`) < startedAt) reasons.push('end precedes start');
    if (!run.listened) reasons.push('listening was not declared');
    if (run.endPolicy !== run.policy) reasons.push('interruption policy changed or was not recorded');
    if (sampleRate === null || endSampleRate === null) reasons.push('context sample rate missing');
    if (run.scenario === 'long-play' && duration < 600) reasons.push('long play shorter than 600 seconds');
    const device = String(run.device), os = String(run.os), browser = String(run.browser), agent = String(run.userAgent);
    if (physical && (!device.trim() || !os.trim() || !browser.trim())) reasons.push('exact device, OS and browser versions are required');
    // Cheap consistency check only. A desktop browser can spoof its user agent; this cannot authenticate hardware.
    if (environment === 'physical-ios-safari' && !/(iPhone|iPad)/.test(agent)) reasons.push('user agent does not look like iOS');
    if (environment === 'physical-android-chrome' && !/Android/.test(agent)) reasons.push('user agent does not look like Android');
    const status: Status = reasons.length === 0 ? declared : 'unverified';
    if (status !== run.acceptanceStatus) warnings.push(`run ${id}: exported acceptanceStatus ${String(run.acceptanceStatus)} differs from independently derived ${status}`);
    runResults.push({ id, scenario: String(run.scenario), policy: String(run.policy), environment, status, reasons });
    if (!physical) continue;
    const key = `${environment}|${String(run.scenario)}|${String(run.policy)}`;
    // The latest finished run represents a cell, matching the page; later unfinished runs never replace it.
    if (run.endedAt !== null) best.set(key, { environment, scenario: String(run.scenario), policy: String(run.policy), status, runId: id, reasons });
  }
  const cells = ENVIRONMENTS.flatMap(environment => SCENARIOS.flatMap(scenario => POLICIES.map(policy =>
    best.get(`${environment}|${scenario}|${policy}`) ?? { environment, scenario, policy, status: 'unverified' as const, runId: null, reasons: ['no finished physical capture'] })));
  const counts: Record<Status, number> = { pass: 0, fail: 0, unverified: 0 };
  for (const cell of cells) counts[cell.status]++;
  return Object.freeze({ valid: true as const, cells: Object.freeze(cells), counts: Object.freeze(counts),
    complete: counts.pass === cells.length, runs: report.runs.length, runResults: Object.freeze(runResults), warnings: Object.freeze(warnings) });
}
