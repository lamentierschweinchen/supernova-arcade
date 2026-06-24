// Vercel / Next.js (pages API) serverless adapter for the gasless relayer.
//
// Deploy ../web as static files and this file as a serverless function so the
// browser can POST to /api/relay on the same origin. Set RELAYER_PEM or
// RELAYER_SECRET_KEY as an environment variable in your host's dashboard
// (never commit a key). The validate/sign/broadcast logic lives in ../relay.js
// and is shared with the local dev server.
//
// Vercel routing: placing this at `api/relay.js` exposes it at `/api/relay`.
// sdk-core's crypto needs the Node.js runtime (not edge).

const { handleRelay } = require("../relay");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  // Vercel parses JSON bodies automatically; fall back to manual parse otherwise.
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
  }

  const ip =
    (req.headers["x-forwarded-for"]?.split(",")[0] || "").trim() ||
    req.headers["x-real-ip"] ||
    "unknown";

  try {
    const { status, json } = await handleRelay({ body: body ?? {}, ip });
    res.status(status).json(json);
  } catch (err) {
    console.error("[api/relay] error:", err);
    res.status(500).json({ error: "relay_failed" });
  }
};
