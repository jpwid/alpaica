const express = require("express");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createTicketCheckerService } = require("./ticket-checker-store");

const root = __dirname;
const env = loadEnv(path.join(root, ".env"));
const port = Number(process.env.PORT || env.PORT || 4180);
const amadeusBase = (process.env.AMADEUS_BASE_URL || env.AMADEUS_BASE_URL || "https://test.api.amadeus.com").replace(/\/$/, "");
const clientId = process.env.AMADEUS_CLIENT_ID || env.AMADEUS_CLIENT_ID || "";
const clientSecret = process.env.AMADEUS_CLIENT_SECRET || env.AMADEUS_CLIENT_SECRET || "";
const serpApiKey = process.env.SERPAPI_API_KEY || env.SERPAPI_API_KEY || "";
const searchApiKey = process.env.SEARCHAPI_API_KEY || env.SEARCHAPI_API_KEY || "";
const brightDataKey = process.env.BRIGHT_DATA_API_KEY || env.BRIGHT_DATA_API_KEY || "";
let tokenCache = { token: "", expiresAt: 0 };
const flightLocationCache = new Map();

const airportByCity = {
  amsterdam: "AMS",
  rotterdam: "RTM",
  "den haag": "RTM",
  utrecht: "AMS",
  eindhoven: "EIN",
  borne: "AMS",
  hengelo: "AMS",
  almelo: "AMS",
  oldenzaal: "AMS",
  enschede: "AMS",
  london: "LHR",
  zurich: "ZRH",
  basel: "BSL",
  geneva: "GVA",
  paris: "CDG",
  brussel: "BRU",
  brussels: "BRU",
  antwerp: "ANR",
  berlin: "BER",
  hamburg: "HAM",
  munich: "MUC",
  frankfurt: "FRA",
  dusseldorf: "DUS",
  milan: "MXP",
  milaan: "MXP"
};

const destinationAirport = {
  Amsterdam: "AMS",
  Rotterdam: "RTM",
  Brussels: "BRU",
  Antwerp: "ANR",
  Paris: "CDG",
  Nice: "NCE",
  Lyon: "LYS",
  Bordeaux: "BOD",
  Marseille: "MRS",
  Barcelona: "BCN",
  Valencia: "VLC",
  Madrid: "MAD",
  Seville: "SVQ",
  Lisbon: "LIS",
  Porto: "OPO",
  Milan: "MXP",
  Rome: "FCO",
  Malaga: "AGP",
  Prague: "PRG",
  Budapest: "BUD",
  Krakow: "KRK",
  Warsaw: "WAW",
  Copenhagen: "CPH",
  Stockholm: "ARN",
  Gothenburg: "GOT",
  Oslo: "OSL",
  Bergen: "BGO",
  Helsinki: "HEL",
  Tallinn: "TLL",
  Riga: "RIX",
  Vilnius: "VNO",
  London: "LHR",
  Manchester: "MAN",
  Edinburgh: "EDI",
  Dublin: "DUB",
  Athens: "ATH",
  Thessaloniki: "SKG",
  Istanbul: "IST",
  Dubrovnik: "DBV",
  Split: "SPU",
  Zagreb: "ZAG",
  Ljubljana: "LJU",
  Reykjavik: "KEF",
  Valletta: "MLA"
};

