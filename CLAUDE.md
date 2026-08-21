# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

React + Tauri desktop application starter: Next.js 16 (React 19) + Tauri 2.9 + TypeScript + Tailwind CSS v4 + shadcn/ui + Zustand.

**Dual Runtime Model:**

- **Web mode** (`pnpm dev`): Next.js dev server at <http://localhost:3000>
- **Desktop mode** (`pnpm tauri dev`): Tauri wraps Next.js in a native window

## Development Commands

```bash
# Frontend (main app — port 3000)
pnpm dev              # Start Next.js dev server
pnpm build            # Build for production (outputs to out/)
pnpm lint             # Run ESLint
pnpm lint:fix         # Auto-fix ESLint issues
pnpm format           # Format with Prettier
pnpm format:check     # Check formatting without writing
pnpm typecheck        # TypeScript --noEmit

# Testing
pnpm test             # Run Jest tests
pnpm test:watch       # Run tests in watch mode
pnpm test:coverage    # Run tests with coverage report (90% gate — jest.config.ts)
pnpm test:e2e         # Playwright specs in e2e/ (also run in CI)
pnpm test:e2e:ui      # Playwright UI mode
pnpm audit:catalog    # Check the registry against upstream (scripts/audit-catalog.ts)

# Rust (from src-tauri/)
cargo test            # Inline #[cfg(test)] suites — no tests/ directory
cargo clippy -- -D warnings
cargo fmt

# Desktop (Tauri)
pnpm tauri dev        # Dev mode with hot reload
pnpm tauri build      # Build desktop installer
pnpm tauri info       # Check Tauri environment

# Docs site (pnpm workspace — port 3001)
pnpm docs:dev         # Start Fumadocs dev server
pnpm docs:build       # Build docs for production
pnpm docs:start       # Start docs production server

# Add shadcn/ui components
pnpm dlx shadcn@latest add <component-name>
```

## Architecture

### Workspace Structure

This is a **pnpm monorepo** with two packages:

| Package  | Path       | Port | Purpose                                          |
| -------- | ---------- | ---- | ------------------------------------------------ |
| Main app | `/` (root) | 3000 | Next.js + Tauri desktop app (`output: "export"`) |
| Docs     | `docs/`    | 3001 | Fumadocs documentation site (full server mode)   |

Root `pnpm-lock.yaml` is the single lockfile for all packages. Run `pnpm install` from the repo root.

### Frontend Structure (main app)

- `app/` - Next.js App Router (layout.tsx, page.tsx, globals.css)
- `components/ui/` - All 56 shadcn/ui components pre-installed (**no test files here**)
- `components/agentpack/` - the agentpack installer UI (shell, header, task rail,
  `workspace-tabs`, `change-tray`, `command-palette`, sections, run panel), plus
  `onboarding-dialog` / `onboarding-network-step` / `guided-tour` (the three
  guidance surfaces), `config-io`, `bundle/*-dialog`, `desktop-only-note`
- `hooks/` - Shared hooks: `use-mobile`, `use-mounted`, `use-incremental`
- `lib/utils.ts` - `cn()` utility (clsx + tailwind-merge)

⚠️ `jest.config.ts`'s `collectCoverageFrom` covers `app/ components/ lib/` only,
so `store/` and `hooks/` are outside the 90% gate even where they have tests.

### agentpack desktop app

The home page (`app/page.tsx`) renders the **agentpack** installer — a GUI port of
the terminal `agentpack` TUI that sets up the terminal coding agents, engineering
skills, MCP servers, network/mirrors and cc-switch.

⚠️ **Two tiers of agent, and only the first tier gets config written into it.**
`CLI_TOOLS` installs, upgrades and removes every agent in the catalog, but skills
and MCP servers are only written for Claude, Codex and OpenCode — the three whose
config surfaces this repo has writers and Rust paths for, which is exactly what
`McpTarget` names. Everything else (Gemini CLI, Qwen Code, Copilot CLI, Crush,
Amp, Cline, Auggie, Droid, Cursor CLI) is install-only. Adding a CLI means: the
`CliTool["id"]` union, a `kind` (agent/companion — it drives the grouped install
lists via `clisByKind`), a registry entry (use `npmCli()` / `scriptInstall()`
rather than spelling twelve commands out), and **en + zh-CN catalog entries** — a
registry id with no i18n entry fails `registry.test.ts`'s catalog-integrity test.
Set `minNodeMajor` only when the package really publishes an `engines.node`
floor; it makes the plan refuse an install up front, which is wrong if npm
wouldn't. Then run `pnpm audit:catalog` — every package and installer URL in the
catalog must be live and undeprecated.

