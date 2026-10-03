export interface CapacityObservation {
  p99Ms: number;
  deadlineMs: number;
  missedDeadlines: number;
  diagnosticIssues: readonly string[];
  capacityApplicable: boolean;
}

/** Host-row selection only; deliberately independent of the optional CI budgets. */
export function capacityEligibility(observation: CapacityObservation, maximumP99DeadlineRatio = 0.5) {
  if (!Number.isFinite(maximumP99DeadlineRatio) || maximumP99DeadlineRatio <= 0 || maximumP99DeadlineRatio > 0.5) {
    throw new RangeError('capacity p99 ratio must be in (0,0.5]');
  }
  const reasons: string[] = [];
  const validTiming = Number.isFinite(observation.p99Ms) && observation.p99Ms >= 0 &&
    Number.isFinite(observation.deadlineMs) && observation.deadlineMs > 0;
  const ratio = validTiming ? observation.p99Ms / observation.deadlineMs : NaN;
  if (!Number.isFinite(ratio)) reasons.push('invalid timing observation');
  else if (ratio > maximumP99DeadlineRatio) reasons.push('p99 exceeds conservative deadline fraction');
  if (!Number.isInteger(observation.missedDeadlines) || observation.missedDeadlines < 0) reasons.push('invalid miss count');
  else if (observation.missedDeadlines !== 0) reasons.push('observed block deadline misses');
  for (const issue of observation.diagnosticIssues) reasons.push(`diagnostics: ${issue}`);
  if (!observation.capacityApplicable) reasons.push('idle row does not exercise sounding-voice capacity');
  const eligible = reasons.length === 0;
  return {
    eligible,
    p99ReserveRatio: Number.isFinite(ratio) ? 1 - ratio : null,
    reasons: eligible ? ['p99 reserve criterion met; zero observed misses; clean workload diagnostics'] : reasons,
  };
}
