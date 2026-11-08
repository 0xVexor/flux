# Flux design system

The visual rules we agreed for Flux, and where they live in the code. Read this first when you
continue the interface work on another machine.

The numbers are the ones shadcn/ui uses (the "new-york" style), written down from memory, so a
control in Flux is the size of the same control there. **Check them against
<https://ui.shadcn.com> before treating any number as final.** The colours are not shadcn's:
Flux keeps its own palette in `src/ui/tokens.css` (dark and light, teal accent).

## Where things are

| What                                                         | File                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Colours, both themes                                         | `src/ui/tokens.css`                                             |
| Spec tokens and every shared primitive                       | `src/ui/ds.css`                                                 |
| Toolbar popup, main view                                     | `src/ui/popup/popup-minimal.css`                                |
| Toolbar popup, download notice                               | `src/ui/popup/popup-refresh.css`, `src/ui/popup/NoticeView.tsx` |
| Add download (manager window and popup) and the batch dialog | `src/ui/manager/add-dialog-ds.css`                              |
| Dropdown                                                     | `src/ui/components/Select.tsx`                                  |
| Date and time                                                | `src/ui/components/DateTimePicker.tsx`                          |
| "Save to" folder choice                                      | `src/ui/components/FolderChoice.tsx`                            |
| Collapsible "More options"                                   | `src/ui/components/MoreOptions.tsx`                             |
| One icon per file type                                       | `src/ui/components/category-icons.ts`                           |
| Notice wording and validation                                | `src/shared/notices.ts`                                         |
| Toast injected into a website                                | `src/shared/page-toast.ts`                                      |

`src/ui/theme.css` imports the older layers (`styles.css`, `refresh.css`, `shell.css`,
`redesign.css` and others) and then `add-dialog-ds.css` **last**. That order matters: the older
layers have more specific selectors, and the dialog file only wins because it loads after them.

## Tokens (`ds.css`)

| Token                         | Value                   | Use                                              |
| ----------------------------- | ----------------------- | ------------------------------------------------ |
| `--ds-radius-sm`              | 4 px                    | checkbox, list items inside a popover            |
| `--ds-radius`                 | 6 px                    | buttons, inputs, select, calendar day, popover   |
| `--ds-radius-lg`              | 8 px                    | alerts, toast, segmented tabs                    |
| `--ds-radius-xl`              | 12 px                   | cards (the popup speed card)                     |
| `--ds-h` / `--ds-h-sm`        | 36 px / 32 px           | control height, small control height             |
| `--ds-space-1…6`              | 4 · 8 · 12 · 16 · 24 px | the only spacing scale                           |
| `--ds-text`, `--ds-text-lh`   | 14 px / 20 px           | body, labels, buttons                            |
| `--ds-small`, `--ds-small-lh` | 12 px / 16 px           | helper text, badges, metadata                    |
| `--ds-title`                  | 18 px, weight 600       | dialog titles                                    |
| `--ds-bar`                    | 8 px                    | progress bar                                     |
| `--ds-ring`                   | 3 px accent at 50 %     | focus ring (the border also turns to the accent) |
| `--ds-shadow-xs`              | `0 1px 2px` at 5 %      | outline and filled buttons, inputs               |

Use the tokens in CSS. Do not write new pixel values for radius, spacing or type.

## Rules

- **One filled button per view.** Everything else is outline or ghost.
- **Icons** are 16 px in controls and messages, 20 px for file types and the brand mark. They
  never sit inside a coloured tile.
- **Status** is a small dot plus text (`ds-dot`: green live, amber paused or waiting, red failed,
  grey idle). Never a coloured box.
- **Labels** are 14 px, weight 500, above the control with 8 px between. Fields are 16 apart.
- **Sentence case** everywhere ("Add download", not "Add Download"). No terminal punctuation on
  labels and buttons.
- **Borders** are one hairline colour (`--border`). Controls and buttons share it.
- **Focus** is the accent border plus the 3 px ring.
- Native scrollbars are hidden in the popup and in long lists; the list still scrolls.
- The brand is `flux.` in lowercase with a green period, with the bolt beside it.

