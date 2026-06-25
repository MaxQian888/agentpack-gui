# agentpack → agentpack-gui Migration — Design

**Date:** 2026-06-25
**Status:** Approved (design); pending implementation plan

## Goal

Migrate **all** functionality of the terminal `agentpack` (an Ink/React TUI
installer for Claude Code, Codex, engineering skills, MCP servers and cc-switch)
into `agentpack-gui` (Next.js 16 static-export + Tauri 2.9 desktop app). No
feature is dropped: presets, env detection, CLI install/upgrade, skill
install/uninstall, MCP server install (with skippable keys), network/mirror
config, cc-switch management (visible apps + provider SQLite DB), bilingual UI,
dry-run/preview, config import/export, OS override, and live step-log streaming.

## Architecture — Hybrid (TypeScript logic + Rust side-effects)

The source already separates **pure logic** from **side-effecting logic**. We
keep that seam:

- **Pure logic → TypeScript frontend.** Browser-safe (uses `smol-toml`, no Node
  builtins). Ported nearly verbatim.
- **Side-effects → Rust backend.** Process execution, filesystem, process
  detection, and the cc-switch SQLite DB become custom Tauri commands.

Dry-run safety becomes **structural**: in preview mode the frontend runner never
invokes a mutating Rust command — it renders "would run / would write" lines
locally. Read-only Rust commands (detect, load providers, get paths) are safe in
both modes.

### Frontend modules (`lib/agentpack/`)

| Module                 | Source origin                                         | Notes                                                                                                                               |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`             | `core/types.ts`                                       | OS, Command, CliTool, SkillDef, McpServer, Plan, NetworkConfig + new `StepDescriptor`                                               |
| `registry.ts`          | `core/registry.ts`                                    | CLI_TOOLS, SKILLS, MCP_SERVERS, find\* — unchanged                                                                                  |
| `presets.ts`           | `core/presets.ts`                                     | PRESETS — unchanged                                                                                                                 |
| `config.ts`            | `core/config.ts`                                      | serializePlan / parseConfig (secrets redacted); `fillSecretsFromEnv` becomes "fill from provided map" (no `process.env` in browser) |
| `merge/mcp.ts`         | `core/install/mcp.ts`                                 | buildClaudeMcpCommand, buildCodexMcpEntry, mergeCodexMcp — unchanged                                                                |
| `merge/network.ts`     | `core/install/network.ts`                             | npmRegistryCommand, mergeClaudeSettings, mergeCodexProvider — unchanged                                                             |
| `ccswitch/provider.ts` | `core/ccswitch/provider.ts`                           | buildSettingsConfig — unchanged                                                                                                     |
| `ccswitch/settings.ts` | `core/ccswitch/settings.ts`                           | visibleApps read/merge + keys/defaults — unchanged                                                                                  |
| `ccswitch/preset.ts`   | `core/ccswitch/preset.ts`                             | RECOMMENDED_PROVIDERS — unchanged                                                                                                   |
| `ccswitch/types.ts`    | `core/ccswitch/types.ts`                              | ProviderApp, VisibleApps, Provider, ProviderForm — unchanged                                                                        |
| `plan.ts`              | `core/plan.ts` + `core/actions.ts` + `core/verify.ts` | **restructured** to emit declarative `StepDescriptor[]` instead of step closures                                                    |
| `runner.ts`            | `core/runner.ts`                                      | sequential, non-aborting, status callbacks; dispatches descriptors to preview (dry) or Rust (execute)                               |
| `preview.ts`           | `core/exec.ts` + `coreOutput` strings                 | given a descriptor, produce its dry-run "would …" lines                                                                             |
| `report.ts`            | `core/report.ts`                                      | summarize() / pendingKeyEnvs() — unchanged                                                                                          |

**StepDescriptor kinds:** `command` (run a CLI command), `mergeFile` (read →
pure merge → write a JSON/TOML config), `skillInstall`, `skillRemove`,
`ccProvider` (add/update/delete/setCurrent), `ccVisibleApps`. Each descriptor
carries a localized `label` and a typed `payload`; the runner switches on kind.

### Rust backend (`src-tauri/src/`)

Custom Tauri commands (no extra ACL permissions needed for app commands in
Tauri 2; no new Tauri plugins; CSP unchanged — IPC only):

| Command                                                                        | Replaces                                   | Behavior                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_command(file, args, on_event: Channel)`                                   | `core/exec.ts`                             | spawn via `std::process::Command`, stream stdout+stderr lines through a `tauri::ipc::Channel`, return exit code; non-zero → error                                                                       |
| `detect_cli(bin, gui)`                                                         | `core/detect.ts`                           | `where`/`which` PATH lookup; non-GUI also `--version` probe; GUI also checks `~/.cc-switch`                                                                                                             |
| `is_process_running(name)`                                                     | `core/detect.ts`                           | `tasklist` (Windows) / `pgrep -x`                                                                                                                                                                       |
| `read_text_file(path)` / `write_text_file(path, content)` / `remove_dir(path)` | `core/install/configfiles.ts`, `skills.ts` | write creates parent dirs                                                                                                                                                                               |
| `install_skill(id, targets)`                                                   | `core/install/skills.ts`                   | copy bundled skill from Tauri **resources** (`bundle.resources` ships `assets/skills/`) into target skills dirs                                                                                         |
| `get_paths()`                                                                  | `core/paths.ts`                            | returns resolved absolute paths (home, claudeSettings, codexConfig, claude/codex skills dirs, ccSwitch settings + db) so the frontend never does path math                                              |
| `cc_load_providers()`                                                          | `core/ccswitch/db.ts`                      | read-only via `rusqlite`; schema assert; returns Claude/Codex providers                                                                                                                                 |
| `cc_write_provider(op, …, dry_run)`                                            | `core/ccswitch/db.ts`                      | add/update/delete/set_current; guardrails: refuse while cc-switch running, back up DB, schema assert, transaction, refuse deleting active; `dry_run` returns rendered SQL lines without touching the DB |

