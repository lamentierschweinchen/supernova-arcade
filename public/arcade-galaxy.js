/* ============================================================================
   arcade-galaxy.js — the shared "Galaxy of Nodes" backdrop for the Supernova
   Arcade (hub + every game). A lightweight 2D port of Beautiful Blockchains'
   Galaxy Explorer: 3 shard clusters (amber / mint / coral) breathing around a
   pulsing metachain core, a temperature-tinted starfield, and transaction
   "photons" arcing between shards (cross-shard route through the core).

   Usage (ES module):
     import { mountGalaxy } from '/arcade-galaxy.js';
     const galaxy = mountGalaxy({ intensity: 0.5, focusShard: 2 });
     galaxy.pulse(2, 3);   // fire 3 photons from shard 2 (wire to real onchain activity)

   opts:
     intensity   0..1  overall brightness/density. Hub ~1, in-game ~0.45 (dimmed,
                       so the game stays the focus — the "play register").
     focusShard  0|1|2|null  bias the ambient stream toward this shard (a game
                       lives on its shard, so its own galaxy leans that color).
     ambient     bool  run a gentle ambient photon stream (default true).
     canvas      element | selector  reuse an existing canvas; otherwise one is
                       created, fixed full-screen at z-index 0.
   Returns { pulse(shard, n), setIntensity(v), destroy() }.
   ============================================================================ */

const SHARDS = [[245, 181, 68], [35, 247, 221], [255, 107, 157]]; // amber / mint / coral
const CORE = [205, 247, 253];
const TEMP = [[166,191,255],[242,242,255],[204,217,255],[255,242,217],[255,224,166],[255,184,115]];

