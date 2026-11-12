// FX-Steuerung: Preset-/Farb-Buttons, DROP/Strobe, Blackout, Nächstes Preset,
// sowie Toggles (Auto-FX, Preset-Rotation, Farbwechsel, Beat-Sync) via action-rule.

import React, { useEffect, useState } from 'react';
import { ControlAction, FXConfig } from '../../shared/types';
import { Section, Toggle } from './ui';

// Heuristik: Farb-Buttonname -> CSS-Farbe für den Swatch.
const COLOR_HINT: Record<string, string> = {
  red: '#ff5a5f',
  blue: '#4aa3ff',
  green: '#48d597',
  magenta: '#e86bff',
  pink: '#ff7ab6',
  cyan: '#38e1e1',
  yellow: '#ffd24a',
  orange: '#ffa24a',
  white: '#f2f4f8',
  purple: '#9b6bff',
  amber: '#ffbf4a',
};

function colorFor(name: string): string | undefined {
  const key = name.toLowerCase().replace(/^color[_-]?/, '');
  return COLOR_HINT[key];
}

function prettify(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\bfx\b/i, 'FX').toUpperCase();
}

export function FxControls(props: {
  fx: FXConfig;
  dispatch: (a: ControlAction) => void | Promise<void>;
}) {
  const { fx, dispatch } = props;

  // Auto-FX ist eine reine Laufzeit-Umschaltung (nicht in AppConfig) -> lokal halten.
  const [autoFx, setAutoFx] = useState(true);
  // Letzter ausgelöster Button für kurzes visuelles Feedback.
  const [pulse, setPulse] = useState<string | null>(null);

  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 320);
    return () => clearTimeout(t);
  }, [pulse]);

  function fire(a: ControlAction, pulseKey?: string) {
    if (pulseKey) setPulse(pulseKey);
    void dispatch(a);
  }

  return (
    <div className="fx">
      <Section
        title="Trigger"
        subtitle="Sofortige Aktionen für den Wolfmix"
        actions={
          <button className="btn btn--ghost" onClick={() => fire({ action: 'tap' }, 'tap')}>
            TAP
          </button>
        }
      >
        <div className="fx__macros">
          <button
            className={`btn btn--drop ${pulse === 'drop' ? 'is-pulse' : ''}`}
            onClick={() => fire({ action: 'drop' }, 'drop')}
            title={`Strobe-Build über ${fx.dropStrobe.beats} Beats`}
          >
            <span className="btn__big">DROP</span>
            <span className="btn__sub">Strobe · {fx.dropStrobe.beats} beats</span>
          </button>
          <button
            className={`btn btn--next ${pulse === 'next' ? 'is-pulse' : ''}`}
            onClick={() => fire({ action: 'next' }, 'next')}
          >
            <span className="btn__big">Nächstes Preset</span>
            <span className="btn__sub">Rotation vorspulen</span>
          </button>
          <button
            className={`btn btn--blackout ${pulse === 'blackout' ? 'is-pulse' : ''}`}
            onClick={() => fire({ action: 'blackout' }, 'blackout')}
          >
            <span className="btn__big">BLACKOUT</span>
            <span className="btn__sub">{fx.blackoutButton}</span>
          </button>
        </div>
      </Section>

      <Section title="Presets" subtitle={`Rotation alle ${fx.presetRotation.everyBars} Takte`}>
        <div className="fx__grid">
          {fx.presetRotation.buttons.length === 0 && <p className="empty">Keine Presets gemappt.</p>}
          {fx.presetRotation.buttons.map((name) => (
            <button
              key={name}
              className={`btn btn--preset ${pulse === `p:${name}` ? 'is-pulse' : ''}`}
              onClick={() => fire({ action: 'button', name }, `p:${name}`)}
            >
              {prettify(name)}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Farben" subtitle={`Wechsel alle ${fx.colorCycle.everyBars} Takte`}>
        <div className="fx__grid fx__grid--colors">
          {fx.colorCycle.buttons.length === 0 && <p className="empty">Keine Farben gemappt.</p>}
          {fx.colorCycle.buttons.map((name) => {
            const c = colorFor(name);
            return (
              <button
                key={name}
                className={`btn btn--color ${pulse === `c:${name}` ? 'is-pulse' : ''}`}
                style={c ? ({ ['--swatch' as string]: c } as React.CSSProperties) : undefined}
                onClick={() => fire({ action: 'button', name }, `c:${name}`)}
              >
                <span className="swatch" aria-hidden />
                <span>{prettify(name).replace(/^COLOR /, '')}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Automatik" subtitle="Beat-synchrone Steuerung">
        <div className="fx__toggles">
          <Toggle
            label="Auto-FX"
            hint="FX-Director steuert automatisch"
            checked={autoFx}
            onChange={(v) => {
              setAutoFx(v);
              fire({ action: 'auto' });
            }}
          />
          <Toggle
            label="Preset-Rotation"
            hint={`alle ${fx.presetRotation.everyBars} Takte`}
            checked={fx.presetRotation.enabled}
            onChange={(v) => fire({ action: 'rule', key: 'presetRotation', enabled: v })}
          />
          <Toggle
            label="Farbwechsel"
            hint={`alle ${fx.colorCycle.everyBars} Takte`}
            checked={fx.colorCycle.enabled}
            onChange={(v) => fire({ action: 'rule', key: 'colorCycle', enabled: v })}
          />
          <Toggle
            label="Beat-Sync"
            hint="Beats an OS2L weiterleiten"
            checked={fx.forwardBeats}
            onChange={(v) => fire({ action: 'rule', key: 'forwardBeats', enabled: v })}
          />
        </div>
      </Section>
    </div>
  );
}
