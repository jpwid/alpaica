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
const smtpConfig = {
  host: process.env.SMTP_HOST || env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || env.SMTP_SECURE || "false") === "true",
  user: process.env.SMTP_USER || env.SMTP_USER || "",
  password: process.env.SMTP_PASSWORD || env.SMTP_PASSWORD || "",
  from: process.env.SMTP_FROM || env.SMTP_FROM || process.env.SMTP_USER || env.SMTP_USER || ""
};
const emailConfigured = Boolean(smtpConfig.host && smtpConfig.user && smtpConfig.password && smtpConfig.from);
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

function normalizeSerpSegments(flights = []) {
  return flights.map((flight) => ({
    airline: flight.airline || "",
    airlineLogo: flight.airline_logo || "",
    flightNumber: flight.flight_number || "",
    airplane: flight.airplane || "",
    departureAirport: flight.departure_airport?.name || flight.departure_airport?.id || "",
    departureCode: flight.departure_airport?.id || "",
    departureTime: flight.departure_airport?.time || "",
    arrivalAirport: flight.arrival_airport?.name || flight.arrival_airport?.id || "",
    arrivalCode: flight.arrival_airport?.id || "",
    arrivalTime: flight.arrival_airport?.time || "",
    duration: Number(flight.duration || 0)
  }));
}

function segmentLayovers(segments = []) {
  return segments.slice(0, -1).map((segment, index) => {
    const next = segments[index + 1];
    const arrival = new Date(String(segment.arrivalTime || "").replace(" ", "T"));
    const departure = new Date(String(next.departureTime || "").replace(" ", "T"));
    const duration = Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime())
      ? 0
      : Math.max(0, Math.round((departure - arrival) / 60000));
    return {
      airport: segment.arrivalAirport,
      code: segment.arrivalCode,
      duration
    };
  });
}

function hasSingleAirline(option) {
  const airlines = new Set((option?.flights || []).map((flight) => flight.airline || flight.flight_number?.split(/\s+/)[0]).filter(Boolean));
  return airlines.size <= 1;
}

