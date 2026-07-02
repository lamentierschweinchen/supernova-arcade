import {
  createArcadeClient,
  UNDEPLOYED_PLACEHOLDER,
} from "/arcade-core.js";
import { mountGalaxy } from "/arcade-galaxy.js";
import { topPlusSelf, fetchGameBoard, BOARD_GAP } from "/arcade-board.js";
import { getHandle, setHandle as savePassportHandle, getAddress } from "/passport.js";
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
} from "/shard-hydra/state.mjs";

mountGalaxy({ intensity: 0.5, focusShard: 0 });

const client = createArcadeClient("shardhydra");
const $ = (id) => document.getElementById(id);
const headEls = [...document.querySelectorAll(".head")];
const reviewState = new URLSearchParams(window.location.search).get("review");

// Replaced together after every fresh four-contract deployment.
const HEADS = [
  "erd1qqqqqqqqqqqqqpgqdra35g6vnytdh8lnuuhpth4xs46xvjvqppuqgh7u5r",
  "erd1qqqqqqqqqqqqqpgq6w5as8ku03k4ag2wzygdyzcux0c98lmrx63sf3ctpx",
  "erd1qqqqqqqqqqqqqpgqgam85mljt0jz4tfj2uvky0n2mrefm6da5cdqlr79w9",
];
const JOIN_GAS = 10_000_000;
const HIT_GAS = 14_000_000;
const SETTLE_GAS = 30_000_000;
const SETTLEMENT_RETRY_MS = 3_000;
const SETTLEMENT_DISPATCH_SAFETY_MS = 250;
const COMBAT_TAIL_SAFETY_MS = 1_000;
const VICTORY_REVEAL_MS = 400;
// A brief serpentine "settle" beat before EVERY result: the Hydra slithers while the
// last onchain strike settles, then the result panel drops.
const SETTLE_BEAT_MS = 1_500;
const REVIEW_ATTACK_ORDER = [1, 0, 2, 1, 2, 0, 0, 2, 1, 0, 1, 2];
const U64_MASK = (1n << 64n) - 1n;

const S = {
  booted: Boolean(reviewState),
  live: false,
  started: false,
  joined: false,
  joining: false,
  combatReady: false,
  readyAt: 0,
  resultShown: false,
  resultFinal: false,
  frozen: Boolean(reviewState),
  runToken: 0,
  activeRunRaidId: 0,
  raidId: 0,
  raidStartedAt: 0,
  raidDeadline: 0,
  raidSeed: 0n,
  attackIndex: 0,
  activeHead: -1,
  joinAttack: 0,
  nextSettlement: 0,
  responseHead: -1,
  phase: "waiting",
  hp: 15,
  visualHp: 15,
  maxHp: 15,
  lives: 2,
  chainLives: 2,
  score: 0,
  raidHits: 0,
  localHits: 0,
  raidAttempts: 0,
  wrongHits: 0,
  timeouts: 0,
  currentStreak: 0,
  bestStreak: 0,
  attackDeadline: 0,
  attackDuration: 2_200,
  nextTimer: 0,
  frame: 0,
  refreshTimer: 0,
  lastObservedAttack: -1,
  lastObservedHp: 15,
  lastObservedScore: 0,
  localResponses: new Map(),
  pendingHits: new Map(),
  settlementTargets: new Map(),
  settlementRequests: new Map(),
  settlementConfirmedThrough: new Map(),
  settlementInFlight: false,
  settlementTimer: 0,
  refreshInFlight: false,
  refreshSequence: 0,
  appliedRefreshSequence: 0,
  raidContexts: new Map(),
  offeredRaidId: 0,
  offerScheduledRaidId: 0,
  offerTimer: 0,
  config: {
    raidDuration: 36_000,
    maxLives: 2,
    progressive: true, // decoupled model — MUST match hub getConfig: steady 1.5s beat + window 1.4s->0.4s
    attackSpacing: 1_500,
    firstAttacks: 6,
    firstWindow: 2_600,
    secondWindow: 2_200,
    finalWindow: 1_800,
    rampAttacks: 8,
    startWindow: 1_400,
    windowStep: 80,
    minWindow: 400,
    settlementGrace: 5_000,
  },
};

function mix64(input) {
  let z = (BigInt(input) + 0x9E3779B97F4A7C15n) & U64_MASK;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & U64_MASK;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & U64_MASK;
  return (z ^ (z >> 31n)) & U64_MASK;
}

function expectedHead(attackId, raidId = S.raidId) {
  if (!S.live) return REVIEW_ATTACK_ORDER[attackId % REVIEW_ATTACK_ORDER.length];
  const seed = S.raidContexts.get(raidId)?.seed ?? S.raidSeed;
  return Number(mix64(BigInt(seed) ^ BigInt(attackId)) % 3n);
}

function attackDuration(index) {
  if (S.config.progressive) {
    return progressiveAttackDuration(index, S.config);
  }
  if (index < S.config.firstAttacks) return S.config.firstWindow;
  if (index < S.config.firstAttacks + 8) return S.config.secondWindow;
  return S.config.finalWindow;
}

function attackBounds(index, raidId = S.raidId) {
  const startedAt = S.raidContexts.get(raidId)?.startedAt ?? S.raidStartedAt;
  if (S.config.progressive) {
    const opensAt = startedAt + progressiveAttackOffset(index, S.config);
    return [opensAt, opensAt + attackDuration(index)];
  }
  const secondAttacks = 8;
  let offset;
  if (index < S.config.firstAttacks) {
    offset = index * S.config.firstWindow;
  } else if (index < S.config.firstAttacks + secondAttacks) {
    offset =
      S.config.firstAttacks * S.config.firstWindow +
      (index - S.config.firstAttacks) * S.config.secondWindow;
  } else {
    offset =
      S.config.firstAttacks * S.config.firstWindow +
      secondAttacks * S.config.secondWindow +
      (index - S.config.firstAttacks - secondAttacks) * S.config.finalWindow;
  }
  const opensAt = startedAt + offset;
  return [opensAt, opensAt + attackDuration(index)];
}

