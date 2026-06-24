// Zero-dependency dev server: serves the static game in ../web AND handles
// POST /api/relay with the gasless relayer core. One command, one origin, no
// framework — `npm run dev` and open http://localhost:8787.
//
// Provide the relayer key via the environment. The easiest way (Node 20+):
//   node --env-file=../.env relayer/server.js
// (npm run dev does this for you.) See ../.env.example.
//
// For production hosting (Vercel/Netlify/etc.), host ../web as static files and
// deploy api/relay.js as a serverless function instead — same relay.js core.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { handleRelay } = require("./relay");

const PORT = Number(process.env.PORT || 8787);
const WEB_DIR = path.resolve(__dirname, "..", "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("payload too large")); // 1MB guard
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function serveStatic(req, res) {
  // map URL path to a file under WEB_DIR; default to game.html
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/game.html";
  const filePath = path.join(WEB_DIR, urlPath);

  // contain the resolved path inside WEB_DIR (no path traversal)
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  // the one dynamic route: the gasless relayer
  if (req.method === "POST" && (req.url || "").split("?")[0] === "/api/relay") {
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
    try {
      const { status, json } = await handleRelay({ body, ip: clientIp(req) });
      return sendJson(res, status, json);
    } catch (err) {
      console.error("[server] relay error:", err);
      return sendJson(res, 500, { error: "relay_failed" });
    }
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(req, res);
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("method not allowed");
});

server.listen(PORT, () => {
  const haveKey = !!(process.env.RELAYER_PEM || process.env.RELAYER_SECRET_KEY);
  console.log(`\n  Supernova Arcade template — dev server`);
  console.log(`  ▸ game:   http://localhost:${PORT}/`);
  console.log(`  ▸ relay:  POST http://localhost:${PORT}/api/relay`);
  console.log(`  ▸ relayer key: ${haveKey ? "loaded ✓" : "NOT set — onchain submit will report 'unavailable'"}`);
  console.log("");
});
