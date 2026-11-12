// ProlinkIngest — Pro-DJ-Link-Aufnahme (XDJ-AZ) via `prolink-connect`.
//
// Aufgabe: Das Pioneer/AlphaTheta Pro-DJ-Link-Netz abhören, den Zustand aller
// Decks (Player 1..4 beim XDJ-AZ) pflegen und als getippte Events für den
// restlichen LightBridge-Main-Prozess (FXDirector etc.) ausgeben.
//
// Legitime Interop mit eigener Hardware + eigener Lichtsoftware.
//
// Öffentlicher Vertrag (siehe ARCHITECTURE.md):
//   class ProlinkIngest extends EventEmitter
//     start(interfaceName?: string): Promise<void>
//     stop(): Promise<void>
//     getState(): DJState
//     static listInterfaces(): { name: string; address: string }[]
//   emittiert: 'state'(DJState), 'beat'({masterBpm,beat,beatInBar}),
//              'track'({deck,track}), 'status'({connected,message})
//
// --------------------------------------------------------------------------
// Recherchierte prolink-connect API (Stand: evanpurkhiser/prolink-connect,
// npm "prolink-connect", Basis von prolink-tools). Hauptexporte aus
// 'prolink-connect':
//   bringOnline(config?: NetworkConfig): Promise<ProlinkNetwork>
//     - Öffnet die UDP-Sockets (Announce/Beat/Status). SCHLÄGT FEHL, wenn
//       Rekordbox auf demselben Rechner läuft oder eine zweite Instanz aktiv ist.
//   ProlinkNetwork:
//     .autoconfigFromPeers(): Promise<void>   // wartet auf erstes Gerät, vcdjId=7
//     .configure({ vcdjId, iface }): void      // manuelle Interface-Wahl
//     .connect(): void                         // startet Announcer + Services
//     .disconnect(): Promise<void>             // schließt Sockets
//     .isConnected(): this is ConnectedProlinkNetwork  // Type-Guard
//     .deviceManager                           // on('connected'|'disconnected'|'announced', Device)
//     .statusEmitter  (null bis connected)     // on('status', CDJStatus.State)
//     .mixstatus      (lazy, null bis connected) // on('nowPlaying'|'stopped'|'setStarted'|'setEnded')
//     .db             (null bis connected)     // getMetadata(opts) / getArtwork(opts)
//   CDJStatus.State (Statuspaket je Player):
//     deviceId, trackId, trackDeviceId, trackSlot (MediaSlot), trackType (TrackType),
//     playState (CDJStatus.PlayState), isOnAir, isSync, isMaster, isEmergencyMode,
//     trackBPM: number|null, effectivePitch, sliderPitch,
//     beatInMeasure (1..4, 0 = kein Track), beatsUntilCue, beat: number|null, packetNum
//   db.getMetadata({ deviceId, trackSlot, trackType, trackId }): Promise<Track|null>
//   db.getArtwork({ deviceId, trackSlot, trackType, trackId }): Promise<Buffer|null>
//   Track: { id, title, duration, tempo, comment, filePath, fileName,
//            artist: {name}|null, album: {name}|null, genre: {name}|null,
//            key: {name}|null, artwork: {id}|null, ... }
// --------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';

import type {
  ConnectedProlinkNetwork,
  NetworkConfig,
  ProlinkNetwork,
  CDJStatus,
  Track,
} from 'prolink-connect';
// Werte-Importe (Enums = Laufzeitwerte). bringOnline ist der Haupteinstieg.
// `CDJStatus` wird als Namespace sowohl für Typen als auch für Enum-Werte
// (PlayState) genutzt.
// ASSUMPTION: `CDJStatus` wird von prolink-connect als Namespace mit den
// Enums PlayState/TrackType/StatusFlag re-exportiert (so dokumentiert via
// `export * as CDJStatus from 'src/status/types'`). Falls ein Build-Target die
// Enum-Laufzeitwerte nicht mitliefert, greift der numerische Fallback in
// `isDeckPlaying()`.
import { bringOnline } from 'prolink-connect';

import type {
  DeckState,
  DJState,
  TrackInfo,
} from '../../shared/types';
import type {
  NetworkInterfaceInfo,
  ProlinkIngestEventMap,
  ProlinkIngestOptions,
} from './interfaces';

const DEFAULT_OPTIONS: Required<ProlinkIngestOptions> = {
  vcdjId: 7, // prolink-connect DEFAULT_VCDJ_ID
  reconnectMs: 3000,
  discoveryTimeoutMs: 15000,
  deckCount: 4, // XDJ-AZ
  fetchArtwork: true,
  maxArtworkBytes: 256 * 1024,
};

