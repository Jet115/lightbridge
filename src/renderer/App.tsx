// LightBridge — Renderer-Haupt-App. Verdrahtet Views mit window.api (IpcApi).

import { useCallback, useState } from 'react';
import { AppConfig, ControlAction } from '../shared/types';
import { Decks } from './components/Decks';
import { FxControls } from './components/FxControls';
import { Header } from './components/Header';
import { LogPanel } from './components/LogPanel';
import { Settings } from './components/Settings';
import { UpdateBanner } from './components/UpdateBanner';
import {
  useApi,
  useConfig,
  useDjState,
  useHotkeys,
  useLog,
  useOs2lStatus,
  useTheme,
  useUpdate,
} from './hooks';

type Tab = 'live' | 'mapping' | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'log', label: 'Log' },
];

export default function App() {
  const api = useApi();
  const state = useDjState(api);
  const os2l = useOs2lStatus(api);
  const { config, save, reload, dirtySaving } = useConfig(api);
  const [lines, clearLog] = useLog(api);
  const [tab, setTab] = useState<Tab>('live');
  const update = useUpdate(api);

  useTheme(config?.ui.theme);

  const beatsPerBar = config?.fx.beatsPerBar ?? 4;

  // FX-Aktion absetzen; bei Regel-Toggles Config nachladen, damit Toggles folgen.
  const dispatch = useCallback(
    async (a: ControlAction) => {
      await api.action(a);
      if (a.action === 'rule') reload();
    },
    [api, reload],
  );

  const saveConfig = useCallback((cfg: AppConfig) => save(cfg), [save]);

  // Live-Hotkeys für schnelle Bedienung.
  useHotkeys({
    space: () => void dispatch({ action: 'tap' }),
    n: () => void dispatch({ action: 'next' }),
    d: () => void dispatch({ action: 'drop' }),
    b: () => void dispatch({ action: 'blackout' }),
    '1': () => setTab('live'),
    '2': () => setTab('mapping'),
    '3': () => setTab('log'),
  });

  return (
    <div className="app">
      <Header state={state} os2l={os2l} beatsPerBar={beatsPerBar} />

      <UpdateBanner status={update.status} onInstall={update.installNow} onCheck={update.check} />

      <nav className="tabs" role="tablist" aria-label="Ansichten">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={`tab ${tab === t.id ? 'tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="tabs__hint" aria-hidden>
          Space TAP · N Preset · D Drop · B Blackout
        </span>
      </nav>

      <main className="content">
        {tab === 'live' && (
          <div id="panel-live" role="tabpanel" aria-labelledby="tab-live" className="panel panel--live">
            <Decks decks={state?.decks ?? []} beatsPerBar={beatsPerBar} />
            {config ? (
              <FxControls fx={config.fx} dispatch={dispatch} />
            ) : (
              <p className="empty">Konfiguration wird geladen…</p>
            )}
          </div>
        )}

        {tab === 'mapping' && (
          <div id="panel-mapping" role="tabpanel" aria-labelledby="tab-mapping" className="panel">
            {config ? (
              <Settings config={config} api={api} saving={dirtySaving} onSave={saveConfig} />
            ) : (
              <p className="empty">Konfiguration wird geladen…</p>
            )}
          </div>
        )}

        {tab === 'log' && (
          <div id="panel-log" role="tabpanel" aria-labelledby="tab-log" className="panel">
            <LogPanel lines={lines} onClear={clearLog} />
          </div>
        )}
      </main>
    </div>
  );
}