const airportAlternatives = {
  AMS: ["AMS", "RTM", "EIN"], RTM: ["RTM", "AMS"], EIN: ["EIN", "AMS", "BRU", "DUS"],
  ZRH: ["ZRH", "BSL", "GVA"], BSL: ["BSL", "ZRH"], GVA: ["GVA", "ZRH"],
  LHR: ["LHR", "LGW", "STN", "LCY"], CDG: ["CDG", "ORY", "BVA"], BRU: ["BRU", "CRL", "ANR"],
  BCN: ["BCN", "GRO", "REU"], MXP: ["MXP", "LIN", "BGY"], MIL: ["MXP", "LIN", "BGY"], FCO: ["FCO", "CIA"], OSL: ["OSL", "TRF"], ARN: ["ARN", "BMA", "NYO"]
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8"
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  return fs.readFileSync(file, "utf8").split(/\r?\n/).reduce((result, line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) return result;
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    return result;
  }, {});
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": mimeTypes[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function amadeusToken() {
  if (!clientId || !clientSecret) {
    const error = new Error("Amadeus is nog niet geconfigureerd. Voeg de API-gegevens toe aan outputs/.env.");
    error.status = 503;
    throw error;
  }

  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });
  const response = await fetch(`${amadeusBase}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json();
  if (!response.ok) throw providerError("Amadeus-aanmelding mislukt", response.status, payload);

  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 1200) - 60) * 1000
  };
  return tokenCache.token;
}

function providerError(message, status, details) {
  const error = new Error(message);
  error.status = status >= 400 && status < 500 ? 400 : 502;
  error.details = details;
  return error;
}

async function amadeusGet(endpoint, params) {
  const token = await amadeusToken();
  const url = new URL(`${amadeusBase}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok) throw providerError("De vluchtprovider kon deze zoekopdracht niet verwerken", response.status, payload);
  return payload;
}

async function resolveLocation(value) {
  const input = String(value || "").trim();
  if (/^[A-Za-z]{3}$/.test(input)) return input.toUpperCase();
  if (input.length < 2) throw Object.assign(new Error("Vul een geldige vertrek- en aankomstplaats in."), { status: 400 });

  const payload = await amadeusGet("/v1/reference-data/locations", {
    subType: "CITY,AIRPORT",
    keyword: input,
    "page[limit]": 10,
    view: "LIGHT"
  });
  const best = (payload.data || []).find((item) => item.subType === "CITY") || (payload.data || [])[0];
  if (!best?.iataCode) throw Object.assign(new Error(`Geen luchthaven gevonden voor ${input}. Probeer een IATA-code, zoals AMS.`), { status: 400 });
  return best.iataCode;
}

function normalizeOffer(offer, dictionaries) {
  const carriers = dictionaries?.carriers || {};
  const itineraries = (offer.itineraries || []).map((itinerary) => {
    const segments = itinerary.segments || [];
    const first = segments[0] || {};
    const last = segments[segments.length - 1] || {};
    const carrierCode = first.carrierCode || "";
    return {
      from: first.departure?.iataCode,
      to: last.arrival?.iataCode,
      departure: first.departure?.at,
      arrival: last.arrival?.at,
      duration: itinerary.duration,
      stops: Math.max(0, segments.length - 1),
      carrier: carriers[carrierCode] || carrierCode,
      flightNumber: carrierCode && first.number ? `${carrierCode}${first.number}` : ""
    };
  });

  return {
    id: offer.id,
    source: offer.source || "AMADEUS",
    price: Number(offer.price?.grandTotal || offer.price?.total || 0),
    currency: offer.price?.currency || "EUR",
    seats: offer.numberOfBookableSeats,
    validatingAirlines: (offer.validatingAirlineCodes || []).map((code) => carriers[code] || code),
    itineraries
  };
}

async function searchFlights(body) {
  const origin = await resolveLocation(body.origin);
  const destination = await resolveLocation(body.destination);
  if (origin === destination) throw Object.assign(new Error("Vertrek- en aankomstplaats moeten verschillend zijn."), { status: 400 });

  const payload = await amadeusGet("/v2/shopping/flight-offers", {
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate: body.departureDate,
    returnDate: body.returnDate,
    adults: Math.min(9, Math.max(1, Number(body.adults || 1))),
    currencyCode: body.currency || "EUR",
    nonStop: body.nonStop ? "true" : undefined,
    max: 20
  });

  return {
    provider: "Amadeus",
    origin,
    destination,
    results: (payload.data || []).map((offer) => normalizeOffer(offer, payload.dictionaries))
  };
}

