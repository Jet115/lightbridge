// Deck-Grid (1..4): Titel/Artist, BPM, Pitch, Playing/On-Air/Master-Badges, Beat, Artwork.

import { DeckState } from '../../shared/types';
import { BeatIndicator } from './BeatIndicator';
import { Badge } from './ui';

function pitchLabel(p: number): string {
  const sign = p > 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}%`;
}

function initials(track?: DeckState['track']): string {
  if (!track) return '—';
  const base = track.artist || track.title || '';
  return base.slice(0, 2).toUpperCase() || '—';
}

function DeckCard(props: { deck: DeckState; beatsPerBar: number }) {
  const d = props.deck;
  const hasTrack = !!d.track;
  const stateClass = d.isMaster ? 'deck--master' : d.playing ? 'deck--playing' : 'deck--idle';

  return (
    <article className={`deck ${stateClass}`} aria-label={`Deck ${d.deck}`}>
      <div className="deck__top">
        <span className="deck__num">DECK {d.deck}</span>
        <div className="deck__badges">
          {d.isMaster && <Badge tone="master">MASTER</Badge>}
          {d.onAir && <Badge tone="air">ON AIR</Badge>}
          <Badge tone={d.playing ? 'live' : 'off'}>{d.playing ? 'PLAY' : 'STOP'}</Badge>
        </div>
      </div>

      <div className="deck__body">
        <div className={`deck__art ${d.track?.artworkDataUri ? 'deck__art--img' : ''}`} aria-hidden>
          {d.track?.artworkDataUri ? (
            <img src={d.track.artworkDataUri} alt="" />
          ) : (
            <span className="deck__art-fallback">{initials(d.track)}</span>
          )}
        </div>
        <div className="deck__meta">
          <h3 className="deck__title" title={d.track?.title}>
            {d.track?.title ?? 'Kein Track'}
          </h3>
          <p className="deck__artist" title={d.track?.artist}>
            {d.track?.artist ?? (hasTrack ? '' : 'leer')}
          </p>
          {d.track?.key && (
            <p className="deck__tags">
              <span className="chip">{d.track.key}</span>
              {d.track.genre && <span className="chip chip--muted">{d.track.genre}</span>}
            </p>
          )}
        </div>
      </div>

      <div className="deck__foot">
        <div className="deck__stat">
          <span className="deck__stat-value">{d.bpm ? d.bpm.toFixed(1) : '––'}</span>
          <span className="deck__stat-label">BPM</span>
        </div>
        <div className="deck__stat">
          <span className={`deck__stat-value ${d.pitch !== 0 ? 'is-shift' : ''}`}>{pitchLabel(d.pitch)}</span>
          <span className="deck__stat-label">Pitch</span>
        </div>
        <BeatIndicator beatInBar={d.playing ? d.beatInBar : 0} beatsPerBar={props.beatsPerBar} size="sm" />
      </div>
    </article>
  );
}

export function Decks(props: { decks: DeckState[]; beatsPerBar: number }) {
  const decks = [...props.decks].sort((a, b) => a.deck - b.deck);
  return (
    <div className="decks" role="group" aria-label="Decks">
      {decks.length === 0 && <p className="empty">Keine Decks erkannt. Warte auf Pro DJ Link…</p>}
      {decks.map((d) => (
        <DeckCard key={d.deck} deck={d} beatsPerBar={props.beatsPerBar} />
      ))}
    </div>
  );
}