function attackAtTime(now, raidId = S.raidId) {
  const startedAt = S.raidContexts.get(raidId)?.startedAt ?? S.raidStartedAt;
  const elapsed = Math.min(
    S.config.raidDuration,
    Math.max(0, now - startedAt),
  );
  if (S.config.progressive) {
    return progressiveAttackAtElapsed(elapsed, S.config);
  }
  const firstSpan = S.config.firstAttacks * S.config.firstWindow;
  const secondSpan = 8 * S.config.secondWindow;
  if (elapsed < firstSpan) {
    return Math.floor(elapsed / S.config.firstWindow);
  }
  if (elapsed < firstSpan + secondSpan) {
    return (
      S.config.firstAttacks +
      Math.floor((elapsed - firstSpan) / S.config.secondWindow)
    );
  }
  return (
    S.config.firstAttacks +
    8 +
    Math.floor((elapsed - firstSpan - secondSpan) / S.config.finalWindow)
  );
}

function chainNow() {
  // Testnet block timestamps are Unix milliseconds. Once the hub gives us the
  // raid anchor, wall time is smoother and fresher than polling a block-backed
  // "now" value every attack.
  return Date.now();
}

function combatEndsAt(startedAt = S.raidStartedAt) {
  return (
    startedAt +
    combatDuration(
      S.config.raidDuration,
      S.config.settlementGrace,
      COMBAT_TAIL_SAFETY_MS,
    )
  );
}

function scheduleNextRaidOffer(raidId, deadline) {
  if (S.offerScheduledRaidId === raidId) return;
  if (S.offerTimer) window.clearTimeout(S.offerTimer);
  S.offerScheduledRaidId = raidId;
  S.offerTimer = window.setTimeout(() => {
    S.offerTimer = 0;
    if (S.started || S.joining || S.raidId !== raidId) return;
    S.offeredRaidId = raidId;
    $("mode").textContent = "Ready";
    $("start").disabled = false;
    $("start").textContent = "Fight";
    setStatus("", "The next Hydra is ready.");
  }, Math.max(0, deadline - chainNow() + 100));
}

function formatClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function decodeMany(parts, count) {
  if (!parts || parts.length < count) return null;
  return parts.slice(0, count).map(client.decodeU64);
}

