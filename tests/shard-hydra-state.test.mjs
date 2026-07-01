import test from "node:test";
import assert from "node:assert/strict";
import {
  combatDuration,
  monotonicHp,
  progressiveAttackAtElapsed,
  progressiveAttackDuration,
  progressiveAttackOffset,
  runOwnsRaid,
  settlementEligibleAt,
  settlementRetryDue,
  snapshotCanApply,
} from "../public/shard-hydra/state.mjs";

test("visual Hydra HP never rebounds when chain snapshots arrive out of order", () => {
  assert.equal(monotonicHp(20, 22), 20);
  assert.equal(monotonicHp(20, 19), 19);
  assert.equal(monotonicHp(0, 1), 0);
});

test("a stale refresh cannot mutate a newer run", () => {
  assert.equal(
    snapshotCanApply({
      sequence: 4,
      appliedSequence: 3,
      requestRunToken: 8,
      currentRunToken: 9,
    }),
    false,
  );
  assert.equal(
    snapshotCanApply({
      sequence: 4,
      appliedSequence: 3,
      requestRunToken: 9,
      currentRunToken: 9,
    }),
    true,
  );
});

test("relay acceptance does not suppress settlement retries", () => {
  const input = {
    confirmedThrough: 3,
    attackId: 3,
    previousRequest: { attackId: 3, sentAt: 1_000 },
    retryMs: 3_000,
  };
  assert.equal(settlementRetryDue({ ...input, now: 3_999 }), false);
  assert.equal(settlementRetryDue({ ...input, now: 4_000 }), true);
  assert.equal(
    settlementRetryDue({ ...input, confirmedThrough: 4, now: 8_000 }),
    false,
  );
});

test("only the raid bound to the foreground run may end it", () => {
  assert.equal(
    runOwnsRaid({ started: true, activeRunRaidId: 21, snapshotRaidId: 20 }),
    false,
  );
  assert.equal(
    runOwnsRaid({ started: true, activeRunRaidId: 21, snapshotRaidId: 21 }),
    true,
  );
});

test("deferred settlement waits through the contract grace and safety buffer", () => {
  assert.equal(settlementEligibleAt(10_000, 5_000), 16_000);
  assert.equal(settlementEligibleAt(10_000, 5_000, 250), 15_250);
});

test("Hydra: full 30s of combat, then a 6s tail for the final onchain strikes", () => {
  // raid window = combat(30s) + settle tail(6s) = 36s. Combat is NOT cut short:
  // combat = raid - grace - safety, so raid 36s yields the full 30s of play.
  assert.equal(combatDuration(36_000, 5_000), 30_000);
});

test("Hydra: reaction window ramps 1.4s->0.4s while bites stay on a steady 1.5s beat", () => {
  // decoupled model — must match the hub contract's getConfig + attack_bounds.
  const config = {
    attackSpacing: 1_500,
    startWindow: 1_400,
    windowStep: 80,
    minWindow: 400,
  };

  // The familiar opening is unchanged; only the solo endgame tightens further.
  assert.equal(progressiveAttackDuration(0, config), 1_400);
  assert.equal(progressiveAttackDuration(5, config), 1_000);
  assert.equal(progressiveAttackDuration(10, config), 600);
  assert.equal(progressiveAttackDuration(11, config), 520);
  assert.equal(progressiveAttackDuration(12, config), 440);
  assert.equal(progressiveAttackDuration(13, config), 400);
  assert.equal(progressiveAttackDuration(20, config), 400);

  for (let attackId = 1; attackId <= 20; attackId += 1) {
    assert.ok(
      progressiveAttackDuration(attackId, config) <=
        progressiveAttackDuration(attackId - 1, config),
    );
  }

  // bites land on a steady beat, DECOUPLED from the window: offset is linear
  // (attack_id * ATTACK_SPACING_MS), matching the contract's attack_bounds.
  assert.equal(progressiveAttackOffset(0, config), 0);
  assert.equal(progressiveAttackOffset(1, config), 1_500);
  assert.equal(progressiveAttackOffset(10, config), 15_000);
  assert.equal(progressiveAttackOffset(20, config), 30_000);

  assert.equal(progressiveAttackAtElapsed(0, config), 0);
  assert.equal(progressiveAttackAtElapsed(1_600, config), 1);
  assert.equal(progressiveAttackAtElapsed(15_000, config), 10);
});