**Hybrid architecture (pure TS logic + Rust side-effects):**

- `lib/agentpack/` — browser-safe pure logic (no Node builtins): `registry`,
  `presets`, `types` (incl. `StepDescriptor`/`Paths`), `config`, `report`,
  `locale`, `scan`, `profile`, `release`, `version`, `merge/{mcp,network}`,
  `network/{discovery,mirrors,probe,proxy,recovery,scan}`, `bundle/*`,
  `config-editor/*`, `mcp-{disabled,health,import}`, `ccconnect`, `ccswitch/*`,
  plus `workspaces` (the seven task domains over the twenty-four `SectionKey`s),
  `appearance` (the interface-scale vocabulary),
  `diagnostics` (the overview's to-do list), `palette` (⌘K contents),
  `activity` (the run log's shape + redaction) and `cleanup` (the disk-cleanup
  catalog — see below).
  `plan.ts` turns a `Plan` into a declarative `StepDescriptor[]`; `preview.ts`
  renders dry-run "would …" lines; `runner.ts` executes descriptors.
- `lib/skills/` — the Skills section's pure logic (`browse`, `conflicts`,
  `frontmatter`, `github`, `meta`, `npx`, `paths`, `scaffold`, `updates`), backed
  by `src-tauri/src/skills.rs`. `lib/highlight/` is the code-editor tokenizer.
- `lib/tauri/commands.ts` — the SOLE bridge: typed `invoke`/`Channel` wrappers.
  (`lib/tauri.ts` is only `isTauri()`; it calls no commands.)
- `src-tauri/src/` — the side-effects. `exec.rs` (`run_command`, streaming output
  via `tauri::ipc::Channel`; `detect_cli`, `is_process_running`, `launch_app`),
  `fsops.rs` (file read/write/remove, resource-based `install_skill`), `paths.rs`
  (all cross-platform path maths), `ccswitch.rs` (the bundled `rusqlite` DB, with
  guardrails), plus `skills.rs` (the largest file here), `download.rs` (release
  resolution + download), `net.rs` (probing), `backup.rs`, `mcp.rs`, `login.rs`,
  `cleanup.rs` (scan / quarantine / purge, with its own path guardrails).
- `lib/i18n/` — the typed bilingual catalog (`en`/`zh-CN`, `Messages = typeof en`)
  - `I18nProvider`/`useT`/`useLocale`. `store/app-store.ts` is the Zustand store.

**Dry-run is structural:** in preview mode `runner.ts` renders preview lines
locally and NEVER calls a mutating Rust command. Skills ship as Tauri resources
(`src-tauri/assets/skills/`, wired via `bundle.resources`).

### Shell & design system

The window is a **Workbench**: a seven-item task rail (`sidebar-nav.tsx`), a
title bar that says where you are, a sub-tab strip per workspace, the workspace
itself, and a change tray docked at the bottom. `lib/agentpack/workspaces.ts`
owns the mapping — the twenty-four `SectionKey`s are the target of every
navigation, grouped into **Overview · Install & repair · Capabilities · My
account · Accounts & quota · Usage · Settings**. Below 900px the rail becomes a
Sheet.

Adding a section means touching six places, and `workspaces.test.ts` fails until
the first two agree: the `SectionKey` union, `WORKSPACES`, the hand-written list
in that test, `SECTIONS` in `sidebar-nav.tsx` (label + icon), `SECTION_LABEL` in
`palette.ts`, and `NAV` in `e2e/helpers.ts`. The guided tour and the ⌘K palette
both walk `SECTIONS`, so a new one needs `menu.*` and `tour.steps.*` copy in
both catalogs or the tour renders an untitled step.