function decodeU64BigInt(part) {
  const bytes = client.b64ToBytes(part || "");
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function setInstruction(kind, title, copy) {
  const box = $("instruction");
  box.className = `instruction ${kind || ""}`.trim();
  $("instructionTitle").textContent = title;
  $("instructionCopy").textContent = copy;
}

function setStatus(kind, copy) {
  $("statusBox").className = `status ${kind || ""}`.trim();
  $("status").textContent = copy;
}

function raidAccuracy() {
  if (!S.raidAttempts) return 0;
  return Math.min(100, Math.round((S.localHits / S.raidAttempts) * 100));
}

function resetRunStats() {
  S.raidHits = 0;
  S.localHits = 0;
  S.raidAttempts = 0;
  S.wrongHits = 0;
  S.timeouts = 0;
  S.currentStreak = 0;
  S.bestStreak = 0;
  S.resultShown = false;
  S.resultFinal = false;
  S.resultBeatArmed = false;
  S.resultBeatDone = false;
}

function hideGate() {
  $("gate").classList.add("gone");
  $("gate").setAttribute("aria-hidden", "true");
  $("gate").inert = true;
}

function showGatePanel(panel) {
  $("briefingPanel").hidden = panel !== "briefing";
  $("resultPanel").hidden = panel !== "result";
  $("gate").classList.remove("gone");
  $("gate").removeAttribute("aria-hidden");
  $("gate").inert = false;
}

function bestRaidHits() {
  try {
    return Number(localStorage.getItem("shardhydra.bestRaidHits") || 0);
  } catch {
    return 0;
  }
}

function rememberBestRaidHits(value) {
  try {
    localStorage.setItem("shardhydra.bestRaidHits", String(value));
  } catch {
    // A personal best is optional; the onchain score remains authoritative.
  }
}

function biteSummary() {
  const parts = [];
  if (S.wrongHits) parts.push(`${S.wrongHits} wrong ${S.wrongHits === 1 ? "head" : "heads"}`);
  if (S.timeouts) parts.push(`${S.timeouts} ${S.timeouts === 1 ? "timeout" : "timeouts"}`);
  return parts.length ? parts.join(" · ") : "2 bites";
}

function showResult({ raidWon, pending = false }) {
  if (S.resultFinal || (S.resultShown && pending)) return;
  S.resultShown = true;
  S.resultFinal = !pending;
  S.combatReady = false;
  clearNextTimer();

  const eliminated = S.lives === 0;
  let title;
  let reason;
  if (pending) {
    title = "YOU WERE DEVOURED";
    reason = `Two bites ended your run. ${biteSummary()}.`;
  } else if (raidWon && eliminated) {
    title = "HYDRA SLAIN";
    reason = "Your team finished the Hydra after you fell.";
  } else if (raidWon) {
    title = "HYDRA SLAIN";
    reason = `You survived and the team dealt all ${S.maxHp} damage.`;
  } else if (eliminated) {
    title = "THE HYDRA ESCAPED";
    reason = `Two bites ended your run. The Hydra escaped with ${visibleHydraHp()} HP.`;
  } else {
    title = "THE HYDRA ESCAPED";
    reason = `Time expired with ${visibleHydraHp()} Hydra HP remaining.`;
  }

  $("resultKicker").textContent = pending ? "Your run is over" : raidWon ? "Raid won" : "Raid lost";
  $("resultTitle").textContent = title;
  $("resultReason").textContent = reason;
  // Arcade score is always the value read back from the hub. Immediate local
  // feedback lives in HP, accuracy, and streak instead.
  $("resultDamage").textContent = String(S.raidHits);
  $("resultAccuracy").textContent = `${raidAccuracy()}%`;
  $("resultStreak").textContent = String(S.bestStreak);
  $("resultHp").textContent = String(visibleHydraHp());
  $("resultCause").textContent = eliminated
    ? `${biteSummary()} ended your run.`
    : `${S.lives} ${S.lives === 1 ? "life" : "lives"} remaining.`;

  const previousBest = bestRaidHits();
  if (!pending && S.raidHits > previousBest) {
    rememberBestRaidHits(S.raidHits);
    $("resultHook").textContent = "New personal best";
  } else if (previousBest > 0) {
    const needed = Math.max(1, previousBest - S.raidHits + 1);
    $("resultHook").textContent = `${needed} more ${needed === 1 ? "hit" : "hits"} to beat your best`;
  } else {
    $("resultHook").textContent = pending ? "Your team is still fighting" : "Fight again. Hit harder.";
  }

  $("resultAction").textContent = pending ? "Watch the raid" : "Fight again";
  $("resultAction").dataset.action = pending ? "watch" : "replay";

  // Universal settle beat: the Hydra slithers for a moment (covering the last onchain
  // strike) before the result panel drops. Runs once per run; a later pending->final
  // update just refreshes the fields and re-shows the panel.
  if (S.resultBeatDone) {
    S.phase = "ended";
    render();
    showGatePanel("result");
    window.setTimeout(() => $("resultAction").focus(), 0);
  } else if (!S.resultBeatArmed) {
    S.resultBeatArmed = true;
    S.phase = "slither";
    $("screen").classList.add("slither");
    render();
    const beatToken = S.runToken;
    window.setTimeout(() => {
      $("screen").classList.remove("slither");
      if (S.runToken !== beatToken) return; // a new run started during the beat
      S.resultBeatDone = true;
      S.phase = "ended";
      render();
      showGatePanel("result");
      window.setTimeout(() => $("resultAction").focus(), 0);
    }, SETTLE_BEAT_MS);
  }
  // else: the slither is armed + running; its timer reveals with the latest fields.
}

function visibleHydraHp() {
  return Math.max(0, S.visualHp);
}

function updateStats() {
  const visibleHp = visibleHydraHp();
  $("hp").textContent = visibleHp;
  $("hpCopy").textContent = `${visibleHp} of ${S.maxHp}`;
  $("hpFill").style.transform = `scaleX(${Math.max(0, visibleHp / Math.max(1, S.maxHp))})`;
  $("score").textContent = S.raidHits;
  $("lives").textContent =
    "♥".repeat(S.lives) + "♡".repeat(Math.max(0, S.config.maxLives - S.lives));
  $("accuracy").textContent = S.raidAttempts ? `${raidAccuracy()}%` : "—";
  const progressbar = document.querySelector(".hp-track");
  progressbar.setAttribute("aria-valuemax", String(S.maxHp));
  progressbar.setAttribute("aria-valuenow", String(visibleHp));
}

function renderHeads() {
  $("arena").classList.toggle("threat-chorus", S.phase === "attack");
  $("screen").classList.toggle("settling", S.phase === "settling");
  headEls.forEach((head, index) => {
    const action = head.querySelector(".head-action");
    const eligible =
      S.started &&
      S.joined &&
      S.combatReady &&
      S.lives > 0 &&
      visibleHydraHp() > 0 &&
      S.attackIndex >= S.joinAttack &&
      !S.localResponses.has(S.attackIndex);
    const isActive = S.phase === "attack" && index === S.activeHead;
    const isHit = S.phase === "hit" && index === S.responseHead;
    const isWrong =
      S.phase === "bite" &&
      index === S.responseHead &&
      S.responseHead !== S.activeHead;
    head.classList.toggle("attacking", isActive);
    head.classList.toggle("hit", isHit);
    head.classList.toggle("wrong", isWrong);
    head.disabled = S.phase !== "attack" || !eligible;
    head.setAttribute("aria-disabled", String(head.disabled));
    head.setAttribute(
      "aria-label",
      isActive
        ? `Hit the attacking Hydra head on Shard ${index}`
        : `Hydra head on Shard ${index}`,
    );
    action.textContent = isActive
      ? eligible
        ? "Hit this head"
        : "Response sent"
      : isHit
        ? "Hit · sent"
        : isWrong
          ? "Wrong head"
          : S.phase === "bite" && index === S.activeHead
            ? "It bit you"
            : "Waiting";
  });
}

function render() {
  updateStats();
  renderHeads();
  if (!S.started) $("raidClock").textContent = formatClock(combatEndsAt(0));
}

function clearNextTimer() {
  if (S.nextTimer) window.clearTimeout(S.nextTimer);
  S.nextTimer = 0;
}

function finishVictory() {
  if (S.resultShown || S.phase === "victory") return;
  S.visualHp = 0;
  S.combatReady = false;
  S.phase = "victory";
  clearNextTimer();
  setInstruction("hit", "HYDRA SLAIN", "You landed the final blow.");
  setStatus("ok", "The Hydra is down.");
  $("mode").textContent = "Raid won";
  $("screen").classList.add("victory");
  render();
  window.setTimeout(() => {
    $("screen").classList.remove("victory");
    showResult({ raidWon: true });
  }, VICTORY_REVEAL_MS);
}

function enterSettlementTail() {
  if (
    !S.live ||
    S.resultShown ||
    S.phase === "settling" ||
    S.phase === "victory" ||
    visibleHydraHp() === 0
  ) {
    return;
  }
  S.combatReady = false;
  S.phase = "settling";
  S.activeHead = -1;
  clearNextTimer();
  setInstruction("hit", "THE HYDRA REELS", "No more heads. Final blows are landing.");
  setStatus("", "The fight ends when the last strikes land.");
  $("mode").textContent = "Final blows";
  render();
}

function showDamage() {
  const pop = $("damagePop");
  pop.classList.remove("show");
  void pop.offsetWidth;
  pop.classList.add("show");
  window.setTimeout(() => pop.classList.remove("show"), 450);
}

function showBite(reason, clickedHead = -1) {
  S.phase = "bite";
  S.responseHead = clickedHead;
  S.lives = Math.max(0, S.lives - 1);
  S.raidAttempts += 1;
  S.currentStreak = 0;
  if (reason === "wrong") S.wrongHits += 1;
  else S.timeouts += 1;
  $("screen").classList.remove("bitten");
  void $("screen").offsetWidth;
  $("screen").classList.add("bitten");
  const title = reason === "wrong" ? "BITTEN · WRONG HEAD" : "BITTEN · TOO SLOW";
  const copy = S.lives
    ? `${S.lives} ${S.lives === 1 ? "life" : "lives"} left. Watch for the next attacking head.`
    : "No lives left. You are out until the next raid.";
  setInstruction("bite", title, copy);
  setStatus(
    "err",
    reason === "wrong"
      ? "Wrong head. You lost one life."
      : "Too slow. You lost one life.",
  );
  render();
  window.setTimeout(() => $("screen").classList.remove("bitten"), 350);
  if (S.lives === 0) {
    $("mode").textContent = "Out";
    window.setTimeout(() => showResult({ raidWon: false, pending: true }), 300);
  }
}

function showCorrectHit(head) {
  S.phase = "hit";
  S.responseHead = head;
  S.raidAttempts += 1;
  S.localHits += 1;
  S.currentStreak += 1;
  S.bestStreak = Math.max(S.bestStreak, S.currentStreak);
  setInstruction("hit", "HIT · HYDRA HURT", "−1 Hydra HP. Watch for the next head.");
  setStatus("ok", "Clean hit. The Hydra lost 1 HP.");
  showDamage();
  render();
}

function scheduleResolution(raidId, attackId) {
  if (!S.live) return;
  const previous = S.settlementTargets.get(raidId) ?? -1;
  if (attackId > previous) S.settlementTargets.set(raidId, attackId);
  const player = client.address;
  if (!player) return;
  const eligibleAt = settlementEligibleAt(
    attackBounds(attackId, raidId)[1],
    S.config.settlementGrace,
    SETTLEMENT_DISPATCH_SAFETY_MS,
  );
  void fetch("/api/hydra/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player, raidId, attackId, eligibleAt }),
    keepalive: true,
  }).catch(() => {
    // The in-page settlement pump remains active as the immediate fallback.
  });
}

