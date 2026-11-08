import { useMemo } from 'react';
import { Folder } from 'lucide-react';
import { Select } from './Select';
import { folderSegments } from '../../shared/files';
import { defaultSettings, type Category, type Settings } from '../../domain/model';

/** The value of the "New folder…" entry; a typed name goes with it. */
export const NEW_FOLDER = '__new__';
const categories = Object.keys(defaultSettings.categoryFolders) as Category[];

/** The folder the user chose for these downloads, or undefined for "Automatic". */
export function folderValue(choice: string, typed: string) {
  return (choice === NEW_FOLDER ? typed.trim() : choice) || undefined;
}

/** "Save to": the download folder, and a folder inside it for just these downloads. */
export function FolderChoice({
  settings,
  destination,
  choice,
  onChoice,
  typed,
  onTyped,
}: {
  settings: Settings;
  destination?: { name: string; authorized: boolean };
  choice: string;
  onChoice: (value: string) => void;
  typed: string;
  onTyped: (value: string) => void;
}) {
  // The app's own category folders (Compressed, Documents and so on), from the settings.
  const main = useMemo(
    () => [
      ...new Set(
        categories
          .map((name) => folderSegments(settings.categoryFolders?.[name] ?? '').join('/'))
          .filter(Boolean),
      ),
    ],
    [settings.categoryFolders],
  );
  return (
    <div className="row">
      <label htmlFor="folder-choice">Save to</label>
      <div className="row-pair is-folder">
        <div className="fake-input">
          <Folder size={16} />
          <span>{destination?.name ?? 'Downloads'}</span>
        </div>
        <Select
          id="folder-choice"
          value={choice}
          onChange={(event) => onChoice(event.target.value)}
          aria-label="Folder for these downloads"
        >
          <option value="">Automatic</option>
          <option value={NEW_FOLDER}>New folder…</option>
          <optgroup label="Main folders">
            {main.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
      {choice === NEW_FOLDER && (
        <input
          aria-label="New folder name"
          placeholder="Folder name"
          value={typed}
          maxLength={80}
          autoFocus
          onChange={(event) => onTyped(event.target.value)}
        />
      )}
    </div>
  );
}
