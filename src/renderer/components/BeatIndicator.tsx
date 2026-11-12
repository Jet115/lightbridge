// Beat-Indikator: vier Punkte (1..4), der aktuelle pulsiert.

export function BeatIndicator(props: { beatInBar: number; beatsPerBar?: number; size?: 'lg' | 'sm' }) {
  const n = props.beatsPerBar ?? 4;
  const size = props.size ?? 'lg';
  const dots = [];
  for (let i = 1; i <= n; i++) {
    const active = i === props.beatInBar;
    const downbeat = i === 1;
    dots.push(
      <span
        key={i}
        className={`beat ${active ? 'beat--active' : ''} ${downbeat ? 'beat--down' : ''}`}
        aria-label={active ? `Beat ${i} von ${n}` : undefined}
      >
        {i}
      </span>,
    );
  }
  return (
    <div className={`beatrow beatrow--${size}`} role="group" aria-label="Beat-Indikator">
      {dots}
    </div>
  );
}