function readySettlementTarget(raidId, target) {
  const context = S.raidContexts.get(raidId);
  if (!context) return -1;
  const readyAt =
    chainNow() -
    S.config.settlementGrace -
    SETTLEMENT_DISPATCH_SAFETY_MS;
  if (readyAt <= context.startedAt) return -1;
  return Math.min(target, Math.max(-1, attackAtTime(readyAt, raidId) - 1));
}

async function sendSettlement(raidId, attackId) {
  if (attackId < 0) return false;
  const confirmedThrough = S.settlementConfirmedThrough.get(raidId) ?? 0;
  const previous = S.settlementRequests.get(raidId);
  if (!settlementRetryDue({
    confirmedThrough,
    attackId,
    previousRequest: previous,
    now: chainNow(),
    retryMs: SETTLEMENT_RETRY_MS,
  })) {
    return false;
  }
  const player = client.addressHex();
  if (!player) return false;
  try {
    const receipt = await client.sendAction(
      "settlePlayer",
      [player, client.u64ToHex(raidId), client.u64ToHex(attackId)],
      SETTLE_GAS,
    );
    // Relay acceptance is not settlement. Keep the target queued until the
    // hub's nextSettlement value proves that this attack was processed.
    S.settlementRequests.set(raidId, {
      attackId,
      sentAt: chainNow(),
      txHash: receipt.txHash,
    });
    return true;
  } catch {
    S.settlementRequests.set(raidId, {
      attackId,
      sentAt: chainNow() - SETTLEMENT_RETRY_MS + 750,
      txHash: "",
    });
    setStatus(
      "warn",
      "The raid is reconnecting. Keep playing.",
    );
    return false;
  }
}

async function pumpResolutions() {
  if (!S.live || S.settlementInFlight) return;
  let candidate = null;
  for (const [raidId, target] of S.settlementTargets) {
    const readyThrough = readySettlementTarget(raidId, target);
    const confirmedThrough = S.settlementConfirmedThrough.get(raidId) ?? 0;
    if (readyThrough >= confirmedThrough) {
      candidate = { raidId, attackId: readyThrough };
      break;
    }
  }
  if (!candidate) return;

  S.settlementInFlight = true;
  try {
    await sendSettlement(candidate.raidId, candidate.attackId);
  } finally {
    S.settlementInFlight = false;
  }
}

async function submitHit(head, raidId, attackId, attempt = 0) {
  const key = `${raidId}:${attackId}`;
  try {
    const receipt = await client.sendActionTo(
      HEADS[head],
      "hit",
      [client.u64ToHex(raidId), client.u64ToHex(attackId)],
      HIT_GAS,
    );
    const pending = S.pendingHits.get(key);
    if (pending) {
      pending.txHash = receipt.txHash;
      pending.status = "submitted";
    }
  } catch {
    const retryDeadline = attackBounds(attackId, raidId)[1] + 3_000;
    if (attempt < 2 && chainNow() < retryDeadline) {
      window.setTimeout(() => {
        void submitHit(head, raidId, attackId, attempt + 1);
      }, 500 * (attempt + 1));
      return;
    }
    const pending = S.pendingHits.get(key);
    if (pending) pending.status = "failed";
    setStatus(
      "err",
      "That hit could not reach the Hydra. Keep fighting.",
    );
  }
}

function handleHeadClick(head) {
  if (
    !S.started ||
    S.phase !== "attack" ||
    S.lives === 0 ||
    S.hp === 0 ||
    S.frozen ||
    !S.combatReady ||
    visibleHydraHp() === 0 ||
    S.localResponses.has(S.attackIndex)
  ) {
    return;
  }
  const raidId = S.raidId;
  const attackId = S.attackIndex;
  const responseKey = `${raidId}:${attackId}`;
  S.localResponses.set(attackId, head);
  scheduleResolution(raidId, attackId);

  if (head === S.activeHead) {
    S.visualHp = Math.max(0, S.visualHp - 1);
    S.pendingHits.set(responseKey, {
      raidId,
      attackId,
      status: "queued",
      txHash: "",
    });
    showCorrectHit(head);
    if (visibleHydraHp() === 0) {
      finishVictory();
    }
  } else {
    showBite("wrong", head);
  }

  if (S.live) {
    void submitHit(head, raidId, attackId);
  }
  else if (head === S.activeHead) {
    S.score += 1;
    S.raidHits += 1;
    S.hp = S.visualHp;
    render();
  }
}

