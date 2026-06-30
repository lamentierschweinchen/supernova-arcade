import {
  Address,
  AddressComputer,
  Transaction,
  TransactionComputer,
  UserSecretKey,
} from "@multiversx/sdk-core";

const ORIGIN = process.env.ARCADE_ORIGIN || "https://supernova-arcade.xyz";
const API = "https://testnet-api.multiversx.com";
const HUB = "erd1qqqqqqqqqqqqqpgqa3dyjwv8r74md5wq0n3cfuvh98w24zmdppuqjufe9x";
const HEADS = [
  "erd1qqqqqqqqqqqqqpgqdra35g6vnytdh8lnuuhpth4xs46xvjvqppuqgh7u5r",
  "erd1qqqqqqqqqqqqqpgq6w5as8ku03k4ag2wzygdyzcux0c98lmrx63sf3ctpx",
  "erd1qqqqqqqqqqqqqpgqgam85mljt0jz4tfj2uvky0n2mrefm6da5cdqlr79w9",
];
const RELAYER = "erd1ru08dt4u5e0psfrwth38u0dfed0hw8289xqdd9yghl3ec24uppuq6hgphm";
const GRACE_MS = 5_000;
const addressComputer = new AddressComputer(3);
const txComputer = new TransactionComputer();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function u64Hex(value) {
  return BigInt(value).toString(16).padStart(16, "0");
}

function decodeU64(part) {
  const bytes = Buffer.from(part || "", "base64");
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return Number(value);
}

function createPlayer() {
  for (;;) {
    const secret = UserSecretKey.generate();
    const address = secret.generatePublicKey().toAddress();
    if (addressComputer.getShardOfAddress(address) === 0) return { secret, address };
  }
}

function signedTransaction({ player, nonce, receiver, data, gasLimit }) {
  const transaction = new Transaction({
    nonce: BigInt(nonce),
    value: 0n,
    sender: player.address,
    receiver: Address.newFromBech32(receiver),
    gasPrice: 1_000_000_000n,
    gasLimit: BigInt(gasLimit),
    data: new TextEncoder().encode(data),
    chainID: "T",
    version: 2,
    relayer: Address.newFromBech32(RELAYER),
  });
  transaction.signature = player.secret.sign(
    txComputer.computeBytesForSigning(transaction),
  );
  return transaction.toPlainObject();
}

async function relay(transaction) {
  const response = await fetch(`${ORIGIN}/api/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction }),
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(`relay failed: ${json.error || response.status}`);
  }
  return json.txHash;
}

async function waitForTransaction(hash, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${API}/transactions/${hash}?fields=status`);
    if (response.ok) {
      const transaction = await response.json();
      if (transaction.status === "success") return;
      if (transaction.status === "fail" || transaction.status === "invalid") {
        throw new Error(`${hash} ${transaction.status}`);
      }
    }
    await sleep(500);
  }
  throw new Error(`${hash} did not finalize`);
}

async function query(funcName, args = []) {
  const response = await fetch(`${API}/vm-values/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scAddress: HUB, funcName, args }),
  });
  const json = await response.json();
  const data = json?.data?.data;
  if (!response.ok || data?.returnCode !== "ok") {
    throw new Error(`${funcName} query failed`);
  }
  return data.returnData;
}

async function snapshot(player) {
  const parts = await query("getPlayerRaidSnapshot", [player.address.toHex()]);
  return parts.map(decodeU64);
}

async function attack(raidId, attackId) {
  const parts = await query("getAttack", [u64Hex(raidId), u64Hex(attackId)]);
  return parts.map(decodeU64);
}

async function waitForSettlement(player, raidId, attackId, timeoutMs = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const parts = await query("getPlayerRaidSettlement", [
      u64Hex(raidId),
      player.address.toHex(),
    ]);
    const values = parts.map(decodeU64);
    if (values[0] === 1 && values[1] > attackId) return values;
    await sleep(750);
  }
  throw new Error("keeper did not advance settlement");
}

const player = createPlayer();
const joinSubmittedAt = Date.now();
const joinHash = await relay(
  signedTransaction({
    player,
    nonce: 0,
    receiver: HUB,
    data: "joinRaid",
    gasLimit: 10_000_000,
  }),
);
await waitForTransaction(joinHash);

const joined = await snapshot(player);
const [raidId, hpBefore, , startedAt, , , currentAttack] = joined;
if (joined[9] !== 1 || joined[10] !== 3) throw new Error("player did not join");

const attackId = Date.now() < startedAt ? 0 : currentAttack + 1;
const [head, opensAt, closesAt] = await attack(raidId, attackId);
await sleep(Math.max(0, opensAt + 50 - Date.now()));

const hitSubmittedAt = Date.now();
const hitHash = await relay(
  signedTransaction({
    player,
    nonce: 1,
    receiver: HEADS[head],
    data: `hit@${u64Hex(raidId)}@${u64Hex(attackId)}`,
    gasLimit: 14_000_000,
  }),
);
await waitForTransaction(hitHash);

const keeperResponse = await fetch(`${ORIGIN}/api/hydra/settle`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    player: player.address.toBech32(),
    raidId,
    attackId,
    eligibleAt: closesAt + GRACE_MS + 1_000,
  }),
});
if (keeperResponse.status !== 202) throw new Error("keeper rejected intent");

const settlement = await waitForSettlement(player, raidId, attackId);
const finalState = await snapshot(player);
if (settlement[3] !== 1) throw new Error("correct hit did not score");
if (finalState[1] !== hpBefore - 1) throw new Error("Hydra HP did not decrease");

console.log(JSON.stringify({
  ok: true,
  player: player.address.toBech32(),
  raidId,
  attackId,
  head,
  startLeadMs: startedAt - joinSubmittedAt,
  joinHash,
  hitHash,
  hitLaunchOffsetMs: hitSubmittedAt - opensAt,
  nextSettlement: settlement[1],
  lives: settlement[2],
  raidHits: settlement[3],
  hpBefore,
  hpAfter: finalState[1],
}, null, 2));
