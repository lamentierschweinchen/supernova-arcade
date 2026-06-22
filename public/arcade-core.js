/* ============================================================================
   arcade-core.js — shared gasless client for Supernova Arcade cabinets.

   The engine behind every Arcade game: an ephemeral in-browser key (no wallet,
   no funds) ground into the relayer's shard, Relayed-v3 signing that matches
   sdk-core byte-for-byte, a POST to the shared /api/relay (the relayer co-signs
   and pays testnet gas), and ~2s reads of the contract's views. Lifted from the
   proven Supernova Sprint client (public/onchain.html) and generalized so a new
   cabinet is a thin HTML file + a data-string builder.

   This is also the reference "open template" client core from the Arcade
   integration spec: meet the same contract (one-tap gasless, onchain
   score/shared-state, anti-cheat, the standard arcadeAction event) and a game
   drops into the hub.

   NETWORK: MultiversX TESTNET — the public network scheduled to run Supernova
   (600ms rounds). Testnet XEGLD is free (faucet), so the relayer pays no real
   cost. Onchain reads are legible in ~2s (API/indexer latency), so counters and
   boards tick on a ~2s cadence; twitch play stays local. Testnet can be reset,
   which clears the boards.

   Safe to expose (addresses + public endpoints only). The relayer SIGNING KEY
   lives solely in the server env (see src/app/api/relay/route.ts).
   ============================================================================ */

export const ARCADE_NET = {
  api: "https://testnet-api.multiversx.com",
  explorer: "https://testnet-explorer.multiversx.com",
  chainID: "T",
  // Gas payer (shard 0). Mirrors RELAYER_ADDRESS in src/lib/onchain/*.config.ts.
  relayer: "erd1ru08dt4u5e0psfrwth38u0dfed0hw8289xqdd9yghl3ec24uppuq6hgphm",
  relayerShard: 0, // ephemeral keys are ground into this shard (Relayed-v3 rule)
  numShards: 3,
  gasPrice: 1000000000,
};

/* Explicit "not deployed yet" sentinel — the all-zero system SC address. Mirrors
   UNDEPLOYED_PLACEHOLDER in arcade.config.ts. A cabinet pointed here plays locally
   with its onchain layer shown as "scheduled"; the relayer refuses it too. */
export const UNDEPLOYED_PLACEHOLDER =
  "erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu";

/* ---------------------------------------------------------------------------
   CABINET REGISTRY — EDIT AFTER DEPLOY.

   Set each cabinet's `contract` to the address printed by its deploy script
   (marketing/games/onchain/<game>-contract/scripts/deploy-testnet.sh) AND set
   the matching NEXT_PUBLIC_*_CONTRACT env for the relayer (arcade.config.ts).
   Both must point at the same deployed address. Until then they stay on the
   placeholder and the games run in local-only "scheduled" mode.
   --------------------------------------------------------------------------- */
