#!/usr/bin/env node
// check-registry.mjs — fail the build when the arcade's game registries drift apart.
//
// The game list is mirrored across ~10 places (arcade-core GAMES, the shell's
// file/route/counter maps, vercel rewrites, the hub grid, three gameFromPath
// regexes, the share + card + info registries, and the server contract config).
// They MUST agree: a missing route 404s, a missing card ships the wrong share
// image, a client contract the server does not know is not relayable. This script
// parses each source and asserts the cross-consistency invariants. Run in predeploy.
//
// Pure text parsing (the sources are a mix of ESM, classic JS, HTML, TS, JSON), so
// it never imports the app. Node built-ins only.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

// ---- parse each source ----

// arcade-core GAMES: the client cabinet registry (key -> {contract, ...}).
const core = read("public/arcade-core.js");
const coreBlock = core.slice(core.indexOf("export const GAMES = {"));
const coreGames = {};
for (const m of coreBlock.matchAll(/^ {2}([a-z0-9]+):\s*\{/gim)) coreGames[m[1]] = true;
// contract per key
const coreContracts = {};
{
  const re = /^ {2}([a-z0-9]+):\s*\{[\s\S]*?contract:\s*"(erd1[a-z0-9]+)"/gim;
  for (const m of coreBlock.matchAll(re)) coreContracts[m[1]] = m[2];
}
const CABINET_KEYS = Object.keys(coreGames);

// shell maps
const shell = read("public/shell.html");
const mapKeys = (name) => {
  const b = shell.slice(shell.indexOf(`var ${name} = {`));
  const end = b.indexOf("};");
  const keys = new Set();
  for (const m of b.slice(0, end).matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"/gim)) keys.add(m[1]);
  return keys;
};
const gameFile = mapKeys("GAME_FILE");
const gamePretty = mapKeys("GAME_PRETTY");
// pretty path values
const prettyPath = {};
{
  const b = shell.slice(shell.indexOf("var GAME_PRETTY = {"));
  for (const m of b.slice(0, b.indexOf("};")).matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"([^"]+)"/gim)) prettyPath[m[1]] = m[2];
}
const counters = new Set([...shell.matchAll(/\{ id: "([a-z0-9]+)"/g)].map((m) => m[1]));

// vercel rewrites
const vercel = JSON.parse(read("vercel.json"));
const rewrites = new Set(vercel.rewrites.map((r) => r.source));
const redirects = new Set((vercel.redirects || []).map((r) => r.source));

// hub CABINETS ids
const hub = read("public/arcade.html");
const cabIds = new Set([...hub.matchAll(/id: "([a-z0-9]+)", name: "/g)].map((m) => m[1]));

// share + card + info registries
const shareKeys = new Set([...read("public/arcade-share.js").matchAll(/^ {2}([a-z0-9]+):\s*\{ route:/gim)].map((m) => m[1]));
const cardKeys = new Set([...read("src/lib/arcadeCards.ts").matchAll(/^ {2}([a-z0-9]+):\s*\{/gim)].map((m) => m[1]));
const infoJs = read("public/arcade-info.js");
const infoKeys = new Set([...infoJs.slice(infoJs.indexOf("var GAMES = {")).matchAll(/^ {4}([a-z0-9]+):\s*\{/gim)].map((m) => m[1]));

// every data-game used by a share button anywhere
const dataGames = new Set();
for (const p of ["tug-of-war", "canvas", "triptych", "button", "reaction", "me"]) {
  try { for (const m of read(`public/${p}.html`).matchAll(/data-game="([a-z0-9]+)"/g)) dataGames.add(m[1]); } catch {}
}
for (const p of ["shard-snake", "clawback", "degen-dash", "wen-moon"]) {
  try { for (const m of read(`public/${p}/app.html`).matchAll(/data-game="([a-z0-9]+)"/g)) dataGames.add(m[1]); } catch {}
}

// gameFromPath regexes in the three classic/near-classic consumers
const pathMatchers = ["arcade-info.js", "arcade-bridge.js", "arcade-sound.js"].map((f) => ({
  f,
  fn: (() => {
    const src = read(`public/${f}`);
    const b = src.slice(src.indexOf("function gameFromPath"));
    const body = b.slice(0, b.indexOf("\n  }") + 4);
    // build a tester from the regex lines
    const rules = [...body.matchAll(/if \(\/([^/]+)\/\.test\(p\)\) return "([a-z0-9]+)"/g)].map((m) => ({ re: new RegExp(m[1]), key: m[2] }));
    return (path) => { for (const r of rules) if (r.re.test(path)) return r.key; return null; };
  })(),
}));

// server contract addresses (client contracts must all appear here)
const serverCfg = read("src/lib/onchain/arcade.config.ts") + read("src/lib/onchain/tap-counter.config.ts");
const serverAddrs = new Set([...serverCfg.matchAll(/(erd1[a-z0-9]{50,})/g)].map((m) => m[1]));

// ---- invariants ----

// Registered games deliberately NOT shown in the hub grid (still routable + carded):
// the classic single canvas lives at /canvas-classic; the triptych replaced it in the grid.
const UNLISTED = new Set(["canvas"]);

// 1. every cabinet game is routable, countable, shown, and has a card + share + info
for (const k of CABINET_KEYS) {
  if (!gameFile.has(k)) fail(`GAME_FILE missing cabinet "${k}"`);
  if (!gamePretty.has(k)) fail(`GAME_PRETTY missing cabinet "${k}"`);
  if (!cardKeys.has(k)) fail(`arcadeCards CARD_GAMES missing "${k}"`);
  if (!shareKeys.has(k)) fail(`arcade-share GAMES missing "${k}"`);
  if (!infoKeys.has(k)) fail(`arcade-info GAMES missing "${k}"`);
  if (UNLISTED.has(k)) continue; // not in the grid / odometer by design
  if (!counters.has(k)) fail(`shell COUNTERS missing cabinet "${k}"`);
  if (!cabIds.has(k)) fail(`hub CABINETS missing "${k}"`);
}

// 2. every pretty path resolves via a vercel rewrite (or redirect)
for (const [k, path] of Object.entries(prettyPath)) {
  if (!rewrites.has(path) && !redirects.has(path)) fail(`vercel.json has no rewrite/redirect for "${k}" -> ${path}`);
}

// 3. every share button's data-game has a card + share entry (the wrong-card bug)
for (const g of dataGames) {
  if (!cardKeys.has(g)) fail(`data-game="${g}" has no CARD_GAMES entry (would ship the fallback sprint card)`);
  if (!shareKeys.has(g)) fail(`data-game="${g}" has no arcade-share entry`);
}

// 4. every client contract is known to the server (else the relayer rejects it)
for (const [k, addr] of Object.entries(coreContracts)) {
  if (!serverAddrs.has(addr)) fail(`arcade-core "${k}" contract ${addr.slice(0, 12)}... is not in the server config (not relayable)`);
}

// 5. each gameFromPath resolves every cabinet's pretty path to that cabinet
for (const { f, fn } of pathMatchers) {
  for (const k of CABINET_KEYS) {
    const path = prettyPath[k];
    if (path && fn(path) !== k) fail(`${f} gameFromPath("${path}") = ${fn(path)}, expected "${k}"`);
  }
}

// ---- report ----
if (errors.length) {
  console.error(`\n✗ registry drift (${errors.length}):`);
  for (const e of errors) console.error("  - " + e);
  console.error("");
  process.exit(1);
}
console.log(`✓ registry consistent: ${CABINET_KEYS.length} cabinets across file/route/counter/hub/card/share/info/contract + ${pathMatchers.length} path matchers.`);
