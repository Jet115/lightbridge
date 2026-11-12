// React-Hooks rund um window.api (Live-Abos + sauberes Cleanup).

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppConfig, DJState, IpcApi, UpdateStatus } from '../shared/types';
import { getApi } from './mockApi';

// Eine stabile API-Instanz pro App-Lauf (Mock darf nicht mehrfach Timer starten).
let apiSingleton: IpcApi | null = null;
export function useApi(): IpcApi {
  if (!apiSingleton) apiSingleton = getApi();
  return apiSingleton;
}

// Abonniert den Live-DJState; initialer Snapshot via getState().
export function useDjState(api: IpcApi): DJState | null {
  const [state, setState] = useState<DJState | null>(null);

  useEffect(() => {
    let active = true;
    api.getState().then((s) => {
      if (active) setState(s);
    });
    const off = api.onState((s) => setState(s));
    return () => {
      active = false;
      off();
    };
  }, [api]);

  return state;
}

export interface Os2lStatus {
  connected: boolean;
  target: string;
}

export function useOs2lStatus(api: IpcApi): Os2lStatus {
  const [status, setStatus] = useState<Os2lStatus>({ connected: false, target: '' });

  useEffect(() => {
    let active = true;
    api.os2lStatus().then((s) => {
      if (active) setStatus(s);
    });
    const off = api.onOs2l((s) => setStatus(s));
    return () => {
      active = false;
      off();
    };
  }, [api]);

  return status;
}

// Ringpuffer für Log-Zeilen.
export function useLog(api: IpcApi, max = 500): [string[], () => void] {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const off = api.onLog((line) => {
      setLines((prev) => {
        const next = prev.length >= max ? prev.slice(prev.length - max + 1) : prev.slice();
        next.push(line);
        return next;
      });
    });
    return () => off();
  }, [api, max]);

  const clear = useCallback(() => setLines([]), []);
  return [lines, clear];
}

export function useConfig(api: IpcApi): {
  config: AppConfig | null;
  save: (cfg: Partial<AppConfig>) => Promise<void>;
  reload: () => void;
  dirtySaving: boolean;
} {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [dirtySaving, setDirtySaving] = useState(false);

  const reload = useCallback(() => {
    api.getConfig().then(setConfig);
  }, [api]);

  useEffect(() => {
    let active = true;
    api.getConfig().then((c) => {
      if (active) setConfig(c);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const save = useCallback(
    async (cfg: Partial<AppConfig>) => {
      setDirtySaving(true);
      try {
        const updated = await api.setConfig(cfg);
        setConfig(updated);
      } finally {
        setDirtySaving(false);
      }
    },
    [api],
  );

  return { config, save, reload, dirtySaving };
}

// Auto-Update-Status abonnieren + Aktionen (Prüfen / Jetzt installieren).
export function useUpdate(api: IpcApi): {
  status: UpdateStatus;
  check: () => void;
  installNow: () => void;
} {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });

  useEffect(() => {
    let active = true;
    api.getUpdateStatus().then((s) => {
      if (active) setStatus(s);
    });
    const off = api.onUpdate((s) => setStatus(s));
    return () => {
      active = false;
      off();
    };
  }, [api]);

  const check = useCallback(() => void api.checkForUpdates(), [api]);
  const installNow = useCallback(() => void api.installUpdateNow(), [api]);

  return { status, check, installNow };
}

// Wendet das gewünschte Theme auf <html data-theme> an.
export function useTheme(theme: AppConfig['ui']['theme'] | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (!theme || theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);
}

// Globale Tastenkürzel; ignoriert Eingaben in Formularfeldern.
export function useHotkeys(map: Record<string, () => void>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        return;
      }
      const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