**Four shared primitives carry every section's chrome.** Use them rather than
hand-rolling the shape again: `section-shell` (heading + subtitle + `help` +
`actions`), `capability-workbench` (that shell plus the lead / primary / aside /
detail grid), `section-status` (the summary, as one band of measured facts — the
row of uniform stat tiles is banned, see design.md), `section-nav` (an aside's
destinations as one ruled panel) and `filter-bar` (`FilterToolbar` +
`ScopeChip` + `SearchField` + `MoreFilters`, the two-tier toolbar over any
inventory list). `scopeChipClass` is exported so a control that must build its
own trigger — the usage dashboard's custom-range pill — is the same object as
the chips beside it. A section that draws its own header drifts: History did,
and ended up the one page whose title sat at a different width from its
neighbours with the tour anchor re-added by hand.

**Settings is three tabs, and each answers one question.** `preferences` is how
the app looks and behaves, `config` is profiles + backup + the CLIs' own config
files, `about` is which build this is. Keep them apart: About used to carry
every preference under its update panel, which is how a setting ends up with two
writers that disagree — `about.test.tsx` asserts it renders no switch at all.

⚠️ **Two preferences live on `<html>`, not in React.** `useAppearance`
(`hooks/`) writes `data-ui-scale` and `data-reduce-motion`, matched by rules in
`app/globals.css` against `--hm-root-*` in `tokens.css` — so the scale is a
token, not a px size computed in JS. It is called once, from the shell, which is
what makes it cover both the live change and the restore at startup. A default
is expressed by **removing** the attribute, never by writing `100`. The theme
and the language are not stored in `settings.json` at all: next-themes and the
i18n provider own their own persistence, and duplicating them would give each
two sources of truth. `settings.startupSection` is validated against
`SECTION_KEYS` before the shell navigates to it.

`design.md` at the repo root is the locked design system (Cobalt / modern-minimal)
and `tokens.css` is its machine-readable half, imported at the top of
`app/globals.css`, which then re-points the shadcn variable _names_ at those
tokens. **Read design.md before adding a surface; add a token before adding a
value** — no `oklch(...)`, px radius or `font-family` belongs anywhere else.

### Staged sections: the setup checklist

`sections/setup-steps.tsx` (`SetupSteps`) is the frame for any section whose work
is **staged** — where nothing can be started before it is installed and nothing
opens before it is started. It renders one hairline panel, one row per step, in
the order the steps must happen: a marker (done · doing now · waiting ·
blocked), the verb as a title, one plain sentence of why, the measured fact in
mono, and the single control that advances that step.

Two sections use it, and both used to say the same thing as three sibling cards
of equal weight, each with its own badge row and its own disabled buttons:

- **cc-connect management** (`sections/ccconnect.tsx`) — install → configure a
  project → start the bridge → open the dashboard. There is no separate service
  card or configuration card any more; each is a row. Refresh moved to the
  section heading's `actions` slot, and Uninstall is step 1's quiet secondary.
- **Accounts & relays** (`sections/ccswitch/`) — `backend-card` (the storage
  choice as two explained options, not a ToggleGroup with the consequence
  printed underneath), then the checklist, then `providers-card` in the
  **full-width `detail` band** — the list is read across four columns and three
  verbs, and in the 8-column primary its last column fell off the panel. The
  aside carries `quick-add-card`, `logins-card`, `app-card` and
  `visible-apps-card`.

Three rules these two depend on:

1. **A step's status is its own precondition, not its position.** `waiting`
   means the thing it needs hasn't happened; `current` is the accent, and it is
   the only accent in the panel — a checklist of primary buttons is four
   primaries. A state the scan hasn't answered yet (`dbReady === null`) is
   `waiting`, never `current`: accenting a row with nothing to click reads as
   stuck rather than as still measuring.
2. **A step that is absent beats a step that is present and ticked.** The native
   provider store has no app to install and no database to create, so those two
   rows don't exist in native mode — `index.test.tsx` asserts it.
3. **Quick add has one home at a time** — inside the provider list's empty
   state, where a first provider is actually chosen, and in the aside once the
   list has rows. Rendered in both, every preset button is on screen twice.

⚠️ The step titles and the four status words are the only strings `SetupSteps`
does not own: `statusLabels` comes from `t.shell.setup{Done,Current,Waiting,
Blocked}` and is **required**, because the marker that carries the state
visually is `aria-hidden`. The status word is a sibling of the title, not part
of it, so `getByText(title)` still matches exactly.

### Onboarding & run invariants

Five rules the first-run and install paths depend on. Each replaced a behaviour
that looked reasonable in the code and lied to the user in the app.

