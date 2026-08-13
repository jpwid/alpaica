const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createTicketCheckerService({ dataFile, database, searchFlights, notify }) {
  const router = express.Router();
  const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  let running = false;
  let pool;
  let databaseReady;

  async function ensureDatabase() {
    if (!database) return null;
    if (!databaseReady) {
      databaseReady = (async () => {
        const mysql = require("mysql2/promise");
        pool = mysql.createPool({ ...database, waitForConnections: true, connectionLimit: 4, queueLimit: 0 });
        await pool.execute(`CREATE TABLE IF NOT EXISTS ticket_checkers (
          id VARCHAR(16) PRIMARY KEY,
          active TINYINT(1) NOT NULL DEFAULT 1,
          payload LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_ticket_checkers_active (active)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        return pool;
      })();
    }
    return databaseReady;
  }

  async function readStore() {
    if (database) {
      const db = await ensureDatabase();
      const [rows] = await db.execute("SELECT payload FROM ticket_checkers ORDER BY updated_at DESC");
      return { checkers: rows.map((row) => JSON.parse(row.payload)) };
    }
    try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); }
    catch { return { checkers: [] }; }
  }

  async function writeStore(store) {
    if (database) {
      const db = await ensureDatabase();
      for (const checker of store.checkers) {
        await db.execute(
          "INSERT INTO ticket_checkers (id, active, payload) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE active = VALUES(active), payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP",
          [checker.id, checker.active ? 1 : 0, JSON.stringify(checker)]
        );
      }
      return;
    }
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
    const resetResults = Boolean(body.resetResults);
    const minTripDays = Math.min(30, Math.max(1, number(body.minTripDays, existing.minTripDays || 7)));
    const maxTripDays = Math.min(30, Math.max(minTripDays, number(body.maxTripDays, existing.maxTripDays || Math.max(21, minTripDays))));
    return {
      ...existing,
      origin: text(body.origin, existing.origin), destination: text(body.destination, existing.destination),
      originCode: text(body.originCode, existing.originCode), destinationCode: text(body.destinationCode, existing.destinationCode),
      email: text(body.email, existing.email).slice(0, 254),
      tripType: body.tripType === "oneway" ? "oneway" : "roundtrip",
      direct: Math.min(2, Math.max(0, number(body.maxStops, 1))) === 0,
      maxStops: Math.min(2, Math.max(0, number(body.maxStops, 1))),
      maxDuration: Math.min(48, Math.max(1, number(body.maxDuration, existing.maxDuration || 24))),
      minTripDays,
      maxTripDays,
      departStart: text(body.departStart, existing.departStart), departEnd: text(body.departEnd, existing.departEnd),
      returnStart: text(body.returnStart, existing.returnStart), returnEnd: text(body.returnEnd, existing.returnEnd),
      departFrom: Math.min(23, Math.max(0, number(body.departFrom, 7))), departTo: Math.min(24, Math.max(1, number(body.departTo, 18))),
      returnFrom: Math.min(23, Math.max(0, number(body.returnFrom, 9))), returnTo: Math.min(24, Math.max(1, number(body.returnTo, 21))),
      adults: Math.min(9, Math.max(1, number(body.adults, 1))),
      childAges: Array.isArray(body.childAges) ? body.childAges.slice(0, 6).map((age) => Math.min(17, Math.max(0, number(age, 7)))) : (existing.childAges || []),
      updateTimes: Array.isArray(body.updateTimes) ? body.updateTimes.slice(0, 4).map(String).filter((value) => /^\d{2}:\d{2}$/.test(value)) : (existing.updateTimes || ["08:00"]),
      active: body.active !== false,
      history: resetResults ? [] : (existing.history || []),
      feed: resetResults ? [] : (existing.feed || []),
      createdAt: existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }

  function completeOffers(checker, item) {
    return (item.offers || []).filter((offer) => checker.tripType === "oneway" || (offer.returnSegments || []).length > 0);
  }

  function sanitizedFeed(checker) {
    return (checker.feed || []).map((item) => {
      const offers = completeOffers(checker, item).sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 3);
      return offers.length ? { ...item, lowestPrice: Number(offers[0].price), offers } : null;
    }).filter(Boolean);
  }

  function historyFromFeed(feed) {
    const daily = new Map();
    for (const item of feed) {
      const date = String(item.checkedAt || "").slice(0, 10);
      if (!date || !Number(item.lowestPrice)) continue;
      daily.set(date, Math.min(daily.get(date) || Infinity, Number(item.lowestPrice)));
    }
    return [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price })).slice(-370);
  }

  function publicChecker(checker) {
    const { lastRunKey, ...safe } = checker;
    const feed = sanitizedFeed(checker);
    return { ...safe, feed, history: historyFromFeed(feed) };
  }

  async function runCheck(checker) {
    const offers = await searchFlights(checker);
    const valid = offers.filter((offer) => Number(offer.price) > 0).sort((a, b) => a.price - b.price).slice(0, 3);
    if (!valid.length) throw new Error("Geen vluchtprijzen gevonden voor deze periode.");
    checker.feed = sanitizedFeed(checker);
    checker.history = historyFromFeed(checker.feed);
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
    if (notify && checker.email) {
      try {
        await notify(checker, valid);
        checker.lastEmailError = "";
        checker.lastEmailAt = now.toISOString();
      } catch (error) {
        checker.lastEmailError = error.message;
      }
    }
    return valid;
  }

  function rebuildHistory(checker) {
    checker.feed = sanitizedFeed(checker);
    checker.history = historyFromFeed(checker.feed);
  }

  router.get("/api/ticket-checkers", asyncRoute(async (req, res) => {
    const store = await readStore();
    res.json({ checkers: store.checkers.filter((checker) => checker.active).map(publicChecker) });
  }));

  router.get("/api/ticket-checkers/:id", asyncRoute(async (req, res) => {
    const checker = (await readStore()).checkers.find((item) => item.id === String(req.params.id).toUpperCase());
    if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
    res.json({ checker: publicChecker(checker) });
  }));

  router.post("/api/ticket-checkers", asyncRoute(async (req, res) => {
    const store = await readStore();
    const requestedId = String(req.body.id || "").toUpperCase();
    const index = requestedId ? store.checkers.findIndex((item) => item.id === requestedId) : -1;
    const previous = index >= 0 ? store.checkers[index] : {};
    const checker = { ...clean(req.body, previous), id: index >= 0 ? requestedId : shortId(store) };
    if (!checker.origin || !checker.destination) return res.status(400).json({ error: "Vul vertrek en bestemming in." });
    if (checker.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checker.email)) return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    if (index >= 0) store.checkers[index] = checker; else store.checkers.unshift(checker);
    await writeStore(store);
    res.status(index >= 0 ? 200 : 201).json({ checker: publicChecker(checker) });
  }));

  router.post("/api/ticket-checkers/:id/status", asyncRoute(async (req, res) => {
    const store = await readStore();
    const checker = store.checkers.find((item) => item.id === String(req.params.id).toUpperCase());
    if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
    checker.active = Boolean(req.body.active);
    checker.updatedAt = new Date().toISOString();
    await writeStore(store);
    res.json({ checker: publicChecker(checker) });
  }));

  router.post("/api/ticket-checkers/:id/check", asyncRoute(async (req, res) => {
    const store = await readStore();
    const checker = store.checkers.find((item) => item.id === String(req.params.id).toUpperCase());
    if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
    const offers = await runCheck(checker);
    await writeStore(store);
    res.json({ checker: publicChecker(checker), offers });
  }));

  router.delete("/api/ticket-checkers/:id/results", asyncRoute(async (req, res) => {
    const store = await readStore();
    const checker = store.checkers.find((item) => item.id === String(req.params.id).toUpperCase());
    if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
    checker.feed = [];
    checker.history = [];
    checker.updatedAt = new Date().toISOString();
    await writeStore(store);
    res.json({ checker: publicChecker(checker) });
  }));

  router.delete("/api/ticket-checkers/:id/results/:resultId", asyncRoute(async (req, res) => {
    const store = await readStore();
    const checker = store.checkers.find((item) => item.id === String(req.params.id).toUpperCase());
    if (!checker) return res.status(404).json({ error: "Checker niet gevonden." });
    const before = (checker.feed || []).length;
    checker.feed = (checker.feed || []).filter((item) => item.id !== req.params.resultId);
    if (checker.feed.length === before) return res.status(404).json({ error: "Prijsresultaat niet gevonden." });
    rebuildHistory(checker);
    checker.updatedAt = new Date().toISOString();
    await writeStore(store);
    res.json({ checker: publicChecker(checker) });
  }));

  async function checkSchedule() {
    if (running) return;
    running = true;
    try {
      const store = await readStore();
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
      if (changed) await writeStore(store);
    } finally { running = false; }
  }

  return {
    router,
    start() {
      if (database) ensureDatabase().then(() => console.log("Ticket Checker database verbonden.")).catch((error) => console.error("Ticket Checker databasefout:", error.message));
      setInterval(checkSchedule, 60_000).unref();
      setTimeout(checkSchedule, 5_000).unref();
    }
  };
}

module.exports = { createTicketCheckerService };
