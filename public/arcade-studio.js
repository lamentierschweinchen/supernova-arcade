/* ============================================================================
   arcade-studio.js — the Score Studio desk for the Supernova Arcade.

   A Strata-style tuning desk for arcade-score.js: every knob over the live
   generative engine, plus a built-in ACTIVITY DRIVER so you can sweep "how busy
   is the arcade" and hear the arrangement escalate from the idle space drone up
   to a full chiptune banger — without waiting on real players.

   Tune by ear, hit "Export mix" to copy the preset JSON, and paste it into
   DEFAULT_MIX in arcade-score.js to ship it as the signed default.

   Standalone dev tool (loaded by arcade-studio.html). It imports the SAME score
   module the hub ships, so what you tune is what plays.
   ============================================================================ */

const VOICE_GROUPS = [
  { title: "Arrangement (escalates with energy)", voices: [
    ["pad", "Space pad"], ["bass", "Funk bass"], ["kick", "Kick"], ["hat", "Hat"],
    ["snare", "Snare"], ["arp", "Arp"], ["lead", "Lead"],
  ] },
  { title: "Cabinets (per-game accents)", voices: [
    ["sprint", "Sprint"], ["tugofwar", "Tug of War"], ["canvas", "Canvas"],
    ["button", "The Button"], ["clawback", "ETHperience"], ["degendash", "Degen Dash"],
  ] },
  { title: "Events", voices: [["blip", "SFX / Jingle"]] },
];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MODES = ["spacey", "bright", "dorian"];

function rnd(n) { return Math.floor(Math.random() * n); }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/* tiny DOM helpers */
function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k === "class") n.className = attrs[k];
    else if (k === "html") n.innerHTML = attrs[k];
    else if (k === "style") n.style.cssText = attrs[k];
    else if (k.startsWith("on") && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => c != null && n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}
function slider(min, max, step, val, on) {
  const s = el("input", { type: "range", min, max, step, value: val, class: "sl" });
  s.addEventListener("input", () => on(parseFloat(s.value)));
  return s;
}

