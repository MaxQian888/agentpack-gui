# agentpack-gui Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every feature of the terminal `agentpack` TUI installer into the `agentpack-gui` Tauri desktop app (presets, CLI install/upgrade, skills, MCP servers, network config, cc-switch management, dry-run, config I/O, OS override, live streaming, bilingual UI).

**Architecture:** Hybrid. Pure logic (registry, presets, plan→descriptors, TOML/JSON merges, config) ports to the Next.js frontend (`lib/agentpack/`); side-effects (process exec, filesystem, process detection, cc-switch SQLite) become custom Tauri/Rust commands. Dry-run is structural — the frontend runner renders "would …" lines locally and never invokes a mutating Rust command in preview mode.

**Tech Stack:** Next.js 16 (static export), React 19, Tauri 2.9, Rust (`rusqlite` bundled, `dirs`), TypeScript, Tailwind v4, shadcn/ui, Zustand, `smol-toml`, Jest, `cargo test`.

## Global Constraints

- **Source of truth for ports:** `/Users/bytedance/Project/agentpack/src/` (the TUI repo). "Port verbatim" = copy that file's body, change only `.js` import extensions to extensionless/`@/` aliases and Node-specific calls as the task states.
- **No Node builtins in `lib/agentpack/`** — frontend runs in a browser webview. `node:fs`, `node:os`, `node:path`, `execa`, `node:crypto`, `node:sqlite` are forbidden there; their work crosses IPC to Rust.
- **Always `pnpm`** from repo root. **Rust ≥ 1.77.2**, edition 2021.
- **Custom Tauri commands need no ACL permission entry** in Tauri 2; do not add plugin permissions. CSP in `tauri.conf.json` stays unchanged (IPC only).
- **Bilingual parity:** every user-facing string goes through the i18n catalog; `en` and `zh-CN` must structurally match (`Messages = typeof en`).
- **TS style:** match existing repo (no semicolons, double quotes, 2-space indent — see `.prettierrc.json`/`eslint.config.mjs`). Run `pnpm format` + `pnpm lint:fix` before each commit.
- **Skills ship as Tauri resources** (`assets/skills/` via `bundle.resources`), not embedded TS.
- **Commit message footer:** end each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

```
src-tauri/
  Cargo.toml                      # + rusqlite (bundled), dirs
  assets/skills/<id>/SKILL.md     # copied from ../agentpack/assets/skills
  tauri.conf.json                 # + bundle.resources, productName/identifier
  src/
    lib.rs                        # register new commands
    commands.rs                   # keep greet (or drop); module wiring
    paths.rs                      # get_paths, env/os resolution
    exec.rs                       # run_command (streaming Channel), detect_cli, is_process_running
    fsops.rs                      # read_text_file, write_text_file, remove_dir, install_skill
    ccswitch.rs                   # cc_load_providers, cc_write_provider (+ guardrails)

lib/agentpack/
  types.ts            # ported core/types.ts + StepDescriptor union + Paths
  registry.ts         # ported core/registry.ts
  presets.ts          # ported core/presets.ts
  config.ts           # ported core/config.ts (env-fill → provided map)
  report.ts           # ported core/report.ts
  locale.ts           # ported core/locale.ts (navigator.language)
  merge/mcp.ts        # ported core/install/mcp.ts
  merge/network.ts    # ported core/install/network.ts
  ccswitch/types.ts   # ported core/ccswitch/types.ts
  ccswitch/provider.ts# ported core/ccswitch/provider.ts
  ccswitch/settings.ts# ported core/ccswitch/settings.ts
  ccswitch/preset.ts  # ported core/ccswitch/preset.ts
  plan.ts             # NEW: buildSteps + buildVerifySteps → StepDescriptor[]
  preview.ts          # NEW: dry-run "would …" lines per descriptor
  runner.ts           # NEW: runSteps over descriptors (dry vs execute)

lib/tauri/
  commands.ts         # typed invoke wrappers for all Rust commands

lib/i18n/
  en.ts  zh-CN.ts  types.ts  index.ts   # ported src/i18n + shell strings
  provider.tsx        # NEW: I18nProvider + useT() + locale store glue

store/
  app-store.ts        # NEW: Zustand — plan, locale, dryRun, osOverride, paths, run state

components/agentpack/
  app-shell.tsx  header.tsx  sidebar-nav.tsx
  sections/presets.tsx  clis.tsx  skills.tsx  mcp.tsx  network.tsx
  sections/ccswitch.tsx  provider-form.tsx
  run/execution-panel.tsx  step-log.tsx  summary.tsx
  config-io.tsx

app/page.tsx          # replaced: renders <AppShell/>
app/layout.tsx        # + I18nProvider, ThemeProvider
```

---

## Phase A — Foundation

### Task A1: Add frontend + Rust dependencies

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src-tauri/Cargo.toml` (dependencies)

- [ ] **Step 1: Add `smol-toml` to the frontend**

Run: `pnpm add smol-toml`
Expected: `smol-toml` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Add Rust deps**

In `src-tauri/Cargo.toml`, under `[dependencies]` add:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
dirs = "5"
```

- [ ] **Step 3: Verify Rust resolves**

Run: `cd src-tauri && cargo fetch`
Expected: downloads `rusqlite`, `libsqlite3-sys`, `dirs`; no error.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build: add smol-toml, rusqlite (bundled), dirs deps"
```

### Task A2: Copy skill assets + wire Tauri resources

**Files:**
- Create: `src-tauri/assets/skills/<id>/SKILL.md` (6 skills)
- Modify: `src-tauri/tauri.conf.json` (`bundle.resources`, `productName`, `identifier`)

- [ ] **Step 1: Copy the bundled skills**

Run: `mkdir -p src-tauri/assets && cp -R /Users/bytedance/Project/agentpack/assets/skills src-tauri/assets/skills`
Expected: `find src-tauri/assets/skills -name SKILL.md` lists 6 files (android, cpp-cmake, python, rust, stm32-c, web-frontend).

- [ ] **Step 2: Register the resource + brand the app**

In `src-tauri/tauri.conf.json`: set `"productName": "agentpack"`, `"identifier": "com.agentpack.desktop"`, window `"title": "agentpack"`, and add to the `bundle` object:

```json
"resources": ["assets/skills/**/*"]
```

- [ ] **Step 3: Verify config parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8'));console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/assets/skills src-tauri/tauri.conf.json
git commit -m "feat: bundle skill assets as Tauri resources; brand app as agentpack"
```

---

## Phase B — Pure logic port (`lib/agentpack/`)

> Each module is ported from `../agentpack/src/...`. Mechanical changes for ALL of Phase B: drop `.js` from relative imports; replace `../i18n/...` imports with `@/lib/i18n/...`; keep logic identical. Tests are ported from `../agentpack/tests/` where they exist, adapted to Jest (`describe/it/expect` are compatible; replace `import { describe, it, expect } from "vitest"` with nothing — Jest globals).

### Task B1: Port `types.ts` + add `StepDescriptor` and `Paths`

**Files:**
- Create: `lib/agentpack/types.ts`
- Test: `lib/agentpack/types.test.ts` (type-only smoke)

**Interfaces:**
- Produces: `OS`, `AgentTarget`, `Command`, `CliTool`, `SkillDef`, `McpServer`, `McpKeys`, `NetworkConfig`, `Plan`, `StepStatus`; NEW `Paths`, `StepDescriptor` union, `StepReport`.

- [ ] **Step 1: Port the source types**

Copy the body of `../agentpack/src/core/types.ts` into `lib/agentpack/types.ts`, but DELETE the `Step`, `StepResult`, `RunContext` interfaces (closure-based; replaced by descriptors). Keep everything else verbatim.

- [ ] **Step 2: Append the new GUI types**

```ts
/** Absolute paths resolved by the Rust backend (get_paths). */
export interface Paths {
  home: string
  claudeSettings: string
  claudeSkillsDir: string
  codexConfig: string
  codexSkillsDir: string
  ccSwitchSettings: string
  ccSwitchDb: string
  os: OS
}

export type StepKind =
  | "command"
  | "mergeFile"
  | "skillInstall"
  | "skillRemove"
  | "ccProvider"
  | "ccVisibleApps"

interface StepBase {
  id: string
  label: string
}

/** Run a CLI command. `verifyOnly` steps swallow failures into output. */
export interface CommandStep extends StepBase {
  kind: "command"
  command: Command
  verifyOnly?: boolean
}

/** Read a config file, apply a pure text transform, write it back. */
export interface MergeFileStep extends StepBase {
  kind: "mergeFile"
  path: string
  merge: (existing: string) => string
  writtenNote: string
}

export interface SkillInstallStep extends StepBase {
  kind: "skillInstall"
  skillId: string
  targets: AgentTarget[]
}

export interface SkillRemoveStep extends StepBase {
  kind: "skillRemove"
  skillId: string
  targets: AgentTarget[]
  dests: string[]
}

export interface CcProviderStep extends StepBase {
  kind: "ccProvider"
  op: "add" | "update" | "delete" | "setCurrent"
  payload: Record<string, unknown>
}

export interface CcVisibleAppsStep extends StepBase {
  kind: "ccVisibleApps"
  path: string
  merge: (existing: string) => string
}

export type StepDescriptor =
  | CommandStep
  | MergeFileStep
  | SkillInstallStep
  | SkillRemoveStep
  | CcProviderStep
  | CcVisibleAppsStep

export interface StepReport {
  id: string
  label: string
  status: StepStatus
  output: string[]
  error?: string
}
```

- [ ] **Step 3: Smoke-test the types compile**

Create `lib/agentpack/types.test.ts`:

```ts
import type { Plan, StepDescriptor, Paths } from "./types"

it("type shapes are usable", () => {
  const p: Plan = { os: "mac", clis: [], skills: [], mcps: [], mcpKeys: {}, network: {} }
  const s: StepDescriptor = { kind: "command", id: "x", label: "x", command: { file: "npm", args: [] } }
  const paths: Pick<Paths, "os"> = { os: "mac" }
  expect(p.os).toBe("mac")
  expect(s.kind).toBe("command")
  expect(paths.os).toBe("mac")
})
```

- [ ] **Step 4: Run + typecheck**

Run: `pnpm jest lib/agentpack/types.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/agentpack/types.ts lib/agentpack/types.test.ts
git commit -m "feat(agentpack): port core types + add StepDescriptor/Paths"
```

### Task B2: Port `registry.ts` + `presets.ts`

**Files:**
- Create: `lib/agentpack/registry.ts`, `lib/agentpack/presets.ts`
- Test: `lib/agentpack/registry.test.ts`

**Interfaces:**
- Produces: `CLI_TOOLS`, `SKILLS`, `MCP_SERVERS`, `findCli`, `findSkill`, `findMcp`; `PRESETS`, `findPreset`.

- [ ] **Step 1: Port both files**

Copy `../agentpack/src/core/registry.ts` → `lib/agentpack/registry.ts` and `../agentpack/src/core/presets.ts` → `lib/agentpack/presets.ts`. Change `from "./types.js"` → `from "./types"`. Logic unchanged.

- [ ] **Step 2: Test invariants**