/**
 * ProlinkIngest: siehe Datei-Header.
 */
export class ProlinkIngest extends EventEmitter {
  private readonly opts: Required<ProlinkIngestOptions>;

  private network: ProlinkNetwork | null = null;
  private state: DJState;

  /** Angeforderter Interface-Name (für Reconnects gemerkt). */
  private requestedInterface?: string;

  /** Timer für geplante Reconnects. */
  private reconnectTimer: NodeJS.Timeout | null = null;

  /**
   * Monoton steigende "Generation". Jeder start()-Aufruf erhöht sie; asynchrone
   * Callbacks ignorieren Ergebnisse alter Generationen (verhindert Races bei
   * schnellem start/stop/reconnect).
   */
  private generation = 0;

  /** True, solange wir aktiv laufen sollen (nicht durch stop() gestoppt). */
  private running = false;

  /** Laufende Metadaten-Abfrage je Deck zur Dedup (trackId). */
  private readonly pendingTrackId = new Map<number, number>();

  /** Für Beat-Erkennung: zuletzt gesehener beatInMeasure je Deck. */
  private readonly lastBeatInBar = new Map<number, number>();

  /** Laufender Beat-Zähler je Deck. */
  private readonly deckBeatCounter = new Map<number, number>();

  constructor(options: ProlinkIngestOptions = {}) {
    super();
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.state = this.makeInitialState();
  }

  // ----------------------------------------------------------------------
  // Öffentliche API
  // ----------------------------------------------------------------------

  /**
   * Startet die Aufnahme. `interfaceName` optional:
   *  - gesetzt  -> manuelle Interface-Wahl (configure({iface, vcdjId}))
   *  - leer     -> Auto-Konfiguration (autoconfigFromPeers, wartet auf 1. Gerät)
   *
   * Idempotent: ein vorheriger Lauf wird zuerst sauber gestoppt.
   */
  async start(interfaceName?: string): Promise<void> {
    await this.stop();
    this.running = true;
    this.requestedInterface = interfaceName;
    await this.connectOnce();
  }

  /**
   * Stoppt die Aufnahme, trennt das Netz und setzt den Zustand zurück.
   * Sicher mehrfach aufrufbar.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.generation += 1; // invalidiert laufende Async-Callbacks
    this.clearReconnect();

    const net = this.network;
    this.network = null;

    if (net) {
      this.detachListeners(net);
      try {
        // disconnect() schließt die UDP-Sockets (Promise).
        await net.disconnect();
      } catch (err) {
        // Beim Stoppen tolerieren wir Fehler (z.B. Socket bereits zu).
        this.log(`disconnect() Fehler ignoriert: ${errMsg(err)}`);
      }
    }

    this.resetRuntimeMaps();
    this.state = this.makeInitialState();
    // Status melden, aber nur wenn wir wirklich etwas hatten.
    this.emitStatus(false, 'gestoppt');
  }

  /**
   * Aktueller DJState (defensive Kopie, damit Consumer nicht intern mutieren).
   */
  getState(): DJState {
    return {
      ...this.state,
      decks: this.state.decks.map(d => ({
        ...d,
        track: d.track ? { ...d.track } : undefined,
      })),
    };
  }

  /**
   * Listet IPv4-Netzwerk-Interfaces (ohne interne/Loopback) für die UI.
   */
  static listInterfaces(): NetworkInterfaceInfo[] {
    const out: NetworkInterfaceInfo[] = [];
    const ifaces = networkInterfaces();
    for (const [name, infos] of Object.entries(ifaces)) {
      if (!infos) continue;
      for (const info of infos) {
        // Node < 18 nutzt family 'IPv4', neuere teils 4 (number). Beides abdecken.
        const isV4 =
          (info.family as unknown as string) === 'IPv4' ||
          (info.family as unknown as number) === 4;
        if (isV4 && !info.internal) {
          out.push({ name, address: info.address });
        }
      }
    }
    return out;
  }

  // ----------------------------------------------------------------------
  // Typisierte EventEmitter-Overloads
  // ----------------------------------------------------------------------

