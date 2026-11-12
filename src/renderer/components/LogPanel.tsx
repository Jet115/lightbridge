// Log-Panel: Live-Zeilen aus onLog, mit Auto-Scroll und Filter.

import { useEffect, useMemo, useRef, useState } from 'react';

export function LogPanel(props: { lines: string[]; onClear: () => void }) {
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const shown = useMemo(() => {
    if (!filter.trim()) return props.lines;
    const f = filter.toLowerCase();
    return props.lines.filter((l) => l.toLowerCase().includes(f));
  }, [props.lines, filter]);

  useEffect(() => {
    if (autoScroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [shown, autoScroll]);

  return (
    <div className="logpanel">
      <div className="logpanel__bar">
        <input
          className="logpanel__filter"
          type="search"
          placeholder="Log filtern…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Log filtern"
        />
        <label className="logpanel__auto">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-Scroll
        </label>
        <span className="logpanel__count">{shown.length} Zeilen</span>
        <button type="button" className="btn btn--ghost" onClick={props.onClear}>
          Leeren
        </button>
      </div>
      <div className="logpanel__box" ref={boxRef} role="log" aria-live="polite" aria-label="Ereignis-Log">
        {shown.length === 0 ? (
          <p className="empty">Noch keine Log-Einträge.</p>
        ) : (
          shown.map((line, i) => (
            <div className="logpanel__line" key={i}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