```ts
import { CLI_TOOLS, MCP_SERVERS, findCli, findMcp } from "./registry"
import { PRESETS, findPreset } from "./presets"

it("each CLI has an install command for every OS key", () => {
  for (const c of CLI_TOOLS) for (const os of ["win", "mac", "linux"] as const)
    expect(c.install).toHaveProperty(os)
})
it("everything preset covers the whole registry", () => {
  const e = findPreset("everything")!
  expect(e.mcps.length).toBe(MCP_SERVERS.length)
})
it("finders work", () => {
  expect(findCli("claude-code")?.bin).toBe("claude")
  expect(findMcp("context7")?.keyEnv).toBe("CONTEXT7_API_KEY")
  expect(PRESETS.map((p) => p.id)).toContain("recommended")
})
```

- [ ] **Step 3: Run**

Run: `pnpm jest lib/agentpack/registry.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/agentpack/registry.ts lib/agentpack/presets.ts lib/agentpack/registry.test.ts
git commit -m "feat(agentpack): port registry + presets"
```

### Task B3: Port merge functions (`merge/mcp.ts`, `merge/network.ts`)

**Files:**
- Create: `lib/agentpack/merge/mcp.ts`, `lib/agentpack/merge/network.ts`
- Test: `lib/agentpack/merge/merge.test.ts`

**Interfaces:**
- Produces: `buildClaudeMcpCommand`, `buildCodexMcpEntry`, `mergeCodexMcp`; `npmRegistryCommand`, `CODEX_RELAY_ENV`, `mergeClaudeSettings`, `mergeCodexProvider`.

- [ ] **Step 1: Port both files**

Copy `../agentpack/src/core/install/mcp.ts` → `lib/agentpack/merge/mcp.ts` and `.../install/network.ts` → `lib/agentpack/merge/network.ts`. Change `from "../types.js"` → `from "../types"`. `smol-toml`'s `parse`/`stringify` work in-browser unchanged.

- [ ] **Step 2: Test merges (port from `../agentpack/tests`)**

```ts
import { buildClaudeMcpCommand, buildCodexMcpEntry, mergeCodexMcp } from "./mcp"
import { mergeClaudeSettings } from "./network"
import { findMcp } from "../registry"

it("http MCP adds bearer header for Claude", () => {
  const cmd = buildClaudeMcpCommand(findMcp("supermemory")!, "k")
  expect(cmd.args).toEqual(expect.arrayContaining(["--transport", "http"]))
  expect(cmd.args.join(" ")).toContain("Authorization: Bearer k")
})
it("codex stdio entry embeds env key", () => {
  const e = buildCodexMcpEntry(findMcp("context7")!, "abc") as Record<string, unknown>
  expect(e.command).toBe("npx")
  expect(e.env).toEqual({ CONTEXT7_API_KEY: "abc" })
})
it("mergeCodexMcp is idempotent per id", () => {
  let toml = mergeCodexMcp("", "context7", { command: "npx", args: [] })
  toml = mergeCodexMcp(toml, "context7", { command: "npx", args: ["x"] })
  expect((toml.match(/context7/g) ?? []).length).toBe(1)
})
it("mergeClaudeSettings sets env block", () => {
  const out = mergeClaudeSettings("", { apiBaseUrl: "https://r", apiToken: "t" })
  expect(JSON.parse(out).env.ANTHROPIC_BASE_URL).toBe("https://r")
})
```

- [ ] **Step 3: Run**

Run: `pnpm jest lib/agentpack/merge/merge.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/agentpack/merge lib/agentpack/merge/merge.test.ts
git commit -m "feat(agentpack): port MCP + network merge functions"
```

### Task B4: Port cc-switch pure modules

**Files:**
- Create: `lib/agentpack/ccswitch/types.ts`, `provider.ts`, `settings.ts`, `preset.ts`
- Test: `lib/agentpack/ccswitch/pure.test.ts`

**Interfaces:**
- Produces: `ProviderApp`, `VisibleApps`, `Provider`, `ProviderForm`, `ClaudeAuthKind`; `buildSettingsConfig`; `VISIBLE_APP_KEYS`, `DEFAULT_VISIBLE_APPS`, `readVisibleApps`, `mergeVisibleApps`; `RECOMMENDED_PROVIDERS`.

- [ ] **Step 1: Port the four files**

Copy from `../agentpack/src/core/ccswitch/{types,provider,settings,preset}.ts`. In `provider.ts` change `from "./types.js"` → `from "./types"`; `smol-toml` import unchanged.

- [ ] **Step 2: Test**

```ts
import { buildSettingsConfig } from "./provider"
import { readVisibleApps, mergeVisibleApps, DEFAULT_VISIBLE_APPS } from "./settings"

it("claude provider uses AUTH_TOKEN by default", () => {
  const json = JSON.parse(buildSettingsConfig({ name: "n", app: "claude", baseUrl: "https://b", token: "t", claudeAuthKind: "auth_token" }))
  expect(json.env.ANTHROPIC_AUTH_TOKEN).toBe("t")
  expect(json.env.ANTHROPIC_BASE_URL).toBe("https://b")
})
it("visibleApps round-trips and defaults missing keys to true", () => {
  expect(readVisibleApps("").claude).toBe(true)
  const merged = mergeVisibleApps("", DEFAULT_VISIBLE_APPS)
  expect(JSON.parse(merged).visibleApps.gemini).toBe(false)
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest lib/agentpack/ccswitch/pure.test.ts`
Expected: PASS.

```bash
git add lib/agentpack/ccswitch lib/agentpack/ccswitch/pure.test.ts
git commit -m "feat(agentpack): port cc-switch pure modules"
```

### Task B5: Port `config.ts`, `report.ts`, `locale.ts`

**Files:**
- Create: `lib/agentpack/config.ts`, `report.ts`, `locale.ts`
- Test: `lib/agentpack/config.test.ts`

**Interfaces:**
- Produces: `CONFIG_VERSION`, `serializePlan`, `parseConfig`, `fillSecrets`; `summarize`, `pendingKeyEnvs`; `detectLang`, `normalizeLang`.

- [ ] **Step 1: Port `config.ts`**

Copy `../agentpack/src/core/config.ts`. Change i18n import to `@/lib/i18n` (re-point after Phase C-i18n exists; for now import `en` from `@/lib/i18n/en`). RENAME `fillSecretsFromEnv(plan, env=process.env)` → `fillSecrets(plan, secrets: Record<string,string|undefined> = {})` and drop the `process.env` default (browser has none); body identical but reads from `secrets`/the param. Keep `parseConfig`/`serializePlan` verbatim.

- [ ] **Step 2: Port `report.ts` and `locale.ts`**

Copy `report.ts` (i18n import → `@/lib/i18n/en`). For `locale.ts`, copy `normalizeLang`/`detectLang`, and add a browser detector:

```ts
/** Detect UI language from the browser; falls back to English. */
export function detectBrowserLang(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator.language : undefined
  return normalizeLang(nav) ?? "en"
}
```

- [ ] **Step 3: Test config round-trip**

```ts
import { serializePlan, parseConfig } from "./config"
import type { Plan } from "./types"

const plan: Plan = { os: "mac", clis: ["claude-code"], skills: [], mcps: [{ id: "context7", targets: ["claude"] }], mcpKeys: { context7: "secret" }, network: { apiToken: "t" } }

it("serialize redacts secrets and parse validates", () => {
  const json = serializePlan(plan)
  expect(json).not.toContain("secret")
  expect(json).not.toContain('"t"')
  const back = parseConfig(json)
  expect(back.clis).toEqual(["claude-code"])
})
it("parse rejects unknown ids", () => {
  expect(() => parseConfig(JSON.stringify({ os: "mac", clis: ["nope"] }))).toThrow()
})
```

- [ ] **Step 4: Run + commit** (depends on Phase C-i18n `en`; if not yet present, do this task after Task C4)

Run: `pnpm jest lib/agentpack/config.test.ts`
Expected: PASS.

```bash
git add lib/agentpack/config.ts lib/agentpack/report.ts lib/agentpack/locale.ts lib/agentpack/config.test.ts
git commit -m "feat(agentpack): port config, report, locale"
```

---

## Phase C — i18n catalog

### Task C1: Port the i18n catalogs + shell strings

**Files:**
- Create: `lib/i18n/en.ts`, `lib/i18n/zh-CN.ts`, `lib/i18n/types.ts`, `lib/i18n/index.ts`
- Test: `lib/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `en`, `zhCN`, `catalogs`, `getMessages(lang)`, types `Lang`, `Messages`, `CoreOutput`.

- [ ] **Step 1: Port all four i18n files**

Copy `../agentpack/src/i18n/{en.ts,zh-CN.ts,types.ts,index.ts}` into `lib/i18n/`. Change `.js` import extensions. Then ADD shell strings to BOTH `en` and `zhCN` objects (keep parity):

```ts
  // appended to the catalog object
  shell: {
    toggleTheme: "Toggle theme",      // zh: "切换主题"
    light: "Light",                   // zh: "浅色"
    dark: "Dark",                     // zh: "深色"
    system: "System",                 // zh: "跟随系统"
    language: "Language",             // zh: "语言"
    preview: "Preview (dry-run)",     // zh: "预览（dry-run）"
    osOverride: "OS",                 // zh: "操作系统"
    run: "Run plan",                  // zh: "执行计划"
    addToPlan: "Add to plan",         // zh: "加入计划"
    loadConfig: "Load config",        // zh: "导入配置"
    saveConfigBtn: "Save config",     // zh: "保存配置"
    cancel: "Cancel",                 // zh: "取消"
    close: "Close",                   // zh: "关闭"
  },
```

- [ ] **Step 2: Parity test (port `../agentpack/tests/i18n.test.ts`)**

```ts
import { en } from "./en"
import { zhCN } from "./zh-CN"
import { CLI_TOOLS, SKILLS, MCP_SERVERS } from "@/lib/agentpack/registry"

function keys(o: object): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" && typeof v !== "function" ? keys(v).map((s) => `${k}.${s}`) : [k])
}
it("zh-CN structurally matches en", () => {
  expect(keys(zhCN).sort()).toEqual(keys(en).sort())
})
it("every registry id has catalog entries in both locales", () => {
  for (const c of CLI_TOOLS) for (const m of [en, zhCN]) expect(m.catalog.cli[c.id]).toBeDefined()
  for (const s of SKILLS) for (const m of [en, zhCN]) expect(m.catalog.skills[s.id]).toBeDefined()
  for (const s of MCP_SERVERS) for (const m of [en, zhCN]) expect(m.catalog.mcp[s.id]).toBeDefined()
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest lib/i18n/i18n.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add lib/i18n
git commit -m "feat(i18n): port typed agentpack catalog + shell strings"
```

### Task C2: I18nProvider + useT hook

**Files:**
- Create: `lib/i18n/provider.tsx`
- Test: `lib/i18n/provider.test.tsx`

**Interfaces:**
- Consumes: `getMessages`, `Lang`, `detectBrowserLang`.
- Produces: `<I18nProvider>`, `useT(): Messages`, `useLocale(): { lang, setLang }`.

- [ ] **Step 1: Implement the provider**

```tsx
"use client"
import { createContext, useContext, useEffect, useState } from "react"
import { getMessages, type Lang, type Messages } from "./index"
import { detectBrowserLang } from "@/lib/agentpack/locale"

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: Messages } | null>(null)
const KEY = "agentpack.lang"

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en")
  useEffect(() => {
    const saved = localStorage.getItem(KEY) as Lang | null
    setLangState(saved ?? detectBrowserLang())
  }, [])
  const setLang = (l: Lang) => { setLangState(l); localStorage.setItem(KEY, l) }
  return <Ctx.Provider value={{ lang, setLang, t: getMessages(lang) }}>{children}</Ctx.Provider>
}
export function useT(): Messages {
  const c = useContext(Ctx); if (!c) throw new Error("useT outside I18nProvider"); return c.t
}
export function useLocale() {
  const c = useContext(Ctx); if (!c) throw new Error("useLocale outside I18nProvider")
  return { lang: c.lang, setLang: c.setLang }
}
```

- [ ] **Step 2: Test it renders + switches**

```tsx
import { render, screen, act } from "@testing-library/react"
import { I18nProvider, useT, useLocale } from "./provider"

