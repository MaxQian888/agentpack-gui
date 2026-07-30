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
