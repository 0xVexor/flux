import { describe, expect, it, vi } from 'vitest';
import {
  categoryOf,
  filenameFromHeaders,
  clampFilename,
  folderLabel,
  numberedFilename,
  sanitizeFilename,
  uniqueFilename,
} from '../../src/shared/files';
import { safeError, trustedSender, validateUrl } from '../../src/shared/security';
import { noticeDetail, noticeTitle, readNotice } from '../../src/shared/notices';

describe('untrusted URLs', () => {
  it('allows HTTP(S) while removing fragments', () => {
    expect(validateUrl('https://example.org/file#secret').href).toBe('https://example.org/file');
    expect(validateUrl('http://127.0.0.1:8080/file', true).hostname).toBe('127.0.0.1');
  });
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,test',
    'https://user:pass@example.org',
    'http://localhost/f',
    'http://127.1/f',
    'http://0x7f000001/f',
    'http://10.0.0.1/f',
    'http://172.16.1.1/f',
    'http://192.168.1.1/f',
    'http://169.254.169.254/f',
    'http://100.64.0.1/f',
    'http://[::1]/f',
    'http://[::ffff:127.0.0.1]/f',
    'https://intranet/f',
    'https://printer.local/f',
    'https://host.internal/f',
  ])('rejects unsafe target %s', (url) => expect(() => validateUrl(url)).toThrow());
  it('redacts signed URLs from diagnostics', () => {
    const message = safeError(
      new Error('Download https://example.org/private?token=secret failed.'),
    );
    expect(message).not.toContain('secret');
    expect(message).toContain('[URL hidden]');
  });
});