function enterAttack(attackId, head) {
  S.attackIndex = attackId;
  S.activeHead = head;
  S.attackDuration = attackDuration(attackId);
  S.attackDeadline = attackBounds(attackId)[1];
  S.responseHead = -1;

  if (!S.joined) {
    S.phase = "waiting";
    setInstruction("", "GET READY", "The Hydra is waking.");
    return;
  }
  if (S.lives === 0) {
    S.phase = "spectating";
    setInstruction("", "YOU'RE OUT · WATCH THE RAID", "Other players can finish this Hydra. You rejoin with two lives next raid.");
    setStatus("", `Spectating the shared fight at ${visibleHydraHp()} Hydra HP.`);
    $("mode").textContent = "Spectating";
    return;
  }
  const response = S.localResponses.get(attackId);
  if (response !== undefined) {
    S.phase = response === head ? "hit" : "bite";
    S.responseHead = response;
    return;
  }

  S.phase = "attack";
  setInstruction("attack", "HIT THE RED HEAD", "Only the open mouth is about to bite.");
  setStatus("warn", "It is about to bite.");
}

function handleAttackAdvance(attackId, head) {
  if (
    S.started &&
    S.joined &&
    S.lastObservedAttack >= S.joinAttack &&
    S.lastObservedAttack < attackId &&
    !S.localResponses.has(S.lastObservedAttack) &&
    S.lives > 0
  ) {
    S.localResponses.set(S.lastObservedAttack, -1);
    showBite("timeout");
    scheduleResolution(S.raidId, S.lastObservedAttack);
  }
  S.lastObservedAttack = attackId;
  enterAttack(attackId, head);
  render();
}

function beginJoinedRun(raidId, startedAt, chainJoinAttack) {
  const now = chainNow();
  S.activeRunRaidId = raidId;
  S.started = true;
  S.joined = true;
  S.joining = false;
  S.combatReady = false;
  S.phase = "countdown";
  S.lives = S.chainLives;

  if (now < startedAt) {
    S.readyAt = startedAt;
    S.joinAttack = Math.max(0, chainJoinAttack);
  } else {
    const currentAttack = attackAtTime(now, raidId);
    const nextAttack = Math.max(chainJoinAttack, currentAttack + 1);
    S.readyAt = attackBounds(nextAttack, raidId)[0];
    S.joinAttack = nextAttack;
  }
  S.lastObservedAttack = S.joinAttack - 1;
  $("mode").textContent = "Live · shared fight";
  setInstruction("", "GET READY", "The first head is about to strike.");
  setStatus("", "Two lives. Kill the Hydra.");
  render();
}

async function joinLiveRaid() {
  if (S.joining) return;
  const runToken = ++S.runToken;
  S.joining = true;
  S.started = false;
  S.joined = false;
  S.activeRunRaidId = 0;
  S.phase = "joining";
  resetRunStats();
  S.combatReady = false;
  $("start").disabled = true;
  $("start").textContent = "Starting";
  hideGate();
  setInstruction("", "THE HYDRA AWAKENS", "Get ready to strike.");
  setStatus("", "Two lives. Kill the Hydra.");
  render();
  try {
    await client.sendAction("joinRaid", [], JOIN_GAS);
    if (runToken !== S.runToken) return;
    setStatus("", "The first head is about to strike.");
    void refreshChain();
  } catch {
    if (runToken !== S.runToken) return;
    S.joining = false;
    S.started = false;
    S.phase = "waiting";
    showGatePanel("briefing");
    $("start").disabled = false;
    $("start").textContent = "Try again";
    setStatus("err", "The Hydra could not wake. Try again.");
  }
}

function startPractice() {
  if (S.started) return;
  S.runToken += 1;
  S.started = true;
  S.joined = true;
  S.activeRunRaidId = 1;
  resetRunStats();
  S.readyAt = Date.now() + 1_200;
  S.combatReady = false;
  S.visualHp = S.maxHp;
  S.raidId = 1;
  S.raidStartedAt = S.readyAt;
  S.raidDeadline = S.readyAt + S.config.raidDuration;
  S.raidContexts.set(1, { seed: 0n, startedAt: S.raidStartedAt });
  S.joinAttack = 0;
  S.lastObservedAttack = -1;
  hideGate();
  $("mode").textContent = "Practice";
  setInstruction("", "GET READY · 3", "Watch the heads.");
  setStatus("", "Two lives. Kill the Hydra.");
  render();
}

function scrollBoardIntoView() {
  // On mobile, bring the play area on-screen so the heads are visible and thumb-tappable
  // without scrolling mid-reaction — the intro copy otherwise pushes them below the fold.
  if (window.innerWidth > 640) return;
  const el = document.getElementById("screen");
  if (el) {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_e) {}
  }
}

function startGame() {
  if (!S.booted || S.joining) return;
  scrollBoardIntoView();
  if (S.live) joinLiveRaid();
  else startPractice();
}

function handleResultAction() {
  if ($("resultAction").dataset.action === "watch") {
    hideGate();
    S.phase = "spectating";
    $("mode").textContent = "Spectating";
    setInstruction("", "WATCH THE RAID", "Your team can still finish the Hydra.");
    setStatus("", `The Hydra has ${visibleHydraHp()} HP left.`);
    render();
    return;
  }

  S.started = false;
  S.joined = false;
  S.joining = false;
  S.runToken += 1;
  S.activeRunRaidId = 0;
  S.combatReady = false;
  S.localResponses.clear();
  S.pendingHits.clear();
  S.lastObservedAttack = -1;
  scrollBoardIntoView();
  if (S.live) void joinLiveRaid();
  else startPractice();
}

