// LightBridge — Electron Main-Prozess.
// Aufgaben: App-Lifecycle + BrowserWindow, Config laden, ProlinkIngest/OS2LClient/FXDirector
// instanziieren und verdrahten, Ingest-Events -> FXDirector + Renderer spiegeln,
// IPC-Handler für window.api (IpcApi) registrieren.
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';

import { ConfigStore } from './config-store';
import { ProlinkIngest } from './prolink/ingest';
import { OS2LClient } from './os2l/client';
import { FXDirector } from './fx/director';
import { Updater } from './updater';

import type { AppConfig, ControlAction, DJState, TrackInfo, UpdateStatus } from '../shared/types';

// ---------------------------------------------------------------------------
// Laufzeit-Status (module-scope, damit IPC-Handler und Lifecycle darauf zugreifen)
// ---------------------------------------------------------------------------
const store = new ConfigStore();
let config: AppConfig = store.get();

let mainWindow: BrowserWindow | null = null;
let ingest: ProlinkIngest | null = null;
let os2l: OS2LClient | null = null;
let fx: FXDirector | null = null;
let updater: Updater | null = null;

let lastOs2lStatus: { connected: boolean; target: string } = {
  connected: false,
  target: `${config.os2l.host}:${config.os2l.port}`,
};

// ---------------------------------------------------------------------------
// Renderer-Kommunikation
// ---------------------------------------------------------------------------
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  // eslint-disable-next-line no-console
  console.log(stamped);
  broadcast('log', stamped);
}

function pushOs2lStatus(status: { connected: boolean; target: string }): void {
  lastOs2lStatus = status;
  broadcast('os2l', status);
}

// ---------------------------------------------------------------------------
// OS2L + FXDirector (Pipeline). Werden bei os2l-Config-Änderungen neu aufgebaut.
// ---------------------------------------------------------------------------
function buildOs2lPipeline(): void {
  os2l = new OS2LClient(config.os2l, (status) => {
    pushOs2lStatus(status);
    log(`OS2L: ${status.connected ? 'verbunden' : 'getrennt'} (${status.target})`);
  });
  fx = new FXDirector(config.fx, os2l);
  void os2l.connect();
}

function teardownOs2lPipeline(): void {
  try {
    os2l?.close();
  } catch (err) {
    log(`OS2L close Fehler: ${String(err)}`);
  }
  os2l = null;
  fx = null;
}

// ---------------------------------------------------------------------------
// ProlinkIngest-Events -> FXDirector + Renderer.
// Die Handler referenzieren die Live-Bindings `fx`, sodass ein Pipeline-Neuaufbau
// (bei OS2L-Config-Änderung) automatisch greift, ohne Listener neu zu registrieren.
// ---------------------------------------------------------------------------
function wireIngest(): void {
  if (!ingest) return;

  ingest.on('state', (state: DJState) => {
    fx?.onState(state);
    broadcast('state', state);
  });

  ingest.on('beat', (beat: { masterBpm: number; beat: number; beatInBar: number }) => {
    fx?.onBeat(beat.masterBpm, beat.beat, beat.beatInBar);
  });

  ingest.on('track', (payload: { deck: number; track: TrackInfo }) => {
    fx?.onTrack(payload);
  });

  ingest.on('status', (status: { connected: boolean; message?: string }) => {
    log(`Pro DJ Link: ${status.connected ? 'verbunden' : 'getrennt'}${status.message ? ` — ${status.message}` : ''}`);
    // State-Snapshot nachziehen, damit die UI den connected-Flag sofort sieht.
    broadcast('state', ingest!.getState());
  });
}

// ---------------------------------------------------------------------------
// IPC-Handler gemäß IpcApi
// ---------------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle('getState', (): DJState => {
    return (
      ingest?.getState() ?? {
        connected: false,
        masterDeck: 0,
        masterBpm: 0,
        beat: 0,
        beatInBar: 1,
        decks: [],
        updatedAt: Date.now(),
      }
    );
  });

  ipcMain.handle('getConfig', (): AppConfig => config);

  ipcMain.handle('setConfig', (_evt, partial: Partial<AppConfig>): AppConfig => {
    const prev = config;
    config = store.set(partial);

    // FX-Regeln immer live aktualisieren.
    fx?.updateConfig(config.fx);

    // OS2L-Ziel geändert -> Pipeline neu aufbauen (OS2LClient kennt nur connect/close).
    const os2lChanged =
      prev.os2l.host !== config.os2l.host ||
      prev.os2l.port !== config.os2l.port ||
      prev.os2l.discover !== config.os2l.discover ||
      prev.os2l.reconnectMs !== config.os2l.reconnectMs;
    if (os2lChanged) {
      log('OS2L-Konfiguration geändert — Verbindung wird neu aufgebaut.');
      teardownOs2lPipeline();
      buildOs2lPipeline();
      fx?.updateConfig(config.fx);
    }

    // Netzwerk-Interface geändert -> Ingest neu starten.
    if (prev.prolink.interface !== config.prolink.interface) {
      log(`Pro-DJ-Link-Interface gewechselt auf "${config.prolink.interface ?? 'auto'}".`);
      // start() stoppt intern einen laufenden Ingest zuerst (idempotent).
      ingest
        ?.start(config.prolink.interface)
        .catch((err) => log(`Ingest-Neustart Fehler: ${String(err)}`));
    }

    // Theme live anwenden.
    nativeTheme.themeSource = config.ui.theme;

    broadcast('config', config);
    return config;
  });

  ipcMain.handle('action', (_evt, a: ControlAction): void => {
    try {
      fx?.action(a);
    } catch (err) {
      log(`Action-Fehler (${a.action}): ${String(err)}`);
    }
  });

  ipcMain.handle('os2lStatus', (): { connected: boolean; target: string } => {
    return os2l?.status() ?? lastOs2lStatus;
  });

  ipcMain.handle('listInterfaces', async (): Promise<{ name: string; address: string }[]> => {
    try {
      return await ProlinkIngest.listInterfaces();
    } catch (err) {
      log(`listInterfaces Fehler: ${String(err)}`);
      return [];
    }
  });

  ipcMain.handle('checkForUpdates', (): void => updater?.check());
  ipcMain.handle('installUpdateNow', (): void => updater?.installNow());
  ipcMain.handle('getUpdateStatus', (): UpdateStatus => updater?.getStatus() ?? { state: 'idle' });
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#111317',
    title: 'LightBridge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // Dev: electron-vite liefert ELECTRON_RENDERER_URL; Prod: gebündeltes index.html.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    nativeTheme.themeSource = config.ui.theme;

    registerIpc();

    // Pipeline: OS2L + FXDirector.
    buildOs2lPipeline();

    // Ingest: Pro DJ Link.
    ingest = new ProlinkIngest();
    wireIngest();
    ingest
      .start(config.prolink.interface)
      .catch((err) => log(`Ingest-Start Fehler: ${String(err)}`));

    log(`LightBridge gestartet. Config: ${store.path}`);

    createWindow();

    // Auto-Updater nur im gepackten Build (braucht publish-Feed; im Dev wirft electron-updater).
    if (app.isPackaged) {
      updater = new Updater((s) => broadcast('update', s), log);
      updater.start();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    ingest?.stop().catch(() => {
      /* ignore beim Beenden */
    });
    teardownOs2lPipeline();
  });
}
