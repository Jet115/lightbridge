// Preload — stellt window.api (IpcApi) über contextBridge bereit (contextIsolation=true).
// invoke() für Request/Response, on() für Push-Events (state/os2l/log); die onX-Methoden
// liefern eine Unsubscribe-Funktion zurück.
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type {
  AppConfig,
  ControlAction,
  DJState,
  IpcApi,
  UpdateStatus,
} from '../shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_evt: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: IpcApi = {
  getState: () => ipcRenderer.invoke('getState'),
  getConfig: () => ipcRenderer.invoke('getConfig'),
  setConfig: (cfg: Partial<AppConfig>) => ipcRenderer.invoke('setConfig', cfg),
  action: (a: ControlAction) => ipcRenderer.invoke('action', a),
  os2lStatus: () => ipcRenderer.invoke('os2lStatus'),
  listInterfaces: () => ipcRenderer.invoke('listInterfaces'),
  onState: (cb: (s: DJState) => void) => subscribe('state', cb),
  onOs2l: (cb: (s: { connected: boolean; target: string }) => void) =>
    subscribe('os2l', cb),
  onLog: (cb: (line: string) => void) => subscribe('log', cb),
  checkForUpdates: () => ipcRenderer.invoke('checkForUpdates'),
  installUpdateNow: () => ipcRenderer.invoke('installUpdateNow'),
  getUpdateStatus: () => ipcRenderer.invoke('getUpdateStatus'),
  onUpdate: (cb: (s: UpdateStatus) => void) => subscribe('update', cb),
};

contextBridge.exposeInMainWorld('api', api);