function Probe() { const t = useT(); const { setLang } = useLocale()
  return <button onClick={() => setLang("zh-CN")}>{t.menu.title}</button> }
it("provides messages and switches locale", async () => {
  render(<I18nProvider><Probe /></I18nProvider>)
  expect(await screen.findByText("Main menu")).toBeInTheDocument()
  await act(async () => { screen.getByRole("button").click() })
  expect(screen.getByText("主菜单")).toBeInTheDocument()
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest lib/i18n/provider.test.tsx`
Expected: PASS.

```bash
git add lib/i18n/provider.tsx lib/i18n/provider.test.tsx
git commit -m "feat(i18n): add client I18nProvider + useT/useLocale"
```

---

## Phase D — Rust side-effect commands

### Task D1: `paths.rs` — get_paths

**Files:**
- Create: `src-tauri/src/paths.rs`
- Modify: `src-tauri/src/lib.rs` (mod + handler)

**Interfaces:**
- Produces: `#[tauri::command] get_paths() -> Paths` with fields `home, claude_settings, claude_skills_dir, codex_config, codex_skills_dir, cc_switch_settings, cc_switch_db, os` serialized **camelCase**.

- [ ] **Step 1: Implement**

```rust
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
  home: String,
  claude_settings: String,
  claude_skills_dir: String,
  codex_config: String,
  codex_skills_dir: String,
  cc_switch_settings: String,
  cc_switch_db: String,
  os: String,
}

fn s(p: PathBuf) -> String { p.to_string_lossy().into_owned() }
fn os_family() -> &'static str {
  if cfg!(windows) { "win" } else if cfg!(target_os = "macos") { "mac" } else { "linux" }
}

#[tauri::command]
pub fn get_paths() -> Result<Paths, String> {
  let home = dirs::home_dir().ok_or("no home dir")?;
  let claude = home.join(".claude");
  let codex = std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".codex"));
  let ccsw = home.join(".cc-switch");
  Ok(Paths {
    home: s(home.clone()),
    claude_settings: s(claude.join("settings.json")),
    claude_skills_dir: s(claude.join("skills")),
    codex_config: s(codex.join("config.toml")),
    codex_skills_dir: s(codex.join("skills")),
    cc_switch_settings: s(ccsw.join("settings.json")),
    cc_switch_db: s(ccsw.join("cc-switch.db")),
    os: os_family().into(),
  })
}
```

- [ ] **Step 2: Register**

In `lib.rs` add `mod paths;` and extend `generate_handler!` with `paths::get_paths`.

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: compiles (warnings ok).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/paths.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): get_paths command"
```

### Task D2: `exec.rs` — run_command (streaming), detect_cli, is_process_running

**Files:**
- Create: `src-tauri/src/exec.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/exec.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `run_command(file: String, args: Vec<String>, on_event: Channel<String>) -> Result<i32, String>` — emits each output line through the channel, returns exit code, `Err` if spawn fails.
  - `detect_cli(bin: String, gui: bool) -> DetectionResult { installed: bool, version: Option<String> }`
  - `is_process_running(name: String) -> bool`

- [ ] **Step 1: Implement run_command with line streaming**

```rust
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use serde::Serialize;
use tauri::ipc::Channel;

#[tauri::command]
pub fn run_command(file: String, args: Vec<String>, on_event: Channel<String>) -> Result<i32, String> {
  let mut child = Command::new(&file).args(&args)
    .stdout(Stdio::piped()).stderr(Stdio::piped())
    .spawn().map_err(|e| format!("command not found: {file} ({e})"))?;
  let stdout = child.stdout.take().unwrap();
  let stderr = child.stderr.take().unwrap();
  let tx = on_event.clone();
  let h = std::thread::spawn(move || {
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
      let _ = tx.send(line);
    }
  });
  for line in BufReader::new(stdout).lines().map_while(Result::ok) {
    let _ = on_event.send(line);
  }
  let _ = h.join();
  let status = child.wait().map_err(|e| e.to_string())?;
  Ok(status.code().unwrap_or(-1))
}
```

- [ ] **Step 2: Implement detect_cli + is_process_running**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult { installed: bool, version: Option<String> }

fn on_path(bin: &str) -> bool {
  let finder = if cfg!(windows) { "where" } else { "which" };
  Command::new(finder).arg(bin).output().map(|o| o.status.success()).unwrap_or(false)
}

#[tauri::command]
pub fn detect_cli(bin: String, gui: bool) -> DetectionResult {
  if gui {
    let cc = dirs::home_dir().map(|h| h.join(".cc-switch").exists()).unwrap_or(false);
    return DetectionResult { installed: on_path(&bin) || (bin == "cc-switch" && cc), version: None }
  }
  match Command::new(&bin).arg("--version").output() {
    Ok(o) if o.status.success() => {
      let v = String::from_utf8_lossy(if o.stdout.is_empty() { &o.stderr } else { &o.stdout });
      DetectionResult { installed: true, version: v.lines().next().map(|s| s.trim().to_string()) }
    }
    _ => DetectionResult { installed: false, version: None },
  }
}

#[tauri::command]
pub fn is_process_running(name: String) -> bool {
  if cfg!(windows) {
    Command::new("tasklist").args(["/fi", &format!("imagename eq {name}.exe"), "/nh"]).output()
      .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(&format!("{name}.exe"))).unwrap_or(false)
  } else {
    Command::new("pgrep").args(["-x", &name]).output().map(|o| o.status.success()).unwrap_or(false)
  }
}
```

- [ ] **Step 3: Test detect on a guaranteed-present binary**

```rust
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn detects_a_real_binary() {
    let bin = if cfg!(windows) { "cmd" } else { "sh" };
    assert!(on_path(bin));
  }
  #[test]
  fn missing_binary_not_installed() {
    assert!(!detect_cli("definitely-not-a-real-bin-xyz".into(), false).installed);
  }
}
```

- [ ] **Step 4: Register, build, test**

Add `mod exec;` to `lib.rs` and `exec::run_command, exec::detect_cli, exec::is_process_running` to the handler.
Run: `cd src-tauri && cargo test exec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/exec.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): run_command streaming + detect_cli + is_process_running"
```

### Task D3: `fsops.rs` — file ops + install_skill

**Files:**
- Create: `src-tauri/src/fsops.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `read_text_file(path) -> Result<String, String>` (missing → `Ok("")`)
  - `write_text_file(path, content) -> Result<(), String>` (creates parents)
  - `remove_dir(path) -> Result<(), String>`
  - `install_skill(app: AppHandle, id, targets: Vec<String>) -> Result<Vec<String>, String>` — resolves resource dir, copies `assets/skills/<id>` into each target's skills dir, returns dest paths.

- [ ] **Step 1: Implement file ops + recursive copy + install_skill**

```rust
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
  match fs::read_to_string(&path) { Ok(s) => Ok(s), Err(_) => Ok(String::new()) }
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
  if let Some(p) = Path::new(&path).parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
  fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_dir(path: String) -> Result<(), String> {
  if Path::new(&path).exists() { fs::remove_dir_all(&path).map_err(|e| e.to_string())?; }
  Ok(())
}

fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
  fs::create_dir_all(dest)?;
  for entry in fs::read_dir(src)? {
    let entry = entry?; let to = dest.join(entry.file_name());
    if entry.file_type()?.is_dir() { copy_dir(&entry.path(), &to)?; }
    else { fs::copy(entry.path(), to)?; }
  }
  Ok(())
}

#[tauri::command]
pub fn install_skill(app: AppHandle, id: String, targets: Vec<String>) -> Result<Vec<String>, String> {
  let base = app.path().resource_dir().map_err(|e| e.to_string())?.join("assets/skills").join(&id);
  let home = dirs::home_dir().ok_or("no home dir")?;
  let codex = std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".codex"));
  let mut dests = Vec::new();
  for t in targets {
    let dir = if t == "claude" { home.join(".claude/skills") } else { codex.join("skills") };
    let dest = dir.join(&id);
    copy_dir(&base, &dest).map_err(|e| e.to_string())?;
    dests.push(dest.to_string_lossy().into_owned());
  }
  Ok(dests)
}
```

- [ ] **Step 2: Register + build**

Add `mod fsops;` and the four commands to the handler.
Run: `cd src-tauri && cargo build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/fsops.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): file ops + resource-based install_skill"
```

### Task D4: `ccswitch.rs` — provider DB (rusqlite) with guardrails

**Files:**
- Create: `src-tauri/src/ccswitch.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/ccswitch.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `cc_load_providers() -> Result<Vec<Provider>, String>` (read-only; `[]` if no DB)
  - `cc_write_provider(req: WriteReq) -> Result<Vec<String>, String>` where `WriteReq { op: "add"|"update"|"delete"|"setCurrent", dry_run: bool, id: Option<String>, app: String, form: Option<ProviderForm>, settings_config: Option<String> }`. The frontend builds `settings_config` (via the ported `buildSettingsConfig`) and passes it in; Rust handles ids/sort/guards/SQL.
- Guardrails (real run only): no DB → err; cc-switch running → err (unless `AGENTPACK_SKIP_RUNNING_CHECK=1`); schema assert (required columns); back up DB; transaction; refuse deleting active. Dry-run: open read-only, schema assert, return `"would run: <SQL>"` lines, no writes, no backup.

- [ ] **Step 1: Implement (mirror `../agentpack/src/core/ccswitch/db.ts`)**

```rust
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const REQUIRED: &[&str] = &["id","app_type","name","settings_config","category","created_at","sort_index","notes","meta","is_current"];

