// arcade.js — the reusable browser client for a Supernova Arcade game.
//
// Drop this in, point it at your contract + relayer (see arcade.config.js), and
// you get one-tap GASLESS onchain play with no wallet and no build step. It is
// framework-free: a single ES module that lazily loads two tiny crypto libraries
// from a CDN. No @multiversx/sdk-core in the browser.
//
// THE FLOW (Relayed v3, all client-side):
//   1. Generate an ephemeral ed25519 keypair in the browser (no wallet, no funds),
//      ground into the relayer's shard (Relayed v3 needs sender + relayer in the
//      same shard).
//   2. Build + sign a transaction with that ephemeral key (sender = ephemeral,
//      relayer = the hosted relayer). The nonce is fetched once, then incremented
//      LOCALLY so rapid actions never wait on the network.
//   3. POST the signed tx to your relayer (/api/relay). It co-signs and pays gas.
//   4. Read the leaderboard / global counter straight from the contract.
//
// Everything fails SOFT: if the libs or relayer are unavailable, reads resolve to
// empty and actions throw an ArcadeError your UI can show without breaking play.
//
// REMEMBER: onchain reads are legible at ~2s, so poll the leaderboard / counter on
// a ~2s tick. Never put a contract read in your per-frame loop.

export class ArcadeError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "ArcadeError";
    this.code = code;
  }
}

const CDN = {
  ed25519: "https://esm.sh/@noble/ed25519@2.1.0",
  base: "https://esm.sh/@scure/base@1.1.6",
};

