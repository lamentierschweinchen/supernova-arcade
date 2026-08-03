// arcade-standings.mjs — authoritative on-chain standings for every cabinet.
//
// Reads the contracts directly rather than the leaderboard service, so it answers
// "did the transactions actually EXECUTE" and not merely "were they accepted".
// That distinction has bitten every load wave so far: gateway acceptance and
// contract execution are different things, and only this view sees the second one.
//
// Every cabinet exposes getGlobalActions + getPlayerCount; the original tap counter
// predates that convention and uses getGlobalTaps.
//
//   node scripts/arcade-standings.mjs            # snapshot
//   node scripts/arcade-standings.mjs --watch 5  # re-read every 5 min, show the rate
const API = "https://testnet-api.multiversx.com";

const CABINETS = [
  ["Supernova Sprint", "erd1qqqqqqqqqqqqqpgqlwv6l2zpx9v0uv6869tn90exv3vdplejppuq97k7r4", "getGlobalTaps"],
  ["Tug of War",       "erd1qqqqqqqqqqqqqpgqrxm0hn9tgwm3waey3ynx08uutur58y0kppuqgpd2xl"],
  ["The Button",       "erd1qqqqqqqqqqqqqpgqm4z4vf7h2y0dmcadrj66ucxkda7950mqppuqz09pgl"],
  ["Reaction",         "erd1qqqqqqqqqqqqqpgqfhn8axyds26pz6lue7akns6de9f0qaakppuqjxjact"],
  ["Snakanova",        "erd1qqqqqqqqqqqqqpgq0lqyvkyt6eldks4ehvu38wd2g7e75tkmppuqhd5c5x"],
  ["Clawback",         "erd1qqqqqqqqqqqqqpgq5prt7nz84my2926d4xs9sw9dyz9j2s4uppuqkvnrrs"],
  ["Degen Dash",       "erd1qqqqqqqqqqqqqpgqs7wzfzuc0wju7kdna4528ntz4hcywdrlppuqtn4h8w"],
  ["Wen Moon",         "erd1qqqqqqqqqqqqqpgq83errjg5avj4d8tmpwpc33ckl9ywp0erppuqna027f"],
  ["Shard Hydra",      "erd1qqqqqqqqqqqqqpgqa3dyjwv8r74md5wq0n3cfuvh98w24zmdppuqjufe9x"],
  ["Novaman · shard 0","erd1qqqqqqqqqqqqqpgq8shkqnta5x6aj7gt5lapsmk7aw5kjrzrppuqvfm605"],
  ["Novaman · shard 1","erd1qqqqqqqqqqqqqpgqk6gs82sw7urmxky08cxsvpfz9vkrs7nqx63s34pjrl"],
  ["Novaman · shard 2","erd1qqqqqqqqqqqqqpgqdp7qwkajzvg0pn3annpgkmhjhw89tlwf5cdqs7jc4q"],
  ["Canvas · left",    "erd1qqqqqqqqqqqqqpgqphkmpc6ryf0ha9fnymhawyetkwknf907x63s9kfv5h"],
  ["Canvas · center",  "erd1qqqqqqqqqqqqqpgqxex6j5ucqqmgurwpxunf428jnrck53a9ppuqg93s3t"],
  ["Canvas · right",   "erd1qqqqqqqqqqqqqpgqj4pwlwf2ujuhy9x0fxmfuuhal4llxl3n5cdq3hgrfd"],
];

const dec = (b) => { const x = Buffer.from(b || "", "base64"); let v = 0n; for (const c of x) v = (v << 8n) | BigInt(c); return Number(v); };
async function view(sc, fn) {
  try {
    const r = await fetch(`${API}/vm-values/query`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scAddress: sc, funcName: fn, args: [] }),
      signal: AbortSignal.timeout(20_000),
    });
    const d = (await r.json())?.data?.data;
    return d?.returnCode === "ok" ? dec(d.returnData?.[0]) : null;
  } catch { return null; }
}

// A view call fails now and then. Counting that cabinet as zero silently erases its whole
// history from the total (one flaky Sprint read dropped 2M), and makes the rate line show
// a fake collapse followed by a fake spike. Hold the last good value per cabinet instead,
// and say plainly when a number is stale rather than quietly reporting a wrong total.
const lastGood = new Map();
async function snapshot() {
  const rows = await Promise.all(CABINETS.map(async ([name, sc, fn]) => {
    const [actions, players] = await Promise.all([
      view(sc, fn || "getGlobalActions"), view(sc, "getPlayerCount"),
    ]);
    if (actions !== null) lastGood.set(name, actions);
    const held = actions === null && lastGood.has(name);
    return { name, actions: actions ?? lastGood.get(name) ?? null, players, held };
  }));
  return rows;
}

const argv = process.argv.slice(2);
const wi = argv.indexOf("--watch");
const everyMin = wi >= 0 ? +argv[wi + 1] || 5 : 0;

let prev = null, prevAt = 0;
async function render() {
  const rows = await snapshot();
  const now = Date.now();
  const total = rows.reduce((s, r) => s + (r.actions ?? 0), 0);
  const pad = Math.max(...rows.map((r) => r.name.length));
  console.log(`\n  ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
  const unknown = rows.filter((r) => r.actions === null).map((r) => r.name);
  const stale = rows.filter((r) => r.held).map((r) => r.name);
  for (const r of rows) {
    const a = r.actions === null ? "  unreadable" : r.actions.toLocaleString().padStart(11);
    const p = r.players === null ? "" : `${String(r.players).padStart(6)} players`;
    let d = "";
    if (prev) {
      const was = prev.find((x) => x.name === r.name);
      const delta = (r.actions ?? 0) - (was?.actions ?? 0);
      if (delta > 0) d = `   +${delta.toLocaleString()}`;
    }
    console.log(`  ${r.name.padEnd(pad)}  ${a}  ${p}${r.held ? "  (held, read failed)" : ""}${d}`);
  }
  console.log(`  ${"".padEnd(pad)}  ${"─".repeat(11)}`);
  console.log(`  ${"TOTAL".padEnd(pad)}  ${total.toLocaleString().padStart(11)}${unknown.length ? `   PARTIAL — missing ${unknown.join(", ")}` : ""}`);
  if (stale.length) console.log(`  ${"".padEnd(pad)}  (held last-known for ${stale.join(", ")})`);
  // A rate computed across a snapshot where some cabinet was unknown is meaningless, so
  // don't print a number that would be read as a real slowdown.
  if (prev && !unknown.length && !prev.some((r) => r.actions === null)) {
    const pt = prev.reduce((s, r) => s + (r.actions ?? 0), 0);
    const secs = (now - prevAt) / 1000;
    console.log(`  ${"landed on-chain".padEnd(pad)}  +${(total - pt).toLocaleString()} in ${(secs / 60).toFixed(0)}m  =  ${((total - pt) / secs).toFixed(1)}/s`);
  }
  prev = rows; prevAt = now;
}

await render();
if (everyMin) { setInterval(render, everyMin * 60_000); }
