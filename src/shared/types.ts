// Gemeinsame Verträge für alle Module (main, renderer, ingest, os2l, fx).
// ALLE Module importieren ausschließlich aus dieser Datei, damit sie zusammenpassen.

export interface TrackInfo {
  title: string;
  artist?: string;
  album?: string;
  bpm: number;              // Track-BPM aus Metadaten/Beatgrid
  key?: string;
  genre?: string;
  lengthSec?: number;
  artworkDataUri?: string;  // optional, data:image/... (klein halten)
}

export interface DeckState {
  deck: number;             // Player-Nummer (1..4), XDJ-AZ = 4 Decks
  isMaster: boolean;
  onAir: boolean;           // Fader offen / on-air (falls Mixer-Info vorhanden)
  playing: boolean;
  bpm: number;              // effektives BPM inkl. Pitch
  pitch: number;            // Prozent (-100..+100)
  beat: number;             // laufender Beat-Zähler des Decks
  beatInBar: number;        // 1..4
  track?: TrackInfo;
}

export interface DJState {
  connected: boolean;
  masterDeck: number;
  masterBpm: number;
  beat: number;             // laufender Beat-Zähler des Master-Decks
  beatInBar: number;        // 1..4
  decks: DeckState[];
  updatedAt: number;
}

// Events, die der Pro-DJ-Link-Ingest aussendet (EventEmitter)
export type ProlinkEvent =
  | { type: 'state'; state: DJState }
  | { type: 'beat'; masterBpm: number; beat: number; beatInBar: number }
  | { type: 'trackChange'; deck: number; track: TrackInfo }
  | { type: 'nowPlaying'; deck: number; track: TrackInfo }
  | { type: 'status'; connected: boolean; message?: string };

// OS2L-Nachrichten an WTOOLS (TCP, Default 127.0.0.1:5000)
export interface OS2LBeat { evt: 'beat'; change: boolean; pos: number; bpm: number; strength: number; }
export interface OS2LBtn  { evt: 'btn'; name: string; state: boolean; }
export type OS2LMessage = OS2LBeat | OS2LBtn;

export interface FXRuleButtonList { enabled: boolean; everyBars: number; buttons: string[]; }

export interface FXConfig {
  forwardBeats: boolean;
  beatsPerBar: number;            // i.d.R. 4
  strengthPattern: number[];      // Beat-Stärke pro Takt, z.B. [1,0.4,0.7,0.4]
  presetRotation: FXRuleButtonList;
  colorCycle: FXRuleButtonList;
  dropStrobe: { button: string; beats: number };
  blackoutButton: string;
  cueScenes: { enabled: boolean; map: Record<string, string> }; // Hotcue/Memory-Name -> OS2L-Button
  energy: { enabled: boolean; lowButton?: string; highButton?: string; bpmHigh: number };
}

export interface AppConfig {
  prolink: { interface?: string; useVirtualCdj: boolean };
  os2l: { host: string; port: number; discover: boolean; reconnectMs: number };
  fx: FXConfig;
  ui: { theme: 'system' | 'dark' | 'light' };
}

export const DEFAULT_CONFIG: AppConfig = {
  prolink: { interface: undefined, useVirtualCdj: true },
  os2l: { host: '127.0.0.1', port: 5000, discover: true, reconnectMs: 2000 },
  fx: {
    forwardBeats: true,
    beatsPerBar: 4,
    strengthPattern: [1.0, 0.4, 0.7, 0.4],
    presetRotation: { enabled: true, everyBars: 8, buttons: ['fx1', 'fx2', 'fx3', 'fx4'] },
    colorCycle: { enabled: true, everyBars: 4, buttons: ['color_red', 'color_blue', 'color_green', 'color_magenta'] },
    dropStrobe: { button: 'strobe', beats: 8 },
    blackoutButton: 'blackout',
    cueScenes: { enabled: false, map: {} },
    energy: { enabled: false, lowButton: 'fx1', highButton: 'strobe', bpmHigh: 140 },
  },
  ui: { theme: 'system' },
};

// Steueraktionen (renderer -> main)
export type ControlAction =
  | { action: 'tap' }
  | { action: 'next' }
  | { action: 'button'; name: string }
  | { action: 'drop' }
  | { action: 'blackout' }
  | { action: 'auto' }
  | { action: 'rule'; key: 'forwardBeats' | 'presetRotation' | 'colorCycle'; enabled: boolean };

// Auto-Updater-Status (main -> renderer)
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'none' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

// Von preload via contextBridge als window.api bereitgestellt
export interface IpcApi {
  getState(): Promise<DJState>;
  getConfig(): Promise<AppConfig>;
  setConfig(cfg: Partial<AppConfig>): Promise<AppConfig>;
  action(a: ControlAction): Promise<void>;
  os2lStatus(): Promise<{ connected: boolean; target: string }>;
  listInterfaces(): Promise<{ name: string; address: string }[]>;
  onState(cb: (s: DJState) => void): () => void;
  onOs2l(cb: (s: { connected: boolean; target: string }) => void): () => void;
  onLog(cb: (line: string) => void): () => void;
  // Auto-Updater
  checkForUpdates(): Promise<void>;
  installUpdateNow(): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  onUpdate(cb: (s: UpdateStatus) => void): () => void;
}
