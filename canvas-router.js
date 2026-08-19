const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createCanvasRouter({ root }) {
  const router = express.Router();
  const attempts = new Map();
  const password = process.env.CANVAS_PASSWORD || "";
  const apiKey = process.env.OPENAI_API_KEY || "";
  const model = process.env.CANVAS_IMAGE_MODEL || "gpt-image-2";
  const signingKey = crypto.createHash("sha256").update(`canvas:${password}`).digest();

  router.use(express.json({ limit: "60mb" }));

  function rateLimit(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((stamp) => now - stamp < 10 * 60 * 1000);
    if (recent.length >= 12) return res.status(429).json({ error: "Te veel pogingen. Probeer het over enkele minuten opnieuw." });
    recent.push(now);
    attempts.set(key, recent);
    next();
  }

  function signToken() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
    const signature = crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  function validToken(value) {
    if (!password || !value) return false;
    const [payload, signature] = String(value).split(".");
    if (!payload || !signature) return false;
    const expected = crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");
    if (!timingSafeEqualText(signature, expected)) return false;
    try { return Number(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp) > Date.now(); } catch { return false; }
  }

  function requireAccess(req, res, next) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!validToken(token)) return res.status(401).json({ error: "Ontgrendel Canvas eerst met het privéwachtwoord." });
    next();
  }

  router.post("/login", rateLimit, (req, res) => {
    if (!password) return res.status(503).json({ error: "CANVAS_PASSWORD is nog niet ingesteld op Hostinger." });
    if (!timingSafeEqualText(req.body?.password || "", password)) return res.status(401).json({ error: "Onjuist wachtwoord." });
    res.json({ token: signToken(), expires_in: 28800 });
  });

  router.post("/generate", requireAccess, async (req, res, next) => {
    try {
      if (!apiKey) return res.status(503).json({ error: "OPENAI_API_KEY is nog niet ingesteld op Hostinger." });
      const instruction = String(req.body?.instruction || "").trim();
      const references = Array.isArray(req.body?.references) ? req.body.references.slice(0, 5) : [];
      if (!instruction || !references.length) return res.status(400).json({ error: "Voeg referentiebeelden en een duidelijke instructie toe." });

      const form = new FormData();
      const basePath = path.join(root, "canvas", "assets", "master-bedroom.png");
      form.append("image[]", new Blob([fs.readFileSync(basePath)], { type: "image/png" }), "master-bedroom.png");
      for (const [index, reference] of references.entries()) {
        const match = String(reference?.dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) throw Object.assign(new Error("Een referentiebeeld heeft een ongeldig formaat."), { status: 400 });
        const bytes = Buffer.from(match[2], "base64");
        if (bytes.length > 8 * 1024 * 1024) throw Object.assign(new Error("Een referentiebeeld is groter dan 8 MB."), { status: 400 });
        form.append("image[]", new Blob([bytes], { type: match[1] }), `reference-${index + 1}.${match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1]}`);
      }

      form.append("model", model);
      form.append("size", "1536x1024");
      form.append("quality", "medium");
      form.append("input_fidelity", "high");
      form.append("output_format", "png");
      form.append("prompt", [
        "Edit the first image: a photorealistic architectural visualization of the master bedroom.",
        "Preserve the exact room geometry, camera position, windows, glass wardrobe, doors, bed placement and lighting architecture.",
        "Use the remaining images only as material, color and style references.",
        "Do not add a freestanding fireplace or change structural elements.",
        `User instruction: ${instruction}`
      ].join(" "));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180000);
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error?.message || "De beeldbewerking is mislukt.";
        throw Object.assign(new Error(message), { status: response.status >= 400 && response.status < 500 ? 400 : 502 });
      }
      const image = payload?.data?.[0];
      const imageUrl = image?.b64_json ? `data:image/png;base64,${image.b64_json}` : image?.url;
      if (!imageUrl) throw Object.assign(new Error("OpenAI gaf geen beeld terug."), { status: 502 });
      res.json({ image_url: imageUrl });
    } catch (error) {
      if (error.name === "AbortError") error = Object.assign(new Error("De beeldbewerking duurde te lang. Probeer opnieuw."), { status: 504 });
      next(error);
    }
  });

  return router;
}

module.exports = { createCanvasRouter };
