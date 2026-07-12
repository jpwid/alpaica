# Alpaica als Hostinger Web App

Gebruik deze route voor echte vluchtdata via de backend. De oude FTP-upload is alleen geschikt voor een statische website.

## Hostinger instellingen

- Type app: Node.js / Express
- Repository: `jpwid/alpaica`
- Branch: `main`
- App root: `/`
- Package manager: `npm`
- Node.js versie: `22.x` of `24.x`
- Install command: `npm install`
- Start command: `npm start`
- Entry file: `server.js`

## Environment variables

Zet deze in Hostinger bij de Web App environment variables:

```text
SERPAPI_API_KEY=jouw_serpapi_key
NODE_ENV=production
```

Laat `PORT` leeg, tenzij Hostinger expliciet vraagt om een vaste poort. De app gebruikt automatisch de poort die Hostinger doorgeeft.

## Test na deploy

Open:

```text
https://alpaica.com/health
```

Als de backend draait, zie je JSON met:

```json
{ "ok": true, "app": "alpaica", "serpapiConfigured": true }
```

Daarna kun je testen:

```text
https://alpaica.com/api/status
```

Daar moet `SerpApi Google Flights` op `configured: true` staan.

## Belangrijk

De workflow `.github/workflows/deploy-hostinger.yml` is bewust alleen nog handmatig te starten. Automatische FTP-deploy naar `public_html` is niet genoeg voor de backend en kan de Web App-route verwarren.
