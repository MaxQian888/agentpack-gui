# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Spend card on the dashboard** — month-to-date cost, tokens and sessions on
  the home screen, with the per-CLI split. Built from session summaries only, so
  it never waits on the much larger per-message series
- **Shareable usage report** — export the range you're viewing as a PNG/SVG card
  or a Markdown summary. The card is self-contained (no external font or asset)
  and carries its own caveats, so a figure can't be shared as if it were an invoice
- `write_binary_file` Tauri command, for writing the rendered PNG
- **Rust CI on all three platforms** (`.github/workflows/rust.yml`) — clippy and
  the test suite on Linux, Windows and macOS. Neither had ever run in CI, so the
  whole side-effect layer was only ever exercised on a maintainer's own machine
- `src-tauri/rustfmt.toml`, pinning the 2-space house style so `cargo fmt`
  doesn't reflow every file
- **Playwright in CI** (`.github/workflows/e2e.yml`) — the specs had never run
  there, which is how three of them came to assert markup that two refactors ago
  had stopped existing
- **The Claude and Codex desktop apps are installable targets** — the path for
  someone who has never opened a terminal. Each bundles its own copy of the
  agent (no Node, no CLI) and reads the same `~/.claude` / `~/.codex` config, so
  skills and MCP servers written for the CLI apply unchanged; they are registered
  alongside the CLIs, not in place of them. macOS resolves Claude through
  `RELEASES.json` (the documented download links answer 403 to any non-browser
  client) and Codex through Homebrew; Windows uses `winget install
Anthropic.Claude`. The Codex app on Windows is Store-only, so it surfaces a
  manual note rather than installing the CLI by mistake
- `launch_app` — opens an installed desktop app **by name**, since the platforms
  disagree about what a path is here, and waits on the launcher because that is
  the only thing that reports "no such app"
- **The first-run wizard asks window-or-terminal first.** It decides what
  "install Claude" even means, and for someone who has never opened a terminal
  the honest answer is the desktop app — so that is the default, asked on its own
  rather than buried in a bundle card. `applySurface` resolves it before targets
  are derived, so no bundle needs a GUI variant
- **The last wizard step shows what Install will do** — the assistants, skills
  and MCP servers the bundle resolves to, a green dot on what is already
  installed, and the agents each group gets configured for. Derived from
  `presetSelection()`, which is also what `applyPreset` calls, so the summary
  cannot describe a plan that won't run
- **The wizard asks for the API keys it needs.** context7 and github are both
  key-gated and both in the Recommended bundle, so the default first run used to
  install two servers that came up cleanly and then never worked. Keys stay local
  to the wizard until Install, so an abandoned wizard leaves nothing behind
- **Engineering skills are offered in the wizard.** The welcome screen promises
  them and `minimal` / `recommended` carried none, so the default path installed
  exactly zero of them. They can't ship inside the bundles because the six are
  per-stack — that would hand a Rust developer an Android playbook — so the last
  step offers them as checkboxes, seeded from the bundle and adjustable
- **A run ends with a verdict, one next action, and a list of what still needs a
  human** — a blank MCP key, signing in to Claude, Git on Windows, cc-switch
  needing to stay running. None of those are failures, so none of them used to
  make the run look anything other than green. The log is not gone, it is demoted
  behind a disclosure
- `DesktopOnlyNote`, so web mode's limits are stated in one recognisable shape
  while the wording stays per-section
- **Tests for the six untested Rust files** (1936 lines: the three per-CLI
  history parsers, their scan/util helpers, and all the cross-platform path
  maths), aimed at the documented traps — the `ClaudeAcc` dedup, Codex's
  cumulative `total_token_usage`, the real `OPENCODE_COLS` select against an
  in-memory SQLite, and `CODEX_HOME` / per-shell rc resolution. Plus runner and
  preview tests for `releaseInstall` and `snapshot`: the most side-effect-dense
  step kind, and the rollback safety net

### Changed

- The chat-history scan now runs at **startup** rather than on first visit to the
  History section, streaming progress while the dashboard's spend card holds a
  skeleton
- **In-app updates are enabled**: the updater signing key is wired up and the
  release workflow publishes signed artifacts plus `latest.json`