// NOTE: snake_case fields (no rename) to match the ported TS `Provider` type
// (app_type, settings_config, website_url, is_current).
#[derive(Serialize)]
pub struct Provider { id: String, app_type: String, name: String, settings_config: String, website_url: Option<String>, notes: Option<String>, is_current: bool }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderForm { name: String, website_url: Option<String>, notes: Option<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteReq { op: String, dry_run: bool, id: Option<String>, app: String, form: Option<ProviderForm>, settings_config: Option<String> }

fn db_path() -> PathBuf {
  if let Ok(p) = std::env::var("AGENTPACK_CCSWITCH_DB") { return PathBuf::from(p) }
  dirs::home_dir().unwrap_or_default().join(".cc-switch/cc-switch.db")
}
fn exists() -> bool { db_path().exists() }

fn assert_schema(conn: &Connection) -> Result<(), String> {
  let mut cols = Vec::new();
  let mut stmt = conn.prepare("PRAGMA table_info(providers)").map_err(|e| e.to_string())?;
  let rows = stmt.query_map([], |r| r.get::<_, String>(1)).map_err(|e| e.to_string())?;
  for r in rows { cols.push(r.map_err(|e| e.to_string())?); }
  for c in REQUIRED { if !cols.iter().any(|x| x == c) { return Err("unsupported cc-switch database schema — update agentpack before editing providers.".into()) } }
  Ok(())
}

#[tauri::command]
pub fn cc_load_providers() -> Result<Vec<Provider>, String> {
  if !exists() { return Ok(vec![]) }
  let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
  assert_schema(&conn)?;
  let mut stmt = conn.prepare("SELECT id, app_type, name, settings_config, website_url, notes, is_current FROM providers WHERE app_type IN ('claude','codex') ORDER BY app_type, sort_index").map_err(|e| e.to_string())?;
  let rows = stmt.query_map([], |r| Ok(Provider {
    id: r.get(0)?, app_type: r.get(1)?, name: r.get(2)?, settings_config: r.get(3)?,
    website_url: r.get(4)?, notes: r.get(5)?, is_current: r.get::<_, i64>(6)? != 0,
  })).map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for r in rows { out.push(r.map_err(|e| e.to_string())?); }
  Ok(out)
}

fn is_running() -> bool {
  if std::env::var("AGENTPACK_SKIP_RUNNING_CHECK").as_deref() == Ok("1") { return false }
  crate::exec::is_process_running("cc-switch".into())
}

fn backup() -> Result<String, String> {
  let p = db_path();
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
  let dest = format!("{}.bak-{}", p.to_string_lossy(), stamp);
  std::fs::copy(&p, &dest).map_err(|e| e.to_string())?;
  Ok(dest)
}

#[tauri::command]
pub fn cc_write_provider(req: WriteReq) -> Result<Vec<String>, String> {
  if !exists() { return Err("cc-switch database not found. Launch cc-switch once, then return here.".into()) }
  let mut log = Vec::new();

  // SQL text builder shared by dry-run + real
  let render = |sql: &str| -> String { format!("would run: {sql}") };

  if req.dry_run {
    let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    assert_schema(&conn)?;
    log.push(render(&format!("{} provider ({})", req.op, req.app)));
    return Ok(log)
  }

  if is_running() { return Err("cc-switch is running — close it before changing providers.".into()) }
  log.push(format!("backed up database → {}", backup()?));
  let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
  assert_schema(&conn)?;
  conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
  let result = (|| -> Result<Vec<String>, String> {
    match req.op.as_str() {
      "add" => {
        let form = req.form.as_ref().ok_or("missing form")?;
        let id = uuid_like();
        let settings = req.settings_config.clone().ok_or("missing settings_config")?;
        let sort: i64 = conn.query_row("SELECT COALESCE(MAX(sort_index),-1)+1 FROM providers WHERE app_type=?1", [&req.app], |r| r.get(0)).map_err(|e| e.to_string())?;
        let has_current: i64 = conn.query_row("SELECT COUNT(*) FROM providers WHERE app_type=?1 AND is_current=1", [&req.app], |r| r.get(0)).map_err(|e| e.to_string())?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
        conn.execute("INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, meta, is_current, in_failover_queue) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
          rusqlite::params![id, req.app, form.name, settings, form.website_url, Option::<String>::None, now, sort, form.notes, "{}", if has_current == 0 {1} else {0}, 0]).map_err(|e| e.to_string())?;
        Ok(vec![format!("added provider \"{}\" ({})", form.name, req.app)])
      }
      "update" => {
        let form = req.form.as_ref().ok_or("missing form")?;
        let id = req.id.as_ref().ok_or("missing id")?;
        let settings = req.settings_config.clone().ok_or("missing settings_config")?;
        conn.execute("UPDATE providers SET name=?1, settings_config=?2, website_url=?3, notes=?4 WHERE id=?5 AND app_type=?6",
          rusqlite::params![form.name, settings, form.website_url, form.notes, id, req.app]).map_err(|e| e.to_string())?;
        Ok(vec![format!("updated provider \"{}\" ({})", form.name, req.app)])
      }
      "delete" => {
        let id = req.id.as_ref().ok_or("missing id")?;
        let cur: i64 = conn.query_row("SELECT is_current FROM providers WHERE id=?1 AND app_type=?2", [id, &req.app], |r| r.get(0)).unwrap_or(0);
        if cur != 0 { return Err("cannot delete the active provider — switch to another provider in cc-switch first.".into()) }
        conn.execute("DELETE FROM providers WHERE id=?1 AND app_type=?2", [id, &req.app]).map_err(|e| e.to_string())?;
        Ok(vec![format!("deleted provider ({})", req.app)])
      }
      "setCurrent" => {
        let id = req.id.as_ref().ok_or("missing id")?;
        conn.execute("UPDATE providers SET is_current=0 WHERE app_type=?1", [&req.app]).map_err(|e| e.to_string())?;
        conn.execute("UPDATE providers SET is_current=1 WHERE id=?1 AND app_type=?2", [id, &req.app]).map_err(|e| e.to_string())?;
        Ok(vec![format!("set current provider ({})", req.app)])
      }
      other => Err(format!("unknown op {other}")),
    }
  })();
  match result {
    Ok(mut out) => { conn.execute("COMMIT", []).map_err(|e| e.to_string())?; log.append(&mut out); Ok(log) }
    Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
  }
}

fn uuid_like() -> String {
  // RFC-4122-ish from system entropy; cc-switch only needs a unique id string.
  let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
  format!("{:032x}", n)
}
```

- [ ] **Step 2: Test against a temp DB**

```rust
#[cfg(test)]
mod tests {
  use super::*;
  use rusqlite::Connection;
  fn seed(path: &str) {
    let c = Connection::open(path).unwrap();
    c.execute_batch("CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT, meta TEXT, is_current INTEGER, in_failover_queue INTEGER);").unwrap();
  }
  #[test]
  fn add_then_load() {
    let dir = std::env::temp_dir().join(format!("ccsw-{}.db", uuid_like()));
    let p = dir.to_string_lossy().to_string();
    seed(&p);
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &p);
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");
    let req = WriteReq { op: "add".into(), dry_run: false, id: None, app: "claude".into(),
      form: Some(ProviderForm { name: "Test".into(), website_url: None, notes: None }),
      settings_config: Some("{\"env\":{}}".into()) };
    cc_write_provider(req).unwrap();
    let list = cc_load_providers().unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].is_current); // first provider becomes current
    let _ = std::fs::remove_file(&p);
  }
}
```

- [ ] **Step 3: Register, build, test**

Add `mod ccswitch;` and both commands to the handler.
Run: `cd src-tauri && cargo test ccswitch`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ccswitch.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): cc-switch provider DB via rusqlite with guardrails"
```

---

## Phase E — TS command wrappers

### Task E1: `lib/tauri/commands.ts`

**Files:**
- Create: `lib/tauri/commands.ts`
- Modify: `lib/tauri.ts` (keep `isTauri`; re-export or leave `greet`)
- Test: `lib/tauri/commands.test.ts` (mock `@tauri-apps/api/core`)

**Interfaces:**
- Consumes: `invoke`, `Channel` from `@tauri-apps/api/core`; types from `@/lib/agentpack/types`, `@/lib/agentpack/ccswitch/types`.
- Produces typed wrappers:
  - `getPaths(): Promise<Paths>`
  - `runCommand(cmd: Command, onLine: (l: string) => void): Promise<number>` (exit code)
  - `detectCli(bin: string, gui: boolean): Promise<{ installed: boolean; version?: string }>`
  - `isProcessRunning(name: string): Promise<boolean>`
  - `readTextFile(path: string): Promise<string>`; `writeTextFile(path, content): Promise<void>`; `removeDir(path): Promise<void>`
  - `installSkill(id: string, targets: AgentTarget[]): Promise<string[]>`
  - `ccLoadProviders(): Promise<Provider[]>`
  - `ccWriteProvider(req): Promise<string[]>`

- [ ] **Step 1: Implement wrappers**

```ts
import { invoke, Channel } from "@tauri-apps/api/core"
import type { AgentTarget, Command, Paths } from "@/lib/agentpack/types"
import type { Provider, ProviderApp } from "@/lib/agentpack/ccswitch/types"

export const getPaths = () => invoke<Paths>("get_paths")

export async function runCommand(cmd: Command, onLine: (l: string) => void): Promise<number> {
  const onEvent = new Channel<string>()
  onEvent.onmessage = onLine
  return invoke<number>("run_command", { file: cmd.file, args: cmd.args, onEvent })
}

export const detectCli = (bin: string, gui: boolean) =>
  invoke<{ installed: boolean; version?: string }>("detect_cli", { bin, gui })
export const isProcessRunning = (name: string) => invoke<boolean>("is_process_running", { name })
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path })
export const writeTextFile = (path: string, content: string) => invoke<void>("write_text_file", { path, content })
export const removeDir = (path: string) => invoke<void>("remove_dir", { path })
export const installSkill = (id: string, targets: AgentTarget[]) => invoke<string[]>("install_skill", { id, targets })
export const ccLoadProviders = () => invoke<Provider[]>("cc_load_providers")

export interface CcWriteReq {
  op: "add" | "update" | "delete" | "setCurrent"
  dryRun: boolean
  id?: string
  app: ProviderApp
  form?: { name: string; websiteUrl?: string; notes?: string }
  settingsConfig?: string
}
export const ccWriteProvider = (req: CcWriteReq) => invoke<string[]>("cc_write_provider", { req })
```

- [ ] **Step 2: Test the invoke mapping**

```ts
jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(async (cmd: string) => (cmd === "get_paths" ? { os: "mac" } : undefined)),
  Channel: class { onmessage: ((m: string) => void) | null = null },
}))
import { getPaths, detectCli } from "./commands"
import { invoke } from "@tauri-apps/api/core"

it("getPaths invokes get_paths", async () => {
  expect(await getPaths()).toEqual({ os: "mac" })
})
it("detectCli passes bin + gui", async () => {
  await detectCli("claude", false)
  expect(invoke).toHaveBeenCalledWith("detect_cli", { bin: "claude", gui: false })
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest lib/tauri/commands.test.ts`
Expected: PASS.

```bash
git add lib/tauri/commands.ts lib/tauri/commands.test.ts
git commit -m "feat(tauri): typed TS wrappers for backend commands"
```

---

## Phase F — Descriptor model: plan, preview, runner

### Task F1: `plan.ts` — buildSteps + buildVerifySteps → StepDescriptor[]

**Files:**
- Create: `lib/agentpack/plan.ts`
- Test: `lib/agentpack/plan.test.ts`

