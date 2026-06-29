import {
  createArcadeClient,
  UNDEPLOYED_PLACEHOLDER,
} from "/arcade-core.js";
import { mountGalaxy } from "/arcade-galaxy.js";
import { topPlusSelf, fetchGameBoard, BOARD_GAP } from "/arcade-board.js";
import { getHandle, setHandle as savePassportHandle, getAddress } from "/passport.js";

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
const RESOLVE_GAS = 30_000_000;
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
  hp: 24,
  maxHp: 24,
  lives: 3,
  chainLives: 3,
  score: 0,
  raidHits: 0,
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
  lastObservedHp: 24,
  lastObservedScore: 0,
  localResponses: new Map(),
  pendingHits: new Map(),
  settlementTargets: new Map(),
  settlementSentThrough: new Map(),
  settlementInFlight: false,
  settlementTimer: 0,
  raidContexts: new Map(),
  offeredRaidId: 0,
  offerScheduledRaidId: 0,
  offerTimer: 0,
  config: {
    raidDuration: 60_000,
    maxLives: 3,
    firstAttacks: 6,
    firstWindow: 2_600,
    secondWindow: 2_200,
    finalWindow: 1_800,
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
  if (index < S.config.firstAttacks) return S.config.firstWindow;
  if (index < S.config.firstAttacks + 8) return S.config.secondWindow;
  return S.config.finalWindow;
}

function attackBounds(index, raidId = S.raidId) {
  const startedAt = S.raidContexts.get(raidId)?.startedAt ?? S.raidStartedAt;
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
  const elapsed = Math.max(0, now - startedAt);
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
  return Math.min(100, Math.round((S.raidHits / S.raidAttempts) * 100));
}

function resetRunStats() {
  S.raidHits = 0;
  S.raidAttempts = 0;
  S.wrongHits = 0;
  S.timeouts = 0;
  S.currentStreak = 0;
  S.bestStreak = 0;
  S.resultShown = false;
  S.resultFinal = false;
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
  return parts.length ? parts.join(" · ") : "3 bites";
}

function showResult({ raidWon, pending = false }) {
  if (S.resultFinal || (S.resultShown && pending)) return;
  S.resultShown = true;
  S.resultFinal = !pending;
  S.combatReady = false;
  S.phase = "ended";
  render();

  const eliminated = S.lives === 0;
  let title;
  let reason;
  if (pending) {
    title = "YOU WERE DEVOURED";
    reason = `Three bites ended your run. ${biteSummary()}.`;
  } else if (raidWon && eliminated) {
    title = "HYDRA SLAIN";
    reason = "Your team finished the Hydra after you fell.";
  } else if (raidWon) {
    title = "HYDRA SLAIN";
    reason = "You survived and the team dealt all 24 damage.";
  } else if (eliminated) {
    title = "THE HYDRA ESCAPED";
    reason = `Three bites ended your run. The Hydra escaped with ${S.hp} HP.`;
  } else {
    title = "THE HYDRA ESCAPED";
    reason = `Time expired with ${S.hp} Hydra HP remaining.`;
  }

  $("resultKicker").textContent = pending ? "Your run is over" : raidWon ? "Raid won" : "Raid lost";
  $("resultTitle").textContent = title;
  $("resultReason").textContent = reason;
  $("resultDamage").textContent = String(S.raidHits);
  $("resultAccuracy").textContent = `${raidAccuracy()}%`;
  $("resultStreak").textContent = String(S.bestStreak);
  $("resultHp").textContent = String(S.hp);
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
  showGatePanel("result");
  window.setTimeout(() => $("resultAction").focus(), 0);
}

function visibleHydraHp() {
  return Math.max(0, S.hp - S.pendingHits.size);
}

function removeOldestPendingHits(count) {
  for (const key of S.pendingHits.keys()) {
    if (count <= 0) break;
    S.pendingHits.delete(key);
    count -= 1;
  }
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
  if (!S.started) $("raidClock").textContent = "1:00";
}

function clearNextTimer() {
  if (S.nextTimer) window.clearTimeout(S.nextTimer);
  S.nextTimer = 0;
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
}

function readySettlementTarget(raidId, target) {
  const context = S.raidContexts.get(raidId);
  if (!context) return -1;
  const readyAt = chainNow() - S.config.settlementGrace - 750;
  if (readyAt <= context.startedAt) return -1;
  return Math.min(target, Math.max(-1, attackAtTime(readyAt, raidId) - 1));
}

