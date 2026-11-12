// OS2LClient — Legitime OS2L-Interop mit WTOOLS (eigener Wolfmix).
//
// OS2L = "Open Sound to Light". WTOOLS stellt einen OS2L-Server bereit
// (Default 127.0.0.1:5000) und ist per mDNS unter `_os2l._tcp` auffindbar.
// Protokoll: JSON-Objekte über eine rohe TCP-Verbindung, kompakt, pro
// Nachricht genau ein Objekt. Beispiele:
//   {"evt":"beat","change":true,"pos":<beats>,"bpm":<float>,"strength":<0..1>}
//   {"evt":"btn","name":"<name>","state":true|false}
//
// Diese Klasse ist bewusst robust: sie fängt alle Verbindungsfehler ab,
// verbindet sich automatisch neu und wirft nie eine Exception nach außen.

import * as net from 'net';
import type { OS2LMessage } from '../../shared/types';

export interface OS2LOptions {
  host: string;
  port: number;
  discover: boolean;
  reconnectMs: number;
}

export interface OS2LStatus {
  connected: boolean;
  target: string;
}

type StatusCb = (s: OS2LStatus) => void;

// Minimaler struktureller Typ für bonjour-service, damit wir ohne harte
// Abhängigkeit (und ohne @types) kompilieren. Wird nur lazy benutzt.
interface BonjourService {
  addresses?: string[];
  host?: string;
  port?: number;
}
interface BonjourBrowser {
  on(event: 'up', cb: (svc: BonjourService) => void): void;
  stop?(): void;
}
interface BonjourInstance {
  find(opts: { type: string; protocol?: 'tcp' | 'udp' }, cb?: (svc: BonjourService) => void): BonjourBrowser;
  destroy?(): void;
}

export class OS2LClient {
  private opts: OS2LOptions;
  private onStatus: StatusCb;

  private socket: net.Socket | null = null;
  private connected = false;
  private closed = false;              // true nach close(): keine Reconnects mehr
  private connecting = false;

  private reconnectTimer: NodeJS.Timeout | null = null;

  // Aktuelles Verbindungsziel (kann per mDNS vom konfigurierten abweichen)
  private targetHost: string;
  private targetPort: number;

  // mDNS-Discovery (lazy, optional)
  private bonjour: BonjourInstance | null = null;
  private browser: BonjourBrowser | null = null;
  private discovered = false;

  constructor(opts: OS2LOptions, onStatus: StatusCb) {
    this.opts = { ...opts };
    this.onStatus = onStatus;
    this.targetHost = opts.host;
    this.targetPort = opts.port;
  }

  // --- Öffentliche API ------------------------------------------------------

  connect(): void {
    this.closed = false;
    if (this.opts.discover) {
      // Discovery läuft parallel; bis ein Server gefunden wird (oder mDNS
      // nicht verfügbar ist), nutzen wir host/port als Fallback.
      this.startDiscovery();
    }
    this.openSocket();
  }

  close(): void {
    this.closed = true;
    this.clearReconnect();
    this.stopDiscovery();
    this.teardownSocket();
    this.setConnected(false);
  }

  sendBeat(pos: number, bpm: number, strength: number, change: boolean): void {
    const msg: OS2LMessage = {
      evt: 'beat',
      change: !!change,
      pos: Number(pos) || 0,
      bpm: Number(bpm) || 0,
      strength: clamp01(strength),
    };
    this.send(msg);
  }

  sendBtn(name: string, state: boolean): void {
    if (!name) return;
    const msg: OS2LMessage = { evt: 'btn', name: String(name), state: !!state };
    this.send(msg);
  }

  status(): OS2LStatus {
    return { connected: this.connected, target: `${this.targetHost}:${this.targetPort}` };
  }

  // --- Socket-Handling ------------------------------------------------------

  private openSocket(): void {
    if (this.closed || this.connecting || this.connected) return;
    this.connecting = true;
    this.teardownSocket();

    const sock = new net.Socket();
    this.socket = sock;

    // Fehler niemals nach außen werfen.
    sock.on('error', () => {
      // Details ignorieren wir bewusst; 'close' kümmert sich um Reconnect.
      this.connecting = false;
    });

    sock.on('connect', () => {
      this.connecting = false;
      this.setConnected(true);
    });

    sock.on('close', () => {
      this.connecting = false;
      const wasConnected = this.connected;
      this.setConnected(false);
      // Socket aufräumen, damit wir sauber neu verbinden.
      if (this.socket === sock) this.socket = null;
      sock.removeAllListeners();
      if (!this.closed) this.scheduleReconnect();
      void wasConnected;
    });

    // Eingehende Daten (OS2L-Server kann z.B. "feedback" senden) ignorieren
    // wir für diese Ausgabe-only-Richtung, lesen den Stream aber leer, damit
    // der Buffer nicht aufläuft.
    sock.on('data', () => { /* no-op */ });

    try {
      sock.setNoDelay(true);
      sock.connect(this.targetPort, this.targetHost);
    } catch {
      // Synchroner Fehler (sehr selten) -> Reconnect planen.
      this.connecting = false;
      if (!this.closed) this.scheduleReconnect();
    }
  }

