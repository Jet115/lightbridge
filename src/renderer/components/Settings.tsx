// Mapping/Settings-Editor für AppConfig: FXConfig, OS2L, Pro DJ Link, Theme.
// Arbeitet auf einem lokalen Entwurf; "Speichern" ruft setConfig(draft).

import { useEffect, useMemo, useState } from 'react';
import { AppConfig, IpcApi } from '../../shared/types';
import { Field, Section, Toggle } from './ui';

type Iface = { name: string; address: string };

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function listToText(list: string[]): string {
  return list.join(', ');
}
function textToList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
function numbersToText(list: number[]): string {
  return list.join(', ');
}
function textToNumbers(text: string): number[] {
  return text
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

export function Settings(props: {
  config: AppConfig;
  api: IpcApi;
  saving: boolean;
  onSave: (cfg: AppConfig) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<AppConfig>(() => clone(props.config));
  const [interfaces, setInterfaces] = useState<Iface[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Externe Config-Änderungen übernehmen (z.B. Toggle aus der FX-View).
  useEffect(() => {
    setDraft(clone(props.config));
  }, [props.config]);

  useEffect(() => {
    let active = true;
    props.api.listInterfaces().then((list) => {
      if (active) setInterfaces(list);
    });
    return () => {
      active = false;
    };
  }, [props.api]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(props.config),
    [draft, props.config],
  );

  // Generischer, typsicherer Patcher für verschachtelte Teilbäume.
  function patch(fn: (d: AppConfig) => void) {
    setDraft((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
  }

  const cueRows = Object.entries(draft.fx.cueScenes.map);

  async function save() {
    await props.onSave(clone(draft));
    setSavedAt(Date.now());
  }

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Section title="Darstellung" subtitle="Theme der Oberfläche">
        <div className="grid grid--2">
          <Field label="Theme" htmlFor="set-theme">
            <select
              id="set-theme"
              value={draft.ui.theme}
              onChange={(e) => patch((d) => (d.ui.theme = e.target.value as AppConfig['ui']['theme']))}
            >
              <option value="system">System (automatisch)</option>
              <option value="dark">Dunkel</option>
              <option value="light">Hell</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Pro DJ Link" subtitle="Netzwerk-Interface zum XDJ-AZ">
        <div className="grid grid--2">
          <Field label="Interface" hint="Netzwerkschnittstelle im DJ-LAN" htmlFor="set-iface">
            <select
              id="set-iface"
              value={draft.prolink.interface ?? ''}
              onChange={(e) => patch((d) => (d.prolink.interface = e.target.value || undefined))}
            >
              <option value="">Automatisch</option>
              {draft.prolink.interface &&
                !interfaces.some((i) => i.name === draft.prolink.interface) && (
                  <option value={draft.prolink.interface}>{draft.prolink.interface} (gespeichert)</option>
                )}
              {interfaces.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name} — {i.address}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Virtual CDJ" hint="Als Virtual CDJ beitreten (empfohlen)">
            <Toggle
              label="Virtual CDJ aktiv"
              checked={draft.prolink.useVirtualCdj}
              onChange={(v) => patch((d) => (d.prolink.useVirtualCdj = v))}
            />
          </Field>
        </div>
      </Section>

      <Section title="OS2L → WTOOLS" subtitle="Verbindung zum Wolfmix">
        <div className="grid grid--3">
          <Field label="Host" htmlFor="set-host">
            <input
              id="set-host"
              type="text"
              value={draft.os2l.host}
              onChange={(e) => patch((d) => (d.os2l.host = e.target.value))}
              placeholder="127.0.0.1"
            />
          </Field>
          <Field label="Port" htmlFor="set-port">
            <input
              id="set-port"
              type="number"
              min={1}
              max={65535}
              value={draft.os2l.port}
              onChange={(e) => patch((d) => (d.os2l.port = Number(e.target.value)))}
            />
          </Field>
          <Field label="Reconnect (ms)" htmlFor="set-reconnect">
            <input
              id="set-reconnect"
              type="number"
              min={250}
              step={250}
              value={draft.os2l.reconnectMs}
              onChange={(e) => patch((d) => (d.os2l.reconnectMs = Number(e.target.value)))}
            />
          </Field>
        </div>
        <Toggle
          label="OS2L-Discovery"
          hint="WTOOLS automatisch im Netzwerk finden"
          checked={draft.os2l.discover}
          onChange={(v) => patch((d) => (d.os2l.discover = v))}
        />
      </Section>

      <Section title="FX — Grundlagen">
        <div className="grid grid--3">
          <Field label="Beats pro Takt" htmlFor="set-bpb">
            <input
              id="set-bpb"
              type="number"
              min={1}
              max={16}
              value={draft.fx.beatsPerBar}
              onChange={(e) => patch((d) => (d.fx.beatsPerBar = Number(e.target.value)))}
            />
          </Field>
          <Field label="Blackout-Button" htmlFor="set-blackout">
            <input
              id="set-blackout"
              type="text"
              value={draft.fx.blackoutButton}
              onChange={(e) => patch((d) => (d.fx.blackoutButton = e.target.value))}
            />
          </Field>
          <Field label="Beat-Stärke-Muster" hint="Kommagetrennt, z.B. 1, 0.4, 0.7, 0.4" htmlFor="set-strength">
            <input
              id="set-strength"
              type="text"
              defaultValue={numbersToText(draft.fx.strengthPattern)}
              onBlur={(e) => patch((d) => (d.fx.strengthPattern = textToNumbers(e.target.value)))}
            />
          </Field>
        </div>
        <Toggle
          label="Beat-Sync (forwardBeats)"
          hint="Beats an OS2L weiterleiten"
          checked={draft.fx.forwardBeats}
          onChange={(v) => patch((d) => (d.fx.forwardBeats = v))}
        />
      </Section>

      <Section title="FX — Preset-Rotation">
        <div className="grid grid--2">
          <Field label="Buttons" hint="Kommagetrennte OS2L-Button-Namen" htmlFor="set-preset-btns">
            <input
              id="set-preset-btns"
              type="text"
              defaultValue={listToText(draft.fx.presetRotation.buttons)}
              key={`preset-${JSON.stringify(props.config.fx.presetRotation.buttons)}`}
              onBlur={(e) => patch((d) => (d.fx.presetRotation.buttons = textToList(e.target.value)))}
            />
          </Field>
          <Field label="Alle N Takte" htmlFor="set-preset-every">
            <input
              id="set-preset-every"
              type="number"
              min={1}
              value={draft.fx.presetRotation.everyBars}
              onChange={(e) => patch((d) => (d.fx.presetRotation.everyBars = Number(e.target.value)))}
            />
          </Field>
        </div>
        <Toggle
          label="Rotation aktiv"
          checked={draft.fx.presetRotation.enabled}
          onChange={(v) => patch((d) => (d.fx.presetRotation.enabled = v))}
        />
      </Section>

      <Section title="FX — Farbwechsel">
        <div className="grid grid--2">
          <Field label="Buttons" hint="Kommagetrennte OS2L-Button-Namen" htmlFor="set-color-btns">
            <input
              id="set-color-btns"
              type="text"
              defaultValue={listToText(draft.fx.colorCycle.buttons)}
              key={`color-${JSON.stringify(props.config.fx.colorCycle.buttons)}`}
              onBlur={(e) => patch((d) => (d.fx.colorCycle.buttons = textToList(e.target.value)))}
            />
          </Field>
          <Field label="Alle N Takte" htmlFor="set-color-every">
            <input
              id="set-color-every"
              type="number"
              min={1}
              value={draft.fx.colorCycle.everyBars}
              onChange={(e) => patch((d) => (d.fx.colorCycle.everyBars = Number(e.target.value)))}
            />
          </Field>
        </div>
        <Toggle
          label="Farbwechsel aktiv"
          checked={draft.fx.colorCycle.enabled}
          onChange={(v) => patch((d) => (d.fx.colorCycle.enabled = v))}
        />
      </Section>

      <Section title="FX — Drop / Strobe">
        <div className="grid grid--2">
          <Field label="Strobe-Button" htmlFor="set-drop-btn">
            <input
              id="set-drop-btn"
              type="text"
              value={draft.fx.dropStrobe.button}
              onChange={(e) => patch((d) => (d.fx.dropStrobe.button = e.target.value))}
            />
          </Field>
          <Field label="Dauer (Beats)" htmlFor="set-drop-beats">
            <input
              id="set-drop-beats"
              type="number"
              min={1}
              value={draft.fx.dropStrobe.beats}
              onChange={(e) => patch((d) => (d.fx.dropStrobe.beats = Number(e.target.value)))}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="FX — Cue-Szenen"
        subtitle="Hotcue-/Memory-Name → OS2L-Button"
        actions={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              patch((d) => {
                let base = 'cue';
                let n = 1;
                while (d.fx.cueScenes.map[`${base}${n}`] !== undefined) n += 1;
                d.fx.cueScenes.map[`${base}${n}`] = '';
              })
            }
          >
            + Zeile
          </button>
        }
      >
        <Toggle
          label="Cue-Szenen aktiv"
          checked={draft.fx.cueScenes.enabled}
          onChange={(v) => patch((d) => (d.fx.cueScenes.enabled = v))}
        />
        <div className="maprows">
          {cueRows.length === 0 && <p className="empty">Keine Zuordnungen. Füge eine Zeile hinzu.</p>}
          {cueRows.map(([cue, btn], idx) => (
            <div className="maprow" key={idx}>
              <input
                type="text"
                aria-label="Cue-Name"
                placeholder="Hotcue-/Memory-Name"
                defaultValue={cue}
                key={`k-${idx}-${cue}`}
                onBlur={(e) =>
                  patch((d) => {
                    const val = d.fx.cueScenes.map[cue];
                    const newKey = e.target.value.trim();
                    if (newKey === cue) return;
                    delete d.fx.cueScenes.map[cue];
                    if (newKey) d.fx.cueScenes.map[newKey] = val ?? '';
                  })
                }
              />
              <span className="maprow__arrow" aria-hidden>
                →
              </span>
              <input
                type="text"
                aria-label="OS2L-Button"
                placeholder="OS2L-Button"
                value={btn}
                onChange={(e) => patch((d) => (d.fx.cueScenes.map[cue] = e.target.value))}
              />
              <button
                type="button"
                className="btn btn--icon"
                aria-label={`Zeile ${cue} entfernen`}
                onClick={() => patch((d) => delete d.fx.cueScenes.map[cue])}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="FX — Energie (optional)" subtitle="BPM-abhängige Umschaltung">
        <div className="grid grid--3">
          <Field label="Low-Button" htmlFor="set-energy-low">
            <input
              id="set-energy-low"
              type="text"
              value={draft.fx.energy.lowButton ?? ''}
              onChange={(e) => patch((d) => (d.fx.energy.lowButton = e.target.value || undefined))}
            />
          </Field>
          <Field label="High-Button" htmlFor="set-energy-high">
            <input
              id="set-energy-high"
              type="text"
              value={draft.fx.energy.highButton ?? ''}
              onChange={(e) => patch((d) => (d.fx.energy.highButton = e.target.value || undefined))}
            />
          </Field>
          <Field label="BPM-Schwelle" htmlFor="set-energy-bpm">
            <input
              id="set-energy-bpm"
              type="number"
              min={60}
              max={300}
              value={draft.fx.energy.bpmHigh}
              onChange={(e) => patch((d) => (d.fx.energy.bpmHigh = Number(e.target.value)))}
            />
          </Field>
        </div>
        <Toggle
          label="Energie-Logik aktiv"
          checked={draft.fx.energy.enabled}
          onChange={(v) => patch((d) => (d.fx.energy.enabled = v))}
        />
      </Section>

      <Section
        title="Updates"
        subtitle="LightBridge aktualisiert sich automatisch; hier manuell prüfen"
        actions={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void props.api.checkForUpdates()}
          >
            Nach Updates suchen
          </button>
        }
      >
        <p className="empty">
          Neue Versionen werden im Hintergrund geladen. Sobald eine bereitsteht, erscheint oben
          ein Hinweis zum Neustart.
        </p>
      </Section>

      <div className="settings__bar">
        <div className="settings__status" aria-live="polite">
          {props.saving
            ? 'Speichere…'
            : dirty
              ? 'Nicht gespeicherte Änderungen'
              : savedAt
                ? 'Gespeichert ✓'
                : 'Keine Änderungen'}
        </div>
        <div className="settings__buttons">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!dirty || props.saving}
            onClick={() => setDraft(clone(props.config))}
          >
            Zurücksetzen
          </button>
          <button type="submit" className="btn btn--primary" disabled={!dirty || props.saving}>
            Speichern
          </button>
        </div>
      </div>
    </form>
  );
}
