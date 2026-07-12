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

Als GitHub Actions meldt `Input required and not supplied: username`, dan mist bijna altijd deze secret exact:

`HOSTINGER_FTP_USERNAME`

Let op de exacte naam: hoofdletters, underscores en geen spaties. De secret moet onder **Repository secrets** staan, niet alleen onder Variables.

Als GitHub Actions meldt `getaddrinfo ENOTFOUND *** (control socket)`, dan is `HOSTINGER_FTP_HOST` niet oplosbaar. Controleer dan:

- Gebruik alleen de hostnaam of het IP-adres, dus geen `ftp://`, geen `https://` en geen `/public_html`.
- Goed voorbeeld: `ftp.alpaica.com`
- Ook goed: het server IP-adres uit Hostinger hPanel
- Fout voorbeeld: `ftp://ftp.alpaica.com/public_html`
- Als `alpaica.com` nog niet naar Hostinger wijst, gebruik tijdelijk het FTP-serveradres of IP-adres dat Hostinger in hPanel toont.

## Wat wordt online gezet

De workflow uploadt de inhoud van `outputs/` naar de webroot. Door `local-dir: ./outputs/` uploadt hij dus niet de map `outputs` zelf, maar de bestanden erin.

Deze bestanden komen online:

- `outputs/index.html`
- `outputs/europe-cities.js`
- `outputs/meetway-hero.png`

De lokale backend `outputs/server.js`, `.env`, `.env.example` en `STARTEN.md` worden uitgesloten in deze statische deploy.

Als Hostinger toch een map `public_html/outputs/` laat zien, dan draait GitHub nog met een oude workflow of upload je via een ander proces. Push deze workflowwijziging opnieuw en verwijder daarna de foutieve map `public_html/outputs/` in Hostinger File Manager.

## Later: echte API/backend

Voor echte vluchtdata via SerpApi of een andere provider is een backend nodig die API-sleutels veilig bewaart. Als jouw Hostinger pakket Node.js apps ondersteunt, kunnen we later een aparte Node-deploy maken. Anders is een kleine backend op bijvoorbeeld Render, Vercel, Fly.io of een Hostinger VPS logischer.