async function pumpResolutions() {
  if (!S.live || S.settlementInFlight) return;
  let candidate = null;
  for (const [raidId, target] of S.settlementTargets) {
    const readyThrough = readySettlementTarget(raidId, target);
    const sentThrough = S.settlementSentThrough.get(raidId) ?? -1;
    if (readyThrough > sentThrough) {
      candidate = { raidId, attackId: readyThrough };
      break;
    }
  }
  if (!candidate) return;

  const { raidId, attackId } = candidate;
  const head = expectedHead(attackId, raidId);
  S.settlementInFlight = true;
  try {
    await client.sendActionTo(
      HEADS[head],
      "resolveMiss",
      [client.u64ToHex(raidId), client.u64ToHex(attackId)],
      RESOLVE_GAS,
    );
    S.settlementSentThrough.set(raidId, attackId);
    if ((S.settlementTargets.get(raidId) ?? -1) <= attackId) {
      S.settlementTargets.delete(raidId);
    }
  } catch {
    setStatus(
      "warn",
      "The raid is reconnecting. Keep playing.",
    );
  } finally {
    S.settlementInFlight = false;
  }
}

async function submitHit(head, raidId, attackId) {
  try {
    await client.sendActionTo(
      HEADS[head],
      "hit",
      [client.u64ToHex(raidId), client.u64ToHex(attackId)],
      HIT_GAS,
    );
  } catch {
    S.pendingHits.delete(`${raidId}:${attackId}`);
    S.combatReady = true;
    render();
    setStatus(
      "err",
      `That hit did not land on Shard ${head}. Watch for the next head.`,
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
    S.pendingHits.set(responseKey, { raidId, attackId });
    showCorrectHit(head);
    if (visibleHydraHp() === 0) {
      S.combatReady = false;
      setInstruction("hit", "FINAL BLOW", "The Hydra is falling.");
      setStatus("ok", "The shared fight is over.");
      render();
    }
  } else {
    showBite("wrong", head);
  }

  if (S.live) void submitHit(head, raidId, attackId);
  else if (head === S.activeHead) {
    S.score += 1;
    S.raidHits += 1;
    S.hp = Math.max(0, S.hp - 1);
    render();
    if (S.hp === 0) showResult({ raidWon: true });
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
    setInstruction("", "YOU'RE OUT · WATCH THE RAID", "Other players can finish this Hydra. You rejoin with three lives next raid.");
    setStatus("", `Spectating the shared fight at ${S.hp} Hydra HP.`);
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
  setInstruction("attack", "HIT THE GLOWING HEAD", "Tap it before the red timer empties.");
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

async function joinLiveRaid() {
  if (S.joining) return;
  S.joining = true;
  resetRunStats();
  S.readyAt = Date.now() + 1_200;
  S.combatReady = false;
  $("start").disabled = true;
  $("start").textContent = "Get ready";
  hideGate();
  S.started = true;
  setInstruction("", "GET READY · 3", "Watch the heads.");
  setStatus("", "Three lives. Kill the Hydra.");
  render();
  try {
    await client.sendAction("joinRaid", [], JOIN_GAS);
    setStatus("", "Watch the heads.");
  } catch (error) {
    S.joining = false;
    S.started = false;
    showGatePanel("briefing");
    $("start").disabled = false;
    $("start").textContent = "Try again";
    setStatus("err", "The Hydra could not wake. Try again.");
  }
}

function startPractice() {
  if (S.started) return;
  S.started = true;
  S.joined = true;
  resetRunStats();
  S.readyAt = Date.now() + 1_200;
  S.combatReady = false;
  S.raidId = 1;
  S.raidStartedAt = S.readyAt;
  S.raidDeadline = S.readyAt + S.config.raidDuration;
  S.raidContexts.set(1, { seed: 0n, startedAt: S.raidStartedAt });
  S.joinAttack = 0;
  S.lastObservedAttack = 0;
  hideGate();
  $("mode").textContent = "Practice";
  setInstruction("", "GET READY · 3", "Watch the heads.");
  setStatus("", "Three lives. Kill the Hydra.");
  render();
}

function startGame() {
  if (!S.booted || S.joining) return;
  if (S.live) joinLiveRaid();
  else startPractice();
}

function handleResultAction() {
  if ($("resultAction").dataset.action === "watch") {
    hideGate();
    S.phase = "spectating";
    $("mode").textContent = "Spectating";
    setInstruction("", "WATCH THE RAID", "Your team can still finish the Hydra.");
    setStatus("", `The Hydra has ${S.hp} HP left.`);
    render();
    return;
  }

  S.started = false;
  S.joined = false;
  S.joining = false;
  S.combatReady = false;
  S.localResponses.clear();
  S.pendingHits.clear();
  S.lastObservedAttack = -1;
  if (S.live) void joinLiveRaid();
  else startPractice();
}

async function refreshChain() {
  if (!S.live) return;
  const raidRaw = await client.query("getRaidState");
  const raid = decodeMany(raidRaw, 9);
  if (!raid) return;

  const [
    raidId,
    hp,
    maxHp,
    startedAt,
    deadline,
  ] = raid;

  const raidChanged = raidId !== S.raidId;
  const raidExpired = startedAt > 0 && chainNow() >= deadline;
  const raidEnded = hp === 0 || raidExpired;
  S.raidId = raidId;
  S.raidStartedAt = startedAt;
  S.raidDeadline = deadline;
  S.raidSeed = decodeU64BigInt(raidRaw[5]);
  S.raidContexts.set(raidId, {
    seed: S.raidSeed,
    startedAt,
  });
  S.hp = hp;
  S.maxHp = maxHp || S.maxHp;

  await client.ensureKey();
  const addressHex = client.addressHex();
  const mine = addressHex
    ? decodeMany(await client.query("getPlayerState", [addressHex]), 6)
    : null;
  let settledWithoutPoint = 0;
  if (mine) {
    const [joined, lives, joinAttack, nextSettlement, score, raidHits] = mine;
    const wasJoined = S.joined;
    const previousScore = S.score;
    S.joined = Boolean(joined) && !raidEnded;
    S.chainLives = lives;
    S.lives = raidChanged || !wasJoined ? lives : Math.min(S.lives, lives);
    S.joinAttack =
      S.joined && !wasJoined
        ? attackAtTime(chainNow(), raidId)
        : Math.max(S.joinAttack, joinAttack);
    S.nextSettlement = nextSettlement;
    S.score = score;
    S.raidHits = raidHits;
    const scoreDelta = Math.max(0, score - previousScore);
    removeOldestPendingHits(scoreDelta);
    for (const [key, pending] of S.pendingHits) {
      if (
        pending.raidId === raidId &&
        pending.attackId < nextSettlement
      ) {
        S.pendingHits.delete(key);
        settledWithoutPoint += 1;
      }
    }
    if (S.joined && !wasJoined) {
      S.joining = false;
      S.started = true;
      S.lives = lives;
      $("mode").textContent = "Live · shared fight";
      setStatus("", "Three lives. Kill the Hydra.");
    }
  }

  if (raidChanged) {
    if (S.offerTimer) {
      window.clearTimeout(S.offerTimer);
      S.offerTimer = 0;
    }
    S.offerScheduledRaidId = 0;
    S.localResponses.clear();
    resetRunStats();
    S.lastObservedAttack = -1;
    S.lastObservedHp = hp;
    S.lastObservedScore = S.score;
    S.offeredRaidId = 0;
    if (S.joined) {
      S.started = true;
      S.joining = false;
      hideGate();
      $("mode").textContent = "Live · shared fight";
    } else {
      S.started = false;
      showGatePanel("briefing");
      $("mode").textContent = "Ready";
      document.querySelector(".rules-kicker").textContent = "How to play";
      document.querySelector(".rules h2").textContent = "Kill the Hydra.";
      document.querySelector(".rules > p").textContent = "Hit the glowing head before it bites. Three bites and you’re out.";
      $("start").disabled = false;
      $("start").textContent = "Fight";
    }
  }
  if (mine) S.raidHits = mine[5];

  if (hp < S.lastObservedHp) {
    showDamage();
    if (S.score === S.lastObservedScore) {
      setStatus("ok", "Another player hit! The Hydra lost 1 HP.");
    }
  } else if (S.chainLives < S.lives) {
    S.lives = S.chainLives;
    setStatus("err", `The Hydra bit you. ${S.lives} ${S.lives === 1 ? "life" : "lives"} left.`);
    if (S.lives === 0) showResult({ raidWon: false, pending: true });
  } else if (settledWithoutPoint > 0) {
    setStatus("warn", "Too late—no damage. Watch for the next head.");
  }

  S.lastObservedHp = hp;
  S.lastObservedScore = S.score;

  // A dormant shared raid is historical state, not the promise shown to the next
  // player. The next Fight call creates a fresh 24-HP raid with three lives.
  if (!S.started && !S.joined && raidEnded) {
    S.hp = S.maxHp;
    S.lives = S.config.maxLives;
    S.chainLives = S.config.maxLives;
    S.raidHits = 0;
  }

  // Raid and personal outcomes resolve separately: the player may be eliminated
  // before the shared Hydra is killed or escapes.
  if (S.started && hp === 0) {
    setInstruction("hit", "HYDRA DEAD", "The shared fight is over.");
    $("mode").textContent = "Raid won";
    showResult({ raidWon: true });
  } else if (S.started && raidExpired) {
    setInstruction("bite", "THE HYDRA ESCAPED", "Time ran out.");
    $("mode").textContent = "Raid over";
    showResult({ raidWon: false });
  } else {
    render();
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

  [
    S.maxHp,
    S.config.raidDuration,
    S.config.maxLives,
    S.config.firstAttacks,
    S.config.firstWindow,
    S.config.secondWindow,
    S.config.finalWindow,
    S.config.settlementGrace,
  ] = config;
  S.hp = raid[1];
  S.live = true;
  S.booted = true;
  $("chainCopy").innerHTML = "<b>No wallet. No gas. Just react.</b> Take the Hydra on solo, or pile on with the crowd.";
  $("mode").textContent = "Live · shared fight";
  $("start").disabled = false;
  $("start").textContent = "Fight";
  setStatus("", "Three lives. Sixty seconds. Kill the Hydra.");
  await refreshChain();
  S.refreshTimer = window.setInterval(refreshChain, 900);
  S.settlementTimer = window.setInterval(pumpResolutions, 750);
}

function tick() {
  if (S.started && !S.frozen) {
    const now = chainNow();
    const raidMs = Math.max(0, S.raidDeadline - now);
    $("raidClock").textContent = formatClock(raidMs);

    if (!S.combatReady && !S.resultShown) {
      const countdownMs = S.readyAt - now;
      if (countdownMs > 0) {
        const count = Math.max(1, Math.ceil(countdownMs / 400));
        setInstruction("", `GET READY · ${count}`, "Watch the heads.");
      } else if (S.joined) {
        S.combatReady = true;
        const currentAttack = attackAtTime(now);
        if (S.live) {
          const [, closesAt] = attackBounds(currentAttack);
          const enoughTime = closesAt - now >= attackDuration(currentAttack) * 0.65;
          S.joinAttack = enoughTime ? currentAttack : currentAttack + 1;
          S.lastObservedAttack = S.joinAttack - 1;
        } else {
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
      S.hp > 0 &&
      S.raidStartedAt > 0 &&
      now < S.raidDeadline
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
  S.raidStartedAt = Date.now() - 17_000;
  S.raidDeadline = Date.now() + 43_000;
  S.attackIndex = 7;
  S.activeHead = 1;
  S.joinAttack = 0;
  hideGate();
  $("raidClock").textContent = "0:43";
  $("mode").textContent = "Shared fight";

  if (state === "attack") {
    S.phase = "attack";
    S.attackDuration = 2_600;
    setInstruction("attack", "HIT THE GLOWING HEAD", "Tap it before the red timer empties.");
    setStatus("warn", "It is about to bite.");
    headEls[1].querySelector(".attack-meter i").style.transform = "scaleX(.58)";
  } else if (state === "hit") {
    S.phase = "hit";
    S.responseHead = 1;
    S.hp = 23;
    S.score = 1;
    S.raidHits = 1;
    S.raidAttempts = 1;
    S.bestStreak = 1;
    setInstruction("hit", "HIT · HYDRA HURT", "−1 Hydra HP. Watch for the next head.");
    setStatus("ok", "Clean hit. The Hydra lost 1 HP.");
    $("damagePop").classList.add("show");
  } else if (state === "bite") {
    S.phase = "bite";
    S.responseHead = 0;
    S.lives = 2;
    S.raidAttempts = 1;
    S.wrongHits = 1;
    setInstruction("bite", "BITTEN · WRONG HEAD", "2 lives left. Watch for the next attacking head.");
    setStatus("err", "Wrong head. You lost 1 life.");
    $("screen").classList.add("bitten");
  } else if (state === "victory") {
    S.hp = 0;
    S.raidHits = 9;
    S.raidAttempts = 11;
    S.bestStreak = 6;
    showResult({ raidWon: true });
  } else if (state === "escape") {
    S.hp = 4;
    S.raidHits = 7;
    S.raidAttempts = 10;
    S.bestStreak = 4;
    showResult({ raidWon: false });
  } else if (state === "dead") {
    S.hp = 11;
    S.lives = 0;
    S.raidHits = 5;
    S.raidAttempts = 8;
    S.wrongHits = 2;
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