function normalizeCityKey(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function airportForCity(value) {
  const input = String(value || "").trim();
  if (/^[A-Za-z]{3}$/.test(input)) return input.toUpperCase();
  return airportByCity[normalizeCityKey(input)] || input.slice(0, 3).toUpperCase();
}

function destinationForCity(value) {
  const input = String(value || "").trim();
  if (/^[A-Za-z]{3}$/.test(input)) return input.toUpperCase();
  return destinationAirport[input] || input.slice(0, 3).toUpperCase();
}

function airportOptionsFor(value, isDestination = false) {
  const base = isDestination ? destinationForCity(value) : airportForCity(value);
  return airportAlternatives[base] || [base];
}

function allowedAirportSet(body) {
  return new Set((Array.isArray(body.allowedAirportCodes) ? body.allowedAirportCodes : []).map((code) => String(code || "").toUpperCase()));
}

function pickAllowedAirport(options, allowed) {
  if (!allowed.size) return options[0];
  return options.find((code) => allowed.has(code)) || "";
}

function routeSeed(...values) {
  return normalizeCityKey(values.join("-")).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function estimateGroundMinutes(...values) {
  return 25 + (routeSeed(...values) % 70);
}

function firstFlightTime(option, field) {
  const flights = option?.flights || [];
  const flight = field === "departure" ? flights[0] : flights[flights.length - 1];
  const airport = field === "departure" ? flight?.departure_airport : flight?.arrival_airport;
  return airport?.time || "";
}

function normalizeSerpOption(option, traveler, origin, destination, fallback) {
  const flights = option?.flights || [];
  const first = flights[0] || {};
  const last = flights[flights.length - 1] || first;
  const departure = firstFlightTime(option, "departure") || fallback.outbound || "";
  const arrival = firstFlightTime(option, "arrival") || "";
  const stops = Math.max(0, flights.length - 1);
  const flightDuration = Number(option?.total_duration || 0);
  // Ground transfer is estimated until a maps/transport provider is connected.
  const homeToAirportDuration = estimateGroundMinutes(traveler.city, origin);
  const arrivalToCenterDuration = estimateGroundMinutes(destination, "center");
  const segments = flights.map((flight) => ({
    airline: flight.airline || "",
    flightNumber: flight.flight_number || "",
    airplane: flight.airplane || "",
    departureAirport: flight.departure_airport?.name || flight.departure_airport?.id || "",
    departureTime: flight.departure_airport?.time || "",
    arrivalAirport: flight.arrival_airport?.name || flight.arrival_airport?.id || "",
    arrivalTime: flight.arrival_airport?.time || "",
    duration: flight.duration || null
  }));
  return {
    traveler: traveler.name || "Reiziger",
    origin,
    destination,
    departureAirport: origin,
    arrivalAirport: destination,
    nearbyAlternativeAirports: [...new Set([...(airportOptionsFor(traveler.city) || []), ...(airportOptionsFor(destination, true) || [])])].filter((code) => code !== origin && code !== destination),
    airline: first.airline || option?.airline || "Google Flights",
    outbound: arrival ? `${departure} - ${arrival}` : departure || "Tijd via provider",
    inbound: option?.return_flights?.length ? "Retourdetails via provider" : "",
    duration: flightDuration,
    flightDuration,
    homeToAirportDuration,
    arrivalToCenterDuration,
    totalTravelDuration: flightDuration ? flightDuration + homeToAirportDuration + arrivalToCenterDuration : 0,
    isDirect: stops === 0,
    stops,
    price: Number(option?.price || 0),
    segments,
    source: "SerpApi Google Flights",
    bookingToken: option?.booking_token || option?.departure_token || ""
  };
}

async function serpApiFlight(traveler, destination, body) {
  if (!serpApiKey) throw Object.assign(new Error("SerpApi is nog niet geconfigureerd."), { status: 503 });

  const allowed = allowedAirportSet(body);
  const origin = pickAllowedAirport(airportOptionsFor(traveler.city), allowed);
  const arrival = pickAllowedAirport(airportOptionsFor(destination, true), allowed);
  if (!origin || !arrival) throw Object.assign(new Error("Kon een luchthaven niet bepalen."), { status: 400 });

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", arrival);
  url.searchParams.set("outbound_date", body.departureDate);
  if (body.returnDate) url.searchParams.set("return_date", body.returnDate);
  url.searchParams.set("currency", body.currency || "EUR");
  url.searchParams.set("hl", body.locale || "nl");
  url.searchParams.set("gl", body.country || "ch");
  url.searchParams.set("api_key", serpApiKey);

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    const cause = error.cause?.code ? `${error.cause.code}: ${error.cause.message || error.message}` : error.message;
    throw Object.assign(new Error(`SerpApi is vanuit deze lokale server niet bereikbaar (${cause}). De code is gekoppeld, maar deze runtime blokkeert de externe verbinding.`), { status: 502, details: cause });
  }
  const payload = await response.json();
  if (!response.ok || payload.error) throw providerError(payload.error || "SerpApi kon deze vlucht niet ophalen", response.status, payload);

  const option = [...(payload.best_flights || []), ...(payload.other_flights || [])]
    .filter((item) => Number(item.price || 0) > 0)
    .filter((item) => !body.directOnly || (item.flights || []).length <= 1)
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0];

  if (!option) {
    return {
      traveler: traveler.name || "Reiziger",
      origin,
      destination: arrival,
      departureAirport: origin,
      arrivalAirport: arrival,
      airline: "Geen resultaat",
      outbound: "Geen vlucht gevonden",
      inbound: "Geen retour gevonden",
      flightDuration: 0,
      totalTravelDuration: 0,
      isDirect: false,
      stops: null,
      price: 0,
      source: "SerpApi Google Flights"
    };
  }

  return normalizeSerpOption(option, traveler, origin, arrival, body);
}