cc-switch SQL generation lives **only** in Rust (single source of truth);
dry-run goes through Rust read-only/no-op so the "would run: <SQL>" echo stays
faithful.

## UI / UX (React + shadcn/ui, replaces the starter home page at `/`)

- **App shell:** shadcn `Sidebar` with the seven main-menu sections — Quick
  setup (presets) · Engineering skills · cc-switch management · Install/upgrade
  CLIs · MCP servers · Network/mirrors · Config (save/load). Header: brand,
  **Preview (dry-run) toggle**, **OS override** select, language switcher, theme
  toggle.
- **State:** a Zustand store holds the building `Plan` (clis, skills, mcps,
  mcpKeys, network) + locale + dryRun + osOverride + run state.
- **Sections ↔ TUI screens:**
  - _Presets_ — selectable cards (Custom/Minimal/Recommended/Everything) that
    pre-fill the store.
  - _CLIs_ — env-check status rows (installed/not found) + install/upgrade
    toggles.
  - _Skills_ — per-category list with live install status + install/uninstall.
  - _MCP_ — multi-select + per-server API-key inputs (skippable).
  - _Network_ — relay base URL + token + npm mirror inputs.
  - _cc-switch_ — install/check, Visible-apps switches, Provider table
    (add/edit/delete/set-current) + recommended-provider presets; Node/runtime
    note retained where relevant.
- **Execution panel** (shadcn `Sheet`/`Dialog`): Review plan → Run → **live
  streaming step log** (statuses pending/running/done/error/skipped, retry
  failed, cancel) → Summary (ok/failed counts, pending key env vars, next
  steps). One runner drives both the wizard plan and one-off management actions.
- **Config:** Save → file dialog writes redacted `agentpack.config.json`; Load →
  parse + repopulate the store.

## i18n

Port the source's **typed TS catalog** (`i18n/en.ts`, `zh-CN.ts`, `types.ts`)
into the GUI with a small client `I18nProvider` + `useT()` hook, folding the few
shell strings (theme/locale toggles) in. Rationale: the catalog is heavily
function-interpolated and compile-time typed (`Messages = typeof en`); rewriting
~150 strings × 2 languages into next-intl ICU would be lossy and tedious. This
replaces the currently-unused next-intl client wiring; next-intl's request
config stays for the build pipeline. Locale auto-detection via
`navigator.language` (mirrors `core/locale.ts`).

## Cross-platform

- Per-OS install commands already live in the registry; OS override feeds the
  same data path used for detection.
- All OS-specific shell/path logic lives in Rust (`cfg!`, `dirs`) — `where` vs
  `which`, `tasklist` vs `pgrep`, home/config resolution. The frontend never
  joins paths.
- cc-switch SQLite uses bundled (static) `rusqlite` — no system sqlite, no Node
  runtime dependency.

## Error handling

- `run_command` non-zero exit → step error with the rendered command + exit
  code; the runner records it and continues (non-aborting), matching
  `core/runner.ts`.
- Verify steps (`claude --version`, `claude mcp list`, `codex --version`)
  swallow failures into output, never failing the run.
- cc-switch guardrails surface as localized errors (no DB, running, unsupported
  schema, cannot delete active).
- Config parse rejects unknown OS/CLI/skill/MCP ids with localized messages.

## Testing

- **Jest (frontend):** port the existing vitest specs for registry, presets,
  plan→descriptors, merge functions, config round-trip, report/summarize, locale
  detection; component tests for the key screens (presets, MCP keys, provider
  form, execution panel).
- **`cargo test` (Rust):** sqlite guardrails (backup, schema assert, refuse
  delete-active, dry-run SQL), detect logic, file merge-write round-trips.

## Dependencies added

- Frontend: `smol-toml`.
- Rust: `rusqlite` (with the bundled feature), `dirs`.
- No new Tauri plugins; CSP unchanged.

## Out of scope

- Reimplementing cc-switch's own "sync provider to live CLI config" (the source
  also only flips the DB flag).
- The standalone single-binary packaging path (the GUI ships as a Tauri app;
  skills travel as Tauri resources rather than embedded TS).
