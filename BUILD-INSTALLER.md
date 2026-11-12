# Installer bauen (macOS / Windows)

> Hinweis: `tsc` (typecheck) und `electron-vite build` (Bundling) sind bereits **grün verifiziert**.
> Der Installer-Bau selbst muss **lokal** laufen — er lädt die Electron-Binary und kompiliert eine
> native Abhängigkeit (`better-sqlite3`, via `prolink-connect`). In gesicherten Sandboxes werden
> solche Paket-Install-Skripte blockiert.

## Voraussetzungen
- **Node ≥ 22**, npm.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Windows:** „Desktop development with C++" (VS Build Tools) + Python 3 — für `node-gyp` (better-sqlite3).
- Windows-Installer am besten **auf Windows** (oder CI) bauen; macOS-DMG auf einem Mac.

## Schritte
```bash
cd lightbridge
npm install

# Falls npm die Dependency-Install-Skripte zurückhält (npm 11 "allowScripts" —
# erkennbar an "npm install-scripts approve <pkg>"):
npm install-scripts approve electron better-sqlite3 fsevents core-js electron-winstaller
npm install            # erneut, damit die freigegebenen Skripte laufen (lädt Electron, kompiliert better-sqlite3)

npm run rebuild        # better-sqlite3 gegen Electrons ABI bauen (electron-builder install-app-deps)

npm run dist:mac       # -> dist/*.dmg   (x64 + arm64)
# ODER auf Windows:
npm run dist:win       # -> dist/*.exe   (NSIS)
```
Ergebnis liegt in `dist/`.

## Native Abhängigkeit (wichtig)
`prolink-connect` zieht **better-sqlite3** (nativ, für die lokale rekordbox-DB = Track-Metadaten/Artwork).
- `npm run rebuild` bzw. das `postinstall` (`electron-builder install-app-deps`) baut es für Electron.
- Schlägt der Build daran fehl: Toolchain prüfen (s. o.) und `npm run rebuild` erneut ausführen.
- Brauchst du **nur** Live-BPM/Beat/Play-State (keine Metadaten/Artwork aus der lokalen DB), lässt sich der
  DB-Pfad später abschalten — die native Abhängigkeit bleibt aber über prolink-connect erhalten.

## Icons & Signierung (optional)
- Icons: `build/icon.icns` (mac) / `build/icon.ico` (win) ablegen, sonst Electron-Default.
- macOS-Notarisierung: in `electron-builder.yml` `notarize: true` einkommentieren und Env setzen
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`).
- Universal-Binary statt zwei DMGs: in `electron-builder.yml` `arch: [universal]` setzen.

## Auto-Update (eingebaut)
LightBridge enthält einen **automatischen Updater** (`electron-updater`). Die gepackte App prüft beim
Start und danach alle 6 Stunden auf neue Versionen, lädt sie im Hintergrund und bietet oben in der
Oberfläche einen **„Neu starten & installieren"**-Hinweis (manuell: Settings → Updates → „Nach Updates
suchen"). Im Dev-Modus ist der Updater aus (nur im gepackten Build aktiv).

Damit das funktioniert, müssen die Releases irgendwo liegen, von dem die App sie zieht — der
**Update-Feed**. Standard ist **GitHub Releases**:

1. In `electron-builder.yml` unter `publish:` `owner`/`repo` auf dein GitHub-Repo setzen
   (aktuell Platzhalter `DEIN_GITHUB_USER` / `lightbridge`).
2. `version` in `package.json` erhöhen (z. B. `0.1.0` → `0.1.1`).
3. Release bauen **und veröffentlichen**:

   **Automatisch per GitHub Actions** (empfohlen) — der Workflow `.github/workflows/release.yml` baut
   mac **und** win und lädt die Artefakte als Release hoch, sobald du ein Tag pushst:
   ```bash
   git tag v0.1.1 && git push origin v0.1.1
   ```
   (Tag muss zur `version` passen. `GITHUB_TOKEN` stellt Actions automatisch bereit.)

   **Oder lokal** (nur die aktuelle Plattform):
   ```bash
   export GH_TOKEN=ghp_dein_token      # Token mit "repo"-Scope
   npm run build
   npx electron-builder --mac --publish always   # bzw. --win
   ```

Beim Veröffentlichen entstehen neben `*.dmg`/`*.exe` auch `latest-mac.yml` / `latest.yml` (+ `*.blockmap`).
**Diese YAML-Dateien sind der Feed** — ohne sie findet der Updater nichts.

**Ohne GitHub** (eigener HTTPS-Server): in `electron-builder.yml` `publish:` auf
`provider: generic` + `url: https://…/updates/` umstellen und die erzeugten Dateien dorthin hochladen.

### Signierung ist für Auto-Update wichtig
- **macOS:** Auto-Update funktioniert **nur mit gültiger Signierung + Notarisierung**. Unsigniert baut
  zwar ein DMG, aber macOS verweigert das automatische Ersetzen. Secrets setzen (siehe oben /
  `electron-builder.yml`-Kopf) und `notarize: true` einkommentieren. In GitHub Actions dieselben Werte
  als Repo-Secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
- **Windows:** Auto-Update läuft auch **unsigniert**; ohne Code-Signing-Zertifikat zeigt Windows aber
  beim ersten Start eine SmartScreen-Warnung. Für saubere Verteilung ein Authenticode-Zertifikat
  hinterlegen (`CSC_LINK`/`CSC_KEY_PASSWORD`).

## Wenn etwas hakt
Schick mir die genaue Fehlermeldung aus `npm run dist:*` — dann fixe ich die Packaging-Konfig gezielt
(häufige Stolpersteine: fehlende Icons, better-sqlite3-ABI, Entitlements, Signierung, falsche
`publish`-owner/repo).
