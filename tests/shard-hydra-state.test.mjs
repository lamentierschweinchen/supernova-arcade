import test from "node:test";
import assert from "node:assert/strict";
import {
  monotonicHp,
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
});