function normalizeSerpOption(option, traveler, origin, destination, fallback) {
  const flights = option?.flights || [];
  const returnFlights = fallback.returnOption?.flights || option?.return_flights || [];
  const first = flights[0] || {};
  const last = flights[flights.length - 1] || first;
  const departure = firstFlightTime(option, "departure") || fallback.outbound || "";
  const arrival = firstFlightTime(option, "arrival") || "";
  const stops = Math.max(0, flights.length - 1);
  const outboundDuration = Number(option?.total_duration || 0);
  const returnDuration = Number(fallback.returnOption?.total_duration || 0);
  const flightDuration = outboundDuration + returnDuration;
  // Ground transfer is estimated until a maps/transport provider is connected.
  const homeToAirportDuration = estimateGroundMinutes(traveler.city, origin);
  const arrivalToCenterDuration = estimateGroundMinutes(destination, "center");
  const outboundSegments = normalizeSerpSegments(flights);
  const returnSegments = normalizeSerpSegments(returnFlights);
  const segments = [...outboundSegments, ...returnSegments];
  const airlines = [...new Set(segments.map((segment) => segment.airline).filter(Boolean))];
  const adultCount = Number(fallback.adultCount || 1);
  const childCount = Number(fallback.childCount || 0);
  const travelerCount = Math.max(1, adultCount + childCount);
  const price = Number(fallback.returnOption?.price || option?.price || 0);
  return {
    traveler: traveler.name || "Reiziger",
    origin,
    destination,
    departureAirport: origin,
    arrivalAirport: destination,
    nearbyAlternativeAirports: [...new Set([...(airportOptionsFor(traveler.city) || []), ...(airportOptionsFor(destination, true) || [])])].filter((code) => code !== origin && code !== destination),
    airline: airlines.join(" + ") || first.airline || option?.airline || "Google Flights",
    outbound: arrival ? `${departure} - ${arrival}` : departure || "Tijd via provider",
    inbound: returnSegments.length ? `${returnSegments[0].departureTime} - ${returnSegments[returnSegments.length - 1].arrivalTime}` : "",
    departureDate: fallback.departureDate || "",
    returnDate: fallback.returnDate || "",
    duration: flightDuration,
    flightDuration,
    outboundDuration,
    returnDuration,
    homeToAirportDuration,
    arrivalToCenterDuration,
    totalTravelDuration: flightDuration ? flightDuration + homeToAirportDuration + arrivalToCenterDuration : 0,
    isDirect: stops === 0,
    stops,
    returnStops: Math.max(0, returnFlights.length - 1),
    price,
    adultCount,
    childCount,
    travelerCount,
    pricePerTraveler: Math.round((price / travelerCount) * 100) / 100,
    segments,
    outboundSegments,
    returnSegments,
    outboundLayovers: segmentLayovers(outboundSegments),
    returnLayovers: segmentLayovers(returnSegments),
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
  const selectedLocation = (value, fallback) => {
    const match = String(value || "").match(/\(((?:[A-Z]{3})|(?:\/[mg]\/[^)]+))\)\s*$/i);
    if (match) return match[1].startsWith("/") ? match[1] : match[1].toUpperCase();
    return fallback(String(value || "").replace(/\s*\((?:[A-Z]{3}|\/[mg]\/[^)]+)\)\s*$/i, ""));
  };
  const storedLocation = (value) => /^(?:[A-Z]{3}|\/[mg]\/[^\s]+)$/i.test(String(value || "")) ? String(value) : "";
  const origin = storedLocation(checker.originCode) || selectedLocation(checker.origin, airportForCity);
  const arrival = storedLocation(checker.destinationCode) || selectedLocation(checker.destination, destinationForCity);
  const existingTripDays = checker.departStart && checker.returnStart
    ? Math.max(1, Math.round((new Date(`${checker.returnStart}T12:00:00`) - new Date(`${checker.departStart}T12:00:00`)) / 86400000))
    : 7;
  const minTripDays = Math.min(60, Math.max(1, Number(checker.minTripDays || existingTripDays)));
  const maxTripDays = Math.min(90, Math.max(minTripDays, Number(checker.maxTripDays || Math.max(21, existingTripDays))));
  const minimumReturn = new Date(`${checker.departEnd || checker.departStart}T12:00:00`);
  minimumReturn.setDate(minimumReturn.getDate() + minTripDays);
  const minimumReturnDate = minimumReturn.toISOString().slice(0, 10);
  const maximumReturn = new Date(`${checker.departStart}T12:00:00`);
  maximumReturn.setDate(maximumReturn.getDate() + maxTripDays);
  const maximumReturnDate = maximumReturn.toISOString().slice(0, 10);
  const returnDate = checker.returnStart && checker.returnStart >= minimumReturnDate ? checker.returnStart : minimumReturnDate;
  const availableReturnEnd = checker.returnEnd && checker.returnEnd < maximumReturnDate ? checker.returnEnd : maximumReturnDate;
  if (checker.tripType !== "oneway" && returnDate > availableReturnEnd) {
    throw Object.assign(new Error(`Binnen deze datumranges is geen reis van ${minTripDays} tot ${maxTripDays} dagen mogelijk.`), { status: 400 });
  }
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights");
  const isRoundTrip = checker.tripType !== "oneway";
  url.searchParams.set("type", isRoundTrip ? "1" : "2");
  url.searchParams.set("departure_id", origin);
  url.searchParams.set("arrival_id", arrival);
  url.searchParams.set("outbound_date", checker.departStart);
  if (isRoundTrip && returnDate) url.searchParams.set("return_date", returnDate);
  url.searchParams.set("outbound_times", `${checker.departFrom},${Math.min(23, checker.departTo)}`);
  if (isRoundTrip) url.searchParams.set("return_times", `${checker.returnFrom},${Math.min(23, checker.returnTo)}`);
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
  const outboundOptions = [...(payload.best_flights || []), ...(payload.other_flights || [])]
    .filter((option) => Number(option.price || 0) > 0)
    .filter(hasSingleAirline)
    .filter((option) => !checker.maxDuration || Number(option.total_duration || 0) <= checker.maxDuration * 60)
    .filter((option) => !checker.direct || (option.flights || []).length <= 1)
    .filter((option) => Math.max(0, (option.flights || []).length - 1) <= checker.maxStops)
    .slice(0, 3);

  const offers = await Promise.all(outboundOptions.map(async (option) => {
    let returnOption = null;
    if (isRoundTrip && returnDate && option.departure_token) {
      const returnUrl = new URL(url);
      returnUrl.searchParams.set("departure_token", option.departure_token);
      const returnResponse = await fetch(returnUrl);
      const returnPayload = await returnResponse.json();
      if (returnResponse.ok && !returnPayload.error) {
        returnOption = [...(returnPayload.best_flights || []), ...(returnPayload.other_flights || [])]
          .filter((candidate) => Number(candidate.price || 0) > 0)
          .filter(hasSingleAirline)
          .filter((candidate) => !checker.maxDuration || Number(candidate.total_duration || 0) <= checker.maxDuration * 60)
          .filter((candidate) => !checker.direct || (candidate.flights || []).length <= 1)
          .filter((candidate) => Math.max(0, (candidate.flights || []).length - 1) <= checker.maxStops)
          .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))[0] || null;
      }
    }
    return normalizeSerpOption(option, { name: "Ticket Checker", city: checker.origin }, origin, arrival, {
      outbound: "",
      returnOption,
      departureDate: checker.departStart,
      returnDate: isRoundTrip ? returnDate : "",
      adultCount: checker.adults,
      childCount: (checker.childAges || []).length
    });
  }));

  return offers.sort((a, b) => a.price - b.price).slice(0, 3);
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

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));

function readableMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} ${hours === 1 ? "uur" : "uur"}`;
  return `${hours} uur ${remainder} min`;
}

function emailSegments(title, segments = [], layovers = []) {
  if (!segments.length) return "";
  return `<h4 style="margin:16px 0 8px">${escapeHtml(title)}</h4>${segments.map((segment, index) => {
    const layover = layovers[index];
    return `<div style="padding:10px 0;border-top:1px solid #ddd"><strong>${escapeHtml(segment.airline)} ${escapeHtml(segment.flightNumber)}</strong><br>${escapeHtml(segment.departureCode)} ${escapeHtml(segment.departureTime)} → ${escapeHtml(segment.arrivalCode)} ${escapeHtml(segment.arrivalTime)} · ${escapeHtml(readableMinutes(segment.duration))}${layover ? `<br><span style="color:#6b645e">Overstap: ${escapeHtml(layover.code || layover.airport)} · ${escapeHtml(readableMinutes(layover.duration))}</span>` : ""}</div>`;
  }).join("")}`;
}

async function sendTicketCheckerUpdate(checker, offers) {
  if (!emailConfigured || !checker.email) return;
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: { user: smtpConfig.user, pass: smtpConfig.password }
  });
  const offerHtml = offers.map((offer, index) => `<section style="margin:18px 0;padding:16px;border:1px solid #18181b;border-radius:10px">
    <h3 style="margin:0 0 5px">${index + 1}. €${escapeHtml(offer.price)} · ${escapeHtml(offer.airline)}</h3>
    <div>${escapeHtml(offer.departureDate)} t/m ${escapeHtml(offer.returnDate)} · gemiddeld €${escapeHtml(offer.pricePerTraveler)} per reiziger</div>
    ${emailSegments("Heenvlucht", offer.outboundSegments, offer.outboundLayovers)}
    ${emailSegments("Terugvlucht", offer.returnSegments, offer.returnLayovers)}
  </section>`).join("");
  const offerText = offers.map((offer, index) => `${index + 1}. €${offer.price} · ${offer.airline}\n${offer.departureDate}${offer.returnDate ? ` t/m ${offer.returnDate}` : ""} · gemiddeld €${offer.pricePerTraveler} per reiziger`).join("\n\n");
  const checkerUrl = `https://alpaica.com/flightchecker/?checker=${encodeURIComponent(checker.id)}`;
  await transporter.sendMail({
    from: { name: "Alpaica Ticket Checker", address: smtpConfig.from },
    replyTo: smtpConfig.from,
    to: checker.email,
    subject: `Ticket Checker ${checker.id}: vanaf €${offers[0]?.price || "-"}`,
    text: `${checker.origin} → ${checker.destination}\n\nDit zijn de drie voordeligste actuele resultaten.\n\n${offerText}\n\nOpen Ticket Checker ${checker.id}: ${checkerUrl}\n\nJe ontvangt dit bericht omdat voor dit e-mailadres een Ticket Checker is geactiveerd.`,
    html: `<div style="font-family:Arial,sans-serif;color:#18181b;max-width:680px;margin:auto"><h1>${escapeHtml(checker.origin)} → ${escapeHtml(checker.destination)}</h1><p>Dit zijn de drie voordeligste actuele resultaten.</p>${offerHtml}<p><a href="${checkerUrl}">Open Ticket Checker ${escapeHtml(checker.id)}</a></p><p style="color:#6b645e;font-size:12px">Google Flights geeft één ticketprijs voor de ingestelde reizigers en geen betrouwbare prijsuitsplitsing per leeftijdscategorie. Het bedrag per reiziger is daarom een gemiddelde.</p><p style="color:#6b645e;font-size:12px">Je ontvangt dit bericht omdat voor dit e-mailadres een Ticket Checker is geactiveerd.</p></div>`
  });
}