export function mountGalaxy(opts = {}) {
  const intensity0 = opts.intensity == null ? 1 : opts.intensity;
  const focusShard = opts.focusShard == null ? null : opts.focusShard;
  const ambient = opts.ambient !== false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cv = opts.canvas
    ? (typeof opts.canvas === 'string' ? document.querySelector(opts.canvas) : opts.canvas)
    : null;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'galaxy';
    Object.assign(cv.style, { position: 'fixed', inset: '0', zIndex: '0', display: 'block', pointerEvents: 'none' });
    document.body.prepend(cv);
  }
  const ctx = cv.getContext('2d');

  let intensity = intensity0;
  let W, H, DPR, cx, cy, R;
  let stars = [], clusters = [], photons = [];
  let clock = 0, last = 0, since = 0, sb = 0, raf = 0, running = true;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    cx = W * 0.5; cy = H * 0.4; R = Math.min(W, H) * 0.42;
    buildStars();
  }
  function buildStars() {
    stars = [];
    const n = Math.round((innerWidth * innerHeight) / 5200);
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: (0.4 + Math.pow(u, 3) * 2.6) * DPR,
        c: TEMP[(Math.random() * TEMP.length) | 0], tw: rnd(0, 6.28), ts: rnd(0.4, 1.4) });
    }
  }
  function buildClusters() {
    clusters = SHARDS.map((rgb, i) => {
      const pts = [];
      for (let k = 0; k < 165; k++) pts.push({ a: Math.random() * 6.28, rr: Math.abs(gauss()) * R * 0.36, sz: (0.5 + Math.pow(Math.random(), 2.4) * 2.6), b: rnd(0.45, 1) });
      return { rgb, baseAngle: (i / 3) * 6.28 - Math.PI / 2, breath: 0.25 + i * 0.06, phase: i * 1.6, pts };
    });
  }
  function sc(c, t) { const a = c.baseAngle + t * 0.06; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.62]; }
  function qb(a, b, c, t) { const u = 1 - t; return u * u * a + 2 * u * t * b + t * t * c; }

  function spawn(si, burst) {
    if (photons.length > 150) return;
    if (si == null) si = focusShard != null && Math.random() < 0.6 ? focusShard : (Math.random() * 3) | 0;
    const [sx, sy] = sc(clusters[si], clock);
    const cross = Math.random() < (burst ? 0.55 : 0.4);
    let ex, ey, col;
    if (cross) { const di = (si + 1 + ((Math.random() * 2) | 0)) % 3; const e = sc(clusters[di], clock); ex = e[0]; ey = e[1]; col = [255, 243, 200]; }
    else { ex = sx + gauss() * R * 0.5; ey = sy + gauss() * R * 0.32; col = clusters[si].rgb; }
    photons.push({ sx, sy, ex, ey, mx: cx + gauss() * R * 0.12, my: cy + gauss() * R * 0.08, age: 0, life: rnd(1, 1.9), col, sz: (cross ? 2.4 : 1.7) * DPR });
  }

  function staticFrame() {
    ctx.fillStyle = '#050608'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) { ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${0.55 * intensity})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill(); }
    for (const c of clusters) { const [ux, uy] = sc(c, 0); const [r0, g0, b0] = c.rgb; const hg = ctx.createRadialGradient(ux, uy, 0, ux, uy, R * 0.6); hg.addColorStop(0, `rgba(${r0},${g0},${b0},${0.24 * intensity})`); hg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ux, uy, R * 0.6, 0, 6.28); ctx.fill(); }
  }

  function frame(now) {
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now; clock += dt;
    const I = intensity;
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#050608'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    // starfield
    for (const s of stars) { const tw = 0.55 + 0.45 * Math.sin(clock * s.ts + s.tw); ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${0.6 * I * tw})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill(); }
    // metachain core
    const cp = 0.85 + 0.15 * Math.sin(clock * 1.5);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.78 * cp);
    g.addColorStop(0, `rgba(${CORE[0]},${CORE[1]},${CORE[2]},${0.6 * I})`); g.addColorStop(0.3, `rgba(120,200,230,${0.16 * I})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.78 * cp, 0, 6.28); ctx.fill();
    ctx.fillStyle = `rgba(${CORE[0]},${CORE[1]},${CORE[2]},${0.95 * I})`; ctx.beginPath(); ctx.arc(cx, cy, 3.4 * DPR, 0, 6.28); ctx.fill();
    // shard clusters
    for (const c of clusters) {
      const [ux, uy] = sc(c, clock); const br = 0.94 + 0.13 * Math.sin(clock * c.breath * 6.28 + c.phase); const [r0, g0, b0] = c.rgb;
      const hg = ctx.createRadialGradient(ux, uy, 0, ux, uy, R * 0.62 * br);
      hg.addColorStop(0, `rgba(${r0},${g0},${b0},${0.26 * I})`); hg.addColorStop(0.5, `rgba(${r0},${g0},${b0},${0.08 * I})`); hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ux, uy, R * 0.62 * br, 0, 6.28); ctx.fill();
      const rot = clock * 0.13;
      for (const p of c.pts) { const a = p.a + rot, px = ux + Math.cos(a) * p.rr * br, py = uy + Math.sin(a) * p.rr * br * 0.62; ctx.fillStyle = `rgba(${r0},${g0},${b0},${p.b * br * I})`; ctx.beginPath(); ctx.arc(px, py, p.sz * DPR, 0, 6.28); ctx.fill(); }
    }
    // photons
    for (let i = photons.length - 1; i >= 0; i--) {
      const p = photons[i]; p.age += dt; const t = p.age / p.life; if (t >= 1) { photons.splice(i, 1); continue; }
      const fade = (t < 0.15 ? t / 0.15 : (1 - t) / 0.85) * Math.max(0.5, I); const [r0, g0, b0] = p.col;
      for (let k = 0; k < 6; k++) { const tt = Math.max(0, t - k * 0.04); const x = qb(p.sx, p.mx, p.ex, tt), y = qb(p.sy, p.my, p.ey, tt); ctx.fillStyle = `rgba(${r0},${g0},${b0},${fade * (1 - k / 6) * 0.95})`; ctx.beginPath(); ctx.arc(x, y, p.sz * (1 - k * 0.12), 0, 6.28); ctx.fill(); }
    }
    // ambient stream + a Supernova burst
    if (ambient) {
      since += dt; const rate = 0.05 / Math.max(0.4, I);
      while (since > rate) { since -= rate; if (Math.random() < 0.6) spawn(null, false); }
      sb += dt; if (sb > 24) { sb = 0; for (let k = 0; k < 70; k++) setTimeout(() => spawn(null, true), k * 9); }
    }
    raf = requestAnimationFrame(frame);
  }

  buildClusters(); resize();
  const onResize = () => { resize(); if (reduce) staticFrame(); };
  addEventListener('resize', onResize);
  if (reduce) staticFrame(); else raf = requestAnimationFrame(frame);

  return {
    pulse(shard, n = 1) { if (reduce) return; for (let k = 0; k < n; k++) spawn(shard == null ? null : shard, false); },
    setIntensity(v) { intensity = v; if (reduce) staticFrame(); },
    destroy() { running = false; cancelAnimationFrame(raf); removeEventListener('resize', onResize); },
  };
}
