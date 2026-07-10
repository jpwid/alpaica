# Alpaica live vluchtzoeker

De live zoekfunctie gebruikt eerst de officiële Amadeus Flight Offers Search API.

1. Maak een ontwikkelaarsaccount en applicatie aan via https://developers.amadeus.com/.
2. Kopieer `.env.example` naar `.env`.
3. Vul `AMADEUS_CLIENT_ID` en `AMADEUS_CLIENT_SECRET` in. Deel deze sleutels nooit in chat of in de browsercode.
4. Start vanuit deze map:

```powershell
& "C:\Users\jeanp\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

5. Open http://localhost:4180/.

Zonder API-gegevens blijft de bestaande voorbeeldweergave beschikbaar en meldt de live zoeker dat configuratie nodig is.

Voor Skyscanner is afzonderlijke partner/API-toegang nodig via https://developers.skyscanner.net/. Voeg geen onofficiële scraper of gedeelde API-sleutel toe: prijzen, voorwaarden en beschikbaarheid zijn dan niet betrouwbaar.
