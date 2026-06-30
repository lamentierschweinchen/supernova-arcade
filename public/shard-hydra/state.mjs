export function monotonicHp(currentVisibleHp, authoritativeHp) {
  return Math.max(0, Math.min(currentVisibleHp, authoritativeHp));
}

export function snapshotCanApply({
  sequence,
  appliedSequence,
  requestRunToken,
  currentRunToken,
}) {
  return sequence >= appliedSequence && requestRunToken === currentRunToken;
}

export function settlementRetryDue({
  confirmedThrough,
  attackId,
  previousRequest,
  now,
  retryMs,
}) {
  if (attackId < confirmedThrough) return false;
  if (!previousRequest || previousRequest.attackId < attackId) return true;
  return now - previousRequest.sentAt >= retryMs;
}

export function runOwnsRaid({ started, activeRunRaidId, snapshotRaidId }) {
  return started && activeRunRaidId === snapshotRaidId;
}

export function settlementEligibleAt(closesAt, graceMs, safetyMs = 1_000) {
  return closesAt + graceMs + safetyMs;
}