async function fetchChainSnapshot() {
  await client.ensureKey();
  const addressHex = client.addressHex();
  if (!addressHex) return null;

  const snapshotRaw = await client.query("getPlayerRaidSnapshot", [addressHex]);
  const snapshot = decodeMany(snapshotRaw, 15);
  if (snapshot) {
    return {
      raidRaw: snapshotRaw.slice(0, 9),
      raid: snapshot.slice(0, 9),
      mine: snapshot.slice(9, 15),
    };
  }

  // Backward-compatible only during a coordinated contract rollout.
  const raidRaw = await client.query("getRaidState");
  const raid = decodeMany(raidRaw, 9);
  if (!raid) return null;
  const mine = decodeMany(await client.query("getPlayerState", [addressHex]), 6);
  return mine ? { raidRaw, raid, mine } : null;
}

async function refreshChain() {
  if (!S.live || S.refreshInFlight) return;
  const sequence = ++S.refreshSequence;
  const runToken = S.runToken;
  S.refreshInFlight = true;
  try {
    const snapshot = await fetchChainSnapshot();
    if (!snapshot || !snapshotCanApply({
      sequence,
      appliedSequence: S.appliedRefreshSequence,
      requestRunToken: runToken,
      currentRunToken: S.runToken,
    })) {
      return;
    }
    S.appliedRefreshSequence = sequence;

    const [raidId, hp, maxHp, startedAt, deadline] = snapshot.raid;
    const [joined, lives, chainJoinAttack, nextSettlement, score, raidHits] =
      snapshot.mine;
    const raidChanged = raidId !== S.raidId;
    const raidExpired = startedAt > 0 && chainNow() >= deadline;
    const raidEnded = hp === 0 || raidExpired;
    const raidSettling =
      !raidEnded &&
      startedAt > 0 &&
      chainNow() >= combatEndsAt(startedAt);
    const previousRaidHits = S.raidHits;
    const previousChainHp = S.hp;
    const previousChainLives = S.chainLives;
    const previousLocalLives = S.lives;

    S.raidId = raidId;
    S.raidStartedAt = startedAt;
    S.raidDeadline = deadline;
    S.raidSeed = decodeU64BigInt(snapshot.raidRaw[5]);
    S.raidContexts.set(raidId, { seed: S.raidSeed, startedAt });
    S.hp = hp;
    S.maxHp = maxHp || S.maxHp;
    S.chainLives = lives;
    S.nextSettlement = nextSettlement;
    S.settlementConfirmedThrough.set(raidId, nextSettlement);
    S.score = score;
    S.raidHits = raidHits;

    if (raidChanged) {
      if (S.offerTimer) {
        window.clearTimeout(S.offerTimer);
        S.offerTimer = 0;
      }
      S.offerScheduledRaidId = 0;
      S.offeredRaidId = 0;
      S.lastObservedHp = hp;
      S.lastObservedScore = score;
      if (!S.started) {
        S.visualHp = raidEnded ? S.maxHp : hp;
        S.localResponses.clear();
        S.pendingHits.clear();
        S.lastObservedAttack = -1;
      }
    }

    const joinedThisRaid = Boolean(joined) && !raidEnded;
    if (S.joining && joinedThisRaid) {
      S.visualHp = hp;
      S.lives = lives;
      hideGate();
      beginJoinedRun(raidId, startedAt, chainJoinAttack);
    } else if (S.activeRunRaidId === raidId) {
      S.joined = joinedThisRaid;
      S.lives = Math.min(S.lives, lives);
      S.visualHp = monotonicHp(S.visualHp, hp);
      S.joinAttack = Math.max(S.joinAttack, chainJoinAttack);
    }

    let settledWithoutPoint = 0;
    const scoreDelta = Math.max(0, raidHits - previousRaidHits);
    let confirmedHits = scoreDelta;
    for (const [key, pending] of S.pendingHits) {
      if (pending.raidId === raidId && pending.attackId < nextSettlement) {
        S.pendingHits.delete(key);
        if (confirmedHits > 0) confirmedHits -= 1;
        else settledWithoutPoint += 1;
      }
    }
    const settlementTarget = S.settlementTargets.get(raidId);
    if (settlementTarget !== undefined && settlementTarget < nextSettlement) {
      S.settlementTargets.delete(raidId);
    }
    const request = S.settlementRequests.get(raidId);
    if (request && request.attackId < nextSettlement) {
      S.settlementRequests.delete(raidId);
    }

    if (
      S.activeRunRaidId === raidId &&
      hp < previousChainHp &&
      scoreDelta === 0
    ) {
      S.visualHp = monotonicHp(S.visualHp, hp);
      showDamage();
      setStatus("ok", "Another player struck the Hydra.");
    } else if (
      S.activeRunRaidId === raidId &&
      lives < previousChainLives &&
      lives < previousLocalLives
    ) {
      S.lives = lives;
      setStatus(
        "err",
        `The Hydra bit you. ${S.lives} ${S.lives === 1 ? "life" : "lives"} left.`,
      );
      if (S.lives === 0) showResult({ raidWon: false, pending: true });
    } else if (settledWithoutPoint > 0 && S.activeRunRaidId === raidId) {
      setStatus("warn", "That strike missed. Watch the next head.");
    }

    S.lastObservedHp = hp;
    S.lastObservedScore = score;

    if (!S.started && !S.joining) {
      S.joined = false;
      S.visualHp = raidEnded ? S.maxHp : hp;
      S.lives = S.config.maxLives;
      S.chainLives = S.config.maxLives;
      S.raidHits = 0;
      showGatePanel("briefing");
      if (raidSettling) {
        $("mode").textContent = "Final blows";
        $("start").disabled = true;
        $("start").textContent = "Next raid soon";
        setStatus("", "Final blows are landing. The next Hydra follows.");
        scheduleNextRaidOffer(raidId, deadline);
      } else {
        $("mode").textContent = "Ready";
        $("start").disabled = false;
        $("start").textContent = "Fight";
      }
    }

    if (runOwnsRaid({
      started: S.started,
      activeRunRaidId: S.activeRunRaidId,
      snapshotRaidId: raidId,
    }) && hp === 0) {
      if (S.resultShown) showResult({ raidWon: true });
      else finishVictory();
    } else if (
      runOwnsRaid({
        started: S.started,
        activeRunRaidId: S.activeRunRaidId,
        snapshotRaidId: raidId,
      }) &&
      raidExpired
    ) {
      setInstruction("bite", "THE HYDRA ESCAPED", "Time ran out.");
      $("mode").textContent = "Raid over";
      showResult({ raidWon: false });
    } else {
      if (S.resultShown) {
        $("resultDamage").textContent = String(S.raidHits);
        $("resultAccuracy").textContent = `${raidAccuracy()}%`;
        $("resultHp").textContent = String(visibleHydraHp());
        if (!S.resultFinal && S.lives === 0) {
          setStatus("", `Spectating the shared fight at ${visibleHydraHp()} Hydra HP.`);
        }
      }
      render();
    }
  } finally {
    S.refreshInFlight = false;
  }
}

