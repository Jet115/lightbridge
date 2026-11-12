// Schlanke Statusleiste für den Auto-Updater.
// Zeigt sich nur, wenn es etwas zu melden gibt (verfügbar / lädt / bereit / Fehler),
// und blendet sich im Ruhezustand komplett aus.

import { UpdateStatus } from '../../shared/types';

interface Props {
  status: UpdateStatus;
  onInstall: () => void;
  onCheck: () => void;
}

export function UpdateBanner({ status, onInstall, onCheck }: Props) {
  // Ruhezustände: nichts anzeigen (hält die UI aufgeräumt).
  if (status.state === 'idle' || status.state === 'checking' || status.state === 'none') {
    return null;
  }

  if (status.state === 'available') {
    return (
      <div className="update-banner" role="status">
        <span className="update-banner__dot" aria-hidden />
        <span className="update-banner__text">
          Update {status.version} verfügbar — wird im Hintergrund geladen …
        </span>
      </div>
    );
  }

  if (status.state === 'downloading') {
    return (
      <div className="update-banner" role="status">
        <span className="update-banner__dot" aria-hidden />
        <span className="update-banner__text">Update wird geladen … {status.percent}%</span>
        <span className="update-banner__bar" aria-hidden>
          <span className="update-banner__bar-fill" style={{ width: `${status.percent}%` }} />
        </span>
      </div>
    );
  }

  if (status.state === 'downloaded') {
    return (
      <div className="update-banner update-banner--ready" role="status">
        <span className="update-banner__dot" aria-hidden />
        <span className="update-banner__text">
          Update {status.version} bereit — zum Abschließen neu starten.
        </span>
        <button type="button" className="update-banner__btn" onClick={onInstall}>
          Neu starten &amp; installieren
        </button>
      </div>
    );
  }

  // error
  return (
    <div className="update-banner update-banner--error" role="alert">
      <span className="update-banner__dot" aria-hidden />
      <span className="update-banner__text">Update-Fehler: {status.message}</span>
      <button type="button" className="update-banner__btn" onClick={onCheck}>
        Erneut prüfen
      </button>
    </div>
  );
}