1. **Only a deliberate exit marks someone onboarded.** `settings.onboarded` is
   written by "Maybe later" and by Install — never by Esc, the overlay, or the
   tour link, which write `settings.onboardingProgress` instead so the next
   launch resumes. Treating every close as consent meant one mis-click on
   question 1 and the user was never guided again.
2. **A run's verdict reads all four statuses.** `done`, `warning`, `error` and
   `skipped` together (plus `cancelled` from `useRunner`, since `skipped` alone
   can't tell a stopped run from a dependency-skipped step). Counting only
   `done`/`error` reported a cancelled run as "All set".
3. **Retry merges in place.** The full step list lives in `useRunner`'s `all`
   ref, which a retry must not narrow, and results merge back by **id** — a
   retry batch is a subset, so batch indices don't line up.
4. **The one-click dedup must have a real scan.** `DashboardScan.degraded` says
   a source couldn't be read (as opposed to not existing — the Rust side already
   draws that line: NotFound → `Ok("")`, real failure → `Err`). `runOneClick`
   falls back to the last good scan and refuses to run without one. Deduping
   against a scan that wrongly says "nothing is installed" re-adds everything,
   and `claude mcp add` rejects a duplicate id.

5. **Every write goes through the review panel.** `useRunner.run()` stages steps
   and resolves only once the user applies them (or `[]` if they walk away), so
   a caller still reads `const reports = await run(steps)` — it just waits for a
   human in between. There is no global dry-run mode any more: **Preview only**
   and **Apply changes** are two buttons inside the panel, next to the step list
   they act on, and a preview leaves the steps staged so applying afterwards is
   one click. Section tests use `run/__testing__/harness` (`autoApply` to stand
   in for the user, `panel` to drive the gate by hand).

Also: the completion screen derives its next action and chores from `reports`,
not from `plan` — with **no step at all** reading as success, because the dedup
emits nothing for what's already installed.

⚠️ The **activity log** (`~/.agentpack/activity.json`) records what ran, and its
redaction is a deliberate line, not an oversight: title, source, timestamp,
outcome, per-step status/duration and any restore point — never command output,
config bodies, env vars or API keys. `recordRun` copies fields explicitly rather
than spreading `StepReport`, so the next field added there can't leak by
default. Previews write no record at all. The ⌘K palette is bound by the same
rule: it indexes destinations and app actions, never content.

### Environment cleanup

The **Clean up** section (Install & repair → last tab) reclaims the disk the
agent CLIs fill up and clears the records they leave behind. On a working
machine that is real money: `~/.codex/sessions` reaches gigabytes,
`~/.codex/logs_*.sqlite` hundreds of megabytes, `~/.claude/projects` hundreds
more, and none of the three CLIs offers a way to prune any of it.

- `lib/agentpack/cleanup.ts` — the catalog and its pure logic. `CLEANUP_TARGETS`
  is path-based (removed); `CLEANUP_CONFIG_TARGETS` is key-based (edited). Plus
  `specsFor` (resolve → backend specs), `rowsFrom` (fold per-path stats into one
  row per target), `safeSelection`, `groupByCategory`, `formatBytes`.
- `src-tauri/src/cleanup.rs` — `cleanup_roots` / `cleanup_scan` / `cleanup_apply`
  / `cleanup_quarantine_{list,restore,purge}`.
- `components/agentpack/sections/cleanup/` — `index` (rows, filters, selection),
  `scan` (one pass: measure paths, read config files), `trash-card`.

Five rules, each of which is why some part of the above looks the way it does:

1. **The catalog is candidates; the scan is truth.** Every entry is a place an
   agent _might_ write. Nothing renders until a scan says it exists and how big
   it is, so a machine without OpenCode never sees an OpenCode row.
2. **The frontend never picks the path.** `cleanup.rs` re-derives every root
   itself (`allowed_roots`) and holds a deny-list (`protected_paths`) covering
   credentials, live config and the skills roots. A spec pointing at a bare root
   is refused unless a glob narrows it — "sweep this whole agent directory" is
   not expressible. `is_container` vs `is_cleanable` is that distinction: a root
   may be _read_, never _removed_.
3. **A directory named as a target survives; its entries are what go.** Which is
   why the catalog targets `plugins/cache`, not `plugins` — and why
   `installed_plugins.json` next to it can't be taken by accident.
