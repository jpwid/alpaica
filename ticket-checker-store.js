const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createTicketCheckerService({ dataFile, searchFlights }) {
  const router = express.Router();
  let running = false;

  function readStore() {
    try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); }
    catch { return { checkers: [] }; }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const temporary = `${dataFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(store, null, 2));
    fs.renameSync(temporary, dataFile);
  }

  function shortId(store) {
    let id;
    do { id = crypto.randomBytes(5).toString("base64url").slice(0, 7).toUpperCase(); }
    while (store.checkers.some((checker) => checker.id === id));
    return id;
  }

  function clean(body, existing = {}) {
    const text = (value, fallback = "") => String(value ?? fallback).trim();
    const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return {
      ...existing,
      origin: text(body.origin, existing.origin), destination: text(body.destination, existing.destination),
      direct: Boolean(body.direct), maxStops: Math.min(2, Math.max(0, number(body.maxStops, 1))),
      departStart: text(body.departStart, existing.departStart), departEnd: text(body.departEnd, existing.departEnd),
      returnStart: text(body.returnStart, existing.returnStart), returnEnd: text(body.returnEnd, existing.returnEnd),
      departFrom: Math.min(23, Math.max(0, number(body.departFrom, 7))), departTo: Math.min(24, Math.max(1, number(body.departTo, 18))),
      returnFrom: Math.min(23, Math.max(0, number(body.returnFrom, 9))), returnTo: Math.min(24, Math.max(1, number(body.returnTo, 21))),
      adults: Math.min(9, Math.max(1, number(body.adults, 1))),
      childAges: Array.isArray(body.childAges) ? body.childAges.slice(0, 6).map((age) => Math.min(17, Math.max(0, number(age, 7)))) : (existing.childAges || []),
      updateTimes: Array.isArray(body.updateTimes) ? body.updateTimes.slice(0, 4).map(String).filter((value) => /^\d{2}:\d{2}$/.test(value)) : (existing.updateTimes || ["08:00"]),
      active: body.active !== false,
      history: existing.history || [], feed: existing.feed || [], createdAt: existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }

  function publicChecker(checker) {
    const { lastRunKey, ...safe } = checker;
    return safe;
  }

  async function runCheck(checker) {
    const offers = await searchFlights(checker);
    const valid = offers.filter((offer) => Number(offer.price) > 0).sort((a, b) => a.price - b.price).slice(0, 3);
    if (!valid.length) throw new Error("Geen vluchtprijzen gevonden voor deze periode.");
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const lowestPrice = valid[0].price;
    const existing = checker.history.find((item) => item.date === date);
    if (existing) existing.price = Math.min(existing.price, lowestPrice);
    else checker.history.push({ date, price: lowestPrice });
    checker.history = checker.history.slice(-370);
    checker.feed.unshift({ id: crypto.randomUUID(), checkedAt: now.toISOString(), lowestPrice, offers: valid });
    checker.feed = checker.feed.slice(0, 90);
    checker.lastError = "";
    checker.updatedAt = now.toISOString();
    return valid;
  }

  router.get("/api/ticket-checkers", (req, res) => {
    const store = readStore();
    res.json({ checkers: store.checkers.filter((checker) => checker.active).map(publicChecker) });
  });

  router.get("/api/ticket-checkers/:id", (req, res) => {
    const checker = readStore().checkers.find((item) => item.id === String(req.params.id).toUpperCase());
    if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
    res.json({ checker: publicChecker(checker) });
  });

  router.post("/api/ticket-checkers", (req, res) => {
    const store = readStore();
    const requestedId = String(req.body.id || "").toUpperCase();
    const index = requestedId ? store.checkers.findIndex((item) => item.id === requestedId) : -1;
    const previous = index >= 0 ? store.checkers[index] : {};
    const checker = { ...clean(req.body, previous), id: index >= 0 ? requestedId : shortId(store) };
    if (!checker.origin || !checker.destination) return res.status(400).json({ error: "Vul vertrek en bestemming in." });
    if (index >= 0) store.checkers[index] = checker; else store.checkers.unshift(checker);
    writeStore(store);
    res.status(index >= 0 ? 200 : 201).json({ checker: publicChecker(checker) });
  });

  router.post("/api/ticket-checkers/:id/status", (req, res) => {
    const store = readStore();
    const checker = store.checkers.find((item) => item.id === String(req.params.id).toUpperCase());
    if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
    checker.active = Boolean(req.body.active); checker.updatedAt = new Date().toISOString(); writeStore(store);
    res.json({ checker: publicChecker(checker) });
  });

  router.post("/api/ticket-checkers/:id/check", async (req, res, next) => {
    try {
      const store = readStore();
      const checker = store.checkers.find((item) => item.id === String(req.params.id).toUpperCase());
      if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
      const offers = await runCheck(checker); writeStore(store); res.json({ checker: publicChecker(checker), offers });
    } catch (error) { next(error); }
  });

  async function checkSchedule() {
    if (running) return;
    running = true;
    try {
      const store = readStore();
      const parts = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
      const time = `${parts.find((part) => part.type === "hour").value}:${parts.find((part) => part.type === "minute").value}`;
      const day = new Date().toISOString().slice(0, 10);
      let changed = false;
      for (const checker of store.checkers.filter((item) => item.active && item.updateTimes.includes(time))) {
        const key = `${day}-${time}`;
        if (checker.lastRunKey === key) continue;
        checker.lastRunKey = key;
        try { await runCheck(checker); }
        catch (error) { checker.lastError = error.message; checker.updatedAt = new Date().toISOString(); }
        changed = true;
      }
      if (changed) writeStore(store);
    } finally { running = false; }
  }

  return { router, start() { setInterval(checkSchedule, 60_000).unref(); setTimeout(checkSchedule, 5_000).unref(); } };
}

module.exports = { createTicketCheckerService };