/* ---------- leaderboard: top hitters (cumulative damage), scalable off-chain
   board + global cross-game names, top-10 + a pinned "you" row. ---------- */
const myBech = getAddress() || "";
function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

async function renderBoard() {
  const box = $("lbRows");
  if (!box) return;
  const rows = await fetchGameBoard("shardhydra");
  if (!rows.length) {
    box.innerHTML = '<li class="empty">No hits yet. Be the first to wound the Hydra.</li>';
    return;
  }
  const myHandle = getHandle();
  const rowHtml = (e) => {
    const mine = myBech && e.address === myBech;
    // your own row prefers your passport name (it shows even before it propagates onchain)
    const name = mine && myHandle
      ? escapeHtml(myHandle)
      : e.handle
        ? escapeHtml(e.handle)
        : shortAddr(e.address);
    return `<li><span class="rank">${e.rank}</span><span class="who${mine ? " you" : ""}">${name}</span><span class="sc">${fmtNum(e.score)}</span></li>`;
  };
  const { visible, self } = topPlusSelf(rows, myBech, 10);
  box.innerHTML = visible.map(rowHtml).join("") + (self ? BOARD_GAP + rowHtml(self) : "");
}

async function saveName() {
  const input = $("handle");
  if (!input) return;
  const v = (input.value || "").trim();
  if (!v) return;
  savePassportHandle(v); // one passport name — pre-fills every Arcade cabinet (set once, ported everywhere)
  await renderBoard(); // your row shows it immediately
  if (!S.live) {
    setStatus("ok", "Name saved. It goes onchain with the board once the raid is live.");
    return;
  }
  // Same path as every other cabinet: write the handle onchain. The hub, like
  // every game contract, requires one scoring hit before it stores your name.
  try {
    await client.sendAction("setHandle", [client.strToHex(v)], 10_000_000);
    setStatus("ok", "Name saved across the Arcade.");
  } catch (err) {
    const msg = String(err?.message || err?.code || "").toLowerCase();
    if (msg.includes("score first") || msg.includes("first"))
      setStatus("warn", "Land one hit first — then your name hits the shared board.");
    else setStatus("warn", "Name saved here. It will reach the shared board shortly.");
  }
}

async function bootstrap() {
  $("start").disabled = true;
  $("start").textContent = "Checking chain…";
  if (
    !client.deployed ||
    HEADS.some((address) => address === UNDEPLOYED_PLACEHOLDER)
  ) {
    S.booted = true;
    $("mode").textContent = "Practice";
    $("start").disabled = false;
    $("start").textContent = "Fight";
    render();
    return;
  }

  await client.ensureKey();
  const [configRaw, raidRaw] = await Promise.all([
    client.query("getConfig"),
    client.query("getRaidState"),
  ]);
  const config = decodeMany(configRaw, 8);
  const raid = decodeMany(raidRaw, 9);
  if (!config || !raid) {
    S.booted = true;
    S.live = false;
    $("mode").textContent = "Practice";
    $("start").disabled = false;
    $("start").textContent = "Fight";
    $("chainCopy").innerHTML = "<b>Practice mode.</b> The live testnet raid is temporarily unavailable.";
    setStatus("", "Live chain state could not be loaded. This run will not score.");
    render();
    return;
  }

  const [
    maxHp,
    raidDuration,
    maxLives,
    attackSpacing,
    startWindow,
    windowStep,
    minWindow,
    settlementGrace,
  ] = config;
  S.maxHp = maxHp;
  S.config.raidDuration = raidDuration;
  S.config.maxLives = maxLives;
  S.config.settlementGrace = settlementGrace;
  // Decoupled model: getConfig slot 4 is now the steady beat between bites
  // (ATTACK_SPACING_MS), not a ramp count. Window ramps independently.
  S.config.progressive = true;
  S.config.attackSpacing = attackSpacing;
  S.config.startWindow = startWindow;
  S.config.windowStep = windowStep;
  S.config.minWindow = minWindow;
  S.hp = raid[1];
  S.visualHp = raid[1];
  S.live = true;
  S.booted = true;
  $("chainCopy").innerHTML = "<b>No wallet. No gas. Just react.</b> Take the Hydra on solo, or pile on with the crowd.";
  $("mode").textContent = "Live · shared fight";
  $("start").disabled = false;
  $("start").textContent = "Fight";
  setStatus("", "Two lives. Thirty seconds. Kill the Hydra.");
  await refreshChain();
  S.refreshTimer = window.setInterval(() => void refreshChain(), 600);
  S.settlementTimer = window.setInterval(pumpResolutions, 750);
}

