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
- `components/agentpack/` - the agentpack installer UI (shell, header, sidebar, sections, run panel),
  plus `onboarding-dialog` / `onboarding-network-step` / `guided-tour` (the three
  guidance surfaces), `quick-install-dialog`, `config-io`, `bundle/*-dialog`,
  `desktop-only-note`
- `hooks/` - Shared hooks: `use-mobile`, `use-mounted`, `use-incremental`
- `lib/utils.ts` - `cn()` utility (clsx + tailwind-merge)

⚠️ `jest.config.ts`'s `collectCoverageFrom` covers `app/ components/ lib/` only,
so `store/` and `hooks/` are outside the 90% gate even where they have tests.

### agentpack desktop app

The home page (`app/page.tsx`) renders the **agentpack** installer — a GUI port of
the terminal `agentpack` TUI that sets up Claude Code, Codex, engineering skills,
MCP servers, network/mirrors and cc-switch.

**Hybrid architecture (pure TS logic + Rust side-effects):**

- `lib/agentpack/` — browser-safe pure logic (no Node builtins): `registry`,
  `presets`, `types` (incl. `StepDescriptor`/`Paths`), `config`, `report`,
  `locale`, `scan`, `profile`, `release`, `version`, `merge/{mcp,network}`,
  `network/{discovery,mirrors,probe,proxy,recovery,scan}`, `bundle/*`,
  `config-editor/*`, `mcp-{disabled,health,import}`, `ccconnect`, `ccswitch/*`.
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
  resolution + download), `net.rs` (probing), `backup.rs`, `mcp.rs`, `login.rs`.
- `lib/i18n/` — the typed bilingual catalog (`en`/`zh-CN`, `Messages = typeof en`)
  - `I18nProvider`/`useT`/`useLocale`. `store/app-store.ts` is the Zustand store.

**Dry-run is structural:** in preview mode `runner.ts` renders preview lines
locally and NEVER calls a mutating Rust command. Skills ship as Tauri resources
(`src-tauri/assets/skills/`, wired via `bundle.resources`).

### Onboarding & run invariants

Four rules the first-run and install paths depend on. Each replaced a behaviour
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

Also: the completion screen derives its next action and chores from `reports`,
not from `plan` — with **no step at all** reading as success, because the dedup
emits nothing for what's already installed.

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

`TooltipProvider` is already mounted in `app/layout.tsx` — no extra wrapper needed.

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