**Interfaces:**
- Consumes: registry finders, merge functions, `Paths`, `Messages`, `Plan`.
- Produces: `buildSteps(plan: Plan, paths: Paths, messages?: Messages): StepDescriptor[]`; `buildVerifySteps(plan, messages?): CommandStep[]`; and menu-action builders mirroring `core/actions.ts`: `skillInstallStep`, `skillRemoveStep`, `visibleAppsStep`, `providerStep(op, ...)`.

- [ ] **Step 1: Implement buildSteps (descriptor form of `core/plan.ts`)**

```ts
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { findCli, findMcp, findSkill } from "./registry"
import { buildClaudeMcpCommand, buildCodexMcpEntry, mergeCodexMcp } from "./merge/mcp"
import { mergeClaudeSettings, mergeCodexProvider, npmRegistryCommand } from "./merge/network"
import type { Paths, Plan, StepDescriptor, CommandStep } from "./types"

export function buildSteps(plan: Plan, paths: Paths, messages: Messages = en): StepDescriptor[] {
  const t = messages.steps, cat = messages.catalog
  const steps: StepDescriptor[] = []

  if (plan.network.npmRegistry) {
    steps.push({ kind: "command", id: "npm-registry", label: t.npmRegistry(plan.network.npmRegistry), command: npmRegistryCommand(plan.network.npmRegistry) })
  }
  for (const id of plan.clis) {
    const tool = findCli(id); if (!tool) continue
    const title = cat.cli[id]?.title ?? id
    const cmd = tool.install[plan.os]
    if (cmd) steps.push({ kind: "command", id: `cli-${id}`, label: t.installCli(title), command: cmd })
  }
  for (const sk of plan.skills) {
    const def = findSkill(sk.id); if (!def || sk.targets.length === 0) continue
    const title = cat.skills[sk.id]?.title ?? sk.id
    steps.push({ kind: "skillInstall", id: `skill-${sk.id}`, label: t.installSkill(title, sk.targets.join(", ")), skillId: sk.id, targets: sk.targets })
  }
  for (const m of plan.mcps) {
    const server = findMcp(m.id); if (!server || m.targets.length === 0) continue
    const title = cat.mcp[m.id]?.title ?? m.id
    const key = plan.mcpKeys[m.id]
    if (m.targets.includes("claude"))
      steps.push({ kind: "command", id: `mcp-claude-${m.id}`, label: t.addMcpClaude(title), command: buildClaudeMcpCommand(server, key) })
    if (m.targets.includes("codex")) {
      const entry = buildCodexMcpEntry(server, key)
      steps.push({ kind: "mergeFile", id: `mcp-codex-${m.id}`, label: t.addMcpCodex(title), path: paths.codexConfig,
        merge: (existing) => mergeCodexMcp(existing, server.id, entry), writtenNote: t.codexMcpWritten(server.id) })
    }
  }
  const net = plan.network
  if (net.apiBaseUrl || net.apiToken) {
    if (plan.clis.includes("claude-code"))
      steps.push({ kind: "mergeFile", id: "relay-claude", label: t.configureClaudeRelay, path: paths.claudeSettings,
        merge: (e) => mergeClaudeSettings(e, net), writtenNote: t.claudeSettingsUpdated })
    if (plan.clis.includes("codex") && net.apiBaseUrl)
      steps.push({ kind: "mergeFile", id: "relay-codex", label: t.configureCodexRelay, path: paths.codexConfig,
        merge: (e) => mergeCodexProvider(e, net), writtenNote: t.codexProviderUpdated })
  }
  return steps
}

export function buildVerifySteps(plan: Plan, messages: Messages = en): CommandStep[] {
  const v = messages.verify
  const steps: CommandStep[] = []
  if (plan.clis.includes("claude-code")) {
    steps.push({ kind: "command", id: "verify-claude-version", label: v.claudeVersion, verifyOnly: true, command: { file: "claude", args: ["--version"] } })
    if (plan.mcps.some((m) => m.targets.includes("claude")))
      steps.push({ kind: "command", id: "verify-claude-mcp", label: v.claudeMcp, verifyOnly: true, command: { file: "claude", args: ["mcp", "list"] } })
  }
  if (plan.clis.includes("codex"))
    steps.push({ kind: "command", id: "verify-codex-version", label: v.codexVersion, verifyOnly: true, command: { file: "codex", args: ["--version"] } })
  return steps
}
```

- [ ] **Step 2: Implement the menu-action builders**

```ts
import { mergeVisibleApps } from "./ccswitch/settings"
import { buildSettingsConfig } from "./ccswitch/provider"
import type { AgentTarget } from "./types"
import type { ProviderApp, ProviderForm, VisibleApps } from "./ccswitch/types"

export function skillInstallStep(skillId: string, title: string, targets: AgentTarget[], m: Messages = en): StepDescriptor {
  return { kind: "skillInstall", id: `skill-install-${skillId}`, label: m.steps.installSkill(title, targets.join(", ")), skillId, targets }
}
export function skillRemoveStep(skillId: string, title: string, targets: AgentTarget[], dests: string[], m: Messages = en): StepDescriptor {
  return { kind: "skillRemove", id: `skill-remove-${skillId}`, label: m.steps.uninstallSkill(title, targets.join(", ")), skillId, targets, dests }
}
export function visibleAppsStep(path: string, visible: VisibleApps, m: Messages = en): StepDescriptor {
  return { kind: "ccVisibleApps", id: "cc-visible-apps", label: m.steps.ccVisibleApps, path, merge: (e) => mergeVisibleApps(e, visible) }
}
export function providerStep(op: "add" | "update" | "delete" | "setCurrent", app: ProviderApp, form: ProviderForm | undefined, name: string, id: string | undefined, m: Messages = en): StepDescriptor {
  const label = op === "add" ? m.steps.ccProviderAdd(name) : op === "update" ? m.steps.ccProviderUpdate(name)
    : op === "delete" ? m.steps.ccProviderDelete(name) : m.steps.ccProviderSetCurrent(name)
  const settingsConfig = form ? buildSettingsConfig(form) : undefined
  return { kind: "ccProvider", id: `cc-provider-${op}`, label, op,
    payload: { app, id, settingsConfig, form: form ? { name: form.name, websiteUrl: form.websiteUrl, notes: form.notes } : undefined } }
}
```

- [ ] **Step 3: Test descriptor output**

```ts
import { buildSteps, buildVerifySteps } from "./plan"
import type { Paths, Plan } from "./types"

const paths: Paths = { home: "/h", claudeSettings: "/h/.claude/settings.json", claudeSkillsDir: "/h/.claude/skills", codexConfig: "/h/.codex/config.toml", codexSkillsDir: "/h/.codex/skills", ccSwitchSettings: "/h/.cc-switch/settings.json", ccSwitchDb: "/h/.cc-switch/cc-switch.db", os: "mac" }
const plan: Plan = { os: "mac", clis: ["claude-code"], skills: [{ id: "rust", targets: ["claude"] }], mcps: [{ id: "context7", targets: ["claude", "codex"] }], mcpKeys: { context7: "k" }, network: { npmRegistry: "https://m", apiBaseUrl: "https://r" } }

it("orders steps registry→install→skills→mcp→relay", () => {
  const ids = buildSteps(plan, paths).map((s) => s.id)
  expect(ids[0]).toBe("npm-registry")
  expect(ids).toEqual(expect.arrayContaining(["cli-claude-code", "skill-rust", "mcp-claude-context7", "mcp-codex-context7", "relay-claude"]))
})
it("codex mcp step targets the resolved config path", () => {
  const step = buildSteps(plan, paths).find((s) => s.id === "mcp-codex-context7")!
  expect(step.kind === "mergeFile" && step.path).toBe("/h/.codex/config.toml")
})
it("verify steps are verifyOnly", () => {
  expect(buildVerifySteps(plan).every((s) => s.verifyOnly)).toBe(true)
})
```

- [ ] **Step 4: Run + commit**

Run: `pnpm jest lib/agentpack/plan.test.ts`
Expected: PASS.

```bash
git add lib/agentpack/plan.ts lib/agentpack/plan.test.ts
git commit -m "feat(agentpack): descriptor-based plan + verify + menu-action builders"
```

### Task F2: `preview.ts` — dry-run lines per descriptor

**Files:**
- Create: `lib/agentpack/preview.ts`
- Test: `lib/agentpack/preview.test.ts`

**Interfaces:**
- Consumes: `StepDescriptor`, `Paths`, `Messages`, `commandToString`.
- Produces: `commandToString(cmd: Command): string`; `previewLines(step: StepDescriptor, paths: Paths, messages?: Messages): string[]`.

- [ ] **Step 1: Implement**

```ts
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import type { Command, Paths, StepDescriptor } from "./types"

export function commandToString(cmd: Command): string {
  const quote = (a: string) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)
  return [cmd.file, ...cmd.args.map(quote)].join(" ")
}

export function previewLines(step: StepDescriptor, paths: Paths, m: Messages = en): string[] {
  const out = m.coreOutput
  switch (step.kind) {
    case "command": return [`$ ${commandToString(step.command)}`, out.wouldRun(commandToString(step.command))]
    case "mergeFile":
    case "ccVisibleApps": return [out.wouldWrite(step.path)]
    case "skillInstall": return step.targets.map((tt) =>
      out.wouldCopy(`${paths.home}/assets/skills/${step.skillId}`, `${tt === "claude" ? paths.claudeSkillsDir : paths.codexSkillsDir}/${step.skillId}`))
    case "skillRemove": return step.dests.map((d) => out.wouldDelete(d))
    case "ccProvider": return [`would run: ${step.op} provider (${(step.payload as { app: string }).app})`]
  }
}
```

- [ ] **Step 2: Test**

```ts
import { previewLines, commandToString } from "./preview"
import type { Paths, StepDescriptor } from "./types"
const paths = { home: "/h", claudeSkillsDir: "/h/.claude/skills", codexSkillsDir: "/h/.codex/skills" } as Paths

it("command preview shows would run", () => {
  const s: StepDescriptor = { kind: "command", id: "x", label: "x", command: { file: "npm", args: ["i", "-g", "x"] } }
  expect(previewLines(s, paths)).toContain("would run: npm i -g x")
})
it("mergeFile preview shows would write path", () => {
  const s: StepDescriptor = { kind: "mergeFile", id: "x", label: "x", path: "/h/.codex/config.toml", merge: (e) => e, writtenNote: "" }
  expect(previewLines(s, paths)).toEqual(["would write /h/.codex/config.toml"])
})
it("quoting wraps args with spaces", () => {
  expect(commandToString({ file: "claude", args: ["--header", "Authorization: Bearer k"] })).toContain('"Authorization: Bearer k"')
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest lib/agentpack/preview.test.ts`
Expected: PASS.

```bash
git add lib/agentpack/preview.ts lib/agentpack/preview.test.ts
git commit -m "feat(agentpack): dry-run preview line generator"
```

### Task F3: `runner.ts` — execute descriptors (dry vs real)

**Files:**
- Create: `lib/agentpack/runner.ts`
- Test: `lib/agentpack/runner.test.ts` (mock `@/lib/tauri/commands`)

**Interfaces:**
- Consumes: all wrappers from `@/lib/tauri/commands`, `previewLines`, `commandToString`, `StepDescriptor`, `StepReport`, `Paths`.
- Produces: `runSteps(steps: StepDescriptor[], opts: { dryRun: boolean; paths: Paths; messages?: Messages; signal?: AbortSignal; onUpdate?: (r: StepReport, i: number) => void }): Promise<StepReport[]>`.

