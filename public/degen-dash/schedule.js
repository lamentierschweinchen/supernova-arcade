// schedule.js — the DEGEN DASH stream schedule, byte-for-byte identical to the Rust
// contract (contract/src/lib.rs). Pure: no DOM, no network, no dependencies.
//
// Imported by BOTH the browser game (to render the exact stream the contract will
// referee against) AND scripts/verify-schedule.mjs (Node, to cross-check against
// the contract's Rust math). One source of truth, so client and contract can never
// disagree about what an item is.
//
// Each item has a kind (GOOD or BAD), a spawn time, and an amount — all a pure
// splitmix64 function of (seed, config). JavaScript does the u64 math with BigInt
// masked to 64 bits; Rust does it with wrapping u64 ops — same result. The hash
// constants match the Clawback engine exactly; only the meaning is flipped: here
// you TAP the good items to collect them and LEAVE the bad ones.

const MASK = (1n << 64n) - 1n;
const SPAWN_SALT = 0x13579bdf2468ace0n;
const KIND_SALT = 0x2468ace013579bdfn;

/** splitmix64 — identical to the contract's `mix64`. */
export function mix64(z0) {
  let z = (BigInt(z0) + 0x9e3779b97f4a7c15n) & MASK;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return (z ^ (z >> 31n)) & MASK;
}

function amountHash(seed, i) {
  return mix64((seed ^ mix64(i)) & MASK);
}
function spawnHash(seed, i) {
  return mix64((((seed + SPAWN_SALT) & MASK) ^ mix64(i)) & MASK);
}
function kindHash(seed, i) {
  return mix64((((seed + KIND_SALT) & MASK) ^ mix64(i)) & MASK);
}

/** Whether item `i` is GOOD (a win you should collect). The rest are bad (dodge). */
export function isGood(seed, i, goodPermil) {
  return kindHash(BigInt(seed), BigInt(i)) % 1000n < BigInt(goodPermil);
}

/** The amount of item `i` (skewed: mostly small, ~13% big). */
export function amountOf(seed, i) {
  const h = amountHash(BigInt(seed), BigInt(i));
  if (h % 100n < 13n) {
    return Number(9n + ((h >> 8n) % 17n)); // 9..=25 (big)
  }
  return Number(1n + ((h >> 8n) % 6n)); // 1..=6 (small)
}

/** Difficulty-ramp default. Per-mille strength of the concave time-warp below.
 *  500 makes the round's last items arrive ~3x as fast as the first. 0 = uniform. */
const DEFAULT_RAMP_PERMIL = 500n;

/** Concave time-warp for the difficulty ramp. Maps index i in [0,n] onto a spawn
 *  time in [0, span] via g(f) = f + r*f*(1-f), r = ramp/1000 — SPARSE + slow early,
 *  DENSE + fast late ("forgiving open, frantic finish"). Integer BigInt math so it
 *  matches the contract's u64/u128 path exactly. */
function warp(i, n, span, ramp) {
  const lin = (span * i) / n;
  const bump = (ramp * span * i * (n - i)) / (1000n * n * n);
  return lin + bump;
}

/** The ms offset (from round start) at which item `i` appears. Ramped (see warp);
 *  jitter fills its local slot. Spans [0, length-window] so every catch window
 *  still ends inside the round. */
export function spawnOf(seed, i, params) {
  const length = BigInt(params.roundLengthMs);
  const window = BigInt(params.catchWindowMs);
  const n = BigInt(params.items);
  const ramp = BigInt(params.rampPermil ?? DEFAULT_RAMP_PERMIL);
  const span = length - window;
  const bi = BigInt(i);
  const ti = warp(bi, n, span, ramp);
  const tnext = warp(bi + 1n, n, span, ramp);
  const local = tnext - ti;
  const jitter = local === 0n ? 0n : spawnHash(BigInt(seed), bi) % local;
  return Number(ti + jitter);
}

/** The catch window (ms) for item `i`. With late_window_shrink_permil = 0
 *  (default) it is a constant `catchWindowMs`; a positive value linearly shrinks
 *  the window toward the end of the round (tighter timing late). Integer math. */
export function windowOf(i, params) {
  const base = BigInt(params.catchWindowMs);
  const shrink = BigInt(params.lateWindowShrinkPermil ?? 0);
  if (shrink === 0n) return base;
  const n = BigInt(params.items);
  return (base * (1000n * n - shrink * BigInt(i))) / (1000n * n);
}

/** One item: kind, when it appears, how much, when its catch window closes. */
export function deriveItem(seed, i, params) {
  const spawnMs = spawnOf(seed, i, params);
  return {
    id: i,
    spawnMs,
    amount: amountOf(seed, i),
    good: isGood(seed, i, params.goodPermil),
    deadlineMs: spawnMs + Number(windowOf(i, params)),
  };
}

/** The whole round's items, ordered by spawn time (the order they stream in). */
export function buildSchedule(seed, params) {
  const out = [];
  for (let i = 0; i < params.items; i++) out.push(deriveItem(seed, i, params));
  out.sort((a, b) => a.spawnMs - b.spawnMs || a.id - b.id);
  return out;
}

/** Sum of good amounts — the contract's total_good (the perfect-run ceiling). */
export function goodTotal(seed, params) {
  let good = 0;
  for (let i = 0; i < params.items; i++) {
    if (isGood(seed, i, params.goodPermil)) good += amountOf(seed, i);
  }
  return good;
}
