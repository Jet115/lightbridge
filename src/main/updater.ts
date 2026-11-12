// Auto-Updater (electron-updater): prüft beim Start + periodisch, lädt neue Versionen
// im Hintergrund und meldet den Status an den Renderer. Nur im gepackten Build sinnvoll
// (braucht den publish-Feed aus electron-builder.yml, z. B. GitHub Releases).
import pkg from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';

import type { UpdateStatus } from '../shared/types';

const { autoUpdater } = pkg;

export class Updater {
  private status: UpdateStatus = { state: 'idle' };
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly send: (s: UpdateStatus) => void,
    private readonly log: (line: string) => void,
  ) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-available', (i: UpdateInfo) =>
      this.set({ state: 'available', version: i.version }),
    );
    autoUpdater.on('update-not-available', () => this.set({ state: 'none' }));
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      this.set({ state: 'downloading', percent: Math.round(p.percent) }),
    );
    autoUpdater.on('update-downloaded', (i: UpdateInfo) =>
      this.set({ state: 'downloaded', version: i.version }),
    );
    autoUpdater.on('error', (e: Error) =>
      this.set({ state: 'error', message: e?.message ?? String(e) }),
    );
  }

  private set(s: UpdateStatus): void {
    this.status = s;
    this.log(`Update: ${JSON.stringify(s)}`);
    this.send(s);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  check(): void {
    autoUpdater
      .checkForUpdates()
      .catch((e: unknown) =>
        this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
  }

  installNow(): void {
    try {
      autoUpdater.quitAndInstall();
    } catch (e) {
      this.set({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  start(intervalMs = 6 * 60 * 60 * 1000): void {
    this.check();
    this.timer = setInterval(() => this.check(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
