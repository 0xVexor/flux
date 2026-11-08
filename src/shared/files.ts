import type { Category, Settings } from '../domain/model';
const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;
function truncateBytes(value: string, maxBytes: number) {
  let out = '';
  for (const char of value) {
    if (byteLength(out + char) > maxBytes) break;
    out += char;
  }
  return out;
}
/**
 * Linux (ext4) and macOS (APFS) limit a file name to 255 bytes, not characters, so Persian, CJK
 * and emoji names must be cut by byte size. The extension is kept; only the stem is shortened.
 */
export function clampFilename(name: string, maxBytes = 180) {
  if (byteLength(name) <= maxBytes) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && byteLength(name.slice(dot)) <= 24 ? name.slice(dot) : '';
  const room = maxBytes - byteLength(extension);
  const stem = truncateBytes(name.slice(0, extension ? dot : name.length), room);
  return (stem.replace(/[. ]+$/g, '') || 'download') + extension;
}
export function sanitizeFilename(input: string): string {
  const name = clampFilename(
    input
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_')
      .replace(/^[. ]+|[. ]+$/g, ''),
  );
  return !name
    ? 'download'
    : /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)
      ? `_${name}`
      : name;
}
/** Decodes RFC 2047 encoded words such as =?utf-8?B?...?= that some servers put in filename. */
function decodeEncodedWords(value: string) {
  return value.replace(/=\?([\w-]+)\?([bBqQ])\?([^?]*)\?=/g, (word, charset, mode, text) => {
    try {
      let bytes: Uint8Array;
      if (mode.toLowerCase() === 'b') {
        bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
      } else {
        const raw = text
          .replace(/_/g, ' ')
          .replace(/=([0-9a-f]{2})/gi, (_: string, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        bytes = Uint8Array.from(raw, (char: string) => char.charCodeAt(0));
      }
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return word;
    }
  });
}
export function filenameFromHeaders(disposition: string | null, url: string) {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let name =
    encoded ?? plain?.[1] ?? plain?.[2] ?? new URL(url).pathname.split('/').pop() ?? 'download';
  name = decodeEncodedWords(name);
  try {
    name = decodeURIComponent(name);
  } catch {
    /* Malformed server encoding is kept as text. */
  }
  return sanitizeFilename(name);
}
export function categoryOf(name: string): Category {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx', 'pptx', 'epub'].includes(ext))
    return 'Documents';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'bz2'].includes(ext)) return 'Archives';
  if (['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(ext)) return 'Videos';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return 'Audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'Images';
  if (['exe', 'msi', 'dmg', 'pkg', 'iso', 'deb', 'rpm', 'apk'].includes(ext)) return 'Software';
  return 'Other';
}
/** Relative folder segments, each sanitized; "..", "." and empty parts are dropped. */
export function folderSegments(path: string) {
  return path
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map(sanitizeFilename)
    .slice(0, 8);
}
export function categoryFolderName(
  category: Category,
  settings: Pick<Settings, 'categoryFolders'>,
) {
  return folderSegments(settings.categoryFolders?.[category] || category).join('/') || category;
}
/** Path relative to Chrome's Downloads folder, as accepted by chrome.downloads. */
export function downloadsRelativePath(
  filename: string,
  settings: Pick<Settings, 'downloadsSubfolder' | 'saveByCategory' | 'categoryFolders'>,
) {
  const name = sanitizeFilename(filename);
  return [
    ...folderSegments(settings.downloadsSubfolder ?? ''),
    ...(settings.saveByCategory ? [categoryFolderName(categoryOf(name), settings)] : []),
    name,
  ].join('/');
}
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

/** "name.ext" with a number: "name (2).ext". The stem is cut by bytes so the number always fits. */
export function numberedFilename(filename: string, n: number) {
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 && byteLength(filename.slice(dot)) <= 24 ? filename.slice(dot) : '';
  const stem = extension ? filename.slice(0, dot) : filename;
  const suffix = ` (${n})${extension}`;
  return truncateBytes(stem, 200 - byteLength(suffix)) + suffix;
}
/** "name.ext" becomes "name (2).ext", skipping any name already taken (case-insensitive). */
export function uniqueFilename(filename: string, taken: Iterable<string>) {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  if (!used.has(filename.toLowerCase())) return filename;
  for (let n = 2; n < 10000; n++) {
    const candidate = numberedFilename(filename, n);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return filename;
}

/** A drive root has no usable name (Chrome reports "\\" or "/"), so show a plain label instead. */
export function folderLabel(name: string) {
  const trimmed = name.trim();
  return !trimmed || /^[\\/]+$/.test(trimmed) ? 'Drive root' : trimmed;
}
