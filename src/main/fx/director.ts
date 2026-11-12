// FXDirector — erzeugt aus DJ-Events (Pro DJ Link) die OS2L-Ausgabe für
// WTOOLS/Wolfmix. Reine Licht-Logik: Beat-Forwarding, Auto-FX-Regeln
// (Preset-Rotation, Color-Cycle), Drop-Strobe, Energie-Regel, Cue-Szenen und
// manuelle Steueraktionen.
//
// Grundregeln:
//  - Buttons werden IMMER als kurzer Puls gesendet (on, nach ~120 ms off).
//  - Der Beat-Strom wird 1:1 weitergereicht (mit Stärke-Muster), solange
//    forwardBeats aktiv ist.
//  - Auto-FX laufen nur, wenn Auto aktiv und kein Blackout.

import type { FXConfig, DJState, ControlAction, TrackInfo } from '../../shared/types';
import type { OS2LClient } from '../os2l/client';

const PULSE_MS = 120;

export class FXDirector {
  private fx: FXConfig;
  private os2l: OS2LClient;

  // --- Laufzeit-State ---
  private presetIndex = 0;
  private colorIndex = 0;
  private blackout = false;
  private auto = true;                 // Auto-FX aktiv (Master-Schalter)
  private strobeUntil: number | null = null; // Beat-Position, ab der Strobe endet

  private masterBpm = 0;
  private lastBeat = 0;                // zuletzt gesehene Beat-Position
  private lastBarId = -1;             // zur Flankenerkennung pro Takt
  private energyHigh: boolean | null = null; // zuletzt aktive Energiezone

  // Offene Pulse-Timer (name -> Timer), damit wir sauber aufräumen können.
  private pulseTimers = new Map<string, NodeJS.Timeout>();
  private strobeTimer: NodeJS.Timeout | null = null; // Fallback-Ende für Drop-Strobe

  constructor(fx: FXConfig, os2l: OS2LClient) {
    this.fx = fx;
    this.os2l = os2l;
  }

  // --- DJ-Events ------------------------------------------------------------

  /** Master-Beat verarbeiten: Beat weiterleiten + Auto-FX-Regeln auswerten. */
  onBeat(masterBpm: number, beat: number, beatInBar: number): void {
    this.masterBpm = Number(masterBpm) || this.masterBpm;
    this.lastBeat = Number(beat) || 0;

    // 1) Beat an WTOOLS weiterreichen (mit Stärke-Muster).
    if (this.fx.forwardBeats) {
      const strength = this.strengthFor(beatInBar);
      // "change" markiert den Taktbeginn (Downbeat).
      const change = beatInBar === 1;
      this.os2l.sendBeat(this.lastBeat, this.masterBpm, strength, change);
    }

    // 2) Drop-Strobe-Ende verwalten (beat-basiert).
    if (this.strobeUntil !== null && this.lastBeat >= this.strobeUntil) {
      this.endStrobe();
    }

    // 3) Auto-FX-Regeln nur bei aktivem Auto und ohne Blackout.
    if (!this.auto || this.blackout) return;

    const beatsPerBar = Math.max(1, this.fx.beatsPerBar || 4);
    const barId = Math.floor(this.lastBeat / beatsPerBar);
    if (barId === this.lastBarId) return; // selber Takt -> nichts tun
    const firstBar = this.lastBarId < 0;
    this.lastBarId = barId;
    if (firstBar || barId <= 0) return;   // ersten Takt nicht sofort pulsen

    // Preset-Rotation: alle everyBars -> nächstes Preset.
    const pr = this.fx.presetRotation;
    if (pr && pr.enabled && pr.buttons.length > 0) {
      const every = Math.max(1, pr.everyBars || 1);
      if (barId % every === 0) this.advancePreset();
    }

    // Color-Cycle: alle everyBars -> nächste Farbe.
    const cc = this.fx.colorCycle;
    if (cc && cc.enabled && cc.buttons.length > 0) {
      const every = Math.max(1, cc.everyBars || 1);
      if (barId % every === 0) this.advanceColor();
    }
  }

  /** Vollständiger DJ-Zustand: Energie-Regel + Master-BPM merken. */
  onState(state: DJState): void {
    if (!state) return;
    this.masterBpm = Number(state.masterBpm) || this.masterBpm;

    const e = this.fx.energy;
    if (!e || !e.enabled || this.blackout) return;

    const high = this.masterBpm > (e.bpmHigh || 0);
    // Nur beim Zonenwechsel pulsen, nicht bei jedem State-Update.
    if (high === this.energyHigh) return;
    this.energyHigh = high;
    const btn = high ? e.highButton : e.lowButton;
    if (btn) this.pulse(btn);
  }

  /** Track-Wechsel. Aktuell nur informativ (kein zwingender FX-Trigger). */
  onTrack(_info: { deck: number; track: TrackInfo }): void {
    // Platzhalter für zukünftige Logik (z.B. Genre-abhängige Szenen).
    void _info;
  }

  /** Cue/Hotcue ausgelöst -> gemappte Szene pulsen. */
  onCue(name: string): void {
    const cs = this.fx.cueScenes;
    if (!cs || !cs.enabled || !name) return;
    const btn = cs.map ? cs.map[name] : undefined;
    if (btn) this.pulse(btn);
  }