  private teardownSocket(): void {
    const sock = this.socket;
    if (!sock) return;
    this.socket = null;
    try {
      sock.removeAllListeners();
      sock.destroy();
    } catch {
      /* ignore */
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.max(250, this.opts.reconnectMs || 2000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
    // Reconnect-Timer soll den Node-Prozess nicht am Leben halten.
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setConnected(v: boolean): void {
    if (this.connected === v) return;
    this.connected = v;
    this.emitStatus();
  }

  private emitStatus(): void {
    try {
      this.onStatus(this.status());
    } catch {
      /* Callback-Fehler dürfen uns nicht stören */
    }
  }

  private send(msg: OS2LMessage): void {
    const sock = this.socket;
    if (!sock || !this.connected) return; // still verwerfen, wenn offline
    try {
      // Kompakt, ein JSON-Objekt pro Nachricht.
      sock.write(JSON.stringify(msg));
    } catch {
      // Schreibfehler -> 'close'/'error' triggert Reconnect.
    }
  }

  // --- mDNS-Discovery (optional, lazy) -------------------------------------

  private startDiscovery(): void {
    if (this.browser || this.bonjour) return;
    let mod: unknown;
    try {
      // Lazy & optional: wenn das Paket fehlt, fallen wir still auf host/port
      // zurück. require statt import, damit ein fehlendes Modul nicht den
      // gesamten Bundle-/Ladevorgang bricht.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('bonjour-service');
    } catch {
      return; // Paket nicht verfügbar -> Fallback host/port
    }

    try {
      const Ctor = resolveBonjourCtor(mod);
      if (!Ctor) return;
      const instance = new Ctor() as BonjourInstance;
      this.bonjour = instance;
      this.browser = instance.find({ type: 'os2l', protocol: 'tcp' }, (svc) => {
        this.onServiceUp(svc);
      });
      // Zusätzlich 'up'-Event absichern (API-Varianten).
      if (this.browser && typeof this.browser.on === 'function') {
        this.browser.on('up', (svc) => this.onServiceUp(svc));
      }
    } catch {
      // Discovery nicht nutzbar -> Fallback host/port
      this.stopDiscovery();
    }
  }

  private onServiceUp(svc: BonjourService): void {
    if (this.closed || !svc) return;
    const host = pickAddress(svc);
    const port = svc.port;
    if (!host || !port) return;

    // Wir nehmen den zuerst gefundenen OS2L-Server. Wenn er vom aktuellen
    // Ziel abweicht, auf das entdeckte Ziel umschwenken.
    const changed = host !== this.targetHost || port !== this.targetPort;
    this.discovered = true;
    this.targetHost = host;
    this.targetPort = port;

    if (changed) {
      // Neu verbinden auf das entdeckte Ziel.
      this.clearReconnect();
      this.teardownSocket();
      this.setConnected(false);
      this.openSocket();
    } else if (!this.connected && !this.connecting) {
      this.openSocket();
    }
    void this.discovered;
  }

  private stopDiscovery(): void {
    try {
      if (this.browser && typeof this.browser.stop === 'function') this.browser.stop();
    } catch {
      /* ignore */
    }
    try {
      if (this.bonjour && typeof this.bonjour.destroy === 'function') this.bonjour.destroy();
    } catch {
      /* ignore */
    }
    this.browser = null;
    this.bonjour = null;
  }
}

// --- Hilfsfunktionen --------------------------------------------------------

function clamp01(n: number): number {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// IPv4-Adresse aus einem mDNS-Service bevorzugen, sonst .host.
function pickAddress(svc: BonjourService): string | undefined {
  const addrs = Array.isArray(svc.addresses) ? svc.addresses : [];
  const ipv4 = addrs.find((a) => typeof a === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a));
  if (ipv4) return ipv4;
  const any = addrs.find((a) => typeof a === 'string' && a.length > 0);
  if (any) return any;
  return svc.host;
}

// bonjour-service exportiert je nach Version unterschiedlich:
//   - { Bonjour } (benannter Export)
//   - default export (Klasse)
//   - module.exports = Klasse
function resolveBonjourCtor(mod: unknown): (new () => BonjourInstance) | null {
  if (!mod) return null;
  const m = mod as Record<string, unknown>;
  const candidates = [m.Bonjour, m.default, mod];
  for (const c of candidates) {
    if (typeof c === 'function') return c as new () => BonjourInstance;
  }
  // default kann selbst wieder { Bonjour } enthalten
  const def = m.default as Record<string, unknown> | undefined;
  if (def && typeof def.Bonjour === 'function') return def.Bonjour as new () => BonjourInstance;
  return null;
}
