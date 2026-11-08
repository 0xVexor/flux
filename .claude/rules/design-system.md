# Flux design system: persistent UI rules

These rules apply to every UI task. Read `docs/design-system.md` before proposing or
editing UI; preserve its rules and migration status. This file deliberately has no
`paths` frontmatter so it loads at the beginning of each project session.

## Sources and reuse

- The agreed specification is `docs/design-system.md`. Inspect `src/ui/ds.css`,
  `src/ui/tokens.css`, the target screen and its shared components before implementation.
- Flux uses custom React/CSS primitives with shadcn/ui new-york as a sizing reference.
  Before treating shadcn-derived numbers as verified, check <https://ui.shadcn.com>
  and the relevant official component source/style. Record the URL and style checked.
  If offline, report that limitation and preserve existing tokens rather than guessing.
- Upstream defaults can vary by style/version. If a verified value conflicts with the
  agreed Flux spec, explain the difference and obtain a design decision before changing
  shared tokens. Do not silently overwrite Flux's palette or adopt a different style.
- Reuse `Select`, `DateTimePicker`, `FolderChoice`, `MoreOptions`, `Modal`,
  `category-icons` and the existing notice components in `src/ui/components` and
  `src/ui/popup`. Inspect their APIs first; do not create duplicate controls.
- The project has no shadcn installation, Tailwind setup or `components.json`.
  Do not add those or run a shadcn initializer just to follow the visual reference.

## Tokens and presentation

- Use colour variables from `tokens.css` in both light and dark themes, including
  `--accent`, `--accent-hover`, `--accent-ink`, `--border`, `--text` and `--muted`.
- Use `--ds-*` variables for new radius, spacing and type values; do not add literal
  pixel alternatives. Current agreed values in `ds.css` include control heights 36/32,
  radii 4/6/8/12, spacing 4/8/12/16/24, body 14/20, helper 12/16 and title 18/600.
  These describe Flux's current tokens, not a claim of verified upstream equivalence.
- Use `ds-btn` with `is-primary`, `is-outline`, `is-ghost`, `is-danger`, `is-small`,
  plus `ds-icon-btn`, `ds-link`, `ds-dot`, `ds-badge`, `ds-bar`, `ds-notice`,
  `ds-alert` and `ds-toast` as appropriate. Do not combine migrated controls with
  legacy `.button`, `.primary` or `.secondary`, or restyle global `button` selectors.
- One filled primary button per view; remaining actions are outline or ghost.
- Lucide icons: 16px in controls/messages, 20px for file types/brand, without coloured tiles.
- Status is a small dot plus text. Labels are above controls, weight 500, with the
  specification's spacing. Use sentence case; labels/buttons have no terminal punctuation.
- Preserve the lowercase `flux.` brand with green period and adjacent bolt. Controls
  share the hairline `--border`; focus uses the accent border and `--ds-ring`.
- Preserve `theme.css` import order, with `src/ui/manager/add-dialog-ds.css` last. Inspect
  its `ds.css` import and cascade before changing styles. Keep screen styles scoped.

## Interaction and migration

- Popup maximum height is 600px; main width is 360px and Add/batch width is 440px.
  Popup dropdowns/calendars open inline and scroll into view; normal-window dropdowns
  can float. Preserve `popup-room.ts` detection and visible pinned form actions.
- Do not open a native folder picker from the popup. Reuse `FolderChoice` and the
  per-download/batch `saveSubfolder` flow described in the specification.
- Hidden scrollbars must retain scrolling. Keep accessible names, keyboard operation,
  focus visibility, disabled states and reduced-motion support. Test long Persian names.
- Preserve the existing `download-notice` flow and optional notification permission.
  Never access `chrome.notifications` at module load before permission is granted.
- The popup, Add/batch dialogs and shared controls use the new system. The manager
  shell, Settings, queues, details and other listed surfaces remain partly legacy.
  Do not treat legacy styles as the target for new UI or migrate unrelated screens.
- For remaining migration work follow the spec: show the proposed design, get the
  user's design approval, implement that piece, build and test in Chrome before the next.
  This is a design-review workflow, not a hook or technical blocking mechanism.

## Self-review before finishing UI work

- Check the diff for duplicated controls, new literal design values, legacy class
  collisions, CSS order changes and unnecessary dependencies; correct deviations.
- Check light/dark themes, keyboard/focus, popup and manager layouts, long lists and
  Persian filenames. Run relevant existing checks and report their real results.
- Update `docs/design-system.md` when an approved design decision or migration status
  changes; preserve its existing rules and historical context.
