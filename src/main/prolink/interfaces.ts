// Interne Typen für den Pro-DJ-Link-Ingest.
//
// Diese Datei beschreibt NUR modul-interne Verträge (typisierte Events,
// Optionen, Interface-Infos). Die geteilten Domänentypen (DJState, DeckState,
// TrackInfo, ProlinkEvent) kommen weiterhin ausschließlich aus
// `../../shared/types`.

import type { DJState, TrackInfo } from '../../shared/types';

/**
 * Netzwerk-Interface-Info, wie sie `ProlinkIngest.listInterfaces()` liefert
 * und wie sie im Renderer/Settings verwendet wird (identisch zu IpcApi.listInterfaces()).
 */
export interface NetworkInterfaceInfo {
  name: string;
  address: string;
}

/**
 * Nutzlast des `beat`-Events (Master-Deck getaktet).
 */
export interface BeatEvent {
  masterBpm: number;
  beat: number; // laufender Beat-Zähler des Master-Decks
  beatInBar: number; // 1..4
}

/**
 * Nutzlast des `track`-Events (Track-Wechsel auf einem Deck).
 */
export interface TrackEvent {
  deck: number; // Player-Nummer 1..4
  track: TrackInfo;
}

/**
 * Nutzlast des `status`-Events (Verbindungszustand/Meldungen).
 */
export interface StatusEvent {
  connected: boolean;
  message?: string;
}

/**
 * Typisierte Event-Map des ProlinkIngest-EventEmitters.
 * Wird genutzt, um `on`/`once`/`off`/`emit` streng zu typisieren.
 */
export interface ProlinkIngestEventMap {
  state: (state: DJState) => void;
  beat: (data: BeatEvent) => void;
  track: (data: TrackEvent) => void;
  status: (data: StatusEvent) => void;
}

export type ProlinkIngestEventName = keyof ProlinkIngestEventMap;

/**
 * Konfigurationsoptionen für den Ingest. Alle optional mit sinnvollen Defaults.
 */
export interface ProlinkIngestOptions {
  /**
   * ID, als die sich der Virtual CDJ im Netz anmeldet.
   *
   * WICHTIG (laut prolink-connect):
   *  - Default 7 (prolink-connect `DEFAULT_VCDJ_ID`). IDs > 6 belegen keinen
   *    echten Player-Slot, erlauben aber KEINE Remote-DB-Abfragen an CDJs für
   *    unanalysierte Medien. Für reine Rekordbox-/USB-analysierte Tracks reicht
   *    das (unser Normalfall: XDJ-AZ mit vorbereiteten USB-Sticks).
   *  - IDs 1..6 ermöglichen Remote-DB-Abfragen, belegen aber einen Slot.
   */
  vcdjId?: number;

  /**
   * Zeit in ms bis zu einem Reconnect-Versuch nach Fehler/Discovery-Timeout.
   * Default: 3000.
   */
  reconnectMs?: number;

  /**
   * Max. Wartezeit in ms auf das erste Gerät im Netz bei Auto-Konfiguration.
   * Nach Ablauf wird ein Reconnect geplant (statt ewig zu blockieren).
   * Default: 15000.
   */
  discoveryTimeoutMs?: number;

  /**
   * Anzahl der Decks (Player 1..deckCount). XDJ-AZ = 4.
   * Default: 4.
   */
  deckCount?: number;

  /**
   * Ob Artwork via DB geladen und als data:-URI an TrackInfo gehängt wird.
   * Default: true. (Artwork wird nur gesetzt, wenn es klein genug ist.)
   */
  fetchArtwork?: boolean;

  /**
   * Obergrenze (Bytes) für eingebettetes Artwork als data-URI. Default 256 KiB.
   */
  maxArtworkBytes?: number;
}
