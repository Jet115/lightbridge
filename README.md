# LightBridge

Universelle Lichtsoftware (macOS + Windows): liest den **Pioneer/AlphaTheta XDJ-AZ** via
**Pro DJ Link** (`prolink-connect`), erzeugt Lichtlogik und steuert den **Wolfmix über OS2L**
(→ WTOOLS, USB). Electron + React + TypeScript, Packaging mit electron-builder.

Architektur: siehe `ARCHITECTURE.md`. Verträge: `src/shared/types.ts`.

```
XDJ-AZ ─Pro DJ Link (LAN)─► LightBridge ─OS2L (TCP 127.0.0.1:5000)─► WTOOLS ─USB─► Wolfmix
```

## Voraussetzungen
- **Node.js ≥ 22** und npm (electron-store@12 / electron-vite brauchen aktuelles Node).
- macOS-Build: Xcode Command Line Tools. Windows-Build: am besten auf Windows (oder CI).
- Zum Betrieb: XDJ-AZ im selben LAN; Wolfmix per USB am PC; WTOOLS offen mit aktiviertem OS2L.

## Installation & Start
```bash
cd lightbridge
npm install
npm run dev          # Entwicklungsmodus (HMR)
npm run typecheck    # TypeScript prüfen (main + renderer)
npm run build        # Bundles nach out/
npm run dist:mac     # macOS-DMG (x64 + arm64)
npm run dist:win     # Windows-NSIS-Installer (x64)
npm run dist         # aktuelle Plattform
```
> Die Module wurden einzeln validiert (Type-Strip/Harness) und die Schnittstellen abgeglichen,
> aber ein voller `tsc`/Build läuft erst nach `npm install` (Dependencies). Zuerst `npm run typecheck`.

## Auto-Update
Die gepackte App aktualisiert sich selbst (`electron-updater`): prüft beim Start + alle 6 h, lädt neue
Versionen im Hintergrund und zeigt oben einen **„Neu starten & installieren"**-Hinweis. Feed = GitHub
Releases (in `electron-builder.yml` `publish.owner`/`repo` anpassen). Release per Tag veröffentlichen:
`git tag v0.1.1 && git push origin v0.1.1` löst `.github/workflows/release.yml` aus (baut mac + win).
Details + Signierungs-Hinweise: `BUILD-INSTALLER.md`. **macOS-Auto-Update braucht Signierung/Notarisierung.**

## Einrichtung (damit Licht zur Musik läuft)
1. **XDJ-AZ** per Netzwerk (Pro DJ Link) mit demselben LAN wie der PC verbinden.
   - **Wichtig:** rekordbox NICHT auf demselben Rechner wie LightBridge laufen lassen
     (prolink-connect und rekordbox teilen sich die Pro-DJ-Link-Ports). LightBridge spricht direkt mit dem XDJ-AZ.
   - In LightBridge unter **Settings → Pro DJ Link interface** das Netzwerk-Interface wählen, das im DJ-LAN hängt.
2. **Wolfmix + WTOOLS:** Wolfmix per USB an den PC, WTOOLS öffnen, **OS2L aktivieren** (Port **5000**),
   **„Trigger presets from OS2L"** an. In **Settings → OS2L** ggf. `host`/`port` prüfen (Default 127.0.0.1:5000; mDNS-Discovery optional).
3. **Mapping:** Die OS2L-Button-Namen in Settings (`fx1…`, `color_red…`, `strobe`, `blackout`, Cue-Szenen)
   müssen den in WTOOLS den Presets zugeordneten Namen entsprechen.
4. **Live:** Auflegen → LightBridge sendet Beat-Sync + Preset-/Farb-/Drop-/Blackout-Trigger; FX-Controls + Hotkeys (Space=TAP, N=Preset, D=Drop, B=Blackout) in der UI.

## Status & Annahmen (aus dem Modulbau)
- `prolink-connect` 0.11.0; API gegen den Quellcode geprüft. Beats werden aus `beatInMeasure`-Wechseln abgeleitet (kein eigener Beat-Event der Lib).
- `vcdjId=7` erlaubt lokale/USB-Metadaten; für Remote-DB-Abfragen an CDJs 1..6 setzen (Settings/Code).
- OS2L-Nachrichten werden als rohes JSON ohne Trenner gesendet; falls WTOOLS Newline erwartet, in `src/main/os2l/client.ts` ein `'\n'` anhängen.
- macOS: `arch: [x64, arm64]` erzeugt zwei DMGs; für ein Universal-Binary auf `arch: [universal]` umstellen (Kommentar in `electron-builder.yml`). Notarisierung: Secrets setzen und `notarize: true` einkommentieren.
- Noch nicht gegen echte Hardware getestet (XDJ-AZ + Wolfmix) — das ist der nächste Schritt an deinem Rig.

## Projektstruktur
```
src/shared/types.ts          Verträge (fix)
src/main/prolink/            Pro-DJ-Link-Ingest (ProlinkIngest)
src/main/os2l/               OS2L-Client
src/main/fx/                 FX-Director
src/main/index.ts            Electron-Main + Verdrahtung + IPC
src/main/config-store.ts     Config (electron-store)
src/preload/index.ts         window.api (IpcApi)
src/renderer/                React-UI
electron.vite.config.ts, electron-builder.yml, build/entitlements.mac.plist
```