4. **Removal is a move.** The default mode renames into
   `~/.agentpack/trash/<batch>/` — instant for gigabytes, and undoable. The batch
   id comes back as the step's `artifact`, i.e. its restore point, exactly like a
   config snapshot. A restore **skips** a path the CLI has reoccupied rather than
   overwriting it. `cleanup_quarantine_purge` is the only irreversible call in
   the module, and it is never part of a run.
5. **Every removal still goes through the review panel** (invariant 5 above), as
   a `cleanup` step whose `entries` were measured by the scan — so the preview
   names every path and its real size without touching anything.

⚠️ Hooks are a **key inside `settings.json`**, not a file. `claude-hooks` is a
`CLEANUP_CONFIG_TARGETS` entry and rides `mergeFile`, which snapshots to
`.agentpack.bak` first; a cleanup step would have moved the whole file and taken
the user's model, permissions and status line with it. Every `edit` returns
unparseable input verbatim, so a file we couldn't read is never rewritten.

⚠️ `cleanup::opencode_data_candidates` is shared with `history/opencode.rs` on
purpose. Two independent candidate lists would drift, and then this would clear a
database the usage dashboard was never reading.

### Chat history & usage statistics

The **Chat history** section reads, renders and aggregates past sessions from all
three CLIs (Claude Code JSONL, Codex rollout JSONL, OpenCode SQLite). Same hybrid
split:

- `src-tauri/src/history.rs` — reads the three on-disk formats **read-only** and
  normalizes each into one model (`SessionSummary` for the list, `SessionDetail`
  for a transcript, `SessionSeries` for the dashboard). Commands:
  `history_list_sessions`, `history_usage_series`, `history_get_session`,
  `history_get_part_text`. Per-CLI parsers live in `src-tauri/src/history/`
  (`claude`, `codex`, `opencode`, `scan`, `util`).
- `lib/history/` — browser-safe pure logic: `types` (mirrors the serde output),
  `stats` (usage aggregation + per-session cost), `pricing` (the **per-model $/1M
  pricing table** — cost is exact for OpenCode, estimated from tokens for
  Claude/Codex), `blocks` (5-hour billing windows, burn rate, projection),
  `range` (presets / granularity / period-over-period), `series` (analysis over
  the packed event stream), `insights` (cost distribution, outliers, branches),
  `export` (CSV/JSON), `markdown` (safe tokenizer for the transcript renderer),
  `format`/`display` (formatting + source colors). All fully unit-tested.
- `components/agentpack/sections/history/` — the UI: `index` (Sessions/Usage
  tabs, prop-driven like `dashboard`; both scans are owned + lazily cached in
  `app-shell`), `session-browser`, `transcript`, `markdown-view`, and `usage/`
  (Overview / Cost & windows / How you work sub-tabs over one shared `view`).

  The frame is the shared one: `SectionShell` + one `SectionStatus` band, and
  both toolbars are `FilterToolbar`s. Two rules the band depends on — its facts
  are labelled **"All …"** because the usage dashboard states the same
  quantities for a chosen period one tab down, and two figures called "Total
  tokens" that disagree are worse than no summary; and a session row keeps its
  meta on **one clipped line**, because five wrapping meta items turn a 56px row
  into a 200px one at phone width and a list whose row height follows the
  viewport can't be scanned.

**Two caches, one pass.** `history_cache.rs` holds both: `history-cache.json`
(summaries, parsed at startup) and `history-cache.series.json` (the per-message
series — ~200k packed events, ~9 MB, read only when the dashboard opens). A file
is a cache hit only when **both** halves match its `(mtime, size)`, which is what
keeps a single read of the ~3 GB on disk serving both. Cold scan ≈ 17 s, warm
rescan ≈ 200 ms; progress streams over a `Channel`. Bump `CACHE_VERSION` when a
summary's parsed _values_ change, `SERIES_VERSION` for the series.

⚠️ **Claude writes one JSONL line per content block** of a streamed assistant
turn — each repeating the same `message.id`, `requestId` and whole-turn `usage`.
`ClaudeAcc` dedupes on `(message.id, requestId)` (plus a sidechain guard);
without it tokens read ~2.4× high. Content blocks are _not_ duplicated across
those lines, so tool counting deliberately sits outside the usage gate.

