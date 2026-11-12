# LightBridge — Pro DJ Link → Wolfmix (OS2L)

Universelle Lichtsoftware (macOS + Windows). Liest den XDJ-AZ via **Pro DJ Link**
(`prolink-connect`), erzeugt Lichtlogik und steuert den **Wolfmix über OS2L** (→ WTOOLS, USB).

```
XDJ-AZ ──Pro DJ Link (LAN)──► [Main: ProlinkIngest] ──DJState/Beat──► [FXDirector]
                                                                          │ OS2LMessage
[Renderer/React UI] ◄─IPC(window.api)─► [Main: IPC + ConfigStore]        ▼
                                                                [OS2LClient] ──TCP──► WTOOLS 127.0.0.1:5000 ──USB──► Wolfmix
```

## Stack
Electron + TypeScript + React, Bundler **electron-vite**, Packaging **electron-builder**
(mac: universal .dmg x64+arm64; win: NSIS .exe). Alles importiert Typen aus `src/shared/types.ts`.

## Module (Ordner-Eigentümer)
- `src/main/prolink/` — ProlinkIngest (Pro DJ Link → DJState/Events)
- `src/main/os2l/` + `src/main/fx/` — OS2LClient + FXDirector (DJState → OS2L)
- `src/main/index.ts`, `src/preload/`, Build-Configs — Electron-Shell + Verdrahtung + IPC
- `src/renderer/` — React-UI (Decks, BPM, FX-Controls, Mapping/Settings, Log)
- `src/shared/types.ts` — gemeinsame Verträge (fix)

## Öffentliche Modul-APIs (Integrationsvertrag)
- `class ProlinkIngest extends EventEmitter` — `start(iface?)`, `stop()`, `getState():DJState`,
  `static listInterfaces()`; emittiert `state`(DJState), `beat`({masterBpm,beat,beatInBar}),
  `track`({deck,track}), `status`({connected,message}).
- `class OS2LClient` — `new(opts, onStatus)`, `connect()`, `close()`, `sendBeat(pos,bpm,strength,change)`,
  `sendBtn(name,state)`, `status():{connected,target}`.
- `class FXDirector` — `new(fx:FXConfig, os2l:OS2LClient)`, `onState(DJState)`, `onBeat(...)`,
  `onTrack(...)`, `action(ControlAction)`, `updateConfig(fx:FXConfig)`.
- Preload exposed als `window.api: IpcApi`.