- Release notes now explain the macOS "damaged" (unnotarized) and Windows
  SmartScreen prompts, instead of leaving users to conclude the app is broken
- README rewritten for users; the development documentation it used to carry
  moved to `CONTRIBUTING.md`, which gained an architecture section
- **The wizard's network check only appears when it has something to say.**
  `probeSuggestsChange` answers that once and both the step and the wizard read
  it, so they cannot disagree; a healthy machine no longer reads a page of green
  ticks and presses Continue
- **The dry-run toggle is gone from the wizard** — it stays in the header, but as
  the first question a newcomer is asked it only invited the wrong answer: turn
  it on, watch every step report what it _would_ have done, conclude the install
  failed
- **Claude's MCP config is written directly when there is no CLI.**
  `claudeMcpRoute(cli, desktop)` answers `cli` / `file` / `none` once, and both
  the checkbox gate and the step builders read it. `none` emits no step at all,
  which beats emitting one that is certain to fail
- `needsNode` is derived from npx MCP servers as well as npm CLIs — an
  npx-launched server needs Node to _start_, which is a separate question from
  whether anything is being installed _through_ npm
- Run log lines are built from `writtenNote`, which was set at 27 call sites and
  read by nothing: a run now says "added Context7 to Claude Code" rather than
  "wrote /Users/x/.claude.json"
- **Dead scaffolding removed** — a parallel next-intl stack (a plugin running on
  every `next build`, a dependency and five files) serving zero imports and
  referencing a `LocaleProvider` that does not exist, plus `greet`, `lib/env.ts`,
  unread `.env.example` vars and a checked-in screenshot. CLAUDE.md re-audited
  against the tree and given an "Onboarding & run invariants" section

### Fixed

- Flaky usage-dashboard export tests that intermittently timed out under load and
  dragged global coverage below the 90% gate — turning a slow machine into a red
  build. `waitFor`'s budget is now 5s, since CI runners are slower than a laptop
- Coverage restored above the gate (branches 89.8% → 90.1%, functions 89.0% →
  91.3%) by covering the Tauri command wrappers, `mcp-import` and the syntax
  highlighter's edge cases. **This is what blocked the v0.11.0 release**
- Three stale E2E specs: the header's language and OS controls became a
  DropdownMenu, and the network section's relay fields moved to the providers
  section, but the specs still looked for the old `combobox` and `#net-base-url`
- **A run's verdict counted two of its four statuses.** `ok` and `failed` only,
  so a run the user cancelled — every remaining step turns to `skipped`, leaving
  `failed === 0` — got a green tick and "All set", and so did a run that was
  nothing but warnings. It now reads all four, warnings move above the fold, and
  Retry is offered after a cancel
- **Retry erased the run it was retrying.** The retried subset overwrote both
  `reports` and the pending list, so the first pass's successes vanished from the
  panel and from the counts, and a second retry could only draw from the
  already-narrowed list. The full list now lives in its own ref and results merge
  back by **id** — batch indices don't line up on a subset
- **The next action and the chores were read off the plan**, which says what the
  user asked for rather than what happened: a failed Claude install still
  produced an "Open Claude" button, and a failed MCP add still asked for its API
  key. Both now check the reports
- **`scanEnvironment` never rejected**, so a locked or permission-denied config
  was indistinguishable from a clean machine — and deduping against a scan that
  wrongly says "nothing is installed" re-adds everything, which `claude mcp add`
  rejects. The scan now carries `degraded` and the shell prefers the last good
  one, refusing to run when there is neither
- **Web mode went quiet instead of saying what it can't do.** The config-files
  card returned `null` (the editor, eight files and their badges vanished without
  a word), the CLI and runtime sections dropped every status badge, which reads
  as "you have none of these" — and, worst, saving a profile fired
  `toast.success` even though `persist()` no-ops outside Tauri. `persist()` now
  reports whether it actually wrote
- **The welcome wizard could not be opened in web mode at all**: it was gated on
  persisted progress, and the effect that reads those settings returns early
  outside Tauri, so the gate never released
