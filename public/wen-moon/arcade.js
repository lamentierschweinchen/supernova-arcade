import { getSk, savePassport, setHandle as savePassportHandle } from "/passport.js";

// arcade.js — the reusable browser client for WEN MOON, a Supernova Arcade game.
//
// Drop this in, point it at your contract + relayer (see arcade.config.js), and
// you get one-tap GASLESS onchain play with no wallet and no build step. It is
// framework-free: a single ES module that lazily loads two tiny crypto libraries
// from a CDN. No @multiversx/sdk-core in the browser.
//
// THE FLOW (Relayed v3, all client-side) — byte-for-byte identical to the proven
// degen-dash client:
//   1. Reuse the shared PASSPORT key (one identity across every arcade game),
//      ground into the relayer's shard (Relayed v3 needs sender + relayer in the
//      same shard).
//   2. Build + SIGN a transaction with that key (sender = passport, relayer = the
//      hosted relayer). Nonce fetched once, then incremented LOCALLY.
//   3. POST the SIGNED tx as { transaction } to /api/relay. It co-signs + pays gas.
//   4. Read bankroll / leaderboard / global counter straight from the contract.
//
// Everything fails SOFT: if the libs or relayer are unavailable, reads resolve to
// a safe fallback and actions throw an ArcadeError the UI shows without breaking.

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
  // wen-moon's arcade.config.js uses apiBase / chainId / explorerBase; normalize
  // to the field names the signing core expects (api / chainID / explorer).
  const cfg = {
    relayUrl: "/api/relay",
    numShards: 3,
    relayerShard: 0,
    gasPrice: 1_000_000_000,
    gas: {
      startRun: 20_000_000,
      call: 12_000_000,
      cashOut: 12_000_000,
      setHandle: 10_000_000,
      claim: 12_000_000,
    },
    ...config,
    chainID: config.chainId || config.chainID || "T",
    api: config.apiBase || config.api,
    explorer: config.explorerBase || config.explorer,
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
  function hexToBytes(h) {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function utf8ToHex(s) {
    return bytesToHex(enc.encode(s));
  }
  // minimal big-endian hex, at least one byte, even length, so the contract's
  // top-decode reads the right integer (0 => "00").
  function intToArgHex(n) {
    let v = BigInt(n);
    if (v < 0n) throw new ArcadeError("bad_arg", "negative argument");
    let hex = v.toString(16);
    if (hex === "0") hex = "00";
    if (hex.length % 2) hex = "0" + hex;
    return hex;
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
      console.warn("[wenmoon] crypto libs failed to load:", err);
      state.available = false;
      return null;
    }
  }

  async function generateEphemeral(libs) {
    const { ed, bech32 } = libs;
    for (let tries = 0; tries < 400; tries++) {
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

  /** Load libs, restore/generate the shared passport key, fetch the starting nonce.
   *  Idempotent, single-flight. Resolves true when ready to send, false if
   *  unavailable. */
  function ready() {
    if (state.ready) return Promise.resolve(true);
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async () => {
      const libs = await loadLibs();
      if (!libs) return false;
      // reuse the shared passport key (one identity across every game)
      try {
        const saved = getSk();
        if (saved) {
          const priv = hexToBytes(saved);
          const pub = await libs.ed.getPublicKeyAsync(priv);
          if (shardOfPubkey(pub) === cfg.relayerShard) {
            state.key = { priv, pub, address: addressFromPubkey(libs.bech32, pub) };
          }
        }
      } catch (_e) {
        /* fall through to a fresh key */
      }
      if (!state.key) {
        try {
          state.key = await generateEphemeral(libs);
          savePassport(bytesToHex(state.key.priv), state.key.address); // mint the passport once; every game reuses it
        } catch (err) {
          console.warn("[wenmoon] key gen failed:", err);
          state.available = false;
          return false;
        }
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

  /** re-fetch the network nonce for the shared passport key (recovers a nonce race). */
  async function resyncNonce() {
    try {
      const r = await fetch(`${cfg.api}/accounts/${state.key.address}`);
      if (r.ok) {
        const j = await r.json();
        state.nonce = j.nonce || 0;
      }
    } catch (_e) {
      /* keep the in-memory nonce */
    }
  }

  // ---- the core: build, sign, relay ONE transaction (2 attempts on a nonce race) ----
  async function send(fnName, dataStr, gasLimit) {
    const ok = await ready();
    if (!ok) throw new ArcadeError("unavailable", "onchain client unavailable");

    const { ed } = state.libs;
    const key = state.key;
    const dataB64 = btoa(dataStr);

    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const nonce = state.nonce++; // claim this nonce now
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
      if (res.ok && !out.error) {
        try { if (window.parent !== window) window.parent.postMessage({ type: "arcade:tx", hash: out.txHash }, location.origin); } catch (_e) {} // feed the shell's live tx ring
        return { txHash: out.txHash, explorerUrl: out.explorerUrl || explorerTx(out.txHash), sender: out.sender };
      }
      lastErr = new ArcadeError(out.error || `http_${res.status}`, out.message || "relay rejected the transaction");
      if (attempt === 0) await resyncNonce(); // likely a cross-tab nonce race — re-sync and retry once
    }
    throw lastErr;
  }

  // ---- public action methods (each is ONE real gasless transaction) ----
  // startRun mints the 1,000-NOVA bankroll + opens the run onchain.
  function startRun() {
    return send("startRun", "startRun", cfg.gas.startRun);
  }
  // call fires the per-call VRF draw. The CONTRACT draws the outcome from
  // get_block_random_seed() — never client-reported, so the result is uncheatable.
  function call(band, wager) {
    return send("call", `call@${intToArgHex(band)}@${intToArgHex(wager)}`, cfg.gas.call);
  }
  // cashOut banks the current bankroll; the contract records it as your highscore
  // (biggest single cash-out) on the leaderboard.
  function cashOut() {
    return send("cashOut", "cashOut", cfg.gas.cashOut);
  }
  // claim mints your kept NOVA to your wallet (real ESDT). No-op if no token set.
  function claim() {
    return send("claim", "claim", cfg.gas.claim);
  }
  function setHandle(handle) {
    savePassportHandle(handle); // the same name follows the player across every game
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

  function decodeU64(b64) {
    const bin = atob(b64 || "");
    let v = 0n;
    for (let i = 0; i < bin.length; i++) v = (v << 8n) | BigInt(bin.charCodeAt(i));
    return Number(v);
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

  // decode an address arg (hex of the 32-byte pubkey) for a player-keyed view
  async function addrArg(address) {
    const addr = address || state.key?.address;
    if (!addr) return null;
    const libs = await loadLibs();
    if (!libs) return null;
    const { words } = libs.bech32.decode(addr, 256);
    return bytesToHex(libs.bech32.fromWords(words));
  }

  /** This player's (or a given address's) current bankroll. Returns 0 on failure. */
  async function getBankroll(address) {
    try {
      const hex = await addrArg(address);
      if (hex == null) return 0;
      const parts = await vmQuery("getBankroll", [hex]);
      return parts && parts[0] !== undefined ? decodeU64(parts[0]) : 0;
    } catch (err) {
      console.warn("[wenmoon] getBankroll failed:", err);
      return 0;
    }
  }

  /** Top-n leaderboard entries, highest first (sorted CLIENT-SIDE). [] on failure. */
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
      console.warn("[wenmoon] getLeaderboard failed:", err);
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
      console.warn("[wenmoon] getGlobalActions failed:", err);
      return null;
    }
  }

  /** A single player's leaderboard entry (defaults to this client's address). */
  async function getPlayerEntry(address) {
    const addr = address || state.key?.address;
    if (!addr) return { address: "", handle: "", score: 0, timestamp: 0 };
    try {
      const libs = await loadLibs();
      if (!libs) return { address: addr, handle: "", score: 0, timestamp: 0 };
      const hex = await addrArg(addr);
      const parts = await vmQuery("getPlayerEntry", [hex]);
      if (!parts || !parts[0]) return { address: addr, handle: "", score: 0, timestamp: 0 };
      const e = decodeEntry(parts[0], libs.bech32);
      return e || { address: addr, handle: "", score: 0, timestamp: 0 };
    } catch (err) {
      console.warn("[wenmoon] getPlayerEntry failed:", err);
      return { address: addr, handle: "", score: 0, timestamp: 0 };
    }
  }

  /** Read a tx status: 'success' | 'fail' | 'invalid' | 'pending'. */
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
    startRun,
    call,
    cashOut,
    claim,
    setHandle,
    // reads
    getBankroll,
    getLeaderboard,
    getGlobalActions,
    getPlayerEntry,
    getTxStatus,
    explorerTx,
    config: cfg,
  };
}