function tick() {
  if (S.started && !S.frozen) {
    const now = chainNow();
    // count down the COMBAT window (the 30s of play), not the raid+settlement window,
    // and hold at 0:30 until combat actually starts — never tick during the countdown.
    const combatLeft = Math.max(0, combatEndsAt() - Math.max(now, S.readyAt));
    $("raidClock").textContent = formatClock(combatLeft);

    if (!S.combatReady && !S.resultShown) {
      const countdownMs = S.readyAt - now;
      if (countdownMs > 0) {
        const count = Math.max(1, Math.ceil(countdownMs / 1_000));
        setInstruction("", `GET READY · ${count}`, "Watch the heads.");
      } else if (S.joined) {
        S.combatReady = true;
        if (!S.live) {
          S.joinAttack = 0;
          S.lastObservedAttack = -1;
        }
        setInstruction("", "WATCH THE HEADS", "Hit the one that rises and glows.");
      } else {
        setInstruction("", "GET READY", "The Hydra is waking.");
      }
    }

    if (
      S.joined &&
      S.combatReady &&
      visibleHydraHp() > 0 &&
      !S.resultShown &&
      S.raidStartedAt > 0 &&
      now < (S.live ? combatEndsAt() : S.raidDeadline)
    ) {
      const attackId = attackAtTime(now);
      if (attackId !== S.lastObservedAttack) {
        handleAttackAdvance(attackId, expectedHead(attackId));
      }
    }

    if (S.phase === "attack") {
      const attackMs = Math.max(0, S.attackDeadline - now);
      const scale = Math.max(0, Math.min(1, attackMs / S.attackDuration));
      const meter = headEls[S.activeHead]?.querySelector(".attack-meter i");
      if (meter) meter.style.transform = `scaleX(${scale})`;
      if (
        attackMs === 0 &&
        S.joined &&
        S.attackIndex >= S.joinAttack &&
        !S.localResponses.has(S.attackIndex)
      ) {
        S.localResponses.set(S.attackIndex, -1);
        showBite("timeout");
        scheduleResolution(S.raidId, S.attackIndex);
      }
    }

    if (
      S.live &&
      S.joined &&
      S.combatReady &&
      !S.resultShown &&
      now >= combatEndsAt() &&
      now < S.raidDeadline
    ) {
      enterSettlementTail();
    }
  }
  S.frame = window.requestAnimationFrame(tick);
}

function applyReviewState(state) {
  S.frozen = true;
  S.booted = true;
  if (state === "waiting") {
    render();
    return;
  }
  S.started = true;
  S.joined = true;
  S.combatReady = true;
  S.raidId = 12;
  S.raidStartedAt = Date.now() - 10_000;
  S.raidDeadline = Date.now() + 20_000;
  S.attackIndex = 7;
  S.activeHead = 1;
  S.joinAttack = 0;
  hideGate();
  $("raidClock").textContent = "0:20";
  $("mode").textContent = "Shared fight";

  if (state === "attack") {
    S.phase = "attack";
    S.attackDuration = attackDuration(S.attackIndex);
    setInstruction("attack", "HIT THE RED HEAD", "Only the open mouth is about to bite.");
    setStatus("warn", "It is about to bite.");
    headEls[1].querySelector(".attack-meter i").style.transform = "scaleX(.58)";
  } else if (state === "hit") {
    S.phase = "hit";
    S.responseHead = 1;
    S.hp = 14;
    S.visualHp = 14;
    S.score = 1;
    S.raidHits = 1;
    S.localHits = 1;
    S.raidAttempts = 1;
    S.bestStreak = 1;
    setInstruction("hit", "HIT · HYDRA HURT", "−1 Hydra HP. Watch for the next head.");
    setStatus("ok", "Clean hit. The Hydra lost 1 HP.");
    $("damagePop").classList.add("show");
  } else if (state === "bite") {
    S.phase = "bite";
    S.responseHead = 0;
    S.lives = 1;
    S.raidAttempts = 1;
    S.wrongHits = 1;
    setInstruction("bite", "BITTEN · WRONG HEAD", "1 life left. Watch for the next attacking head.");
    setStatus("err", "Wrong head. You lost 1 life.");
    $("screen").classList.add("bitten");
  } else if (state === "settling") {
    S.raidDeadline = Date.now() + 6_000;
    S.hp = 3;
    S.visualHp = 3;
    S.raidHits = 12;
    S.localHits = 12;
    S.raidAttempts = 14;
    $("raidClock").textContent = "0:06";
    S.live = true;
    enterSettlementTail();
  } else if (state === "victory") {
    S.hp = 0;
    S.visualHp = 0;
    S.raidHits = 9;
    S.localHits = 9;
    S.raidAttempts = 11;
    S.bestStreak = 6;
    showResult({ raidWon: true });
  } else if (state === "escape") {
    S.hp = 4;
    S.visualHp = 4;
    S.raidHits = 7;
    S.localHits = 7;
    S.raidAttempts = 10;
    S.bestStreak = 4;
    showResult({ raidWon: false });
  } else if (state === "dead") {
    S.hp = 9;
    S.visualHp = 9;
    S.lives = 0;
    S.raidHits = 5;
    S.localHits = 5;
    S.raidAttempts = 7;
    S.wrongHits = 1;
    S.timeouts = 1;
    S.bestStreak = 3;
    showResult({ raidWon: false, pending: true });
  }
  render();
}

headEls.forEach((head, index) => {
  head.addEventListener("click", () => handleHeadClick(index));
});
$("start").addEventListener("click", startGame);
$("resultAction").addEventListener("click", handleResultAction);
$("saveName")?.addEventListener("click", saveName);
$("handle")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveName();
});
{
  const h = $("handle");
  if (h) h.value = getHandle() || "";
}
renderBoard();
S.boardTimer = window.setInterval(renderBoard, 2500);
window.addEventListener("beforeunload", () => {
  clearNextTimer();
  if (S.frame) window.cancelAnimationFrame(S.frame);
  if (S.refreshTimer) window.clearInterval(S.refreshTimer);
  if (S.settlementTimer) window.clearInterval(S.settlementTimer);
  if (S.boardTimer) window.clearInterval(S.boardTimer);
});

if (reviewState) applyReviewState(reviewState);
else bootstrap();
S.frame = window.requestAnimationFrame(tick);
