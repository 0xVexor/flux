# Flux project instructions

Flux is a Chrome MV3 extension built with React 19, TypeScript and Vite. UI code lives
in `src/ui`; engine, background and storage code have separate responsibilities.

## Design system

- Follow `.claude/rules/design-system.md` for every UI task. It is an unconditional
  project rule, loaded at session start rather than an optional skill.
- Read `docs/design-system.md` before planning or changing UI. It is the agreed design
  specification; `docs/ui-redesign.md` records the earlier design and historical checks.
- Use the existing Flux primitives, `src/ui/ds.css` and `src/ui/tokens.css`. The design
  references shadcn/ui new-york sizing, while retaining Flux colours and custom controls.
- Check the relevant official source at <https://ui.shadcn.com> when introducing or
  validating shadcn-derived dimensions or behaviour. Do not invent values from memory.
- Preserve existing project instructions and the specification's staged migration and
  design-review process. Do not turn this task into a wholesale UI or library migration.
- Do not add Git hooks, Claude hooks, CI gates or other blocking enforcement for these rules.

## Verification and reporting

- Use the scripts in `package.json`: `npm run typecheck`, `npm test`, `npm run build`.
- For changed UI, choose relevant existing Playwright specs in `tests/browser` and verify
  both themes, keyboard interaction, popup constraints and long Persian filenames.
- Review your diff against the design rules and fix deviations before reporting completion.
  Report actual checks, failures and any unverified visual or browser behaviour.
- Keep user changes intact. Change engine, permissions and persistence only when the task
  requires them. Shared UI changes must work in both the popup and manager contexts.

Setup and fresh-session smoke test: `docs/claude-design-system.md`.