export function mountStudio(score, opts = {}) {
  injectCSS();
  const root = el("div", { class: "asd" });
  (opts.mount || document.body).appendChild(root);

  /* ---------------- transport / readouts ---------------- */
  const read = {};
  function stat(label, key) {
    const v = el("div", { class: "stat-v" }, "--"); read[key] = v;
    return el("div", { class: "stat" }, [el("div", { class: "stat-l" }, label), v]);
  }
  const masterSl = slider(0, 1, 0.01, 0.8, (v) => score.setMaster(v));
  const onBtn = el("button", { class: "big", onclick: async () => {
    const nowOn = await score.toggle();
    onBtn.textContent = nowOn ? "◼ STOP" : "▶ START";
    onBtn.classList.toggle("live", nowOn);
  } }, "▶ START");
  const transport = el("div", { class: "row bar" }, [
    onBtn,
    el("div", { class: "fader" }, [el("span", { class: "fl" }, "MASTER"), masterSl]),
    stat("TIER", "tier"), stat("ENERGY", "energy"), stat("BPM", "bpm"),
    stat("KEY", "key"), stat("BAR", "bar"), stat("TOTAL", "total"),
  ]);

  /* ---------------- drive (simulated play) ---------------- */
  const fake = { sprint: 0, tugofwar: 0, canvas: 0, button: 0, clawback: 0, degendash: 0 };
  let activity = 0, autoDemo = false;
  const actSl = slider(0, 1, 0.01, 0, (v) => { activity = v; actVal.textContent = v.toFixed(2); });
  const actVal = el("span", { class: "mono dim" }, "0.00");
  const autoBtn = el("button", { class: "tg", onclick: () => { autoDemo = !autoDemo; autoBtn.classList.toggle("on", autoDemo); } }, "Auto-demo");
  const engSl = slider(0, 1, 0.01, 0, (v) => { score.setEnergyOverride(v); engVal.textContent = v.toFixed(2); engAuto.classList.remove("on"); });
  const engVal = el("span", { class: "mono dim" }, "auto");
  const engAuto = el("button", { class: "tg on", onclick: () => { score.setEnergyOverride(null); engVal.textContent = "auto"; engAuto.classList.add("on"); } }, "Auto");
  const cabBtns = Object.keys(fake).map((id) => el("button", { class: "tg sm", onclick: () => { fake[id] += 14; pushFeed(); } }, id));

  function pushFeed() { score.feed({ perCabinet: { ...fake }, total: Object.values(fake).reduce((a, b) => a + b, 0) }); }
  const driveTimer = setInterval(() => {
    if (!score.isOn()) return;
    let a = activity;
    if (autoDemo) { activity = clamp01(activity + (Math.random() - 0.48) * 0.12); actSl.value = activity; actVal.textContent = activity.toFixed(2); a = activity; }
    fake.sprint += rnd(1 + a * 34);
    fake.tugofwar += rnd(1 + a * 12);
    fake.canvas += rnd(1 + a * 14);
    fake.button += Math.random() < a * 0.5 ? 1 + rnd(3) : 0;
    fake.clawback += Math.random() < a * 0.6 ? rnd(6) : 0;
    fake.degendash += Math.random() < a * 0.5 ? rnd(7) : 0;
    pushFeed();
  }, 1500);

  const drive = panel("Drive · simulate play", [
    el("div", { class: "row" }, [el("span", { class: "fl wide" }, "Activity"), actSl, actVal, autoBtn]),
    el("div", { class: "row" }, [el("span", { class: "fl wide" }, "Energy override"), engSl, engVal, engAuto]),
    el("div", { class: "row wrap" }, [el("span", { class: "fl wide" }, "Poke a cabinet"), ...cabBtns]),
  ]);

  /* ---------------- conductor (15-min arc + data->melody) ---------------- */
  const litVal = el("span", { class: "mono dim" }, "0.80");
  const litSl = slider(0, 1, 0.01, 0.8, (v) => { score.setLitStrength(v); litVal.textContent = v.toFixed(2); });
  const arcBtn = el("button", { class: "tg sm on", onclick: () => { const on = arcBtn.classList.toggle("on"); score.setConductorAuto(on); } }, "Auto-arc");
  const nextBtn = el("button", { class: "tg sm", onclick: () => score.nextMovement() }, "Next movement →");
  const mvRead = el("span", { class: "mono", style: "color:var(--mint);font-size:12px" }, "--");
  const steerRead = el("span", { class: "mono dim", style: "font-size:10.5px" }, "--");
  const conductorPanel = panel("Conductor · 15-min arc + data → melody", [
    el("div", { class: "row" }, [el("span", { class: "fl wide" }, "Data → melody"), litSl, litVal]),
    el("div", { class: "row wrap" }, [el("span", { class: "fl wide" }, "Movement"), mvRead, nextBtn, arcBtn]),
    el("div", { class: "row" }, [el("span", { class: "fl wide" }, "Steering"), steerRead]),
  ]);

  /* ---------------- harmony ---------------- */
  const keyRow = el("div", { class: "row wrap" });
  const keyBtns = {};
  NOTE_NAMES.forEach((nm) => { const b = el("button", { class: "tg sm", onclick: () => score.setKey(nm, null) }, nm); keyBtns[nm] = b; keyRow.appendChild(b); });
  const modeRow = el("div", { class: "row wrap" });
  const modeBtns = {};
  MODES.forEach((m) => { const b = el("button", { class: "tg sm", onclick: () => score.setKey(null, m) }, m); modeBtns[m] = b; modeRow.appendChild(b); });
  const cycleBtn = el("button", { class: "tg", onclick: () => { const on = cycleBtn.classList.toggle("on"); score.setAutoKeyCycle(on); } }, "Auto key-cycle");
  const swingSl = slider(0, 0.5, 0.01, 0.12, (v) => score.setSwing(v));
  const harmony = panel("Harmony · key & modulation", [
    el("div", { class: "row" }, [el("span", { class: "fl wide" }, "Key root"), keyRow]),
    el("div", { class: "row" }, [el("span", { class: "fl wide" }, "Mode"), modeRow]),
    el("div", { class: "row wrap" }, [
      el("span", { class: "fl wide" }, "Modulate"),
      el("button", { class: "tg sm", onclick: () => score.modulate(-2) }, "−2"),
      el("button", { class: "tg sm", onclick: () => score.modulate(2) }, "+2"),
      el("button", { class: "tg sm", onclick: () => score.modulate(5) }, "+5 (fifth)"),
      el("button", { class: "tg sm", onclick: () => score.returnHome() }, "home"),
      cycleBtn,
    ]),
    el("div", { class: "row" }, [el("span", { class: "fl wide" }, "Swing"), swingSl]),
  ]);

  /* ---------------- mixer ---------------- */
  const stripEls = {};
  const mixerBody = el("div", { class: "mix" });
  VOICE_GROUPS.forEach((g) => {
    mixerBody.appendChild(el("div", { class: "grp" }, g.title));
    g.voices.forEach(([id, label]) => {
      const meter = el("i", { class: "mtr-i" });
      const lvl = slider(0, 1, 0.01, 0.5, (v) => score.setLevel(id, v));
      const rev = slider(0, 1, 0.01, 0.2, (v) => score.setSend(id, "reverb", v));
      const del = slider(0, 1, 0.01, 0.1, (v) => score.setSend(id, "delay", v));
      const m = el("button", { class: "mb", onclick: () => { const on = m.classList.toggle("on"); score.setMute(id, on); } }, "M");
      const s = el("button", { class: "sb", onclick: () => { const on = s.classList.toggle("on"); score.setSolo(id, on); } }, "S");
      stripEls[id] = { meter, lvl, rev, del, m, s };
      mixerBody.appendChild(el("div", { class: "strip" }, [
        el("div", { class: "sn" }, [el("div", { class: "mtr" }, meter), el("span", {}, label)]),
        el("label", { class: "kk" }, [el("span", {}, "L"), lvl]),
        el("label", { class: "kk" }, [el("span", {}, "R"), rev]),
        el("label", { class: "kk" }, [el("span", {}, "D"), del]),
        m, s,
      ]));
    });
  });
  const mixer = panel("Mixer", [mixerBody]);

  /* ---------------- moments + presets ---------------- */
  const out = el("textarea", { class: "out", readonly: "", spellcheck: "false" });
  const moments = panel("Moments & presets", [
    el("div", { class: "row wrap" }, [
      el("span", { class: "fl wide" }, "Trigger"),
      el("button", { class: "tg sm", onclick: () => score.triggerJingle("coin") }, "coin"),
      el("button", { class: "tg sm", onclick: () => score.triggerJingle("levelup") }, "level-up"),
      el("button", { class: "tg sm", onclick: () => score.triggerJingle("milestone") }, "milestone"),
      el("button", { class: "tg sm", onclick: () => score.modulate(2) }, "key +2 + riser"),
      el("button", { class: "tg sm", onclick: () => score.triggerMoment() }, "full moment"),
    ]),
    el("div", { class: "row wrap" }, [
      el("span", { class: "fl wide" }, "Feel preset"),
      ...score.presets.map((p) => el("button", { class: "tg sm", onclick: () => { score.applyPreset(p); if (p === "Auto") { engAuto.classList.add("on"); engVal.textContent = "auto"; } } }, p)),
    ]),
    el("div", { class: "row wrap" }, [
      el("span", { class: "fl wide" }, "Signed mix"),
      el("button", { class: "tg", onclick: () => { const j = JSON.stringify(score.getMix(), null, 2); out.value = j; try { navigator.clipboard.writeText(j); } catch (e) {} } }, "Export mix → clipboard"),
    ]),
    out,
  ]);

  root.append(transport, el("div", { class: "cols" }, [
    el("div", { class: "col" }, [drive, conductorPanel, harmony, moments]),
    el("div", { class: "col" }, [mixer]),
  ]));

  /* ---------------- live poll: readouts, meters, control sync ---------------- */
  const poll = setInterval(() => {
    const st = score.getState();
    read.tier.textContent = st.tier;
    read.tier.className = "stat-v " + (st.energy > 0.8 ? "hot" : st.energy > 0.45 ? "warm" : "");
    read.energy.textContent = st.energy.toFixed(2) + (st.energyOverride != null ? " (fix)" : "");
    read.bpm.textContent = st.bpm == null ? "--" : st.bpm;
    read.key.textContent = st.key.root + " " + st.key.mode + (st.modCount ? " +" + st.modCount : "");
    read.bar.textContent = st.bar + " · ch" + st.chordIdx;
    read.total.textContent = st.total == null ? "--" : st.total.toLocaleString("en-US");
    // conductor readouts (movement + data steering)
    const c = st.conductor;
    if (c) {
      const sgn = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
      mvRead.textContent = (c.idx + 1) + "/" + c.count + " · " + c.label + "  [" + c.colorBias + "]";
      steerRead.textContent = "steer " + sgn(c.steer) + " (contour " + sgn(c.contour) + " / trend " + sgn(c.trend) + ")  leap " + c.leapiness.toFixed(2);
      arcBtn.classList.toggle("on", !!c.auto);
    }
    // highlight current key/mode
    for (const nm in keyBtns) keyBtns[nm].classList.toggle("on", nm === st.key.root);
    for (const m in modeBtns) modeBtns[m].classList.toggle("on", m === st.key.mode);
    // meters + reflect engine-driven gate on the meter fill
    for (const id in stripEls) {
      const v = st.voices[id]; if (!v) continue;
      const e = stripEls[id];
      e.meter.style.transform = "scaleX(" + Math.min(1, v.meter * (v.gate == null ? 1 : v.gate)) + ")";
      e.meter.style.opacity = 0.4 + 0.6 * (v.gate == null ? 1 : v.gate);
    }
  }, 70);

  return { dispose() { clearInterval(driveTimer); clearInterval(poll); root.remove(); } };
}

