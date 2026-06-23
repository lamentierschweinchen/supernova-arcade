// passport.js — the Supernova Arcade "player passport".
//
// One persistent identity carried across every game, with no login. A single
// throwaway shard-0 key + a handle live in localStorage (shared across all games
// on this origin), so the key is ground ONCE and every game signs as the same
// address. That makes scores accrue to one identity, which the /me profile then
// sums across cabinets.
//
// This module is deliberately crypto-free: the game clients already load the
// crypto libs and grind the key, so they call savePassport() once they have it,
// and everyone (clients + the profile page) reads the SAME slots through here.
// The profile needs no crypto — it reads the address + handle and queries the
// onchain leaderboards by address.
//
// Tradeoff (documented): one shared key means one shared nonce. A single tab is
// perfect. Two games open in two tabs at once can race the nonce; the clients
// recover by re-fetching the nonce on a conflict. Most play is single-tab.

const SLOT = {
  sk: "arcade.passport.sk", // hex private key (32 bytes), shard 0
  addr: "arcade.passport.address", // bech32 erd... address (derived once, cached)
  handle: "arcade.passport.handle", // the player's chosen name
};

function ls(get, key, val) {
  try {
    if (get) return localStorage.getItem(key);
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch (_e) {
    return null; // private mode / storage disabled — passport degrades to per-session
  }
}

/** The persistent secret-key hex, or null if no passport yet (first ever play). */
export function getSk() {
  return ls(true, SLOT.sk);
}

/** The passport address (bech32), or null. Cached by the client that grinds it. */
export function getAddress() {
  return ls(true, SLOT.addr);
}

/** The chosen handle, or null. */
export function getHandle() {
  return ls(true, SLOT.handle);
}

/** Persist the chosen handle (also goes onchain per game via the client). */
export function setHandle(handle) {
  ls(false, SLOT.handle, String(handle || "").slice(0, 24));
}

/** Called by a game client the first time it grinds (or migrates) the key, so
 *  every other game reuses the same identity from then on. */
export function savePassport(skHex, address) {
  ls(false, SLOT.sk, skHex);
  if (address) ls(false, SLOT.addr, address);
}

/** True once a passport exists (used to show "set your name" vs a real profile). */
export function hasPassport() {
  return !!getSk();
}

export const PASSPORT_SLOTS = SLOT;