function providerStatus() {
  return {
    providers: [{ id: "amadeus", name: "Amadeus", configured: Boolean(clientId && clientSecret), environment: amadeusBase.includes("test.") ? "test" : "production" }],
    flightSearchProviders: [
      { id: "serpapi", name: "SerpApi Google Flights", configured: Boolean(serpApiKey), endpoint: "https://serpapi.com/search?engine=google_flights" },
      { id: "searchapi", name: "SearchAPI Google Flights", configured: Boolean(searchApiKey) },
      { id: "brightdata", name: "Bright Data SERP API", configured: Boolean(brightDataKey) }
    ],
    skyscanner: { configured: false, note: "Partner API-toegang vereist" },
    emailNotifications: { configured: emailConfigured }
  };
}

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
const ticketChecker = createTicketCheckerService({
  dataFile: process.env.TICKET_CHECKER_DATA_FILE || path.join(root, "data", "ticket-checkers.json"),
  database: process.env.DB_HOST ? {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined
  } : null,
  searchFlights: ticketCheckerFlights,
  notify: sendTicketCheckerUpdate
});
app.use(ticketChecker.router);
ticketChecker.start();
app.use(express.static(root, { extensions: ["html"] }));

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "alpaica", serpapiConfigured: Boolean(serpApiKey), databaseConfigured: Boolean(process.env.DB_HOST) });
});

app.get("/api/status", (req, res) => {
  res.json(providerStatus());
});

app.get("/api/flight-locations", asyncRoute(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const language = ["nl", "de", "fr", "en"].includes(String(req.query.lang || "")) ? String(req.query.lang) : "nl";
  if (query.length < 2) return res.json({ results: [] });
  if (!serpApiKey) throw Object.assign(new Error("SerpApi Google Flights is nog niet geconfigureerd."), { status: 503 });

  const cacheKey = `${language}:${query.toLocaleLowerCase("nl-NL")}`;
  const cached = flightLocationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json({ results: cached.results });

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_flights_autocomplete");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", language);
  url.searchParams.set("gl", "ch");
  url.searchParams.set("exclude_regions", "true");
  url.searchParams.set("api_key", serpApiKey);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) throw providerError(payload.error || "Luchthavens zoeken is mislukt", response.status, payload);

  const seen = new Set();
  const allAirportsLabel = { nl: "Alle luchthavens", de: "Alle Flughäfen", fr: "Tous les aéroports", en: "All airports" }[language];
  const results = (payload.suggestions || []).flatMap((suggestion) => {
    const country = String(suggestion.name || "").split(",").slice(1).join(",").trim();
    const stationPattern = /\b(station|railway|railroad|train|gare|bahnhof|hauptbahnhof|centraal|central station|stazione|estación|estacao|st pancras|paddington|king'?s cross|victoria coach|liverpool street|ebbsfleet)\b/i;
    const knownRailCodes = new Set(["QQS", "QQK", "QQP", "XQE", "ZEP", "ZLS", "ZYA", "QRH", "ZYR", "ZYZ", "ZWE", "QDU", "QKL", "QPP", "ZMU", "ZVR", "ZWS", "XPG", "XGB"]);
    const airports = (suggestion.airports || []).filter((airport) => {
      const code = String(airport.id || "").toUpperCase();
      const name = String(airport.name || "");
      const transportType = String(airport.type || airport.transport_type || airport.category || "");
      return /^[A-Z]{3}$/.test(code)
        && !knownRailCodes.has(code)
        && !stationPattern.test(name)
        && !/train|rail|station/i.test(transportType);
    });
    const cityChoice = airports.length >= 1 && /^\/[mg]\//.test(String(suggestion.id || ""))
      ? [{
          code: suggestion.id,
          airport: allAirportsLabel,
          city: suggestion.name,
          country,
          type: "city",
          label: `${suggestion.name} — ${allAirportsLabel}`
        }]
      : [];
    return [...cityChoice, ...airports.map((airport) => ({
      code: airport.id,
      airport: airport.name,
      city: airport.city || suggestion.name,
      country,
      type: "airport",
      label: `${airport.city || suggestion.name} — ${airport.name} (${airport.id})`
    }))];
  }).filter((item) => item.code && !seen.has(item.code) && seen.add(item.code)).slice(0, 14);

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