function panel(title, kids) {
  return el("section", { class: "pnl" }, [el("h3", {}, title), ...kids]);
}

/* ---------------------------------------------------------------- styles */
let injected = false;
function injectCSS() {
  if (injected) return; injected = true;
  const css = `
  .asd{--bg:#06070A;--surface:#0E1117;--s2:#141821;--border:#1E2330;--mint:#23F7DD;--text:#F4F6FA;--dim:#9BA3B4;--faint:#6B7385;--amber:#F5B544;--coral:#FF6B9D;
    --mono:'JetBrains Mono',ui-monospace,Menlo,monospace;font-family:'Roobert PRO',system-ui,sans-serif;color:var(--text);max-width:1200px;margin:0 auto;padding:16px;}
  .asd .row{display:flex;align-items:center;gap:10px;margin:8px 0;}
  .asd .row.wrap{flex-wrap:wrap;} .asd .bar{flex-wrap:wrap;gap:14px;border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:12px 14px;position:sticky;top:8px;z-index:5;}
  .asd .cols{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px;} @media(min-width:920px){.asd .cols{grid-template-columns:1fr 1fr;}}
  .asd .col{display:flex;flex-direction:column;gap:14px;}
  .asd .pnl{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:12px 14px;}
  .asd .pnl h3{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin:2px 0 10px;}
  .asd .big{font-family:inherit;font-weight:700;font-size:14px;letter-spacing:.04em;border:1px solid var(--border);background:var(--s2);color:var(--text);border-radius:10px;padding:9px 16px;cursor:pointer;}
  .asd .big.live{background:var(--mint);color:#04221F;border-color:var(--mint);box-shadow:0 0 16px rgba(35,247,221,.4);}
  .asd .fader{display:flex;align-items:center;gap:8px;} .asd .fl{font-size:11px;color:var(--faint);letter-spacing:.06em;} .asd .fl.wide{min-width:110px;display:inline-block;}
  .asd .stat{display:flex;flex-direction:column;gap:2px;min-width:70px;} .asd .stat-l{font-size:9.5px;letter-spacing:.12em;color:var(--faint);text-transform:uppercase;}
  .asd .stat-v{font-family:var(--mono);font-size:15px;font-weight:700;color:var(--mint);} .asd .stat-v.warm{color:var(--amber);} .asd .stat-v.hot{color:var(--coral);}
  .asd .sl{-webkit-appearance:none;appearance:none;height:4px;border-radius:3px;background:var(--border);outline:none;flex:1 1 90px;min-width:80px;}
  .asd .sl::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--mint);cursor:pointer;box-shadow:0 0 6px rgba(35,247,221,.5);}
  .asd .sl::-moz-range-thumb{width:14px;height:14px;border:none;border-radius:50%;background:var(--mint);cursor:pointer;}
  .asd .tg{font-family:inherit;font-size:12px;border:1px solid var(--border);background:var(--s2);color:var(--dim);border-radius:8px;padding:6px 11px;cursor:pointer;white-space:nowrap;}
  .asd .tg.sm{font-size:11px;padding:5px 9px;} .asd .tg.on{border-color:var(--mint);color:var(--mint);background:rgba(35,247,221,.08);}
  .asd .tg:hover{color:var(--text);} .asd .mono{font-family:var(--mono);} .asd .dim{color:var(--faint);font-size:11px;min-width:34px;}
  .asd .mix{display:flex;flex-direction:column;gap:6px;} .asd .grp{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin:10px 0 2px;}
  .asd .strip{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr auto auto;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--border);border-radius:9px;background:var(--s2);}
  .asd .sn{display:flex;align-items:center;gap:8px;font-size:12px;} .asd .mtr{width:30px;height:8px;border-radius:3px;background:#0a0d13;overflow:hidden;flex:0 0 auto;}
  .asd .mtr-i{display:block;width:100%;height:100%;background:linear-gradient(90deg,var(--mint),var(--amber));transform:scaleX(0);transform-origin:left;transition:transform .07s linear;}
  .asd .kk{display:flex;align-items:center;gap:5px;} .asd .kk span{font-size:9.5px;color:var(--faint);width:9px;}
  .asd .mb,.asd .sb{font-family:var(--mono);font-size:10px;border:1px solid var(--border);background:#0a0d13;color:var(--faint);border-radius:6px;width:24px;height:24px;cursor:pointer;}
  .asd .mb.on{border-color:var(--coral);color:var(--coral);} .asd .sb.on{border-color:var(--amber);color:var(--amber);}
  .asd .out{width:100%;min-height:120px;margin-top:10px;background:#0a0d13;border:1px solid var(--border);border-radius:8px;color:var(--dim);font-family:var(--mono);font-size:11px;padding:8px;resize:vertical;}
  `;
  document.head.appendChild(el("style", { html: css }));
}