export const GAMES = {
  tugofwar: {
    label: "Tug-of-War",
    contract: "erd1qqqqqqqqqqqqqpgqrxm0hn9tgwm3waey3ynx08uutur58y0kppuqgpd2xl", // NEXT_PUBLIC_TUGOFWAR_CONTRACT (testnet, shard 0)
    gasLimit: 8000000,
  },
  canvas: {
    label: "Supernova Canvas",
    contract: "erd1qqqqqqqqqqqqqpgqxex6j5ucqqmgurwpxunf428jnrck53a9ppuqg93s3t", // NEXT_PUBLIC_CANVAS_CONTRACT (testnet, shard 0)
    gasLimit: 15000000,
  },
  button: {
    label: "The Button",
    contract: "erd1qqqqqqqqqqqqqpgqm4z4vf7h2y0dmcadrj66ucxkda7950mqppuqz09pgl", // NEXT_PUBLIC_BUTTON_CONTRACT (testnet, shard 0)
    gasLimit: 8000000,
  },
  reaction: {
    label: "Reaction Arcade",
    contract: UNDEPLOYED_PLACEHOLDER, // set to NEXT_PUBLIC_REACTION_CONTRACT address
    gasLimit: 8000000,
  },
  clawback: {
    // Self-contained fork (its own client at public/clawback/); registered here so
    // the hub odometer sums its getGlobalActions once deployed.
    label: "Clawback",
    contract: "erd1qqqqqqqqqqqqqpgq5prt7nz84my2926d4xs9sw9dyz9j2s4uppuqkvnrrs", // NEXT_PUBLIC_CLAWBACK_CONTRACT (testnet, shard 0)
    gasLimit: 8000000,
  },
  degendash: {
    // Self-contained fork (its own client at public/degen-dash/); registered here so
    // the hub odometer sums its getGlobalActions once deployed. Collect-the-good run
    // game; the high-frequency tx is `collect`. SET contract AFTER DEPLOY.
    label: "Degen Dash",
    contract: "erd1qqqqqqqqqqqqqpgqt4560zpw4yhdm0tmzj2thxkh9snerm58ppuqp7kyxt", // testnet, shard 0
    gasLimit: 8000000,
  },
};

/* ---------- tiny encoders (SC call argument hex) ---------- */
export function bytesToHex(b) {
  let h = "";
  for (let i = 0; i < b.length; i++) h += b[i].toString(16).padStart(2, "0");
  return h;
}
export function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
/** u8 -> 2 hex. */
export function u8ToHex(n) {
  return (n & 0xff).toString(16).padStart(2, "0");
}
/** u32 -> 8 hex (4 bytes BE). Top-decodes cleanly to the integer in-contract. */
export function u32ToHex(n) {
  return (n >>> 0).toString(16).padStart(8, "0");
}
/** UTF-8 string -> hex (for ManagedBuffer args like a handle). */
export function strToHex(s) {
  return bytesToHex(new TextEncoder().encode(s));
}

/* ---------- decoders (vm-query returnData is an array of base64 strings) ---------- */
export function b64ToBytes(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** base64 big-endian unsigned -> JS number (safe for our magnitudes). */
export function decodeU64(b64) {
  const bin = atob(b64 || "");
  let v = 0n;
  for (let i = 0; i < bin.length; i++) v = (v << 8n) | BigInt(bin.charCodeAt(i));
  return Number(v);
}
function readU32BE(bytes, o) {
  return (
    ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
  );
}
function readU64BE(bytes, o) {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[o + i] || 0);
  return Number(v);
}

/* ---------- crypto + addresses ---------- */
/* address shard from the last pubkey byte (matches sdk-core AddressComputer). */
function shardOfPubkey(pub) {
  const last = pub[31];
  let shard = last & 3; // maskHigh = 0b11
  if (shard > ARCADE_NET.numShards - 1) shard = last & 1; // maskLow = 0b01
  return shard;
}

/* lazy-load crypto libs from a CDN; resolve null on any failure (fail-soft). */
let _libs = null;
function loadLibs() {
  if (_libs) return Promise.resolve(_libs);
  return Promise.all([
    import("https://esm.sh/@noble/ed25519@2.1.0"),
    import("https://esm.sh/@scure/base@1.1.6"),
  ])
    .then((mods) => {
      _libs = { ed: mods[0], bech32: mods[1].bech32 };
      return _libs;
    })
    .catch((err) => {
      console.warn("[arcade] crypto libs failed to load:", err);
      return null;
    });
}

function addressFromPubkey(bech32, pub) {
  return bech32.encode("erd", bech32.toWords(pub), 256);
}
/** bech32 erd address -> 32-byte pubkey hex (for a ManagedAddress query arg). */
export function addressToHex(bech32, addr) {
  const words = bech32.decode(addr, 256).words;
  return bytesToHex(new Uint8Array(bech32.fromWords(words)));
}