async function ticketCheckerFlights(checker) {
  if (!serpApiKey) throw Object.assign(new Error("SerpApi Google Flights is nog niet geconfigureerd."), { status: 503 });
  const selectedIata = (value, fallback) => {
    const match = String(value || "").match(/\(([A-Z]{3})\)\s*$/i);
    return match ? match[1].toUpperCase() : fallback(String(value || "").replace(/\s*\([A-Z]{3}\)\s*$/, ""));
  };
  const origin = selectedIata(checker.origin, airportForCity);
  const arrival = selectedIata(checker.destination, destinationForCity);
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights");
  url.searchParams.set("type", "1");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", arrival);
  url.searchParams.set("outbound_date", checker.departStart);
  if (checker.returnStart) url.searchParams.set("return_date", checker.returnStart);
  url.searchParams.set("outbound_times", `${checker.departFrom},${Math.min(23, checker.departTo)}`);
  url.searchParams.set("return_times", `${checker.returnFrom},${Math.min(23, checker.returnTo)}`);
  const childAges = checker.childAges || [];
  url.searchParams.set("adults", String(checker.adults + childAges.filter((age) => age >= 12).length));
  url.searchParams.set("children", String(childAges.filter((age) => age >= 2 && age < 12).length));
  url.searchParams.set("infants_in_seat", String(childAges.filter((age) => age < 2).length));
  url.searchParams.set("stops", String(checker.direct ? 1 : checker.maxStops + 1));
  url.searchParams.set("sort_by", "2");
  url.searchParams.set("currency", "EUR");
  url.searchParams.set("hl", "nl");
  url.searchParams.set("gl", "ch");
  url.searchParams.set("api_key", serpApiKey);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) throw providerError(payload.error || "Google Flights zoekopdracht mislukt", response.status, payload);
  return [...(payload.best_flights || []), ...(payload.other_flights || [])]
    .filter((option) => Number(option.price || 0) > 0)
    .filter((option) => !checker.direct || (option.flights || []).length <= 1)
    .filter((option) => Math.max(0, (option.flights || []).length - 1) <= checker.maxStops)
    .map((option) => normalizeSerpOption(option, { name: "Ticket Checker", city: checker.origin }, origin, arrival, { outbound: "" }))
    .slice(0, 3);
}

const flightSearchAdapters = {
  serpapi: {
    id: "serpapi",
    name: "SerpApi Google Flights",
    configured: () => Boolean(serpApiKey),
    searchTravelerFlight: serpApiFlight
  }
};

