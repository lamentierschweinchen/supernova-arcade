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

export function progressiveAttackDuration(
  attackId,
  { startWindow, windowStep, minWindow },
) {
  return Math.max(minWindow, startWindow - attackId * windowStep);
}

export function progressiveAttackOffset(
  attackId,
  { rampAttacks, startWindow, windowStep, minWindow },
) {
  const rampCount = Math.min(attackId, rampAttacks);
  const rampSpan =
    rampCount * startWindow -
    (windowStep * rampCount * (rampCount - 1)) / 2;
  return rampSpan + Math.max(0, attackId - rampCount) * minWindow;
}

export function progressiveAttackAtElapsed(elapsed, config) {
  for (let attackId = 0; attackId < 128; attackId += 1) {
    if (elapsed < progressiveAttackOffset(attackId + 1, config)) {
      return attackId;
    }
  }
  return 127;
}
