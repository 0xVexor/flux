import { FolderDown, TriangleAlert, X } from 'lucide-react';
import type { ManagerAPI } from '../../application/contracts';
import type { Snapshot } from '../../domain/model';
import { useDismissed } from './dismissed';

/** Main-page status for automatic saving, next to the capture status. */
export function SaveSetup({
  snapshot,
  manager,
  run,
}: {
  snapshot: Snapshot;
  manager: ManagerAPI;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const settings = snapshot.settings;
  const [hidden, dismiss] = useDismissed('saving');
  // Flux writes files itself; without a chosen folder, finished downloads wait for one.
  const blocked = settings.autoSave && !snapshot.destination;
  const needsAccess =
    settings.autoSave && !!snapshot.destination && snapshot.destination.authorized === false;
  if (needsAccess)
    return (
      <section className="ds-alert is-warning is-spaced" aria-label="Automatic saving">
        <TriangleAlert size={16} aria-hidden="true" />
        <div className="ds-alert-body">
          <strong>Allow Flux to write to {snapshot.destination!.name}</strong>
          <p>
            Chrome asks again for folder access after the browser restarts. Allow it once and
            waiting files are saved automatically.
          </p>
        </div>
        <div className="ds-alert-actions">
          <button
            className="ds-btn is-outline is-small"
            onClick={() => run(() => manager.restoreFolderAccess())}
          >
            Allow folder access
          </button>
          <button
            className="ds-btn is-outline is-small"
            onClick={() => run(() => manager.chooseDownloadFolder())}
          >
            Choose another folder
          </button>
        </div>
      </section>
    );
  if (hidden && !needsAccess) return null;
  if (!settings.autoSave)
    return (
      <section className="ds-alert is-spaced" aria-label="Automatic saving">
        <FolderDown size={16} aria-hidden="true" />
        <div className="ds-alert-body">
          <strong>Automatic saving is off</strong>
          <p>Finished downloads wait until you press Save file.</p>
        </div>
        <div className="ds-alert-actions">
          <button
            className="ds-btn is-outline is-small"
            onClick={() => run(() => manager.setAutoSave(true))}
          >
            Turn on automatic saving
          </button>
          <button
            className="ds-icon-btn is-small"
            aria-label="Dismiss banner"
            onClick={dismiss}
          >
            <X size={16} />
          </button>
        </div>
      </section>
    );
  if (blocked)
    return (
      <section className="ds-alert is-warning is-spaced" aria-label="Automatic saving">
        <TriangleAlert size={16} aria-hidden="true" />
        <div className="ds-alert-body">
          <strong>Choose where Flux saves your files</strong>
          <p>
            Flux writes finished downloads into a folder you pick, without using Chrome’s
            downloader. Until you choose one, finished files wait here, verified and safe. Chrome
            does not accept Downloads, Documents, Desktop or your home folder itself, so create a
            new folder first (for example <b>Downloads/Flux</b>) and select that.
          </p>
        </div>
        <div className="ds-alert-actions">
          <button
            className="ds-btn is-outline is-small"
            onClick={() => run(() => manager.chooseDownloadFolder())}
          >
            Choose a folder
          </button>
          <button
            className="ds-icon-btn is-small"
            aria-label="Dismiss banner"
            onClick={dismiss}
          >
            <X size={16} />
          </button>
        </div>
      </section>
    );
  return null;
}