export function createArcade(config) {
  const cfg = {
    relayUrl: "/api/relay",
    chainID: "T",
    numShards: 3,
    relayerShard: 0,
    gasPrice: 1_000_000_000,
    gas: {
      recordAction: 6_000_000,
      setHandle: 10_000_000,
    },
    ...config,
  };

  const state = {
    libs: null, // { ed, bech32 }
    key: null, // { priv, pub, address }
    nonce: 0, // LOCAL nonce, claimed per tx
    ready: false,
    available: true, // false once crypto/libs fail
    initPromise: null,
  };

  // ---- tiny encoders ----
  const enc = new TextEncoder();
  function bytesToHex(b) {
    let h = "";
    for (let i = 0; i < b.length; i++) h += b[i].toString(16).padStart(2, "0");
    return h;
  }
  function utf8ToHex(s) {
    return bytesToHex(enc.encode(s));
  }

  // ---- shard of an address from the last pubkey byte (matches sdk-core) ----
  function shardOfPubkey(pub) {
    const last = pub[31];
    let shard = last & 3; // maskHigh = 0b11
    if (shard > cfg.numShards - 1) shard = last & 1; // maskLow = 0b01
    return shard;
  }

  function addressFromPubkey(bech32, pub) {
    return bech32.encode("erd", bech32.toWords(pub), 256);
  }

  // ---- lazy-load crypto libs (fail-soft) ----
  async function loadLibs() {
    if (state.libs) return state.libs;
    try {
      const [ed, base] = await Promise.all([import(CDN.ed25519), import(CDN.base)]);
      state.libs = { ed, bech32: base.bech32 };
      return state.libs;
    } catch (err) {
      console.warn("[arcade] crypto libs failed to load:", err);
      state.available = false;
      return null;
    }
  }

  async function generateEphemeral(libs) {
    const { ed, bech32 } = libs;
    for (let tries = 0; tries < 300; tries++) {
      const priv = ed.utils.randomPrivateKey();
      const pub = await ed.getPublicKeyAsync(priv);
      if (shardOfPubkey(pub) === cfg.relayerShard) {
        return { priv, pub, address: addressFromPubkey(bech32, pub) };
      }
    }
    throw new ArcadeError("key_gen_failed", "could not derive a key in the relayer shard");
  }

  // canonical signing bytes — field ORDER + encoding match sdk-core
  // TransactionComputer.computeBytesForSigning exactly.
  function signingString(tx) {
    return JSON.stringify({
      nonce: tx.nonce,
      value: tx.value,
      receiver: tx.receiver,
      sender: tx.sender,
      gasPrice: tx.gasPrice,
      gasLimit: tx.gasLimit,
      data: tx.dataB64,
      chainID: tx.chainID,
      version: tx.version,
      relayer: tx.relayer,
    });
  }

  /** Load libs, generate the ephemeral key, fetch the starting nonce. Idempotent,
   *  single-flight. Resolves true when ready to send, false if unavailable. */
  function ready() {
    if (state.ready) return Promise.resolve(true);
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async () => {
      const libs = await loadLibs();
      if (!libs) return false;
      try {
        state.key = await generateEphemeral(libs);
      } catch (err) {
        console.warn("[arcade] key gen failed:", err);
        state.available = false;
        return false;
      }
      // fetch the starting nonce once (fresh key => 0), then increment LOCALLY
      state.nonce = 0;
      try {
        const r = await fetch(`${cfg.api}/accounts/${state.key.address}`);
        if (r.ok) {
          const j = await r.json();
          state.nonce = j.nonce || 0;
        }
      } catch {
        /* fresh key, nonce stays 0 */
      }
      state.ready = true;
      return true;
    })();
    return state.initPromise;
  }

  // ---- the core: build, sign, relay ONE transaction ----
  async function send(fnName, dataStr, gasLimit) {
    const ok = await ready();
    if (!ok) throw new ArcadeError("unavailable", "onchain client unavailable");

    const { ed } = state.libs;
    const key = state.key;
    const nonce = state.nonce++; // claim this nonce now
    const dataB64 = btoa(dataStr);

    const txForSign = {
      nonce,
      value: "0",
      receiver: cfg.contract,
      sender: key.address,
      gasPrice: cfg.gasPrice,
      gasLimit,
      dataB64,
      chainID: cfg.chainID,
      version: 2,
      relayer: cfg.relayer,
    };

    const sig = await ed.signAsync(enc.encode(signingString(txForSign)), key.priv);

    const plainTx = {
      nonce,
      value: "0",
      receiver: cfg.contract,
      sender: key.address,
      senderUsername: undefined,
      receiverUsername: undefined,
      gasPrice: cfg.gasPrice,
      gasLimit,
      data: dataB64,
      chainID: cfg.chainID,
      version: 2,
      relayer: cfg.relayer,
      signature: bytesToHex(sig),
    };

    let res, out;
    try {
      res = await fetch(cfg.relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: plainTx }),
      });
      out = await res.json();
    } catch (err) {
      throw new ArcadeError("network", "could not reach the relayer");
    }
    if (!res.ok || out.error) {
      throw new ArcadeError(out.error || `http_${res.status}`, out.message || "relay rejected the transaction");
    }
    return { txHash: out.txHash, explorerUrl: out.explorerUrl || explorerTx(out.txHash), sender: out.sender };
  }

  // ---- public action methods ----
  // recordAction is the whole score model: one call = one transaction = +1. There
  // is no client-reported score and nothing to bound — the score is the count of
  // real transactions, uncheatable by construction.
  function recordAction() {
    return send("recordAction", "recordAction", cfg.gas.recordAction);
  }
  function setHandle(handle) {
    return send("setHandle", `setHandle@${utf8ToHex(handle)}`, cfg.gas.setHandle);
  }

  // ---- reads (never throw; resolve to a safe fallback) ----

  async function vmQuery(funcName, args) {
    const r = await fetch(`${cfg.api}/vm-values/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scAddress: cfg.contract, funcName, args: args || [] }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const data = j?.data?.data;
    if (!data || data.returnCode !== "ok") return null;
    return data.returnData || [];
  }

  // decode one base64 ScoreEntry: address(32) + handleLen(4 BE) + handle + score(u64 BE) + ts(u64 BE)
  function decodeEntry(b64, bech32) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length < 32 + 4 + 8 + 8) return null;
    let off = 0;
    const pub = bytes.slice(off, off + 32);
    off += 32;
    const hlen = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    off += 4;
    const handle = new TextDecoder().decode(bytes.slice(off, off + hlen));
    off += hlen;
    let score = 0n;
    for (let s = 0; s < 8; s++) score = (score << 8n) | BigInt(bytes[off + s]);
    off += 8;
    let ts = 0n;
    for (let t = 0; t < 8; t++) ts = (ts << 8n) | BigInt(bytes[off + t]);
    off += 8;
    let address = "";
    try {
      address = addressFromPubkey(bech32, pub);
    } catch {}
    return { address, handle, score: Number(score), timestamp: Number(ts) };
  }

  function decodeU64(b64) {
    const bin = atob(b64);
    let v = 0n;
    for (let i = 0; i < bin.length; i++) v = (v << 8n) | BigInt(bin.charCodeAt(i));
    return Number(v);
  }

  /** Top-n leaderboard entries, highest first. The contract returns every entry
   *  UNSORTED; we sort CLIENT-SIDE (highest score first, ties broken by earlier
   *  timestamp) and slice to n. Returns [] on any failure. */
  async function getLeaderboard(n = 10) {
    try {
      const libs = await loadLibs();
      if (!libs) return [];
      const parts = await vmQuery("getLeaderboard", []);
      if (!parts) return [];
      const out = [];
      for (const p of parts) {
        if (!p) continue;
        const e = decodeEntry(p, libs.bech32);
        if (e) out.push(e);
      }
      out.sort((a, b) => b.score - a.score || a.timestamp - b.timestamp);
      return n ? out.slice(0, n) : out;
    } catch (err) {
      console.warn("[arcade] getLeaderboard failed:", err);
      return [];
    }
  }

  /** This game's global onchain-action total. Returns null on failure. */
  async function getGlobalActions() {
    try {
      const parts = await vmQuery("getGlobalActions", []);
      if (!parts) return null;
      return parts[0] ? decodeU64(parts[0]) : 0;
    } catch (err) {
      console.warn("[arcade] getGlobalActions failed:", err);
      return null;
    }
  }

  /** A single player's entry (defaults to this client's ephemeral address). */
  async function getPlayerEntry(address) {
    const addr = address || state.key?.address;
    if (!addr) return { address: "", handle: "", score: 0, timestamp: 0 };
    try {
      const libs = await loadLibs();
      if (!libs) return { address: addr, handle: "", score: 0, timestamp: 0 };
      // getPlayerEntry takes an address arg (hex of the 32-byte pubkey). Decode the
      // bech32 address back to its 32 bytes (inverse of encode/toWords above).
      const { words } = libs.bech32.decode(addr, 256);
      const pubBytes = libs.bech32.fromWords(words);
      const parts = await vmQuery("getPlayerEntry", [bytesToHex(pubBytes)]);
      if (!parts || !parts[0]) return { address: addr, handle: "", score: 0, timestamp: 0 };
      const e = decodeEntry(parts[0], libs.bech32);
      return e || { address: addr, handle: "", score: 0, timestamp: 0 };
    } catch (err) {
      console.warn("[arcade] getPlayerEntry failed:", err);
      return { address: addr, handle: "", score: 0, timestamp: 0 };
    }
  }

  /** Read a tx status: 'success' | 'fail' | 'invalid' | 'pending' | 'unknown'. */
  async function getTxStatus(hash) {
    try {
      const r = await fetch(`${cfg.api}/transactions/${hash}?fields=status`);
      if (!r.ok) return "pending";
      const j = await r.json();
      return j?.status || "pending";
    } catch {
      return "pending";
    }
  }

  function explorerTx(hash) {
    return `${cfg.explorer}/transactions/${hash}`;
  }

  return {
    // lifecycle
    ready,
    get isReady() {
      return state.ready;
    },
    get available() {
      return state.available;
    },
    get address() {
      return state.key?.address || null;
    },
    // actions
    recordAction,
    setHandle,
    // reads
    getLeaderboard,
    getGlobalActions,
    getPlayerEntry,
    getTxStatus,
    explorerTx,
    config: cfg,
  };
}
