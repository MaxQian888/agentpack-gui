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
  plus `workspaces` (the seven task domains over the twenty-five `SectionKey`s),
  `appearance` (the interface-scale vocabulary),
  `inventory` (the machine's asset list — see below),
  `recovery` (every restore point, folded — see below),
  `diagnostics` (the overview's to-do list, derived from it), `palette` (⌘K contents),
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
owns the mapping — the twenty-five `SectionKey`s are the target of every
navigation, grouped into **Overview · Install & repair · Capabilities · My
account · Accounts & quota · Usage · Settings**. Below 900px the rail becomes a
Sheet.

Adding a section means touching six places, and `workspaces.test.ts` fails until
the first two agree: the `SectionKey` union, `WORKSPACES`, the hand-written list
in that test, `SECTIONS` in `sidebar-nav.tsx` (label + icon), `SECTION_LABEL` in
`palette.ts`, and `NAV` in `e2e/helpers.ts`. The guided tour and the ⌘K palette
both walk `SECTIONS`, so a new one needs `menu.*` and `tour.steps.*` copy in
both catalogs or the tour renders an untitled step.

**Five shared primitives carry every section's chrome.** Use them rather than
hand-rolling the shape again: `section-shell` (heading + subtitle + `help` +
`actions`), `capability-workbench` (that shell plus the lead / primary / aside /
detail grid), `section-status` (the summary, as one band of measured facts — the
row of uniform stat tiles is banned, see design.md), `section-nav` (an aside's
destinations as one ruled panel), `section-view` (the one panel a destination
has open) and `filter-bar` (`FilterToolbar` + `ScopeChip` + `SearchField` +
`MoreFilters`, the two-tier toolbar over any inventory list). `scopeChipClass` is exported so a control that must build its
own trigger — the usage dashboard's custom-range pill — is the same object as
the chips beside it. A section that draws its own header drifts: History did,
and ended up the one page whose title sat at a different width from its
neighbours with the tour anchor re-added by hand.

⚠️ **`<main>` is one scroll container for every destination**, so the shell
resets it to the top whenever `section` changes and replays the `hm-enter`
entrance on the content wrapper — by restarting the CSS animation, not by
keying the wrapper, because a key would remount the more-token views that share
state across their tabs. Arriving mid-page on a new tab read as a missed click.

⚠️ **A `SectionNav` choice swaps the primary column; it does not append below
it.** Skills and MCP both used the workbench's full-width `detail` band for
this, and on a machine with twenty-odd skills that put the catalog a screen and
a half under the installed list — the click read as having done nothing. So the
nav lists _every_ view including the inventory (`tabInstalled` is a choice, and
the way back), and `SectionView` renders whichever one is active. It scrolls
itself into view when the choice changes but **not on first render** — arriving
in a section must leave its heading and status band on screen — and passes no
`behavior`, so the reduce-motion rules in `globals.css` still decide whether the
jump animates. The `detail` slot stays for what it is for: a panel read across
the full width regardless of what else is open, like ccswitch's provider list.

⚠️ **`CapabilityList` scrolls inside itself** past `--hm-list-max-h`, and that is
the other half of the same fix. A list's length is the machine's, not the
design's, so an uncapped one lets the number of installed skills decide where
everything below it sits. Capped, the page is the same shape on every machine.
Category headings are `sticky` for the same reason — a scrolling panel needs to
say which group you are in.

**Settings is four tabs, and each answers one question.** `preferences` is how
the app looks and behaves, `config` is profiles + backup + the CLIs' own config
files, `recovery` is every way back the app has left behind (see below), `about`
is which build this is. Keep them apart: About used to carry
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

### The machine inventory

`lib/agentpack/inventory.ts` is the single normalized answer to "what is
actually on this machine?". It **folds readings the app already took** — the
dashboard scan, the CLI detections, the startup network probe — into one
`Asset[]`, and `diagnostics.ts` derives its findings from that rather than from
seven loose parameters. Before it, three surfaces described the same machine in
three shapes, which is how two of them end up disagreeing.

Four rules the shape enforces:

1. **Nothing here measures anything.** Pure and browser-safe, like `scan` and
   `diagnostics`. A missing reading produces a missing asset, never a probe.
2. **Candidates are not assets.** The registry says what _could_ be installed;
   an asset is what a reading found. A machine without OpenCode has no OpenCode
   row — what is expected but absent is `DriftItem`, a comparison against a
   profile, not a property of the machine. `driftFrom` returns nothing at all
   for an unmeasured inventory, or every asset would read as missing and the
   fix would be to reinstall a machine that is already complete.
3. **Observed is not verified.** `health.status` is what the reading showed;
   `health.verifiedAt` says whether anything exercised the asset. A declared MCP
   server is `healthy` with **no** `verifiedAt` — the config parses and names
   it, and nothing tried to start it. `unknown` means "we could not look", never
   "probably fine".
4. **No secrets, by construction.** Every field is copied explicitly, and the
   ones that could carry credential material (a provider's `settings_config`, a
   relay token, an MCP `env`) are not copied at all. This model is the intended
   input to the profile/export formats, so `inventory.test.ts` serializes a whole
   inventory and asserts a planted token never appears in it.

⚠️ `restorePoint`'s **presence is the claim that a rollback exists** — it is set
only when there is both a backup and somewhere to write it back to. Diagnostics
offers Restore on exactly that, so a surface that infers a rollback any other
way will offer a repair that cannot happen.

### The maintenance inbox

`diagnostics.ts` decides **what is wrong**; `lib/agentpack/inbox.ts` decides
**how you get through it** — grouping, selection, and applying one repair to
several findings at once. Every `DiagnosticItem` carries a `category`
(`DiagnosticCategory`, the axis the inbox filters and groups on) alongside its
`severity` (the axis it _ranks_ on — grouping by category would put a blocking
finding underneath an optional one).

There is still no "fix all", and the rule that bans it is what makes batching
legal: across upgrades, restores and installs there is no honest label for one
button, but **a batch restricted to a single action kind can be named exactly**
("Upgrade 3 tools"). Four rules follow:

1. **A batch is keyed off the action, not the topic.** `batchKeyOf` reads
   `item.action.run.kind` and nothing else, so the two findings that both say
   "an update is out" split apart when one is really a `navigate` — the
   Node-floor case, where npm would refuse the upgrade. A key derived from the
   item's family would have swept it in and staged a command known to fail.
2. **A mixed selection is not a batch.** `batchFor` returns `null` rather than a
   partial batch: quietly dropping the picks that didn't fit would run a button
   whose label counted them. The footer bar simply doesn't render.
3. **A batch of one is not a batch** (`MIN_BATCH`). The row's own button already
   does exactly that.
4. **Nothing executes here.** Actions come back as data; the caller maps them
   onto steps and the review panel still gates every one (invariant 5 above).
   `dashboard.tsx`'s `actOnBatch` is all-or-nothing for the same reason as rule 2.

⚠️ `CATEGORY_ORDER` is deliberately **ahead of the findings**: `usage` and `disk`
have no producer yet, because nothing measures a budget or free space in a shape
this list can read. `groupInbox` only emits categories that have items, so an
unproduced category can't render as an empty filter chip — name the category
when you write its producer, don't stub a finding to fill it.

### Reproducing an environment elsewhere

`bundle/format` already carries a whole machine in one file and `bundle/apply`
already diffs an incoming bundle against local **intent** — plan vs plan,
profiles vs profiles, settings vs settings. `lib/agentpack/migrate.ts` adds the
two things that were missing for "rebuild this environment somewhere else":

- **`compareToMachine`** judges a profile against the **inventory**, not against
  another plan — `expectedFrom(plan)` turns a plan into `ExpectedAsset[]` and
  `driftFrom` does the rest. A CLI's asset id needs its `kind`, so a tool the
  registry no longer knows is **skipped rather than guessed at**: an id built
  from a guess matches nothing and would report a satisfied machine as missing.
  An unmeasured inventory yields no claims at all (inherited from `driftFrom`).
- **`pendingCredentials`** is the honest completion of an import: a transfer file
  never carries credentials, so the last thing it can do is name precisely which
  ones it withheld. Three sources, each read from the artefact — key-gated MCP
  servers with no key in the plan, an **active** proxy missing its password or
  client-key passphrase, and the blanked fields still sitting in the carried
  config texts.

⚠️ That last one goes through `blankedSecrets` in `bundle/secrets.ts`, which
reads the **redacted** text and reports the dotted paths a secret-looking key
left empty. It must stay there, beside `SECRET_KEY` and `redactNode`: a checklist
written from its own idea of what counts as a secret drifts from the redaction
the moment either changes, and the direction it drifts in is "we forgot to tell
you about this key". It over-reports for the same reason the redaction
over-blanks — `credentials.user` is listed alongside `credentials.password`.

`pendingCredentials` is wired into the import dialog. `compareToMachine` is not
yet on a surface; version pins (`ExpectedAsset.version`) are supported by the
model but nothing writes them, because `Plan` carries no versions.

### The recovery timeline

This app takes **four different kinds of backup**, each written by a different
part of it and each listed by its own command: provider-store snapshots
(`backup.rs`), skill backups (`skills.rs`), quarantined cleanup batches
(`cleanup.rs`), and the `.agentpack.bak` sibling `mergeFile` leaves next to a
config it edits. `lib/agentpack/recovery.ts` folds all four into one
`RecoveryPoint[]`, newest first — four lists in four places is four chances for
someone to conclude there is no way back from a change there has been a way back
from all along.

⚠️ **`RecoveryPoint.id` is not what a restore takes.** `restoreId` is: a snapshot
id, a skill-backup id, a quarantine batch id, or (for a `.agentpack.bak`) the
_live_ config path, because `fileRestoreStep` appends the suffix itself.

The dangerous case this exists for is `restoreSafety`: someone edits
`~/.claude/settings.json` in a text editor, comes back here to undo something
else, and a restore puts the file back to before their edit. None of the four
mechanisms notices, because each only knows about its own writes. So:

- `stale` — a path this would write over is **newer** than the backup.
- `safe` — every path is older, or absent (nothing to lose).
- `unknown` — an undated point, a point naming no path, a path nothing measured,
  or an mtime the platform wouldn't report. **Never rendered as safe.** Worst
  verdict wins, and `stale` outranks `unknown` — a measured danger beats an
  unmeasured one.

`fsops::file_stat` exists for exactly this, and its `modifiedMs: 0` means
**unknown, not 1970** — reading it as a date would make every unmeasurable file
look older than every backup, i.e. always safe to overwrite. A missing path is
`exists: false` rather than an `Err`, so only a real read failure rejects.

**Restoring is actioned where its consequence can be described.** Two of the four
kinds restore from this page, through the review panel, exactly like the
provider-store restore in `ccswitch/index.tsx` — a `snapshotRestore` step for a
provider snapshot, a `fileRestore` step for a `.agentpack.bak`. The other two
hand off: `restoreSkillBackup` needs the list of agents to restore _into_, and a
quarantine batch is a bag of paths worth reading first. Neither answer is one
this page can ask for, so it sends the user to Skills / Clean up rather than
picking for them.

⚠️ A **`stale` restore asks twice** — an AlertDialog here, then the review panel.
That is proportionate for the one case on the page that actually destroys work;
asking on every restore would teach people to click through both gates. A
successful restore re-reads the timeline, because a restore moves the very
mtimes every verdict on the page was measured against.

⚠️ A **self-guarded** point is `safe` unconditionally, and `pathsToCheck` skips
it. `cleanup_quarantine_restore` already refuses to overwrite a path the CLI has
reoccupied, so warning about it would train people to ignore the warning that
matters. Undated points sort **last**, not first: a `.agentpack.bak` with no date
is not "from 1970", and at the top of a timeline it would claim to be the most
recent thing that happened to the machine.

⚠️ **`ShellBody` must not subscribe to `detections`, `latestVersions`,
`cliManagers` or `networkProbe`.** `refreshDetections` writes the last three
**once per installed CLI, un-batched** (a `latestVersion` and an `npmOwns` promise
each), so one subscription there re-renders the entire window ~20 times on every
startup and Rescan — the header, the tab strip, `<main>` and whatever section the
user is scrolling with it. The one surface that needs those slices
(`ExecutionPanel`, for the pre-flight brief's "already installed" count) reads
them itself and folds the inventory only while the panel is actually asking. The
shell passes it the raw `dashboardScan`, which it already owns.

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

6. **The panel briefs before it asks.** `lib/agentpack/preflight.ts` turns the
   staged `StepDescriptor[]` into sentences (`PreflightBrief`, above the step
   log): what needs an administrator, which prerequisite is here that nobody
   picked, which server will install and then not answer without its key, what
   is being left alone. Three rules: it **reads the steps, never the plan** —
   `buildSteps` is the only thing that decides what a plan becomes, and a brief
   re-deriving that would introduce a run it disagrees with; a **blocker is not
   a veto** — a step needing a human blocks that item, never Apply, because
   turning one impossible item into "you can install nothing" costs the user the
   nine good steps; and an **unmeasured inventory yields no claims** — the
   "already installed" count is `null`, not `0`, until something has looked.
   `useRunner` exposes `pendingSteps` for this; `pendingCount` is derived from
   it so no path can update one and forget the other.

7. **A failed step gets an explanation, not just a colour.**
   `lib/agentpack/failure.ts` reads one `StepReport` and returns a plain-language
   cause, what to do, and the tool's own line as evidence; `FailureNotes` renders
   it above the warnings in the completion screen, with a button to the page that
   fixes it. Four rules: **every reading ends somewhere real** — Node too old →
   Runtimes, no disk → Clean up, refused download → Network, refused rights →
   CLIs (some tools publish a user-scope method); **an unreadable failure says
   so** — `unknown` is a real verdict with honest advice and _no_ destination,
   never the nearest-sounding guess; **the patterns live in one place** — the
   network / permission / notFound verdicts come from `classifyFailure`, the same
   function the retry ladder gates on, so an explanation and an automatic retry
   can't disagree (`failureEvidence` hands back the matching line so nothing
   outside `recovery.ts` re-spells a pattern); and **one reading per cause, not
   per step** — `groupFailures` folds five steps that died on the same blocked
   download into one problem with one fix.

⚠️ A **preview** gets no diagnosis. A dry run wrote nothing, so a reading about
why it "failed" would be about a run that never happened.

⚠️ The wizard's last button is **"Review and install"**, not "Install now", and
`welcome.installIntro` says the changes come next. It used to promise the run
started there; it never did — it stages, and the panel is where a human says
yes. Copy that describes a gate as if it weren't one is how the gate reads as
the app refusing the click that was just made.

Also: the completion screen derives its next action and chores from `reports`,
not from `plan` — with **no step at all** reading as success, because the dedup
emits nothing for what's already installed.

⚠️ The plan it reads is **`useRunner().runPlan`**, the snapshot `run()` took
from `opts.plan` — never the live store plan. `reviewChanges` resets the live
plan the moment a run succeeds, which used to take "Open Claude" and the API-key
to-dos with it; and a run that wasn't built from a plan (an MCP add, a restore)
gets `null`, so it is never briefed or finished on the strength of whatever
happens to be sitting in the tray. `PreflightBrief` reads the same snapshot.

⚠️ **One run at a time.** The panel can be closed mid-run and the page behind it
stays live, so `run()` refuses (toast + reopen the panel) while steps are
executing; the header shows `Running n/m` while the panel is closed.
`applyPending` captures its awaiter _before_ the await. A caller deciding what a
result means uses **`runApplied(reports)`** (`lib/agentpack/report.ts`) — `[]`
is a walked-away review and `skipped` is a cancel, and neither may toast
success, clear a form, or drop an "update available" flag.

⚠️ The change tray counts network config **against what is already applied**
(`unappliedNetwork`: `settings.proxy` plus the store's `appliedNpmRegistry`).
Counted raw, a proxy restored at startup was a permanent "1 selected" that Clear
couldn't clear and every review re-wrote. `reviewChanges` strips the applied part
before `buildSteps` and records what a successful run applied; the tray's Clear
is `clearSelection`, which also drops an unapplied mirror or proxy.

⚠️ The **activity log** (`~/.agentpack/activity.json`) records what ran, and its
redaction is a deliberate line, not an oversight: title, source, timestamp,
outcome, per-step status/duration and any restore point — never command output,
config bodies, env vars or API keys. `recordRun` copies fields explicitly rather
than spreading `StepReport`, so the next field added there can't leak by
default. Previews write no record at all. The ⌘K palette is bound by the same
rule: it indexes destinations and app actions, never content.

### Pi packages

The **Pi** section (Capabilities → Pi) manages one Pi settings file at a time:
the packages it loads, which of each package's resources are switched on, how
Pi authenticates, and the extra folders the history scan reads.

- `lib/pi/` — `types`, plus `management` (the pure half: official `pi` argv,
  settings merges, `piResourcePathEnabled` for Pi's narrowing globs and exact
  `+path`/`-path` overrides, `redactPiPackageSource` and
  `isSafePiPackageSource`), backed by `src-tauri/src/pi_management.rs`.
- `components/agentpack/pi-controller.ts` — shell-owned scans and mutations.
  The section renders the controller and owns no fetching of its own.
- `components/agentpack/sections/pi/` — `index` (the `CapabilityWorkbench`
  frame plus the permission gate), `scope-bar`, `packages`, `browse`, `auth`,
  `sessions`, `package-detail-dialog`, `helpers`.

Five rules, each of which is why some part of the above looks the way it does:

1. **A reading is stamped with the scope it was taken for.** `scopeKey` is
   `global` or `project:<cwd>`, and a snapshot is shown only while its stamp
   still matches. Without it, the moment after a scope change showed the
   previous scope's answer under the new scope's heading, and picking Project
   with no folder yet left the global packages on screen labelled Project.
2. **Not-yet-looked is not empty.** `scanPending` is true until a reading for
   the current scope has come back, error included. The list used to render
   "no packages are configured in this scope" during the first scan, which
   states as fact the one thing nothing had checked. A failed scan records a
   null reading rather than nothing at all, so the spinner clears.
3. **The source is judged before consent is asked for.**
   `buildPiPackageSteps` has always refused a URL carrying credentials, but it
   refused after the user approved "run this with my full permissions". The
   install field now shares that predicate and disables itself first.
4. **Facts are tags, exceptional state is a chip.** `sourceKind`, version,
   `pinned` and `inherited` set as muted text beside the name. Only a package
   whose folder is gone and one the project overrides draw a `RowChip`, which
   is what keeps a chip meaningful when one appears. A disabled resource
   toggle always carries its reason.
5. **The common resource action is in the row, the rare one is in the dialog.**
   Pressing a resource chip switches a whole kind. Per-file `+path`/`-path`
   overrides live in the package's own dialog, which is also the only surface
   with room to say that a declared glob cannot be switched at all.

⚠️ `PiResourceState.enabled` hides three answers, not two: off, on in full, and
on with Pi's globs narrowing it to a subset. `piResourcesOnFor` resolves them, and
the chip reads `2/5` rather than claiming a kind is on when a `-path` override
turned most of it off.

⚠️ The controller is gated on `isTauri()` as well as on the detection. Web mode
has no Rust behind it, so a scan there is not a degraded reading, it is an
`invoke` that throws and an error toast on a page that says `DesktopOnlyNote`.

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
  tabs, prop-driven like `dashboard`; both scans live in `use-history-scans`,
  called once from `app-shell` so they survive navigation), `session-browser`,
  `transcript`, `markdown-view`, and `usage/` (Overview / Cost & windows / How
  you work sub-tabs over one shared `view`).

  ⚠️ `use-history-scans` stamps every scan with a generation and drops a result
  from an older one, and it records a rejected scan as a `WHOLE_SCAN` error —
  never as `{ sessions: [] }`, which every surface reading it (the spend card,
  the session list, the dashboard) would state as "no history". Both tab panels
  stay mounted once visited, so switching tabs keeps period, filters and scroll.

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