  override on<E extends keyof ProlinkIngestEventMap>(
    event: E,
    listener: ProlinkIngestEventMap[E],
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override once<E extends keyof ProlinkIngestEventMap>(
    event: E,
    listener: ProlinkIngestEventMap[E],
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
  override off<E extends keyof ProlinkIngestEventMap>(
    event: E,
    listener: ProlinkIngestEventMap[E],
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
  override emit<E extends keyof ProlinkIngestEventMap>(
    event: E,
    ...args: Parameters<ProlinkIngestEventMap[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  // ----------------------------------------------------------------------
  // Verbindungsaufbau / Reconnect
  // ----------------------------------------------------------------------

  private async connectOnce(): Promise<void> {
    const gen = ++this.generation;
    this.clearReconnect();

    this.emitStatus(false, this.requestedInterface
      ? `verbinde (Interface: ${this.requestedInterface}) ...`
      : 'verbinde (Auto-Konfiguration) ...');

    let network: ProlinkNetwork;
    try {
      // 1) Netz online bringen (öffnet UDP-Sockets).
      network = await bringOnline();
      if (this.isStale(gen)) {
        // Zwischenzeitlich gestoppt/neu gestartet -> wieder abbauen.
        await safeDisconnect(network);
        return;
      }
      this.network = network;

      // 2) Konfigurieren: manuell (Interface) oder automatisch.
      if (this.requestedInterface) {
        const iface = resolveInterface(this.requestedInterface);
        if (!iface) {
          throw new Error(
            `Interface "${this.requestedInterface}" nicht gefunden oder kein IPv4.`,
          );
        }
        // ASSUMPTION: configure() erwartet NetworkConfig { iface, vcdjId } mit
        // iface als node os.NetworkInterfaceInfoIPv4 (so im Quellcode typisiert).
        network.configure({ iface, vcdjId: this.opts.vcdjId } as NetworkConfig);
      } else {
        // Wartet auf das erste Gerät. Mit Timeout absichern, damit wir nicht
        // ewig blockieren, falls (noch) nichts im Netz ist.
        await withTimeout(
          network.autoconfigFromPeers(),
          this.opts.discoveryTimeoutMs,
          'Kein Pro-DJ-Link-Gerät gefunden (Auto-Konfiguration Timeout).',
        );
      }
      if (this.isStale(gen)) {
        await safeDisconnect(network);
        return;
      }

      // 3) Verbinden (Announcer + Services starten).
      // connect() ist im Quellcode synchron; await ist unschädlich.
      await Promise.resolve(network.connect());

      if (!network.isConnected()) {
        throw new Error('Verbindung fehlgeschlagen (isConnected()=false).');
      }
      if (this.isStale(gen)) {
        await safeDisconnect(network);
        return;
      }

      // 4) Listener anhängen und Status melden.
      this.attachListeners(network);
      this.state.connected = true;
      this.touch();
      this.emitStatus(true, this.requestedInterface
        ? `verbunden (Interface: ${this.requestedInterface})`
        : 'verbunden (Auto-Konfiguration)');
      this.emitState();
    } catch (err) {
      if (this.isStale(gen)) return;
      const msg = errMsg(err);
      this.log(`Verbindungsfehler: ${msg}`);
      // Teil-Aufbau wieder abbauen.
      if (this.network) {
        this.detachListeners(this.network);
        await safeDisconnect(this.network);
        this.network = null;
      }
      this.state.connected = false;
      this.emitStatus(false, `Fehler: ${msg}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.running) return;
      this.emitStatus(false, 'Reconnect ...');
      void this.connectOnce();
    }, this.opts.reconnectMs);
    // Den Timer den Prozess nicht am Leben halten lassen.
    this.reconnectTimer.unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ----------------------------------------------------------------------
  // prolink-connect Event-Verdrahtung
  // ----------------------------------------------------------------------

  private attachListeners(network: ProlinkNetwork): void {
    // Statuspakete je Player -> Kern des DJState.
    network.statusEmitter?.on('status', this.handleStatus);

    // Geräte-Lifecycle (nur fürs Logging/Status, kein harter Vertrag).
    network.deviceManager.on('connected', this.handleDeviceConnected);
    network.deviceManager.on('disconnected', this.handleDeviceDisconnected);

    // mixstatus.nowPlaying nutzt dieselben Status-Events, liefert aber eine
    // "geglättete" now-playing-Erkennung. Wir nutzen es, um onAir/Metadaten
    // des tatsächlich hörbaren Decks zu verfeinern.
    // Zugriff auf `mixstatus` initialisiert den Prozessor lazy.
    network.mixstatus?.on('nowPlaying', this.handleNowPlaying);
  }

  private detachListeners(network: ProlinkNetwork): void {
    try {
      network.statusEmitter?.off('status', this.handleStatus);
      network.deviceManager.off('connected', this.handleDeviceConnected);
      network.deviceManager.off('disconnected', this.handleDeviceDisconnected);
      network.mixstatus?.off('nowPlaying', this.handleNowPlaying);
    } catch {
      // defensiv: Listener-Abbau darf nie werfen.
    }
  }

  private handleDeviceConnected = (device: { id: number; name: string }): void => {
    this.log(`Gerät verbunden: #${device.id} ${device.name}`);
  };

  private handleDeviceDisconnected = (device: { id: number; name: string }): void => {
    this.log(`Gerät getrennt: #${device.id} ${device.name}`);
    // Deck zurücksetzen, falls im Deck-Bereich.
    const deck = this.getDeck(device.id);
    if (deck) {
      deck.playing = false;
      deck.onAir = false;
      deck.isMaster = false;
      this.touch();
      this.emitState();
    }
  };

  /**
   * Zentrale Status-Verarbeitung: ein CDJStatus.State-Paket je Player.
   */
  private handleStatus = (status: CDJStatus.State): void => {
    const deviceId = status.deviceId;
    // Nur echte Player-Decks 1..deckCount abbilden (Mixer/VCDJ/Rekordbox ignorieren).
    if (deviceId < 1 || deviceId > this.opts.deckCount) {
      return;
    }

    const deck = this.getOrCreateDeck(deviceId);

    const trackBpm = status.trackBPM ?? 0;
    const effectivePitch = status.effectivePitch ?? 0;
    const effectiveBpm = trackBpm > 0 ? trackBpm * (1 + effectivePitch / 100) : 0;
    const beatInBar = status.beatInMeasure ?? 0;

    // Beat-Zähler/Beat-Erkennung je Deck: Wechsel des beatInMeasure = neuer Beat.
    const prevBeatInBar = this.lastBeatInBar.get(deviceId) ?? 0;
    let beatCounter = this.deckBeatCounter.get(deviceId) ?? 0;
    const beatAdvanced = beatInBar > 0 && beatInBar !== prevBeatInBar;
    if (beatAdvanced) {
      beatCounter += 1;
      this.deckBeatCounter.set(deviceId, beatCounter);
    }
    this.lastBeatInBar.set(deviceId, beatInBar);

    // Deck-Felder aktualisieren.
    deck.isMaster = status.isMaster;
    deck.onAir = status.isOnAir;
    deck.playing = isDeckPlaying(status.playState);
    deck.bpm = round2(effectiveBpm);
    deck.pitch = round2(status.sliderPitch ?? effectivePitch ?? 0);
    deck.beat = beatCounter;
    deck.beatInBar = beatInBar;

    // Master-Infos im DJState pflegen.
    if (status.isMaster) {
      this.state.masterDeck = deviceId;
      this.state.masterBpm = round2(effectiveBpm);
      this.state.beat = beatCounter;
      this.state.beatInBar = beatInBar;
    }

    // Track-Wechsel erkennen (trackId != aktuell geladener).
    this.maybeLoadTrack(deck, status);

    this.touch();

    // Beat-Event nur für das Master-Deck feuern.
    if (beatAdvanced && status.isMaster) {
      this.emit('beat', {
        masterBpm: this.state.masterBpm,
        beat: this.state.beat,
        beatInBar: this.state.beatInBar,
      });
    }

    // State-Event bei jedem Statuspaket (die Consumer drosseln selbst, falls nötig).
    this.emitState();
  };

  /**
   * mixstatus.nowPlaying: markiert das tatsächlich hörbare Deck.
   * Wir stellen sicher, dass dessen Metadaten geladen sind.
   */
  private handleNowPlaying = (status: CDJStatus.State): void => {
    const deviceId = status.deviceId;
    if (deviceId < 1 || deviceId > this.opts.deckCount) return;
    const deck = this.getOrCreateDeck(deviceId);
    deck.onAir = true;
    this.maybeLoadTrack(deck, status);
    this.touch();
    this.emitState();
  };

  // ----------------------------------------------------------------------
  // Metadaten
  // ----------------------------------------------------------------------

  /**
   * Lädt Track-Metadaten, wenn sich die geladene trackId des Decks geändert hat.
   * Entfernt den Track, wenn keiner geladen ist (trackId 0).
   */
  private maybeLoadTrack(deck: DeckState, status: CDJStatus.State): void {
    const trackId = status.trackId ?? 0;

    // Kein Track geladen -> ggf. zurücksetzen.
    if (trackId === 0) {
      if (deck.track) {
        deck.track = undefined;
      }
      this.pendingTrackId.delete(deck.deck);
      return;
    }

    // Schon geladen oder gerade in Arbeit -> nichts tun.
    const alreadyLoaded = deck.track && (deck.track as TrackWithId).__trackId === trackId;
    if (alreadyLoaded) return;
    if (this.pendingTrackId.get(deck.deck) === trackId) return;

    this.pendingTrackId.set(deck.deck, trackId);
    const gen = this.generation;
    void this.loadTrackMetadata(deck.deck, status, trackId, gen);
  }

  private async loadTrackMetadata(
    deckNum: number,
    status: CDJStatus.State,
    trackId: number,
    gen: number,
  ): Promise<void> {
    const net = this.network;
    if (!net || !net.isConnected()) {
      this.pendingTrackId.delete(deckNum);
      return;
    }
    const connected = net as ConnectedProlinkNetwork;

    // Metadaten werden von dem Gerät/Slot geholt, VON DEM der Track stammt
    // (bei Link-Load ist das nicht zwingend das abspielende Deck).
    const queryOpts = {
      deviceId: status.trackDeviceId,
      trackSlot: status.trackSlot,
      trackType: status.trackType,
      trackId,
    };

    try {
      const track = await connected.db.getMetadata(queryOpts);
      if (this.isStale(gen)) return;
      // Veraltet, falls sich inzwischen die trackId wieder geändert hat.
      if (this.pendingTrackId.get(deckNum) !== trackId) return;
      if (!track) {
        this.pendingTrackId.delete(deckNum);
        return;
      }

      const info = this.mapTrack(track, trackId);

      // Optional Artwork nachladen (best effort, blockiert Track nicht).
      if (this.opts.fetchArtwork && track.artwork) {
        void this.loadArtwork(deckNum, queryOpts, track, trackId, gen);
      }

      const deck = this.getOrCreateDeck(deckNum);
      deck.track = info;
      this.pendingTrackId.delete(deckNum);

      this.touch();
      this.emit('track', { deck: deckNum, track: info });
      this.emitState();
    } catch (err) {
      this.pendingTrackId.delete(deckNum);
      if (this.isStale(gen)) return;
      this.log(`Metadaten-Fehler (Deck ${deckNum}, Track ${trackId}): ${errMsg(err)}`);
    }
  }

  private async loadArtwork(
    deckNum: number,
    queryOpts: {
      deviceId: number;
      trackSlot: CDJStatus.State['trackSlot'];
      trackType: CDJStatus.State['trackType'];
      trackId: number;
    },
    track: NonNullable<Awaited<ReturnType<ConnectedProlinkNetwork['db']['getMetadata']>>>,
    trackId: number,
    gen: number,
  ): Promise<void> {
    const net = this.network;
    if (!net || !net.isConnected()) return;
    const connected = net as ConnectedProlinkNetwork;
    try {
      const buf = await connected.db.getArtwork({
        deviceId: queryOpts.deviceId,
        trackSlot: queryOpts.trackSlot,
        trackType: queryOpts.trackType,
        track,
      });
      if (this.isStale(gen) || !buf) return;
      if (buf.length > this.opts.maxArtworkBytes) {
        this.log(`Artwork zu groß (${buf.length} B), übersprungen.`);
        return;
      }
      const deck = this.getOrCreateDeck(deckNum);
      // Nur setzen, wenn noch derselbe Track geladen ist.
      if (!deck.track || (deck.track as TrackWithId).__trackId !== trackId) return;
      deck.track.artworkDataUri = bufferToDataUri(buf);
      this.touch();
      this.emit('track', { deck: deckNum, track: deck.track });
      this.emitState();
    } catch (err) {
      if (this.isStale(gen)) return;
      this.log(`Artwork-Fehler (Deck ${deckNum}): ${errMsg(err)}`);
    }
  }

  /**
   * Mapped einen prolink-connect Track auf unsere TrackInfo.
   * Markiert intern die trackId (nicht-enumerierbar) zur Wechsel-Erkennung.
   */
  private mapTrack(track: Track, trackId: number): TrackInfo {
    const info: TrackInfo = {
      title: track.title ?? 'Unbekannt',
      artist: track.artist?.name,
      album: track.album?.name,
      // tempo ist die Track-BPM (aus Beatgrid/DB).
      bpm: typeof track.tempo === 'number' ? round2(track.tempo) : 0,
      key: track.key?.name,
      genre: track.genre?.name,
      // duration in Sekunden (prolink-connect: Track.duration).
      lengthSec: typeof track.duration === 'number' ? track.duration : undefined,
    };
    // Interne Markierung der trackId für Dedup/Artwork-Zuordnung.
    Object.defineProperty(info, '__trackId', {
      value: trackId,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    return info;
  }

  // ----------------------------------------------------------------------
  // State-Helfer
  // ----------------------------------------------------------------------

  private makeInitialState(): DJState {
    const decks: DeckState[] = [];
    for (let i = 1; i <= this.opts.deckCount; i++) {
      decks.push(this.makeEmptyDeck(i));
    }
    return {
      connected: false,
      masterDeck: 0,
      masterBpm: 0,
      beat: 0,
      beatInBar: 0,
      decks,
      updatedAt: Date.now(),
    };
  }

  private makeEmptyDeck(deck: number): DeckState {
    return {
      deck,
      isMaster: false,
      onAir: false,
      playing: false,
      bpm: 0,
      pitch: 0,
      beat: 0,
      beatInBar: 0,
      track: undefined,
    };
  }

  private getDeck(deck: number): DeckState | undefined {
    return this.state.decks.find(d => d.deck === deck);
  }

  private getOrCreateDeck(deck: number): DeckState {
    let d = this.getDeck(deck);
    if (!d) {
      d = this.makeEmptyDeck(deck);
      this.state.decks.push(d);
      this.state.decks.sort((a, b) => a.deck - b.deck);
    }
    return d;
  }

  private resetRuntimeMaps(): void {
    this.pendingTrackId.clear();
    this.lastBeatInBar.clear();
    this.deckBeatCounter.clear();
  }

  private touch(): void {
    this.state.updatedAt = Date.now();
  }

  private emitState(): void {
    this.emit('state', this.getState());
  }

  private emitStatus(connected: boolean, message?: string): void {
    this.emit('status', { connected, message });
  }

  private log(line: string): void {
    // Zentrale Log-Stelle (an main-Logger/IPC anschließbar).
    this.emitStatus(this.state.connected, line);
  }

  /** True, wenn ein Async-Callback zu einer veralteten Generation gehört. */
  private isStale(gen: number): boolean {
    return gen !== this.generation || !this.running;
  }
}

// Interne Markierung der geladenen trackId an TrackInfo.
type TrackWithId = TrackInfo & { __trackId?: number };

// --------------------------------------------------------------------------
// Freie Hilfsfunktionen
// --------------------------------------------------------------------------

/**
 * Bestimmt, ob ein PlayState als "spielend" gilt (Playing oder Looping).
 * ASSUMPTION: CDJStatus.PlayState.Playing=0x03, Looping=0x04 (laut Quelle).
 * Fallback auf numerische Werte, falls das Enum zur Laufzeit fehlt.
 */
function isDeckPlaying(playState: CDJStatus.State['playState']): boolean {
  const ps = playState as unknown as number;
  return ps === 0x03 /* Playing */ || ps === 0x04 /* Looping */;
}

/** Interface-Name -> node os.NetworkInterfaceInfoIPv4 (erstes IPv4, nicht intern). */
function resolveInterface(name: string): NetworkConfig['iface'] | null {
  const infos = networkInterfaces()[name];
  if (!infos) return null;
  for (const info of infos) {
    const isV4 =
      (info.family as unknown as string) === 'IPv4' ||
      (info.family as unknown as number) === 4;
    if (isV4 && !info.internal) {
      // Struktur entspricht NetworkInterfaceInfoIPv4 (address, netmask, family,
      // mac, internal, cidr, ...). prolink-connect liest daraus iface-Adresse/Maske.
      return info as unknown as NetworkConfig['iface'];
    }
  }
  return null;
}

/** Promise mit Timeout; wirft bei Überschreitung mit gegebener Meldung. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    t.unref?.();
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      err => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

/** Trennt ein Netz defensiv (nie werfend). */
async function safeDisconnect(network: ProlinkNetwork): Promise<void> {
  try {
    await network.disconnect();
  } catch {
    // ignorieren
  }
}

function bufferToDataUri(buf: Buffer): string {
  // ASSUMPTION: Pioneer-Artwork ist i.d.R. JPEG. Falls nicht, zeigen Clients
  // trotzdem meist korrekt an; MIME ist unkritisch fürs Einbetten.
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export default ProlinkIngest;