async function searchGroupFlights(body) {
  const travelers = Array.isArray(body.travelers) ? body.travelers.slice(0, 6) : [];
  const destinations = Array.isArray(body.destinations) ? body.destinations.slice(0, 4) : [];
  if (!travelers.length || !destinations.length) throw Object.assign(new Error("Vul reizigers en bestemmingen in."), { status: 400 });
  if (!body.departureDate) throw Object.assign(new Error("Kies een aankomstdag."), { status: 400 });

  const adapter = flightSearchAdapters.serpapi;
  const results = [];
  for (const destination of destinations) {
    const flights = [];
    for (const traveler of travelers) {
      flights.push(await adapter.searchTravelerFlight(traveler, destination, body));
    }
    results.push({ destination, flights });
  }

  return {
    provider: adapter.name,
    adapter: adapter.id,
    currency: body.currency || "EUR",
    results
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function providerStatus() {
  return {
    providers: [{ id: "amadeus", name: "Amadeus", configured: Boolean(clientId && clientSecret), environment: amadeusBase.includes("test.") ? "test" : "production" }],
    flightSearchProviders: [
      { id: "serpapi", name: "SerpApi Google Flights", configured: Boolean(serpApiKey), endpoint: "https://serpapi.com/search?engine=google_flights" },
      { id: "searchapi", name: "SearchAPI Google Flights", configured: Boolean(searchApiKey) },
      { id: "brightdata", name: "Bright Data SERP API", configured: Boolean(brightDataKey) }
    ],
    skyscanner: { configured: false, note: "Partner API-toegang vereist" }
  };
}

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
const ticketChecker = createTicketCheckerService({
  dataFile: process.env.TICKET_CHECKER_DATA_FILE || path.join(root, "data", "ticket-checkers.json"),
  searchFlights: ticketCheckerFlights
});
app.use(ticketChecker.router);
ticketChecker.start();
app.use(express.static(root, { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "alpaica", serpapiConfigured: Boolean(serpApiKey) });
});

app.get("/api/status", (req, res) => {
  res.json(providerStatus());
});

app.get("/api/flight-locations", asyncRoute(async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) return res.json({ results: [] });
  if (!serpApiKey) throw Object.assign(new Error("SerpApi Google Flights is nog niet geconfigureerd."), { status: 503 });

  const cacheKey = query.toLocaleLowerCase("nl-NL");
  const cached = flightLocationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json({ results: cached.results });

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights_autocomplete");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "nl");
  url.searchParams.set("gl", "ch");
  url.searchParams.set("exclude_regions", "true");
  url.searchParams.set("api_key", serpApiKey);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) throw providerError(payload.error || "Luchthavens zoeken is mislukt", response.status, payload);

  const seen = new Set();
  const results = (payload.suggestions || []).flatMap((suggestion) => (suggestion.airports || []).map((airport) => ({
    code: airport.id,
    airport: airport.name,
    city: airport.city || suggestion.name,
    country: String(suggestion.name || "").split(",").slice(1).join(",").trim(),
    label: `${airport.city || suggestion.name} — ${airport.name} (${airport.id})`
  }))).filter((item) => item.code && !seen.has(item.code) && seen.add(item.code)).slice(0, 12);

  flightLocationCache.set(cacheKey, { results, expiresAt: Date.now() + 60 * 60 * 1000 });
  res.json({ results });
}));

app.get("/api/locations", asyncRoute(async (req, res) => {
  const keyword = req.query.q || "";
  const payload = await amadeusGet("/v1/reference-data/locations", { subType: "CITY,AIRPORT", keyword, "page[limit]": 8, view: "LIGHT" });
  res.json({ results: (payload.data || []).map((item) => ({ name: item.name, code: item.iataCode, type: item.subType, city: item.address?.cityName, country: item.address?.countryName })) });
}));

app.post("/api/flights", asyncRoute(async (req, res) => {
  if (!req.body.departureDate) throw Object.assign(new Error("Kies een vertrekdatum."), { status: 400 });
  res.json(await searchFlights(req.body));
}));

app.post("/api/group-flights", asyncRoute(async (req, res) => {
  res.json(await searchGroupFlights(req.body));
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(root, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error.details || error);
  res.status(error.status || 500).json({ error: error.message || "Onverwachte serverfout" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Alpaica Express draait op http://localhost:${port}`);
});