describe('filenames', () => {
  it.each([
    '../../escape.exe',
    '..\\..\\escape.exe',
    'CON',
    'lpt1.txt',
    'nul',
    'a\u202eb.exe',
    'a\u0000b',
    '  ...  ',
    'name. ',
  ])('sanitizes untrusted filename %s', (value) => {
    const name = sanitizeFilename(value);
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(181);
    expect(name).not.toMatch(/[\\/<>:"|?*\u0000-\u001f\u202a-\u202e]/);
    expect(name).not.toMatch(/^[. ]|[. ]$/);
    expect(name).not.toMatch(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i);
  });
  it('prefers Unicode filename* and safely tolerates malformed server encoding', () => {
    expect(
      filenameFromHeaders(
        'attachment; filename="fallback.bin"; filename*=UTF-8\'\'%E2%9C%93.zip',
        'https://example.org/file',
      ),
    ).toBe('✓.zip');
    expect(
      filenameFromHeaders('attachment; filename="bad%zz.bin"', 'https://example.org/file'),
    ).toBe('bad%zz.bin');
    expect(filenameFromHeaders(null, 'https://example.org/%E2%9C%93.txt')).toBe('✓.txt');
    expect(
      filenameFromHeaders(
        'attachment; filename="=?utf-8?B?2q/Ystin2LHYtCDYudmF2YTaqdix2K8ucGRm?="',
        'https://example.org/api/File/GetFile',
      ),
    ).toBe('گزارش عملکرد.pdf');
    expect(
      filenameFromHeaders(
        'attachment; filename="=?UTF-8?Q?caf=C3=A9_menu.pdf?="',
        'https://example.org/file',
      ),
    ).toBe('café menu.pdf');
    expect(categoryOf('Report.PDF')).toBe('Documents');
    expect(categoryOf('payload.zip')).toBe('Archives');
  });
  describe('trusted extension pages', () => {
    const id = 'fixture-extension';
    const page = (path: string, extension = id) => ({
      id: extension,
      url: `chrome-extension://${extension}${path}`,
    });
    it('accepts the manager, popup and hidden engine page, and nothing else', () => {
      vi.stubGlobal('chrome', { runtime: { id } });
      try {
        for (const path of ['/manager.html', '/popup.html', '/offscreen.html'])
          expect(trustedSender(page(path) as chrome.runtime.MessageSender)).toBe(true);
        expect(trustedSender(page('/other.html') as chrome.runtime.MessageSender)).toBe(false);
        expect(
          trustedSender(page('/offscreen.html', 'other-id') as chrome.runtime.MessageSender),
        ).toBe(false);
        expect(trustedSender({ id, url: 'https://example.org/offscreen.html' })).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
  describe('duplicate names', () => {
    it('numbers a repeated name and skips numbers already used', () => {
      expect(uniqueFilename('a.zip', [])).toBe('a.zip');
      expect(uniqueFilename('a.zip', ['A.ZIP'])).toBe('a (2).zip');
      expect(uniqueFilename('a.zip', ['a.zip', 'a (2).zip'])).toBe('a (3).zip');
      expect(uniqueFilename('README', ['readme'])).toBe('README (2)');
    });
  });
  describe('file name length on Linux and macOS (255 bytes)', () => {
    const bytes = (value: string) => new TextEncoder().encode(value).length;
    it('cuts long Persian names by bytes and keeps the extension', () => {
      const name = sanitizeFilename('گ'.repeat(300) + '.pdf');
      expect(bytes(name)).toBeLessThanOrEqual(180);
      expect(name.endsWith('.pdf')).toBe(true);
      expect(name).not.toContain('�');
    });
    it('keeps the extension of long ASCII names', () => {
      const name = sanitizeFilename('a'.repeat(400) + '.zip');
      expect(name.endsWith('.zip')).toBe(true);
      expect(name.length).toBeLessThanOrEqual(180);
    });
    it('leaves short names alone and never splits an emoji', () => {
      expect(clampFilename('report.pdf')).toBe('report.pdf');
      const name = clampFilename('😀'.repeat(100) + '.txt', 50);
      expect(bytes(name)).toBeLessThanOrEqual(50);
      expect(name).toMatch(/^(?:😀)+.txt$/u);
    });
    it('keeps the number when a long name needs one', () => {
      const name = numberedFilename('گ'.repeat(300) + '.pdf', 7);
      expect(bytes(name)).toBeLessThanOrEqual(200);
      expect(name.endsWith(' (7).pdf')).toBe(true);
    });
  });
  describe('folder label', () => {
    it('names a drive root plainly and keeps real folder names', () => {
      expect(folderLabel('\\')).toBe('Drive root');
      expect(folderLabel('/')).toBe('Drive root');
      expect(folderLabel('')).toBe('Drive root');
      expect(folderLabel('Flux')).toBe('Flux');
    });
  });
  describe('download notices', () => {
    it('words each kind plainly', () => {
      const base = { filename: 'a.zip', at: 1 };
      expect(noticeTitle.saved).toBe('Download complete');
      expect(noticeDetail({ ...base, kind: 'saved', folder: 'Flux/Compressed' })).toBe(
        'Saved in Flux/Compressed',
      );
      expect(noticeDetail({ ...base, kind: 'saved' })).toBe('Saved to your download folder');
      expect(noticeDetail({ ...base, kind: 'failed', error: 'Server closed the connection' })).toBe(
        'Server closed the connection',
      );
      expect(noticeDetail({ ...base, kind: 'queue', waiting: 1 })).toBe(
        '1 file verified and waiting to save',
      );
      expect(noticeDetail({ ...base, kind: 'queue', waiting: 3 })).toBe(
        '3 files verified and waiting to save',
      );
    });
    it('drops anything malformed and trims long text', () => {
      expect(readNotice(null)).toBeNull();
      expect(readNotice({ kind: 'nope', filename: 'a' })).toBeNull();
      expect(readNotice({ kind: 'saved' })).toBeNull();
      const notice = readNotice({
        kind: 'failed',
        filename: 'x'.repeat(500),
        error: 'bad\nthing'.repeat(60),
        waiting: -4,
        id: 'job-1',
      });
      expect(notice?.filename).toHaveLength(200);
      expect(notice?.error).toHaveLength(160);
      expect(notice?.error).not.toContain('\n');
      expect(notice?.waiting).toBeUndefined();
      expect(notice?.id).toBe('job-1');
    });
  });
});
