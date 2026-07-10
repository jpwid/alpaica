# GitHub koppelen voor Alpaica

Repository:

`https://github.com/jpwid/alpaica`

## Eenmalig lokaal koppelen

Voer dit uit in de projectmap:

```powershell
cd "C:\Users\jeanp\Documents\Codex\2026-06-12\wat-kan-ik-met-codex"
git init -b main
git remote add origin https://github.com/jpwid/alpaica.git
git add .
git commit -m "Initial Alpaica MVP"
git push -u origin main
```

Als Git zegt dat `origin` al bestaat:

```powershell
git remote set-url origin https://github.com/jpwid/alpaica.git
```

## Daarna

Elke volgende update gaat zo:

```powershell
git add .
git commit -m "Update Alpaica"
git push
```

Na `git push` start GitHub automatisch de Hostinger deploy via `.github/workflows/deploy-hostinger.yml`.

## Let op

In deze Codex-sessie kon `.git` niet worden aangepast omdat die map alleen-lezen was. De bestanden voor GitHub en Hostinger staan wel klaar.
