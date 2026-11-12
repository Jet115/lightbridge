// Dev-Fallback für window.api, falls die UI isoliert (ohne Electron/preload) läuft.
// Simuliert einen laufenden XDJ-AZ mit 4 Decks, Beat-Takt und OS2L-Verbindung,
// damit sämtliche Views auch im Browser lebendig gerendert werden können.

import {
  AppConfig,
  ControlAction,
  DeckState,
  DEFAULT_CONFIG,
  DJState,
  IpcApi,
  TrackInfo,
  UpdateStatus,
} from '../shared/types';

type StateCb = (s: DJState) => void;
type Os2lCb = (s: { connected: boolean; target: string }) => void;
type LogCb = (line: string) => void;
type UpdateCb = (s: UpdateStatus) => void;

const DEMO_TRACKS: TrackInfo[] = [
  { title: 'Midnight Pulse', artist: 'Lena Vox', album: 'Nocturne', bpm: 126, key: '8A', genre: 'House' },
  { title: 'Chrome Hearts', artist: 'DJ Ferro', album: 'Overdrive', bpm: 128, key: '11B', genre: 'Tech House' },
  { title: 'Aurora Line', artist: 'Sable', album: 'Northern', bpm: 124, key: '5A', genre: 'Progressive' },
  { title: 'Dust & Neon', artist: 'Mara K.', album: 'City Lights', bpm: 174, key: '2B', genre: 'DnB' },
  { title: 'Deep Current', artist: 'Oskar W.', album: 'Tides', bpm: 122, key: '7A', genre: 'Deep House' },
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function makeDeck(deck: number, idx: number, playing: boolean): DeckState {
  const t = DEMO_TRACKS[idx % DEMO_TRACKS.length];
  return {
    deck,
    isMaster: deck === 1,
    onAir: playing,
    playing,
    bpm: t.bpm,
    pitch: 0,
    beat: 0,
    beatInBar: 1,
    track: clone(t),
  };
}

export function createMockApi(): IpcApi {
  let config: AppConfig = clone(DEFAULT_CONFIG);

  const decks: DeckState[] = [
    makeDeck(1, 0, true),
    makeDeck(2, 1, true),
    makeDeck(3, 2, false),
    makeDeck(4, 3, false),
  ];

  let state: DJState = {
    connected: true,
    masterDeck: 1,
    masterBpm: decks[0].bpm,
    beat: 0,
    beatInBar: 1,
    decks,
    updatedAt: Date.now(),
  };

  let os2l = { connected: true, target: '127.0.0.1:5000 (WTOOLS)' };

  const stateCbs = new Set<StateCb>();
  const os2lCbs = new Set<Os2lCb>();
  const logCbs = new Set<LogCb>();
  const updateCbs = new Set<UpdateCb>();
  let updateStatus: UpdateStatus = { state: 'idle' };

  function emitState() {
    state = { ...state, updatedAt: Date.now() };
    stateCbs.forEach((cb) => cb(clone(state)));
  }
  function log(line: string) {
    const stamped = `${new Date().toLocaleTimeString()}  ${line}`;
    logCbs.forEach((cb) => cb(stamped));
  }

  // Beat-Simulation: master-tick ~ masterBpm.
  let beatTimer: ReturnType<typeof setInterval> | undefined;
  function scheduleBeat() {
    if (beatTimer) clearInterval(beatTimer);
    const interval = Math.max(120, 60000 / (state.masterBpm || 120));
    beatTimer = setInterval(() => {
      state.beat += 1;
      state.beatInBar = (state.beat % config.fx.beatsPerBar) + 1;
      for (const d of state.decks) {
        if (d.playing) {
          d.beat += 1;
          d.beatInBar = (d.beat % config.fx.beatsPerBar) + 1;
        }
      }
      emitState();
    }, interval);
  }
  scheduleBeat();

  // Gelegentlicher Track-/Master-Wechsel, damit die UI lebendig wirkt.
  let swapIdx = 4;
  setInterval(() => {
    const target = state.decks[Math.random() > 0.5 ? 0 : 1];
    target.track = clone(DEMO_TRACKS[swapIdx % DEMO_TRACKS.length]);
    target.bpm = target.track.bpm;
    swapIdx += 1;
    // Master folgt dem schnelleren spielenden Deck
    const master = state.decks.find((d) => d.isMaster) ?? state.decks[0];
    state.masterDeck = master.deck;
    state.masterBpm = master.bpm;
    scheduleBeat();
    log(`nowPlaying deck ${target.deck}: ${target.track?.artist} - ${target.track?.title}`);
    emitState();
  }, 14000);

  log('Mock-API aktiv (kein window.api gefunden) — Demodaten laufen.');

  return {
    async getState() {
      return clone(state);
    },
    async getConfig() {
      return clone(config);
    },
    async setConfig(cfg: Partial<AppConfig>) {
      config = { ...config, ...clone(cfg) } as AppConfig;
      // beatsPerBar / bpm könnten sich geändert haben
      scheduleBeat();
      log('Konfiguration gespeichert.');
      return clone(config);
    },
    async action(a: ControlAction) {
      switch (a.action) {
        case 'tap':
          log('TAP (manueller Beat)');
          break;
        case 'next':
          log('Nächstes Preset ausgelöst');
          break;
        case 'button':
          log(`Button → ${a.name}`);
          break;
        case 'drop':
          log('DROP / Strobe-Build ausgelöst');
          break;
        case 'blackout':
          log('BLACKOUT');
          break;
        case 'auto':
          log('Auto-FX umgeschaltet');
          break;
        case 'rule':
          log(`Regel ${a.key} → ${a.enabled ? 'an' : 'aus'}`);
          if (a.key === 'presetRotation') config.fx.presetRotation.enabled = a.enabled;
          if (a.key === 'colorCycle') config.fx.colorCycle.enabled = a.enabled;
          if (a.key === 'forwardBeats') config.fx.forwardBeats = a.enabled;
          break;
      }
    },
    async os2lStatus() {
      return { ...os2l };
    },
    async listInterfaces() {
      return [
        { name: 'en0', address: '192.168.1.42' },
        { name: 'en7 (USB-LAN)', address: '169.254.10.5' },
        { name: 'lo0', address: '127.0.0.1' },
      ];
    },
    onState(cb: StateCb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    onOs2l(cb: Os2lCb) {
      os2lCbs.add(cb);
      // einmal initial pushen
      cb({ ...os2l });
      return () => os2lCbs.delete(cb);
    },
    onLog(cb: LogCb) {
      logCbs.add(cb);
      return () => logCbs.delete(cb);
    },
    async checkForUpdates() {
      // Demo-Ablauf: prüfen → keine Aktualisierung (kein echter Feed im Mock).
      updateStatus = { state: 'checking' };
      updateCbs.forEach((cb) => cb(updateStatus));
      log('Update: Suche nach Aktualisierungen …');
      setTimeout(() => {
        updateStatus = { state: 'none' };
        updateCbs.forEach((cb) => cb(updateStatus));
        log('Update: Bereits aktuell (Mock).');
      }, 900);
    },
    async installUpdateNow() {
      log('Update: Neustart zum Installieren (im Mock ohne Wirkung).');
    },
    async getUpdateStatus() {
      return updateStatus;
    },
    onUpdate(cb: UpdateCb) {
      updateCbs.add(cb);
      return () => updateCbs.delete(cb);
    },
  };
}

// Liefert die echte Bridge, falls vorhanden; sonst die Mock-Implementierung.
export function getApi(): IpcApi {
  const w = window as unknown as { api?: IpcApi };
  if (w.api) return w.api;
  return createMockApi();
}