/* generate an ephemeral keypair whose address lands in the relayer's shard. */
async function generateEphemeral(libs) {
  const ed = libs.ed,
    bech32 = libs.bech32;
  for (let tries = 0; tries < 400; tries++) {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    if (shardOfPubkey(pub) === ARCADE_NET.relayerShard) {
      return { priv, pub, address: addressFromPubkey(bech32, pub) };
    }
  }
  throw new Error("could not derive a key in the relayer shard");
}

/* canonical signing bytes — field ORDER + encoding match sdk-core
   TransactionComputer.computeBytesForSigning exactly. */
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

/* ============================================================================
   createArcadeClient(gameKey) — one client per cabinet.
   ============================================================================ */
export function createArcadeClient(gameKey) {
  const game = GAMES[gameKey];
  if (!game) throw new Error("unknown arcade game: " + gameKey);

  const net = ARCADE_NET;
  const SK_KEY = "arcade.ephemeral." + gameKey; // sessionStorage slot for the key

  const state = {
    libs: null,
    key: null, // { priv, pub, address }
    nonce: 0,
    keyReady: false,
    initPromise: null,
    available: true, // false => degraded (no crypto)
  };

  const deployed = game.contract !== UNDEPLOYED_PLACEHOLDER;

  /* one-time (single-flight) ephemeral key + starting nonce. Reuses a key saved
     in sessionStorage so a reload keeps the player's identity (and their
     leaderboard row / cooldown) within the tab. The key is a throwaway testnet
     key with no funds — the relayer pays gas — so this is safe. */
  function ensureKey() {
    if (state.keyReady) return Promise.resolve(true);
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async function () {
      const libs = await loadLibs();
      if (!libs) {
        state.available = false;
        return false;
      }
      state.libs = libs;
      try {
        const saved = sessionStorage.getItem(SK_KEY);
        if (saved) {
          const priv = hexToBytes(saved);
          const pub = await libs.ed.getPublicKeyAsync(priv);
          if (shardOfPubkey(pub) === net.relayerShard) {
            state.key = { priv, pub, address: addressFromPubkey(libs.bech32, pub) };
          }
        }
      } catch (_e) {
        /* fall through to fresh key */
      }
      if (!state.key) {
        try {
          state.key = await generateEphemeral(libs);
          try {
            sessionStorage.setItem(SK_KEY, bytesToHex(state.key.priv));
          } catch (_e) {
            /* private mode / storage full — fine, key stays in memory */
          }
        } catch (e) {
          console.warn("[arcade] key gen failed:", e);
          state.available = false;
          return false;
        }
      }
      // starting nonce: fetch once, then increment locally for every tx so rapid
      // actions never wait on the network.
      state.nonce = 0;
      try {
        const r = await fetch(net.api + "/accounts/" + state.key.address);
        if (r.ok) {
          const j = await r.json();
          state.nonce = j.nonce || 0;
        }
      } catch (_e) {
        /* fresh key, nonce stays 0 */
      }
      state.keyReady = true;
      return true;
    })();
    return state.initPromise;
  }

  /* fire ONE action transaction. funcName + hex args -> signed Relayed-v3 tx ->
     /api/relay. Returns { txHash, explorerUrl } or throws { code, message }. */
  async function sendAction(funcName, argsHex = [], gasLimitOverride) {
    if (!deployed) throw { code: "not_deployed", message: "cabinet scheduled — not deployed yet" };
    const ok = await ensureKey();
    if (!ok) throw { code: "unavailable", message: "crypto unavailable" };

    const libs = state.libs,
      key = state.key;
    const nonce = state.nonce++; // claim this nonce now
    const dataStr = argsHex.length ? funcName + "@" + argsHex.join("@") : funcName;
    const dataB64 = btoa(dataStr);
    const gasLimit = gasLimitOverride || game.gasLimit;

    const txForSign = {
      nonce,
      value: "0",
      receiver: game.contract,
      sender: key.address,
      gasPrice: net.gasPrice,
      gasLimit,
      dataB64,
      chainID: net.chainID,
      version: 2,
      relayer: net.relayer,
    };
    const sigBytes = await libs.ed.signAsync(
      new TextEncoder().encode(signingString(txForSign)),
      key.priv,
    );
    const plainTx = {
      nonce,
      value: "0",
      receiver: game.contract,
      sender: key.address,
      senderUsername: undefined,
      receiverUsername: undefined,
      gasPrice: net.gasPrice,
      gasLimit,
      data: dataB64,
      chainID: net.chainID,
      version: 2,
      relayer: net.relayer,
      signature: bytesToHex(sigBytes),
    };

    let res, out;
    try {
      res = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: plainTx }),
      });
      out = await res.json();
    } catch (e) {
      throw { code: "network", message: "could not reach the relayer" };
    }
    if (!res.ok || out.error) {
      throw { code: out.error || "relay_error", message: out.message || "", status: res.status };
    }
    return { txHash: out.txHash, explorerUrl: out.explorerUrl || net.explorer + "/transactions/" + out.txHash };
  }

  /* read a contract view. Returns the raw returnData (array of base64 strings),
     or null on any failure (caller keeps its last-known value). Defaults to this
     cabinet's contract. */
  async function query(funcName, argsHex = [], scAddress) {
    const addr = scAddress || game.contract;
    if (addr === UNDEPLOYED_PLACEHOLDER) return null;
    try {
      const r = await fetch(net.api + "/vm-values/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scAddress: addr, funcName, args: argsHex }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const data = j && j.data && j.data.data ? j.data.data : null;
      if (!data || data.returnCode !== "ok") return null;
      return data.returnData || [];
    } catch (_e) {
      return null;
    }
  }

  /* a tx's status: 'success' | 'fail' | 'invalid' | 'pending'. */
  async function txStatus(hash) {
    try {
      const r = await fetch(net.api + "/transactions/" + hash + "?fields=status");
      if (!r.ok) return "pending";
      const j = await r.json();
      return j && j.status ? j.status : "pending";
    } catch (_e) {
      return "pending";
    }
  }

  /* decode a MultiValueEncoded<{address, handle, score}> leaderboard: each
     returnData entry is one TOP-encoded struct = address(32) + handle(4+N) +
     score(8 BE). Field order matches PullerEntry / PainterEntry. */
  function decodeLeaderboard(returnData) {
    if (!returnData) return [];
    const bech32 = state.libs ? state.libs.bech32 : null;
    const out = [];
    for (const b64 of returnData) {
      const bytes = b64ToBytes(b64);
      if (bytes.length < 44) continue; // 32 + 4 + 8 minimum
      let o = 0;
      const addrBytes = bytes.slice(o, o + 32);
      o += 32;
      const hlen = readU32BE(bytes, o);
      o += 4;
      const handle = new TextDecoder().decode(bytes.slice(o, o + hlen));
      o += hlen;
      const score = readU64BE(bytes, o);
      out.push({
        address: bech32 ? addressFromPubkey(bech32, addrBytes) : bytesToHex(addrBytes),
        handle,
        score,
      });
    }
    return out;
  }

  return {
    gameKey,
    label: game.label,
    contract: game.contract,
    deployed,
    explorer: net.explorer,
    get address() {
      return state.key ? state.key.address : null;
    },
    get available() {
      return state.available;
    },
    ensureKey,
    sendAction,
    query,
    txStatus,
    // expose decoders + encoders the cabinet UIs need
    decodeU64,
    b64ToBytes,
    decodeLeaderboard,
    u8ToHex,
    u32ToHex,
    strToHex,
    addressHex() {
      return state.key && state.libs
        ? addressToHex(state.libs.bech32, state.key.address)
        : null;
    },
  };
}
