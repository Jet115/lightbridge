// ConfigStore — lädt/speichert AppConfig persistent (electron-store) und merged mit DEFAULT_CONFIG.
// electron-store legt die Datei unter app.getPath('userData')/<name>.json ab (plattformübergreifend).
import Store from 'electron-store';
import { AppConfig, DEFAULT_CONFIG } from '../shared/types';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Tiefes Mergen: verschachtelte Objekte werden rekursiv zusammengeführt,
 * Arrays (z.B. strengthPattern, buttons) werden bewusst komplett ersetzt,
 * `undefined`-Werte im Patch überschreiben nicht.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T));
  }
  const out: PlainObject = { ...(base as PlainObject) };
  for (const key of Object.keys(patch)) {
    const patchValue = (patch as PlainObject)[key];
    if (patchValue === undefined) continue;
    const baseValue = (base as PlainObject)[key];
    out[key] =
      isPlainObject(baseValue) && isPlainObject(patchValue)
        ? deepMerge(baseValue, patchValue)
        : patchValue;
  }
  return out as T;
}

interface Schema {
  config: AppConfig;
}

export class ConfigStore {
  private readonly store: Store<Schema>;

  constructor() {
    this.store = new Store<Schema>({
      name: 'lightbridge-config',
      defaults: { config: DEFAULT_CONFIG },
    });
  }

  /** Vollständige, mit DEFAULT_CONFIG aufgefüllte Konfiguration. */
  get(): AppConfig {
    const stored = this.store.get('config');
    return deepMerge(DEFAULT_CONFIG, stored);
  }

  /** Partielles Update tief einmergen, persistieren und das neue Vollobjekt zurückgeben. */
  set(partial: Partial<AppConfig>): AppConfig {
    const merged = deepMerge(this.get(), partial);
    this.store.set('config', merged);
    return merged;
  }

  /** Auf Werkseinstellungen zurücksetzen. */
  reset(): AppConfig {
    this.store.set('config', DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  /** Pfad der JSON-Datei (nützlich für Logs/Debug). */
  get path(): string {
    return this.store.path;
  }
}