Two accounting rules run through `computeUsageStats` and must not drift: **every
transcript contributes tokens and cost, only top-level ones count as sessions**
(sub-agents are 57% of Claude's files), and an **unpriced model is reported as
unpriced**, never as a real `$0`.

Update `lib/history/pricing.ts` when model prices change — the date is in its
header comment. `longContext` belongs only on models that really surcharge
oversized prompts (Sonnet 4.5/4.0); Sonnet 4.6 and Opus 4.6+ are flat-rate.

### Docs Structure (`docs/`)

- `docs/app/` - Next.js App Router for the docs site
  - `docs/app/layout.tsx` - Root layout with `RootProvider` (from `fumadocs-ui/provider/next`)
  - `docs/app/docs/layout.tsx` - `DocsLayout` with sidebar
  - `docs/app/docs/[[...slug]]/page.tsx` - Dynamic MDX page
  - `docs/app/api/search/route.ts` - Orama full-text search
- `docs/lib/source.ts` - Fumadocs loader (imports from `collections/server`)
- `docs/source.config.ts` - Content collection definition
- `docs/content/docs/` - MDX content files and `meta.json` sidebar config
- `docs/.source/` - **Auto-generated** by fumadocs-mdx at dev/build time (gitignored)

**Docs-specific import conventions:**

- Source loader: `import { source } from "@/lib/source"` (NOT `@/app/source`)
- Collection output: `import { docs } from "collections/server"` (tsconfig alias → `.source/`)
- Provider: `fumadocs-ui/provider/next` (NOT `fumadocs-ui/provider`)

### Installed shadcn/ui Components

All components are pre-installed — import directly, do not run `shadcn add` for these:

`accordion` · `alert` · `alert-dialog` · `aspect-ratio` · `avatar` · `badge` · `breadcrumb` · `button` · `button-group` · `calendar` · `card` · `carousel` · `chart` · `checkbox` · `collapsible` · `combobox` · `command` · `context-menu` · `dialog` · `direction` · `drawer` · `dropdown-menu` · `empty` · `field` · `form` · `hover-card` · `input` · `input-group` · `input-otp` · `item` · `kbd` · `label` · `menubar` · `native-select` · `navigation-menu` · `pagination` · `popover` · `progress` · `radio-group` · `resizable` · `scroll-area` · `select` · `separator` · `sheet` · `sidebar` · `skeleton` · `slider` · `sonner` · `spinner` · `switch` · `table` · `tabs` · `textarea` · `toggle` · `toggle-group` · `tooltip`

⚠️ There is **no** app-wide `TooltipProvider`. `HelpTip` carries its own, and so
must any other surface using `Tooltip` directly (`sidebar.tsx`, the cleanup
section's risk chips) — a bare `Tooltip` throws "must be used within
TooltipProvider" the moment it renders.

⚠️ `calendar-heatmap` also lives here but is **not** from the shadcn registry: it
is vendored from `rutopio/shadcn-heatmap` (MIT) at a pinned commit, recorded in
the file's header. Its registry item carries `cssVars` that write raw `oklch(...)`
values for `--secondary`, `--chart-1` and `--muted-foreground` into
`app/globals.css` — **revert those** if you ever re-run the CLI for it. Colour
values belong in `tokens.css` (see design.md); the component reads the shadcn
variable _names_, so it picks up this repo's palette without them.

### Tauri Integration

- `src-tauri/` - Rust backend
  - `tauri.conf.json` - Config pointing `frontendDist` to `../out`
  - `beforeDevCommand`: runs `pnpm dev`
  - `beforeBuildCommand`: runs `pnpm build`

**Plugins** (`src-tauri/src/lib.rs`, each with a `lib/tauri/*.ts` bridge):
`updater`, `window-state`, `dialog`, `process`, `store`, `opener`,
`notification`, `os`, `clipboard-manager`, plus desktop-gated `single-instance`
and `global-shortcut`. Every plugin permission lives in
`capabilities/desktop.json` — `default.json` stays minimal. `single-instance`
**must remain the first registered plugin** (plugins run in registration order,
and it has to reject a duplicate launch before anything else touches state).

**Frameless window.** The window has no OS title bar; `components/agentpack/
window-chrome.tsx` decides what to draw from `@tauri-apps/plugin-os`:

- **macOS** — `tauri.macos.conf.json` keeps `decorations: true` with
  `titleBarStyle: "Overlay"` + `hiddenTitle`, so the _native_ traffic lights
  float over the content at `trafficLightPosition`. We draw no buttons; the
  sidebar just takes `MACOS_TRAFFIC_LIGHT_INSET` of top padding to clear them.
- **Windows / Linux** — `decorations: false` in the base config, and
  `<WindowControls>` renders minimize / maximize / close into the header.

⚠️ `tauri.conf.json` and `tauri.macos.conf.json` **both carry the full window
object**: Tauri merges platform config with RFC 7386 JSON Merge Patch, which
replaces arrays wholesale rather than merging them. Change one, change both.

The header (and the sidebar's brand block) carry `data-tauri-drag-region="deep"`,
which makes the whole subtree draggable _except_ clickable elements — Tauri's
drag script bails on `BUTTON`/`INPUT`/`SELECT`/`TEXTAREA`/`LABEL`/`A`/`SUMMARY`,
anything `contenteditable`, and anything with an interactive `role` or a real
`tabindex`. Keep header controls as real interactive elements and they keep
working; swap one for a bare `<div>` and it becomes a drag handle. Edge-resizing
needs no code — tao hit-tests borders on Windows and calls `begin_resize_drag`
on GTK.

### Styling System

- **Tailwind v4** via PostCSS (`@tailwindcss/postcss`)
- CSS variables for theme colors (oklch color space) in `globals.css`
- Dark mode: class-based (apply `.dark` to parent element)
- Custom variant: `@custom-variant dark (&:is(.dark *))`

### Path Aliases

`@/components`, `@/lib`, `@/utils`, `@/ui`, `@/hooks` - all configured in tsconfig.json and components.json

## Code Patterns

```tsx
// Always use cn() for conditional classes
import { cn } from "@/lib/utils"
cn("base-classes", condition && "conditional", className)

// Button composition with asChild
<Button asChild>
  <Link href="/path">Click me</Link>
</Button>
```

```tsx
// Calling Rust from the frontend (Tauri only). isTauri() gates it; every
// command itself comes from lib/tauri/commands.ts, the only caller of invoke.
import { isTauri } from "@/lib/tauri"
import { detectCli } from "@/lib/tauri/commands"
if (isTauri()) {
  detectCli("claude").then((d) => console.log(d.installed))
}
```

```tsx
// Web mode (pnpm dev) can't reach the machine. Say so rather than rendering a
// blank card or a badge-less row — and never toast success after a skipped write.
import { DesktopOnlyNote } from "@/components/agentpack/desktop-only-note"
{
  !isTauri() && mounted ? <DesktopOnlyNote>{t.tools.notTauri}</DesktopOnlyNote> : null
}
// `mounted` (useMounted) is required: isTauri() is false in the pre-rendered
// HTML, so an ungated note hydration-mismatches.
```

## Critical Notes

- **Always use pnpm** (lockfile present); run `pnpm install` from repo root to install all workspaces
- **Tauri production builds require static export**: `next.config.ts` (main app) has `output: "export"` — do not remove it
- **Docs does NOT use static export**: `docs/next.config.ts` is full server mode — keep them separate
- **Rust toolchain**: Requires v1.77.2+ for Tauri builds
- **Docs `.source/` is generated**: run `pnpm docs:dev` or `pnpm docs:build` once before TypeScript resolves `collections/server`
- shadcn/ui configured with "new-york" style and RSC mode
- **Commits are gated**: `.husky/pre-commit` runs `lint-staged` (eslint --fix +
  prettier) and `.husky/commit-msg` checks the message — a commit can rewrite
  your staged files
- **CI**: 9 workflows in `.github/workflows/` — `ci`, `test`, `quality`, `e2e`,
  `rust`, `catalog-audit`, `build-tauri`, `release`, `deploy`
- **Web mode is a real target**, not a degraded preview: `e2e/` exercises it, so
  a section that can't work without Tauri must say so (`DesktopOnlyNote`) rather
  than render blank — and must never confirm a write it skipped
- `docs/content/docs/` currently holds one placeholder page; the Fumadocs site,
  its sidebar and its Orama search route are all wired but have nothing to index