  // --- Steueraktionen -------------------------------------------------------

  action(a: ControlAction): void {
    if (!a) return;
    switch (a.action) {
      case 'tap':
        // Nur informativ (Tap-Tempo wird vom Ingest/Master geliefert).
        break;
      case 'next':
        this.advancePreset();
        break;
      case 'button':
        if (a.name) this.pulse(a.name);
        break;
      case 'drop':
        this.startStrobe();
        break;
      case 'blackout':
        this.toggleBlackout();
        break;
      case 'auto':
        this.auto = !this.auto;
        break;
      case 'rule':
        this.setRule(a.key, a.enabled);
        break;
      default:
        break;
    }
  }

  /** Konfiguration aktualisieren und Indizes/State konsistent halten. */
  updateConfig(fx: FXConfig): void {
    if (!fx) return;
    this.fx = fx;
    // Indizes in gültigen Bereich klemmen.
    const prLen = fx.presetRotation?.buttons?.length ?? 0;
    const ccLen = fx.colorCycle?.buttons?.length ?? 0;
    this.presetIndex = prLen > 0 ? this.presetIndex % prLen : 0;
    this.colorIndex = ccLen > 0 ? this.colorIndex % ccLen : 0;
    // Energiezone neu bewerten lassen.
    this.energyHigh = null;
  }

  /** Alle offenen Timer stoppen (z.B. vor dem Beenden). */
  dispose(): void {
    for (const t of this.pulseTimers.values()) clearTimeout(t);
    this.pulseTimers.clear();
    if (this.strobeTimer) {
      clearTimeout(this.strobeTimer);
      this.strobeTimer = null;
    }
  }

  // --- Interne Logik --------------------------------------------------------

  private strengthFor(beatInBar: number): number {
    const pattern = this.fx.strengthPattern;
    if (!Array.isArray(pattern) || pattern.length === 0) return 1;
    // beatInBar ist 1-basiert.
    const idx = ((Math.floor(beatInBar) - 1) % pattern.length + pattern.length) % pattern.length;
    const v = Number(pattern[idx]);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  private advancePreset(): void {
    const pr = this.fx.presetRotation;
    if (!pr || pr.buttons.length === 0) return;
    this.presetIndex = (this.presetIndex + 1) % pr.buttons.length;
    this.pulse(pr.buttons[this.presetIndex]);
  }

  private advanceColor(): void {
    const cc = this.fx.colorCycle;
    if (!cc || cc.buttons.length === 0) return;
    this.colorIndex = (this.colorIndex + 1) % cc.buttons.length;
    this.pulse(cc.buttons[this.colorIndex]);
  }

  private startStrobe(): void {
    const ds = this.fx.dropStrobe;
    if (!ds || !ds.button) return;
    const beats = Math.max(1, ds.beats || 1);
    // Strobe dauerhaft an, bis das Ende erreicht ist.
    this.os2l.sendBtn(ds.button, true);
    this.strobeUntil = this.lastBeat + beats;

    // Fallback-Timer, falls kein Beat-Strom ankommt (z.B. pausiert):
    // Dauer aus Master-BPM schätzen.
    if (this.strobeTimer) clearTimeout(this.strobeTimer);
    const bpm = this.masterBpm > 0 ? this.masterBpm : 128;
    const ms = Math.max(200, (beats * 60000) / bpm);
    this.strobeTimer = setTimeout(() => this.endStrobe(), ms);
    if (this.strobeTimer.unref) this.strobeTimer.unref();
  }

  private endStrobe(): void {
    const ds = this.fx.dropStrobe;
    this.strobeUntil = null;
    if (this.strobeTimer) {
      clearTimeout(this.strobeTimer);
      this.strobeTimer = null;
    }
    if (ds && ds.button) this.os2l.sendBtn(ds.button, false);
  }

  private toggleBlackout(): void {
    this.blackout = !this.blackout;
    // WTOOLS-Blackout-Button toggelt serverseitig -> kurzer Puls genügt.
    if (this.fx.blackoutButton) this.pulse(this.fx.blackoutButton);
    // Beim Aktivieren laufende Effekte beenden.
    if (this.blackout) this.endStrobe();
  }

  private setRule(key: 'forwardBeats' | 'presetRotation' | 'colorCycle', enabled: boolean): void {
    switch (key) {
      case 'forwardBeats':
        this.fx.forwardBeats = enabled;
        break;
      case 'presetRotation':
        if (this.fx.presetRotation) this.fx.presetRotation.enabled = enabled;
        break;
      case 'colorCycle':
        if (this.fx.colorCycle) this.fx.colorCycle.enabled = enabled;
        break;
      default:
        break;
    }
  }

  /** Button als kurzer Puls senden: on, nach ~120 ms off. */
  private pulse(name: string): void {
    if (!name) return;
    // Laufenden Puls für denselben Button zurücksetzen.
    const existing = this.pulseTimers.get(name);
    if (existing) clearTimeout(existing);

    this.os2l.sendBtn(name, true);
    const t = setTimeout(() => {
      this.pulseTimers.delete(name);
      this.os2l.sendBtn(name, false);
    }, PULSE_MS);
    if (t.unref) t.unref();
    this.pulseTimers.set(name, t);
  }
}
