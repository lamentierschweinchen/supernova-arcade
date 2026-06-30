import { after, NextResponse } from "next/server";
import {
  Address,
  AddressComputer,
  Transaction,
  TransactionComputer,
  UserSecretKey,
} from "@multiversx/sdk-core";
import {
  CHAIN_ID,
  GAS_PRICE,
  NUM_SHARDS,
  RELAYER_ADDRESS,
  TESTNET_API,
} from "@/lib/onchain/leaderboard.config";
import {
  SETTLE_PLAYER_FUNCTION,
  SETTLE_PLAYER_GAS_LIMIT,
  SHARD_HYDRA_HUB_CONTRACT,
} from "@/lib/onchain/arcade.config";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_ATTACK_ID = 64;
const MAX_FUTURE_DELAY_MS = 20_000;
const SETTLEMENT_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2_500;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

type SettlementIntent = {
  player: string;
  raidId: number;
  attackId: number;
  eligibleAt: number;
};

const scheduled = new Map<string, number>();
const rateHits = new Map<string, number[]>();
const addressComputer = new AddressComputer(NUM_SHARDS);
const txComputer = new TransactionComputer();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function u64Hex(value: number) {
  return BigInt(value).toString(16).padStart(16, "0");
}

function decodeU64(part: string | undefined) {
  if (!part) return 0;
  const bytes = Buffer.from(part, "base64");
  let value = BigInt(0);
  for (const byte of bytes) value = (value << BigInt(8)) | BigInt(byte);
  return Number(value);
}

function rateLimited(ip: string) {
  const now = Date.now();
  const hits = (rateHits.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(ip, hits);
  return hits.length > RATE_MAX;
}

function parseIntent(value: unknown): SettlementIntent | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const player = typeof input.player === "string" ? input.player : "";
  const raidId = Number(input.raidId);
  const attackId = Number(input.attackId);
  const eligibleAt = Number(input.eligibleAt);
  const now = Date.now();

  if (
    !Address.isValid(player) ||
    !Number.isSafeInteger(raidId) ||
    raidId <= 0 ||
    !Number.isSafeInteger(attackId) ||
    attackId < 0 ||
    attackId > MAX_ATTACK_ID ||
    !Number.isFinite(eligibleAt) ||
    eligibleAt < now - MAX_FUTURE_DELAY_MS ||
    eligibleAt > now + MAX_FUTURE_DELAY_MS
  ) {
    return null;
  }
  return { player, raidId, attackId, eligibleAt };
}

function createOneUseKeeper() {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const secret = UserSecretKey.generate();
    const address = secret.generatePublicKey().toAddress();
    if (addressComputer.getShardOfAddress(address) === 0) {
      return { secret, address };
    }
  }
  throw new Error("could not create shard-0 keeper");
}

function buildSignedSettlement(intent: SettlementIntent) {
  const keeper = createOneUseKeeper();
  const playerHex = Address.newFromBech32(intent.player).toHex();
  const data = [
    SETTLE_PLAYER_FUNCTION,
    playerHex,
    u64Hex(intent.raidId),
    u64Hex(intent.attackId),
  ].join("@");
  const transaction = new Transaction({
    nonce: BigInt(0),
    value: BigInt(0),
    sender: keeper.address,
    receiver: Address.newFromBech32(SHARD_HYDRA_HUB_CONTRACT),
    gasPrice: BigInt(GAS_PRICE),
    gasLimit: BigInt(SETTLE_PLAYER_GAS_LIMIT),
    data: new TextEncoder().encode(data),
    chainID: CHAIN_ID,
    version: 2,
    relayer: Address.newFromBech32(RELAYER_ADDRESS),
  });
  transaction.signature = keeper.secret.sign(
    txComputer.computeBytesForSigning(transaction),
  );
  return transaction.toPlainObject();
}

async function authoritativeSettlement(intent: SettlementIntent) {
  const response = await fetch(`${TESTNET_API}/vm-values/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scAddress: SHARD_HYDRA_HUB_CONTRACT,
      funcName: "getPlayerRaidSettlement",
      args: [u64Hex(intent.raidId), Address.newFromBech32(intent.player).toHex()],
    }),
    cache: "no-store",
  });
  if (!response.ok) return { joined: true, nextSettlement: -1 };
  const json = await response.json();
  const data = json?.data?.data;
  if (data?.returnCode !== "ok" || !Array.isArray(data.returnData)) {
    return { joined: true, nextSettlement: -1 };
  }
  return {
    joined: decodeU64(data.returnData[0]) === 1,
    nextSettlement: decodeU64(data.returnData[1]),
  };
}

async function relaySettlement(origin: string, intent: SettlementIntent) {
  const response = await fetch(`${origin}/api/relay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hydra-keeper": "1",
    },
    body: JSON.stringify({ transaction: buildSignedSettlement(intent) }),
    cache: "no-store",
  });
  return response.ok;
}

async function settleInBackground(origin: string, intent: SettlementIntent, key: string) {
  try {
    const delay = Math.max(0, Math.ceil(intent.eligibleAt - Date.now()));
    if (delay > 0) await sleep(delay);

    for (let attempt = 0; attempt < SETTLEMENT_ATTEMPTS; attempt += 1) {
      const state = await authoritativeSettlement(intent);
      if (!state.joined || state.nextSettlement > intent.attackId) return;
      await relaySettlement(origin, intent);
      await sleep(RETRY_DELAY_MS);
    }
  } catch (error) {
    console.error("[/api/hydra/settle] Background settlement failed:", error);
  } finally {
    scheduled.delete(key);
  }
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let intent: SettlementIntent | null = null;
  try {
    intent = parseIntent(await request.json());
  } catch {
    // Handled as invalid intent below.
  }
  if (!intent) {
    return NextResponse.json({ error: "invalid_settlement" }, { status: 400 });
  }

  const key = `${intent.player}:${intent.raidId}:${intent.attackId}`;
  const existing = scheduled.get(key) ?? 0;
  if (existing > Date.now()) {
    return NextResponse.json({ queued: true, duplicate: true }, { status: 202 });
  }

  scheduled.set(key, Date.now() + MAX_FUTURE_DELAY_MS + 15_000);
  const origin = new URL(request.url).origin;
  after(() => settleInBackground(origin, intent, key));
  return NextResponse.json({ queued: true }, { status: 202 });
}
