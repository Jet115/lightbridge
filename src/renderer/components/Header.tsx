// Kopfzeile: Verbindungsstatus (Pro DJ Link + OS2L), großer Master-BPM, Beat-Indikator.

import { DJState } from '../../shared/types';
import { Os2lStatus } from '../hooks';
import { BeatIndicator } from './BeatIndicator';
import { Dot } from './ui';

export function Header(props: {
  state: DJState | null;
  os2l: Os2lStatus;
  beatsPerBar: number;
}) {
  const { state, os2l } = props;
  const prolinkOn = !!state?.connected;
  const bpm = state?.masterBpm ?? 0;
  const bpmWhole = Math.floor(bpm);
  const bpmFrac = Math.abs(bpm - bpmWhole).toFixed(2).slice(1); // ".xx"

  return (
    <header className="appbar">
      <div className="appbar__brand">
        <span className="brand__mark" aria-hidden>
          <span className="brand__beam" />
        </span>
        <div className="brand__text">
          <span className="brand__name">LightBridge</span>
          <span className="brand__sub">Pro DJ Link → Wolfmix</span>
        </div>
      </div>

      <div className="appbar__status" role="group" aria-label="Verbindungen">
        <div className={`conn ${prolinkOn ? 'conn--on' : 'conn--off'}`}>
          <Dot on={prolinkOn} />
          <div className="conn__text">
            <span className="conn__label">Pro DJ Link</span>
            <span className="conn__value">
              {prolinkOn ? `verbunden · Master Deck ${state?.masterDeck ?? '–'}` : 'getrennt'}
            </span>
          </div>
        </div>
        <div className={`conn ${os2l.connected ? 'conn--on' : 'conn--off'}`}>
          <Dot on={os2l.connected} />
          <div className="conn__text">
            <span className="conn__label">OS2L</span>
            <span className="conn__value">{os2l.connected ? os2l.target || 'verbunden' : 'getrennt'}</span>
          </div>
        </div>
      </div>

      <div className="appbar__bpm" aria-label="Master BPM">
        <div className="bpm">
          <span className="bpm__value">{bpmWhole || '––'}</span>
          <span className="bpm__frac">{bpm ? bpmFrac : ''}</span>
          <span className="bpm__unit">BPM</span>
        </div>
        <BeatIndicator beatInBar={state?.beatInBar ?? 0} beatsPerBar={props.beatsPerBar} />
      </div>
    </header>
  );
}