- **Every way out of the wizard wrote `onboarded: true`** — Esc, the overlay, the
  tour link — so one mis-click on question 1 meant never being greeted again.
  Only "Maybe later" and Install mark it now; the rest save `onboardingProgress`
  and the next launch resumes where the user left off
- The vanishing-step fallback did the opposite of its comment: when a healthy
  network drops the `network` step, `Math.max(0, Math.min(indexOf, len - 1))`
  turned `indexOf`'s `-1` into `0` and threw the user back to question 1
- `AGENT_OF` knew only the three agent CLIs, so a desktop-only selection fell
  through `mcpTargetsFor`'s "nothing selected" fallback and left the Codex app
  with no MCP servers at all
- The MCP catalog and matrix greyed out the Claude column on a machine with only
  the desktop app — which reads `~/.claude.json` perfectly well, and whose
  servers are exactly the ones the first-run wizard promises
- The `ccProvider` preview line was built by hand instead of from the catalog, so
  a zh-CN dry run printed English — and printed the internal op verb,
  `setCurrent`, at that
- The network step decided "adopted" from the npm registry and proxy alone, so a
  GitHub-only suggestion left the Adopt button live forever and each further
  click silently re-applied it. PyPI and Homebrew mirrors are now marked as
  retry-only env vars rather than listed as if Adopt would write them

## [0.11.0] - 2026-07-20

_Tagged but never published — the release build failed the coverage gate._

### Added

- Complete MCP management: catalog, custom servers, import/export, health probes
- Skill install-conflict resolution when a name already exists in a target root

## [0.10.0] - 2026-07-14

### Added

- Richer MCP and skills managers, with a shared syntax highlighter behind both

### Changed

- Capped Jest workers and bounded worker memory to speed the suite up

## [0.9.0] - 2026-07-12

### Added

- OpenCode as a third MCP target, alongside Claude Code and Codex
- cc-connect: one-click dashboard and a TOML config editor tab

## [0.8.0] - 2026-07-10

### Added

- cc-connect config editor, with a web-admin toggle and port lifecycle control

## [0.7.0] - 2026-07-06

### Added

- Skills manager spanning Claude Code, Codex and OpenCode
- cc-connect bridge management section

## [0.6.0] - 2026-07-06

### Changed

- Runtime updates are gated on package-manager ownership: a Node installed by
  nvm or a vendor installer gets a download link rather than an in-place update
  that would fail or leave a shadowing duplicate

## [0.5.0] - 2026-07-06

### Added

- Guided onboarding and one-click install, with in-place CLI upgrades
- Chat history & usage statistics section
- Cost and activity charts, plus per-session averages
- Per-CLI install-method picker and in-app self-update

### Fixed

- Hardened the environment scan and fixed a dashboard hydration mismatch

### Performance

- Cached session summaries and invalidated transcripts by change
- Windowed long lists and cached transcripts

## [0.4.0] - 2026-07-04

### Changed

- Tool state stays live after an install, upgrade or uninstall — no app restart
  needed for badges and actions to reflect reality

## [0.3.0] - 2026-07-03

### Added

- cc-switch: database initialization, live-config sync, backups, and runtime
  prerequisite checks

## [0.2.0] - 2026-06-25

### Added

- Multi-platform auto-publishing release pipeline: pushing a `v*` tag builds
  Linux/Windows/macOS installers and publishes a GitHub release automatically
- `verify-version` release gate: the pushed tag must match the version in
  `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, so a
  release only happens after a real version bump

### Changed

- Rebranded project metadata to **agentpack** / `agentpack-gui`
  (`Arxtect/agentpack-gui`) across package manifests, docs and governance files

## [Previous] - foundation

### Added

- Initial project setup with Next.js 16 and React 19
- Tauri 2.9 integration for cross-platform desktop applications
- Tailwind CSS v4 with CSS variables and dark mode support
- shadcn/ui component library with Radix UI primitives
- Zustand for lightweight state management
- TypeScript configuration with strict mode
- Jest and React Testing Library for testing
- GitHub Actions CI/CD pipeline

## [0.1.0] - 2024-01-28

### Added

- Initial release

[Unreleased]: https://github.com/Arxtect/agentpack-gui/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Arxtect/agentpack-gui/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Arxtect/agentpack-gui/releases/tag/v0.1.0
