# Alpaica deploy naar Hostinger

Deze setup publiceert de statische MVP voor `alpaica.com` uit `outputs/` naar Hostinger zodra er naar de `main` branch wordt gepusht.

GitHub repository:

`https://github.com/jpwid/alpaica`

## Wat jij in GitHub moet invullen

Ga in je GitHub repository naar:

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

Maak deze secrets aan:

- `HOSTINGER_FTP_HOST`: de FTP host van Hostinger, bijvoorbeeld `ftp.jouwdomein.com`
- `HOSTINGER_FTP_USERNAME`: je FTP gebruikersnaam
- `HOSTINGER_FTP_PASSWORD`: je FTP wachtwoord
- `HOSTINGER_FTP_PROTOCOL`: meestal `ftps`, soms `ftp`
- `HOSTINGER_FTP_PORT`: meestal `21`
- `HOSTINGER_FTP_TARGET_DIR`: meestal `public_html/`

Zet het wachtwoord nooit in een bestand in deze map en plak het liever niet in chat.

## Wat wordt online gezet

De workflow uploadt alleen:

- `outputs/index.html`
- `outputs/europe-cities.js`
- `outputs/meetway-hero.png`

De lokale backend `outputs/server.js` en `.env` worden niet geupload in deze statische deploy.

## Later: echte API/backend

Voor echte vluchtdata via SerpApi of een andere provider is een backend nodig die API-sleutels veilig bewaart. Als jouw Hostinger pakket Node.js apps ondersteunt, kunnen we later een aparte Node-deploy maken. Anders is een kleine backend op bijvoorbeeld Render, Vercel, Fly.io of een Hostinger VPS logischer.