- [ ] **Step 1: Implement**

```ts
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { previewLines, commandToString } from "./preview"
import type { Paths, StepDescriptor, StepReport } from "./types"
import * as api from "@/lib/tauri/commands"

interface Opts { dryRun: boolean; paths: Paths; messages?: Messages; signal?: AbortSignal; onUpdate?: (r: StepReport, i: number) => void }

export async function runSteps(steps: StepDescriptor[], opts: Opts): Promise<StepReport[]> {
  const m = opts.messages ?? en
  const reports: StepReport[] = steps.map((s) => ({ id: s.id, label: s.label, status: "pending", output: [] }))
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i], report = reports[i]
    if (opts.signal?.aborted) { report.status = "skipped"; opts.onUpdate?.(report, i); continue }
    report.status = "running"; opts.onUpdate?.(report, i)
    const log = (l: string) => { report.output.push(l); opts.onUpdate?.(report, i) }
    try {
      if (opts.dryRun) { for (const l of previewLines(step, opts.paths, m)) log(l) }
      else await execute(step, opts.paths, m, log)
      report.status = "done"
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (step.kind === "command" && step.verifyOnly) { report.output.push(msg); report.status = "done" }
      else { report.status = "error"; report.error = msg }
    }
    opts.onUpdate?.(report, i)
  }
  return reports
}

async function execute(step: StepDescriptor, paths: Paths, m: Messages, log: (l: string) => void): Promise<void> {
  switch (step.kind) {
    case "command": {
      const printable = commandToString(step.command); log(`$ ${printable}`)
      const code = await api.runCommand(step.command, log)
      if (code !== 0) throw new Error(`${printable} — ${m.coreOutput.exitedWithCode(code)}`)
      return
    }
    case "mergeFile":
    case "ccVisibleApps": {
      const existing = await api.readTextFile(step.path)
      log(m.coreOutput.write(step.path))
      await api.writeTextFile(step.path, step.merge(existing))
      return
    }
    case "skillInstall": {
      const dests = await api.installSkill(step.skillId, step.targets)
      for (const d of dests) log(m.coreOutput.copy(step.skillId, d))
      return
    }
    case "skillRemove": {
      for (const d of step.dests) { log(m.coreOutput.delete(d)); await api.removeDir(d) }
      return
    }
    case "ccProvider": {
      const p = step.payload as { app: "claude" | "codex"; id?: string; settingsConfig?: string; form?: { name: string; websiteUrl?: string; notes?: string } }
      const lines = await api.ccWriteProvider({ op: step.op, dryRun: false, app: p.app, id: p.id, settingsConfig: p.settingsConfig, form: p.form })
      for (const l of lines) log(l)
      return
    }
  }
}
```

- [ ] **Step 2: Test dry-run never calls mutating APIs; real path dispatches**

```ts
jest.mock("@/lib/tauri/commands")
import * as api from "@/lib/tauri/commands"
import { runSteps } from "./runner"
import type { Paths, StepDescriptor } from "./types"
const paths = { home: "/h", codexConfig: "/h/.codex/config.toml", claudeSkillsDir: "/h/.claude/skills", codexSkillsDir: "/h/.codex/skills" } as Paths

it("dry-run produces preview output and calls no mutating command", async () => {
  const steps: StepDescriptor[] = [{ kind: "command", id: "c", label: "c", command: { file: "npm", args: ["i"] } }]
  const reports = await runSteps(steps, { dryRun: true, paths })
  expect(reports[0].status).toBe("done")
  expect(reports[0].output).toContain("would run: npm i")
  expect(api.runCommand).not.toHaveBeenCalled()
})
it("real command failure marks error but continues", async () => {
  ;(api.runCommand as jest.Mock).mockResolvedValue(1)
  const steps: StepDescriptor[] = [
    { kind: "command", id: "a", label: "a", command: { file: "x", args: [] } },
    { kind: "command", id: "b", label: "b", command: { file: "y", args: [] }, verifyOnly: true },
  ]
  const reports = await runSteps(steps, { dryRun: false, paths })
  expect(reports[0].status).toBe("error")
  expect(reports[1].status).toBe("done") // verifyOnly swallows
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest lib/agentpack/runner.test.ts`
Expected: PASS.

```bash
git add lib/agentpack/runner.ts lib/agentpack/runner.test.ts
git commit -m "feat(agentpack): descriptor runner (dry-run safe, non-aborting)"
```

---

## Phase G — Store + app shell

### Task G1: Zustand store

**Files:**
- Create: `store/app-store.ts`
- Test: `store/app-store.test.ts`

**Interfaces:**
- Produces: `useAppStore` with state `{ plan: Plan; dryRun: boolean; osOverride: OS | null; paths: Paths | null; effectiveOS: () => OS }` and actions `setPaths`, `toggleDryRun`, `setOsOverride`, `setClis`, `setSkill(id, targets)`, `setMcp(id, targets)`, `setMcpKey(id, key)`, `setNetwork(patch)`, `applyPreset(presetId)`, `loadPlan(plan)`, `resetPlan`.

- [ ] **Step 1: Implement**

```ts
import { create } from "zustand"
import type { OS, Paths, Plan } from "@/lib/agentpack/types"
import { findPreset } from "@/lib/agentpack/presets"

const emptyPlan = (os: OS): Plan => ({ os, clis: [], skills: [], mcps: [], mcpKeys: {}, network: {} })

interface State {
  plan: Plan
  dryRun: boolean
  osOverride: OS | null
  paths: Paths | null
  effectiveOS: () => OS
  setPaths: (p: Paths) => void
  toggleDryRun: () => void
  setOsOverride: (os: OS | null) => void
  setClis: (clis: Plan["clis"]) => void
  setSkill: (id: string, targets: Plan["skills"][number]["targets"]) => void
  setMcp: (id: string, targets: Plan["mcps"][number]["targets"]) => void
  setMcpKey: (id: string, key: string) => void
  setNetwork: (patch: Partial<Plan["network"]>) => void
  applyPreset: (presetId: string) => void
  loadPlan: (plan: Plan) => void
  resetPlan: () => void
}

export const useAppStore = create<State>((set, get) => ({
  plan: emptyPlan("mac"),
  dryRun: false,
  osOverride: null,
  paths: null,
  effectiveOS: () => get().osOverride ?? get().paths?.os ?? "mac",
  setPaths: (p) => set((s) => ({ paths: p, plan: { ...s.plan, os: s.osOverride ?? p.os } })),
  toggleDryRun: () => set((s) => ({ dryRun: !s.dryRun })),
  setOsOverride: (os) => set((s) => ({ osOverride: os, plan: { ...s.plan, os: os ?? s.paths?.os ?? "mac" } })),
  setClis: (clis) => set((s) => ({ plan: { ...s.plan, clis } })),
  setSkill: (id, targets) => set((s) => {
    const skills = s.plan.skills.filter((x) => x.id !== id)
    if (targets.length) skills.push({ id, targets })
    return { plan: { ...s.plan, skills } }
  }),
  setMcp: (id, targets) => set((s) => {
    const mcps = s.plan.mcps.filter((x) => x.id !== id)
    if (targets.length) mcps.push({ id, targets })
    return { plan: { ...s.plan, mcps } }
  }),
  setMcpKey: (id, key) => set((s) => ({ plan: { ...s.plan, mcpKeys: { ...s.plan.mcpKeys, [id]: key } } })),
  setNetwork: (patch) => set((s) => ({ plan: { ...s.plan, network: { ...s.plan.network, ...patch } } })),
  applyPreset: (presetId) => set((s) => {
    const p = findPreset(presetId)
    if (!p) return { plan: { ...emptyPlan(s.plan.os) } }
    return { plan: { ...emptyPlan(s.plan.os),
      clis: p.clis as Plan["clis"],
      skills: p.skills.map((id) => ({ id, targets: ["claude", "codex"] as const })) as Plan["skills"],
      mcps: p.mcps.map((id) => ({ id, targets: ["claude"] as const })) as Plan["mcps"] } }
  }),
  loadPlan: (plan) => set({ plan }),
  resetPlan: () => set((s) => ({ plan: emptyPlan(s.plan.os) })),
}))
```

- [ ] **Step 2: Test reducers**

```ts
import { useAppStore } from "./app-store"
beforeEach(() => useAppStore.getState().resetPlan())

it("setMcp adds then clears by empty targets", () => {
  useAppStore.getState().setMcp("context7", ["claude"])
  expect(useAppStore.getState().plan.mcps).toHaveLength(1)
  useAppStore.getState().setMcp("context7", [])
  expect(useAppStore.getState().plan.mcps).toHaveLength(0)
})
it("applyPreset recommended fills clis", () => {
  useAppStore.getState().applyPreset("recommended")
  expect(useAppStore.getState().plan.clis).toContain("cc-switch")
})
it("osOverride changes effectiveOS + plan.os", () => {
  useAppStore.getState().setOsOverride("win")
  expect(useAppStore.getState().effectiveOS()).toBe("win")
  expect(useAppStore.getState().plan.os).toBe("win")
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest store/app-store.test.ts`
Expected: PASS.

```bash
git add store/app-store.ts store/app-store.test.ts
git commit -m "feat(store): zustand app store for plan/dry-run/os/paths"
```

### Task G2: App shell + layout providers + paths bootstrap

**Files:**
- Modify: `app/layout.tsx` (wrap `I18nProvider` + `next-themes` `ThemeProvider`)
- Create: `components/agentpack/app-shell.tsx`, `components/agentpack/header.tsx`, `components/agentpack/sidebar-nav.tsx`
- Modify: `app/page.tsx` (render `<AppShell/>`)

**Interfaces:**
- Consumes: `useT`, `useLocale`, `useAppStore`, `getPaths`, shadcn `Sidebar`, `Tabs` or section switch.
- Produces: `<AppShell/>` with `activeSection` state; header controls bound to store/i18n.

- [ ] **Step 1: Wrap providers in layout**

In `app/layout.tsx`, import and wrap children:

```tsx
import { ThemeProvider } from "next-themes"
import { I18nProvider } from "@/lib/i18n/provider"
// ...
<body className={...}>
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <I18nProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>
  </ThemeProvider>
</body>
```
Add `"use client"`? No — keep layout a server component; the providers are client components (they carry `"use client"`). Update `metadata.title` to `"agentpack"`.

- [ ] **Step 2: Sidebar nav + shell skeleton**

Create `sidebar-nav.tsx` exporting a `SECTIONS` array `[{ key, labelKey }]` for: presets, skills, ccswitch, clis, mcp, network, config — and a component rendering shadcn sidebar buttons that call `onSelect(key)`.

Create `app-shell.tsx`:

```tsx
"use client"
import { useEffect, useState } from "react"
import { useAppStore } from "@/store/app-store"
import { getPaths } from "@/lib/tauri/commands"
import { isTauri } from "@/lib/tauri"
import { Header } from "./header"
import { SidebarNav, type SectionKey } from "./sidebar-nav"
// section components imported lazily below

export function AppShell() {
  const setPaths = useAppStore((s) => s.setPaths)
  const [section, setSection] = useState<SectionKey>("presets")
  useEffect(() => { if (isTauri()) getPaths().then(setPaths).catch(() => {}) }, [setPaths])
  return (
    <div className="flex h-screen">
      <SidebarNav active={section} onSelect={setSection} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-auto p-6">{renderSection(section)}</main>
      </div>
    </div>
  )
}
```
`renderSection` switches on key → the section components (stubs returning the section title for now; filled in Phase G/H/I).

- [ ] **Step 3: Header with controls**

`header.tsx` renders: brand (`t.brand`), Preview switch (`useAppStore.toggleDryRun`), OS select (win/mac/linux/auto → `setOsOverride`), language select (`useLocale`), theme toggle (`next-themes useTheme`). Use shadcn `Switch`, `Select`, `Button`.

- [ ] **Step 4: Point home page at the shell**

Replace `app/page.tsx` body with:

```tsx
import { AppShell } from "@/components/agentpack/app-shell"
export default function Home() { return <AppShell /> }
```

- [ ] **Step 5: Verify build + render**

Run: `pnpm typecheck && pnpm build`
Expected: static export succeeds (`out/` generated), no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/page.tsx components/agentpack/app-shell.tsx components/agentpack/header.tsx components/agentpack/sidebar-nav.tsx
git commit -m "feat(ui): app shell, header controls, providers, paths bootstrap"
```

---

## Phase H — Selection sections

### Task H1: Presets section

**Files:**
- Create: `components/agentpack/sections/presets.tsx`
- Test: `components/agentpack/sections/presets.test.tsx`

**Interfaces:** Consumes `useT`, `useAppStore.applyPreset`, `PRESETS`. Renders selectable cards (Custom + the three presets).

- [ ] **Step 1: Implement** — render `t.presetsScreen.title/subtitle`, then a card per `{ id: "custom" }` and each `PRESETS` entry using `t.presets[id].title/description`; clicking calls `applyPreset(id)` (custom → `resetPlan`). Highlight the active one.

- [ ] **Step 2: Test**

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { PresetsSection } from "./presets"

it("clicking Recommended fills the plan", async () => {
  render(<I18nProvider><PresetsSection /></I18nProvider>)
  await userEvent.click(await screen.findByText("Recommended"))
  expect(useAppStore.getState().plan.clis).toContain("cc-switch")
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest components/agentpack/sections/presets.test.tsx`
Expected: PASS.

```bash
git add components/agentpack/sections/presets.tsx components/agentpack/sections/presets.test.tsx
git commit -m "feat(ui): presets section"
```

### Task H2: CLIs section (env-check + install/upgrade toggles)

**Files:**
- Create: `components/agentpack/sections/clis.tsx`
- Test: `components/agentpack/sections/clis.test.tsx` (mock `@/lib/tauri/commands.detectCli`)

**Interfaces:** Consumes `useT`, `useAppStore` (clis, effectiveOS), `CLI_TOOLS`, `detectCli`, `isTauri`. On mount (Tauri only) detect each CLI; show installed/version or "not found"; a checkbox per tool toggles it into `plan.clis`; installed tools show an "upgrade" hint (`t.tools.upgradeNote`).

- [ ] **Step 1: Implement** — list `CLI_TOOLS`; per row render `t.catalog.cli[id].title` + description, detection badge (`t.envcheck.installed`/`notFound` + version), and a `Checkbox` bound to `plan.clis`. Use `useEffect` to call `detectCli(tool.bin, !!tool.gui)` and store results in local state.

- [ ] **Step 2: Test detection badge + toggle**

```tsx
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({ detectCli: jest.fn(async () => ({ installed: true, version: "1.2.3" })) }))
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { ClisSection } from "./clis"

it("shows version and toggles selection", async () => {
  render(<I18nProvider><ClisSection /></I18nProvider>)
  expect(await screen.findAllByText(/1\.2\.3/)).not.toHaveLength(0)
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(useAppStore.getState().plan.clis.length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest components/agentpack/sections/clis.test.tsx`
Expected: PASS.

```bash
git add components/agentpack/sections/clis.tsx components/agentpack/sections/clis.test.tsx
git commit -m "feat(ui): CLIs section with detection + install/upgrade toggles"
```

### Task H3: Skills section (install/uninstall with live status)

**Files:**
- Create: `components/agentpack/sections/skills.tsx`
- Test: `components/agentpack/sections/skills.test.tsx`

**Interfaces:** Consumes `useT`, `SKILLS`, `useAppStore.setSkill`, target checkboxes (claude/codex). Two modes per skill: add to plan (targets) for batch install, plus a direct "Install/Uninstall now" action that runs a single descriptor via the execution panel (Task I). For this task, implement the **selection** behaviour (target toggles → `setSkill`); the immediate-action button dispatches through the runner added in Task I (wire a callback prop `onRunSteps`).

- [ ] **Step 1: Implement** — list `SKILLS` with `t.catalog.skills[id].title/description`; per skill two checkboxes (Claude, Codex) controlling its `targets`; calling `setSkill(id, targets)`.

