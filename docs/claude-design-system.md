# Claude Code design-system setup

## Files and scope

- `CLAUDE.md`: project context and the instruction to consult the agreed specification.
- `.claude/rules/design-system.md`: unconditional design rules for every new session.
- `docs/design-system.md`: the agreed Flux specification, including the shadcn/ui
  reference requirement, custom colours and incomplete migration list.

Start Claude Code with this checkout as its project directory. A new session loads the
root instructions and the rule automatically; no repeated design-system prompt is needed.
These files guide the model; they do not guarantee perfect compliance or block operations.
No hooks, permissions restrictions, CI gate or runtime UI change is part of this setup.

The `.gitignore` exceptions expose only this shared rule under `.claude`; local settings
and other Claude files remain ignored. Commit the instructions, rule, this guide and the
ignore change when ready to share them with another checkout. This setup does not commit
or push them automatically.

## Why no extra Skill or MCP

Flux implements its own primitives in React and CSS; it does not currently consume a
shadcn registry. Official shadcn docs/source are the reference for validating dimensions,
not authorization to install a new UI stack. An optional Skill is not used to hold rules
that must always load. No MCP server, package installation or global Claude setting is
needed. Reassess tooling if the project later explicitly adopts a component registry.

## Verify a fresh session

1. Open a new Claude Code session in the repository root (not just an additional directory).
2. Run `/context all` and inspect **Memory files** for `CLAUDE.md` and
   `.claude/rules/design-system.md`. `/memory` also helps locate project instructions.
3. If either is absent, check the working directory, file presence, Claude Code version,
   and whether launch settings exclude project instructions. Do not run `/init` over the
   files merely to test loading.
4. Without mentioning design rules, ask: "Plan an Add download form containing a priority
   dropdown, schedule picker and folder choice. Do not edit files. Name the components,
   tokens and references you would use, and explain how the popup differs from the manager."
5. Expected: consult `docs/design-system.md`; reuse `Select`, `DateTimePicker` and
   `FolderChoice`; use `ds-*` tokens/classes, Flux colours and one primary action;
   reference official shadcn sources for upstream checks; explain inline popup controls,
   the 600px limit and no native folder picker in the popup. No new UI library is proposed.
6. Repeat in a second new session to check persistence without restating the rules.

## Practical implementation test

On a disposable branch, request a small existing-form change without restating the design
system, such as adding helper text to a priority field. Inspect the proposed change for
token and component reuse. For a migration/new design, follow the specification's design
approval step first. Verify the actual rendered result in both themes and contexts.

Useful existing commands (choose tests relevant to the changed area):

```powershell
npm run typecheck
npm test -- tests/unit/controls.test.ts
npm run build
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npx playwright test tests/browser/startup.spec.ts tests/browser/redesign.spec.ts
```

Browser tests require an available Chrome and built `dist`. These test UI behaviour, not
whether Claude loaded instructions. The fresh-session checks above test that separately.

References: [Claude Code memory and project rules](https://code.claude.com/docs/en/memory),
[shadcn/ui components](https://ui.shadcn.com/docs/components),
[shadcn/ui theming](https://ui.shadcn.com/docs/theming).