## Components

`ds.css` classes (use these, do not restyle `button`):

- `ds-btn` with `is-primary`, `is-outline`, `is-ghost`, `is-danger`, and `is-small`.
- `ds-icon-btn` (36 px) and `ds-icon-btn is-small` (32 px).
- `ds-link`, `ds-dot`, `ds-badge`, `ds-bar`.
- `ds-notice` (`is-error`, `is-spaced`): a one-line alert.
- `ds-alert` (`is-warning`, `is-spaced`) with `ds-alert-body` and `ds-alert-actions`: a banner
  with title, text and buttons.
- `ds-toast`: a short message in the manager window.
- `ds-select*`, `ds-datepicker*`, `ds-cal-*`, `ds-day`: the dropdown and the calendar.

Scoped to `.add-form` in `add-dialog-ds.css`: text fields, checkbox (16 px, 4 px corners, drawn
check), switch (32 × 18, 16 px thumb), segmented tabs, rows, `batch-*` list.

Class names ending in `-btn` and `is-*` are deliberate: older global rules style `.button`,
`.primary` and `.secondary`, so a `ds-` element must not use those names.

## The toolbar popup

- **Chrome limits.** A popup can be at most 600 px tall, and nothing can be drawn outside its
  window. The window grows with its content and shrinks when it shrinks.
- Because of that, a dropdown or calendar inside the popup opens **inline**, pushing the rest of
  the form down, and scrolls itself into view. In a normal window the dropdown floats above the
  page instead (`Select.tsx` decides with `inPopup()` from `popup-room.ts`).
- The buttons of Add download and of the batch dialog are pinned to the bottom edge of the
  window, whether the form is shorter or taller than the window.
- A file picker would close the popup, so the popup never opens one. "Save to" offers
  "Automatic", "New folder…" and the app's own category folders; the choice applies to that one
  download (or batch) through `saveSubfolder`.
- Widths: main view 360 px, Add download and the batch dialog 440 px.

## Notices

One event, `download-notice`, goes from the engine to the background. The background shows it:

1. **On the website you are looking at**, as a toast (`page-toast.ts`) in a closed shadow root,
   if Flux may run on that tab.
2. Otherwise in the **toolbar popup** (`NoticeView.tsx`).
3. Also as a **system notification** if the user turned Completion notifications on.

Kinds: `saved` (Download complete, closes itself), `ready` (Ready to save), `failed` (with Retry
and Open manager), `queue` (Queue finished). The notification API does not exist until the user
grants the optional permission, so the background must never touch `chrome.notifications` while
the file loads. `tests/browser/startup.spec.ts` guards this.

## Status

Done, on the system above:

- Toolbar popup (main view, download notice).
- Add download in the popup and in the manager window; the batch (several links) dialog.
- Dropdown, date and time, folder choice, checkbox, switch, tabs.
- Notices: popup, website toast, manager toast, alerts and banners on the main page.

Not done yet, still on the older layers:

- The manager main page: header, filter tabs, the download rows, the sidebar.
- Settings, the queue manager, the details panel, the batch-links page and every other dialog
  (they still use native dropdowns and the older buttons).
- Radio choices.
- The older CSS files to retire once nothing uses them: `styles.css`, `refresh.css`, `shell.css`,
  `redesign.css`, `popup-capture.css`.

A sensible order for the rest: the download row and the header of the main page, then the
sidebar, then Settings, then the remaining dialogs. For each piece, show the design, get it
approved, change it, build, and test it in Chrome before the next one.

## Working notes

- `npm run check` runs typecheck, unit and integration tests, and the build. Load `dist` with
  "Load unpacked" in `chrome://extensions` and press Reload after every build; open pages keep
  the old code until they are reloaded too.
- Browser tests need Chrome: `CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npx playwright test tests/browser/startup.spec.ts`.
- Check the interface in both themes (Settings, Theme) and with a long Persian file name.