- [ ] **Step 2: Test target toggling**

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SkillsSection } from "./skills"
it("checking Claude adds skill target", async () => {
  render(<I18nProvider><SkillsSection /></I18nProvider>)
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(useAppStore.getState().plan.skills.length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest components/agentpack/sections/skills.test.tsx`
Expected: PASS.

```bash
git add components/agentpack/sections/skills.tsx components/agentpack/sections/skills.test.tsx
git commit -m "feat(ui): skills section with per-target selection"
```

### Task H4: MCP section (+ API key inputs)

**Files:**
- Create: `components/agentpack/sections/mcp.tsx`
- Test: `components/agentpack/sections/mcp.test.tsx`

**Interfaces:** Consumes `useT`, `MCP_SERVERS`, `useAppStore.setMcp/setMcpKey`. Per server: title/purpose, Claude+Codex target checkboxes, and (if `keyEnv`) a password input bound to `setMcpKey`; `t.mcp.keySuffix` marks keyed servers; key input shows `t.mcpKeys.hint`.

- [ ] **Step 1: Implement** as described.

- [ ] **Step 2: Test key entry**

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { McpSection } from "./mcp"
it("entering a key stores it under the server id", async () => {
  render(<I18nProvider><McpSection /></I18nProvider>)
  const ctx = await screen.findByText(/Context7/)
  await userEvent.click(ctx) // select to reveal key field, or always-visible
  const key = screen.getByLabelText(/context7/i)
  await userEvent.type(key, "abc")
  expect(useAppStore.getState().plan.mcpKeys.context7).toBe("abc")
})
```
(If key fields are always visible, drop the click line.)

- [ ] **Step 3: Run + commit**

Run: `pnpm jest components/agentpack/sections/mcp.test.tsx`
Expected: PASS.

```bash
git add components/agentpack/sections/mcp.tsx components/agentpack/sections/mcp.test.tsx
git commit -m "feat(ui): MCP section with target toggles + key inputs"
```

### Task H5: Network section

**Files:**
- Create: `components/agentpack/sections/network.tsx`
- Test: `components/agentpack/sections/network.test.tsx`

**Interfaces:** Consumes `useT`, `useAppStore.setNetwork`. Three inputs: base URL (`t.network.baseUrlLabel`), token (`t.network.tokenLabel`, password), npm registry (`t.network.registryLabel`) → `setNetwork({ apiBaseUrl | apiToken | npmRegistry })`.

- [ ] **Step 1: Implement.**

- [ ] **Step 2: Test**

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { NetworkSection } from "./network"
it("writes registry into plan.network", async () => {
  render(<I18nProvider><NetworkSection /></I18nProvider>)
  await userEvent.type(screen.getByLabelText(/registry/i), "https://m")
  expect(useAppStore.getState().plan.network.npmRegistry).toBe("https://m")
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm jest components/agentpack/sections/network.test.tsx`
Expected: PASS.

```bash
git add components/agentpack/sections/network.tsx components/agentpack/sections/network.test.tsx
git commit -m "feat(ui): network/mirrors section"
```

---

## Phase I — cc-switch UI + execution panel + config I/O

### Task I1: Execution panel + step log + summary

**Files:**
- Create: `components/agentpack/run/execution-panel.tsx`, `step-log.tsx`, `summary.tsx`
- Create: `components/agentpack/run/use-runner.ts`
- Test: `components/agentpack/run/use-runner.test.tsx` (mock runner)

**Interfaces:**
- Produces: `useRunner()` → `{ reports, running, run(steps, plan), cancel, retryFailed }`; `<ExecutionPanel/>` (shadcn `Sheet`) showing review → live `<StepLog/>` → `<Summary/>`.
- Consumes: `runSteps`, `buildVerifySteps`, `summarize`, `useAppStore` (dryRun, paths), `useT`.

- [ ] **Step 1: Implement the runner hook**

```tsx
"use client"
import { useCallback, useRef, useState } from "react"
import { runSteps } from "@/lib/agentpack/runner"
import { buildVerifySteps } from "@/lib/agentpack/plan"
import type { Plan, StepDescriptor, StepReport } from "@/lib/agentpack/types"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"

export function useRunner() {
  const t = useT()
  const dryRun = useAppStore((s) => s.dryRun)
  const paths = useAppStore((s) => s.paths)
  const [reports, setReports] = useState<StepReport[]>([])
  const [running, setRunning] = useState(false)
  const ctrl = useRef<AbortController | null>(null)

  const run = useCallback(async (steps: StepDescriptor[], plan?: Plan) => {
    if (!paths) return
    const all = plan && !dryRun ? [...steps, ...buildVerifySteps(plan, t)] : steps
    setRunning(true); ctrl.current = new AbortController()
    setReports(all.map((s) => ({ id: s.id, label: s.label, status: "pending", output: [] })))
    await runSteps(all, { dryRun, paths, messages: t, signal: ctrl.current.signal,
      onUpdate: (r, i) => setReports((prev) => { const next = [...prev]; next[i] = { ...r }; return next }) })
    setRunning(false)
  }, [dryRun, paths, t])

  const cancel = useCallback(() => ctrl.current?.abort(), [])
  return { reports, running, run, cancel }
}
```

- [ ] **Step 2: Implement StepLog + Summary + Panel** — `StepLog` maps `reports` to rows with a status icon (pending/running/done ✓/error ✗/skipped) and a monospace `<pre>` of `output`. `Summary` calls `summarize(reports, plan, t, dryRun)` and renders the lines. `ExecutionPanel` is a shadcn `Sheet` opened by a store flag; header shows `t.shell.run` + dry-run badge; footer has Cancel/Close.

- [ ] **Step 3: Test the hook drives reports**

```tsx
jest.mock("@/lib/agentpack/runner", () => ({ runSteps: jest.fn(async (steps, o) => { steps.forEach((s: { id: string; label: string }, i: number) => o.onUpdate({ id: s.id, label: s.label, status: "done", output: ["ok"] }, i)); return [] }) }))
import { renderHook, act } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useRunner } from "./use-runner"

it("run populates reports", async () => {
  useAppStore.setState({ paths: { os: "mac" } as never, dryRun: true })
  const { result } = renderHook(() => useRunner(), { wrapper: I18nProvider })
  await act(async () => { await result.current.run([{ kind: "command", id: "a", label: "A", command: { file: "x", args: [] } }]) })
  expect(result.current.reports[0].status).toBe("done")
})
```

- [ ] **Step 4: Run + commit**

Run: `pnpm jest components/agentpack/run/use-runner.test.tsx`
Expected: PASS.

```bash
git add components/agentpack/run
git commit -m "feat(ui): execution panel, step log, summary, runner hook"
```

### Task I2: Wire "Run plan" + per-section immediate actions

**Files:**
- Modify: `components/agentpack/header.tsx` (Run button → build steps + open panel)
- Modify: `components/agentpack/app-shell.tsx` (mount `<ExecutionPanel/>`)
- Modify: `components/agentpack/sections/skills.tsx` (Install/Uninstall now buttons)

**Interfaces:** Consumes `buildSteps`, `skillInstallStep`, `skillRemoveStep`, `useRunner`, `useAppStore`.

- [ ] **Step 1: Header Run** — on click, `run(buildSteps(plan, paths, t), plan)` then open the panel (store flag `panelOpen`). Add `panelOpen`/`setPanelOpen` to the store (extend Task G1 state inline here).

- [ ] **Step 2: Skills immediate actions** — "Install now" → `run([skillInstallStep(id, title, targets, t)])`; "Uninstall now" → compute dests via `paths.claudeSkillsDir`/`codexSkillsDir` + id, `run([skillRemoveStep(id, title, targets, dests, t)])`.

- [ ] **Step 3: Verify build**

Run: `pnpm typecheck && pnpm build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add components/agentpack/header.tsx components/agentpack/app-shell.tsx components/agentpack/sections/skills.tsx store/app-store.ts
git commit -m "feat(ui): wire Run plan + skill immediate install/uninstall"
```

### Task I3: cc-switch section (install/check, visible apps, providers)

**Files:**
- Create: `components/agentpack/sections/ccswitch.tsx`, `components/agentpack/provider-form.tsx`
- Test: `components/agentpack/sections/ccswitch.test.tsx` (mock `ccLoadProviders`, `detectCli`)

**Interfaces:** Consumes `useT`, `ccLoadProviders`, `detectCli`, `isProcessRunning`, `useRunner`, `visibleAppsStep`, `providerStep`, `RECOMMENDED_PROVIDERS`, `DEFAULT_VISIBLE_APPS`, `VISIBLE_APP_KEYS`, `useAppStore.paths`.

- [ ] **Step 1: Implement three blocks**
  1. *Install/check*: `detectCli("cc-switch", true)` → badge `t.ccswitch.detected/notDetected`; install button adds `cliStep`-equivalent command for cc-switch to the runner (`buildSteps` already handles it if selected, but here a direct `run([{ kind:"command", ... install cmd for effectiveOS }])`; if `install[os]` is null show `tool.manualNote`).
  2. *Visible apps*: a `Switch` per `VISIBLE_APP_KEYS` (labels from `t.ccswitch.appLabels`), seeded from `DEFAULT_VISIBLE_APPS`; Apply → `run([visibleAppsStep(paths.ccSwitchSettings, visible, t)])`.
  3. *Providers*: load via `ccLoadProviders()`; table of name/app/current; row actions Edit/Delete/Set-current → `run([providerStep(...)])`; "+ Add" and recommended-preset buttons open `<ProviderForm/>`. Show `t.ccswitch.setCurrentNote`. If `ccLoadProviders` returns `[]` show `t.ccswitch.empty`/`noDb`.

- [ ] **Step 2: ProviderForm** — fields: name, app (claude/codex radio), baseUrl, token (password), claudeAuthKind radio (only when app=claude), model, notes, website; submit builds a `ProviderForm` and calls `onSubmit(form)` (parent dispatches `providerStep("add"|"update", ...)`).

- [ ] **Step 3: Test providers render + set-current dispatch**

```tsx
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  detectCli: jest.fn(async () => ({ installed: true })),
  ccLoadProviders: jest.fn(async () => [{ id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: false }]),
  isProcessRunning: jest.fn(async () => false),
}))
import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CcSwitchSection } from "./ccswitch"
it("lists providers from the DB", async () => {
  useAppStore.setState({ paths: { ccSwitchSettings: "/x", os: "mac" } as never })
  render(<I18nProvider><CcSwitchSection /></I18nProvider>)
  expect(await screen.findByText("Mine")).toBeInTheDocument()
})
```

- [ ] **Step 4: Run + commit**

Run: `pnpm jest components/agentpack/sections/ccswitch.test.tsx`
Expected: PASS.

```bash
git add components/agentpack/sections/ccswitch.tsx components/agentpack/provider-form.tsx components/agentpack/sections/ccswitch.test.tsx
git commit -m "feat(ui): cc-switch section (detect, visible apps, providers)"
```

### Task I4: Config import/export

**Files:**
- Create: `components/agentpack/config-io.tsx`
- Modify: `src-tauri/Cargo.toml` + `lib.rs` (add `tauri-plugin-dialog` + `tauri-plugin-fs` OR a custom `pick_save_path`/`pick_open_path` command)
- Test: `components/agentpack/config-io.test.tsx`

**Interfaces:** Consumes `serializePlan`, `parseConfig`, `useAppStore` (plan, loadPlan), `useT`. Save → choose path, `writeTextFile(path, serializePlan(plan))`. Load → choose path, `loadPlan(parseConfig(await readTextFile(path)))`.

- [ ] **Step 1: Add file-dialog capability** — simplest cross-platform path: add a Rust command pair using the `rfd` crate (native dialogs) OR the official `tauri-plugin-dialog`. Use `tauri-plugin-dialog` (add to Cargo.toml, register plugin in `lib.rs`, add `dialog:default` to `src-tauri/capabilities/default.json` permissions, `pnpm add @tauri-apps/plugin-dialog`).

- [ ] **Step 2: Implement component** — two buttons; Save uses `save({ defaultPath: "agentpack.config.json" })` then `writeTextFile`; Load uses `open({ filters: [{ name: "json", extensions: ["json"] }] })` then `readTextFile` + `parseConfig` + `loadPlan`. Wrap parse in try/catch → toast `sonner` error (`t.errors.invalidJson`).

- [ ] **Step 3: Test serialize/parse round-trip via the component’s helper** (extract `planToJson`/`jsonToPlan` thin wrappers and unit-test those; dialog is mocked)

```tsx
import { serializePlan, parseConfig } from "@/lib/agentpack/config"
import type { Plan } from "@/lib/agentpack/types"
it("round-trips a plan through config helpers", () => {
  const p: Plan = { os: "mac", clis: ["codex"], skills: [], mcps: [], mcpKeys: {}, network: {} }
  expect(parseConfig(serializePlan(p)).clis).toEqual(["codex"])
})
```

- [ ] **Step 4: Build + commit**

Run: `pnpm typecheck && cd src-tauri && cargo build`
Expected: success.

```bash
git add components/agentpack/config-io.tsx src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json pnpm-lock.yaml components/agentpack/config-io.test.tsx
git commit -m "feat(ui): config import/export via dialog plugin"
```

---

## Phase J — Integration, polish, verification

### Task J1: Wire all sections into the shell + i18n strings audit

**Files:**
- Modify: `components/agentpack/app-shell.tsx` (`renderSection` → real components), `sidebar-nav.tsx` (config-io entry)

- [ ] **Step 1:** Replace section stubs with the real components from Phases H/I. Mount `<ConfigIO/>` in the config section and `<ExecutionPanel/>` at shell root.

- [ ] **Step 2: Full typecheck + lint + all tests**

Run: `pnpm typecheck && pnpm lint && pnpm test && (cd src-tauri && cargo test)`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add components/agentpack
git commit -m "feat(ui): wire all sections + execution panel into shell"
```

### Task J2: Desktop smoke test + README/CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (note the agentpack app + new `lib/agentpack`, `src-tauri` commands), `README.md` (brief feature list)

- [ ] **Step 1: Manual desktop run** (requires a desktop session)

Run: `pnpm tauri dev`
Expected: window titled "agentpack" opens; sidebar sections render; toggling Preview then Run on a Minimal preset streams "would run …" lines without changing the system. Detection badges populate. (If no desktop session is available, document this as a manual verification step and skip.)

- [ ] **Step 2: Update docs** — in `CLAUDE.md` add an "agentpack app" section pointing at `lib/agentpack/` (pure logic), `lib/tauri/commands.ts` (IPC), `src-tauri/src/{exec,fsops,ccswitch,paths}.rs` (side-effects), and the dry-run/preview model. Add a one-line feature summary to `README.md`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document the agentpack desktop app architecture"
```

### Task J3: Final production build

- [ ] **Step 1: Static export + Tauri build sanity**

Run: `pnpm build && pnpm tauri build --no-bundle`
Expected: `out/` generated; Rust release compiles with all commands registered. (`--no-bundle` skips installer packaging for a fast check; drop it for a real installer.)

- [ ] **Step 2: Commit any lockfile/config deltas**

```bash
git add -A
git commit -m "chore: final build verification for agentpack-gui" || echo "nothing to commit"
```

---

## Self-Review Notes

**Spec coverage:** presets (H1), env detection (H2/D2), CLI install/upgrade (H2/F1/D2), skills install/uninstall (H3/F1/D3/I2), MCP install + keys (H4/F1), network/mirrors (H5/F1), cc-switch visible apps (I3/D4 settings) + provider DB CRUD/set-current with guardrails (I3/D4), bilingual UI (C1/C2), dry-run/preview (F2/F3 structural), config I/O (I4), OS override (G1/header), live streaming (D2 Channel + I1), cross-platform (Rust `cfg!`, registry per-OS), error handling (F3 verifyOnly + cc guardrails + parse), testing (every task). All spec sections map to tasks.

**Type consistency:** `StepDescriptor`/`StepReport`/`Paths` defined in B1 and consumed unchanged by plan/preview/runner/store/UI. Command wrapper names in E1 match runner calls in F3 (`runCommand`, `readTextFile`, `writeTextFile`, `removeDir`, `installSkill`, `ccWriteProvider`, `ccLoadProviders`, `detectCli`, `getPaths`). Rust serde `rename_all = "camelCase"` matches the TS field names (`isCurrent`, `appType` — note: `cc_load_providers` returns `app_type`; UI test uses `app_type` — **align**: set Provider serde to keep `app_type`/`is_current` snake to match `ccswitch/types.ts` `Provider` which uses `app_type`/`is_current`). The ported `lib/agentpack/ccswitch/types.ts` `Provider` uses snake_case (`app_type`, `is_current`, `settings_config`, `website_url`) — so Rust `Provider` must NOT rename those (drop `rename_all` on `Provider`, keep snake field names). Fix applied in D4 note below.

**D4 serde correction:** the `Provider` struct fields (`app_type`, `settings_config`, `website_url`, `is_current`) must serialize as snake_case to match the ported TS `Provider` type — remove `#[serde(rename_all = "camelCase")]` from `Provider` (keep it on `WriteReq`/`ProviderForm`, whose TS counterparts use camelCase). The implementer must apply this when writing D4.
