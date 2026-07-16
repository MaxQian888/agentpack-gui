import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import {
  findCli,
  findMcp,
  findRuntime,
  findSkill,
  installMethodsFor,
  upgradeCommandFor,
} from "./registry"
import { isUpgradeAvailable } from "./version"
import {
  buildClaudeMcpCommand,
  buildClaudeMcpCommandFromSpec,
  buildClaudeMcpRemoveCommand,
  buildCodexMcpEntry,
  buildCodexMcpEntryFromSpec,
  buildOpencodeMcpEntry,
  buildOpencodeMcpEntryFromSpec,
  deleteCodexMcpEntry,
  deleteOpencodeMcpEntry,
  mergeCodexMcp,
  mergeOpencodeMcp,
  resolveCatalogSpec,
  type McpSpec,
} from "./merge/mcp"
import {
  deleteClaudeRelay,
  deleteCodexProvider,
  mergeClaudeSettings,
  mergeCodexProvider,
  npmRegistryCommand,
} from "./merge/network"
import {
  mergeClaudeSkillOverride,
  mergeOpencodeSkillPermission,
  type ClaudeSkillVisibility,
  type OpencodeSkillPermission,
} from "./merge/skill-config"
import { mergeVisibleApps } from "./ccswitch/settings"
import { buildSettingsConfig } from "./ccswitch/provider"
import {
  claudeSettingsFromProvider,
  codexAuthFromProvider,
  codexConfigFromProvider,
} from "./ccswitch/sync"
import type {
  AgentTarget,
  CliInstallManager,
  CliTool,
  Command,
  CommandStep,
  McpServer,
  McpTarget,
  Paths,
  Plan,
  Runtime,
  StepDescriptor,
} from "./types"
import type { Provider, ProviderApp, ProviderForm, VisibleApps } from "./ccswitch/types"

/**
 * What's already present on the machine, so a batch run skips redundant work
 * instead of re-installing over things that are already there:
 *  - `versions` / `latest` decide upgrade-vs-skip for an installed CLI (upgrade
 *    only when a newer version is published; otherwise leave it be).
 *  - the per-agent MCP / skill id lists drop the add / copy steps for entries
 *    already configured, mirroring exactly what the dashboard scan reports so
 *    the plan and the dashboard never disagree about what's installed.
 * Every field is optional; an empty state reproduces fresh-install behavior.
 */
export interface InstalledState {
  /** Detected version per installed tool id. */
  versions?: Readonly<Record<string, string | undefined>>
  /** Latest published version per tool id (npm-based CLIs). */
  latest?: Readonly<Record<string, string | undefined>>
  /** How each installed CLI was installed, so an upgrade matches it in place. */
  managers?: Readonly<Record<string, CliInstallManager>>
  /** MCP server ids already configured for Claude Code (`~/.claude.json`). */
  claudeMcps?: readonly string[]
  /** MCP server ids already configured for Codex (`config.toml`). */
  codexMcps?: readonly string[]
  /** MCP server ids already configured for OpenCode (`opencode.json`). */
  opencodeMcps?: readonly string[]
  /** Skill ids already installed in Claude's skills dir. */
  claudeSkills?: readonly string[]
  /** Skill ids already installed in Codex's skills dir. */
  codexSkills?: readonly string[]
}

/**
 * Materialize a Plan into ordered, declarative StepDescriptors.
 * Order: npm mirror → runtime prerequisites → CLI installs → skills →
 * MCP servers → relay config. Closures (merge transforms) stay in TS; only
 * their read/write primitives cross IPC at run time. `messages` localizes
 * labels (defaults to English). `installed` holds detected tool/runtime ids
 * (from the dashboard scan) and drives upgrade-vs-install and prerequisites;
 * `state` carries the finer-grained already-installed detail (CLI versions plus
 * the configured MCP / skill ids) so already-present items are left untouched.
 *
 * Steps that can only succeed after an earlier step carry `dependsOn`, so the
 * runner skips them (instead of failing noisily) when the prerequisite failed.
 */
export function buildSteps(
  plan: Plan,
  paths: Paths,
  messages: Messages = en,
  installed: ReadonlySet<string> = new Set(),
  state: InstalledState = {}
): StepDescriptor[] {
  const t = messages.steps
  const cat = messages.catalog
  const steps: StepDescriptor[] = []

  // Already-configured MCP servers / skills, per agent — an entry here means the
  // corresponding add / copy step is redundant and gets dropped below.
  const claudeMcps = new Set(state.claudeMcps ?? [])
  const codexMcps = new Set(state.codexMcps ?? [])
  const opencodeMcps = new Set(state.opencodeMcps ?? [])
  const claudeSkills = new Set(state.claudeSkills ?? [])
  const codexSkills = new Set(state.codexSkills ?? [])

  // 1. npm registry mirror first, so subsequent npm installs use it.
  if (plan.network.npmRegistry) {
    steps.push({
      kind: "command",
      id: "npm-registry",
      label: t.npmRegistry(plan.network.npmRegistry),
      command: npmRegistryCommand(plan.network.npmRegistry),
    })
  }

  // Resolve the install command + method for a CLI. Already-installed tools
  // upgrade ONLY when a newer version is published; when they're current (or the
  // version lookup hasn't resolved yet) they're skipped rather than re-installed,
  // matching the CLIs / Dashboard sections. An upgrade uses the npm `@latest`
  // command; a fresh install uses the user's chosen method (or the tool's
  // default). `methodId` lets us tell whether Node is actually needed — only
  // npm-based methods do; a native-script or bun install does not.
  type Resolved = {
    skip: boolean
    upgrade: boolean
    cmd: Command | null | undefined
    methodId: string | undefined
    requiresElevation: boolean
  }
  const resolveCli = (tool: CliTool): Resolved => {
    if (installed.has(tool.id)) {
      const behind = isUpgradeAvailable(state.versions?.[tool.id], state.latest?.[tool.id])
      if (!behind) {
        return {
          skip: true,
          upgrade: false,
          cmd: undefined,
          methodId: undefined,
          requiresElevation: false,
        }
      }
      // Upgrade the way it was installed: a native install re-runs its own
      // script (no Node needed); an npm one uses `@latest`.
      const manager = state.managers?.[tool.id]
      const cmd = upgradeCommandFor(tool, plan.os, manager)
      return {
        skip: false,
        upgrade: true,
        cmd,
        methodId: manager === "native" ? "native" : "npm",
        requiresElevation: false,
      }
    }
    const methods = installMethodsFor(tool, plan.os)
    const chosen = methods.find((mth) => mth.id === plan.cliMethods?.[tool.id]) ?? methods[0]
    return {
      skip: false,
      upgrade: false,
      cmd: chosen?.command as Command | undefined,
      methodId: chosen?.id,
      requiresElevation: chosen?.requiresElevation ?? false,
    }
  }
  // A CLI needs the Node prerequisite only when it will be installed via npm
  // (npm ships with Node). pnpm/bun/native methods bring their own runtime.
  const isNpmBased = (methodId: string | undefined) => methodId === "npm" || methodId === "default"

  // 2. Runtime prerequisite — npm-installed CLIs need Node.js (npm). When Node
  // isn't detected, install it first and make the npm CLI installs depend on it.
  const nodeStepId = "runtime-node"
  let nodeStepIsCommand = false
  const needsNode = plan.clis.some((id) => {
    const tool = findCli(id)
    if (!tool?.npmPackage) return false
    const r = resolveCli(tool)
    // A skipped (already-current) CLI does no npm work, so it needs no Node.
    return !r.skip && isNpmBased(r.methodId)
  })
  if (needsNode && !installed.has("node")) {
    const node = findRuntime("node")
    const title = cat.runtime["node"]?.title ?? "Node.js"
    // Auto-install Node with its default (recommended) method.
    const method = node ? installMethodsFor(node, plan.os)[0] : undefined
    if (method) {
      nodeStepIsCommand = true
      steps.push({
        kind: "command",
        id: nodeStepId,
        label: t.installRuntime(title),
        command: method.command,
        requiresElevation: method.requiresElevation || undefined,
      })
    } else {
      steps.push({
        kind: "info",
        id: nodeStepId,
        label: t.installRuntime(title),
        lines: [node?.manualNote ?? t.noInstaller(title), t.manualInstall],
        manual: true,
      })
    }
  }

  // 3. CLI installs — missing ones install; installed-but-behind ones upgrade;
  // installed-and-current ones are skipped (no redundant re-install).
  for (const id of plan.clis) {
    const tool = findCli(id)
    if (!tool) continue
    const { skip, upgrade, cmd, methodId, requiresElevation } = resolveCli(tool)
    if (skip) continue
    const title = cat.cli[id]?.title ?? id
    const npmBased = Boolean(tool.npmPackage) && isNpmBased(methodId)
    if (cmd) {
      steps.push({
        kind: "command",
        id: `cli-${id}`,
        label: upgrade ? t.upgradeCli(title) : t.installCli(title),
        command: cmd,
        // Skip an npm install cleanly when the Node install itself failed.
        dependsOn: npmBased && nodeStepIsCommand ? [nodeStepId] : undefined,
        requiresElevation: requiresElevation || undefined,
      })
    } else {
      // No automated installer on this OS — surface the manual note instead of silently skipping.
      steps.push({
        kind: "info",
        id: `cli-${id}`,
        label: t.installCli(title),
        lines: [tool.manualNote ?? t.noInstaller(title), t.manualInstall],
        manual: true,
      })
    }
  }

  // Later steps that shell out to a CLI installed earlier in this same run
  // depend on that install step (freshly-installed => not in `installed`).
  const claudeDep =
    plan.clis.includes("claude-code") && !installed.has("claude-code")
      ? ["cli-claude-code"]
      : undefined

  // 4. Skills — copy only into targets where the skill isn't already installed,
  // so a re-run never re-copies over an existing install.
  for (const sk of plan.skills) {
    const def = findSkill(sk.id)
    if (!def || sk.targets.length === 0) continue
    const targets = sk.targets.filter((tg) =>
      tg === "claude" ? !claudeSkills.has(sk.id) : !codexSkills.has(sk.id)
    )
    if (targets.length === 0) continue
    const title = cat.skills[sk.id]?.title ?? sk.id
    steps.push({
      kind: "skillInstall",
      id: `skill-${sk.id}`,
      label: t.installSkill(title, targets.join(", ")),
      skillId: sk.id,
      targets,
    })
  }

  // 5. MCP servers — add only to agents that don't already have the server
  // configured. Re-adding a Claude server errors (`claude mcp add` rejects a
  // duplicate id); re-merging a Codex one is wasteful — skipping both keeps a
  // re-run clean and idempotent.
  for (const m of plan.mcps) {
    const server = findMcp(m.id)
    if (!server || m.targets.length === 0) continue
    const title = cat.mcp[m.id]?.title ?? m.id
    const key = plan.mcpKeys[m.id]

    if (m.targets.includes("claude") && !claudeMcps.has(m.id)) {
      steps.push({
        kind: "command",
        id: `mcp-claude-${m.id}`,
        label: t.addMcpClaude(title),
        command: buildClaudeMcpCommand(server, key),
        // `claude mcp add` needs the claude binary that step installs.
        dependsOn: claudeDep,
      })
    }
    if (m.targets.includes("codex") && !codexMcps.has(m.id)) {
      const entry = buildCodexMcpEntry(server, key)
      steps.push({
        kind: "mergeFile",
        id: `mcp-codex-${m.id}`,
        label: t.addMcpCodex(title),
        path: paths.codexConfig,
        merge: (existing) => mergeCodexMcp(existing, server.id, entry),
        writtenNote: t.codexMcpWritten(server.id),
      })
    }
    if (m.targets.includes("opencode") && !opencodeMcps.has(m.id)) {
      const entry = buildOpencodeMcpEntry(server, key)
      steps.push({
        kind: "mergeFile",
        id: `mcp-opencode-${m.id}`,
        label: t.addMcpOpencode(title),
        path: paths.opencodeConfig,
        merge: (existing) => mergeOpencodeMcp(existing, server.id, entry),
        writtenNote: t.opencodeMcpWritten(server.id),
      })
    }
  }

  // 6. Relay / API endpoint config.
  const net = plan.network
  if (net.apiBaseUrl || net.apiToken) {
    if (plan.clis.includes("claude-code")) {
      steps.push({
        kind: "mergeFile",
        id: "relay-claude",
        label: t.configureClaudeRelay,
        path: paths.claudeSettings,
        merge: (existing) => mergeClaudeSettings(existing, net),
        writtenNote: t.claudeSettingsUpdated,
      })
    }
    if (plan.clis.includes("codex") && net.apiBaseUrl) {
      steps.push({
        kind: "mergeFile",
        id: "relay-codex",
        label: t.configureCodexRelay,
        path: paths.codexConfig,
        merge: (existing) => mergeCodexProvider(existing, net),
        writtenNote: t.codexProviderUpdated,
      })
    }
  }

  return steps
}

/**
 * Read-only post-install verify steps (claude --version, claude mcp list,
 * codex --version). All marked verifyOnly so failures surface as info.
 */
export function buildVerifySteps(plan: Plan, messages: Messages = en): CommandStep[] {
  const v = messages.verify
  const steps: CommandStep[] = []
  if (plan.clis.includes("claude-code")) {
    steps.push({
      kind: "command",
      id: "verify-claude-version",
      label: v.claudeVersion,
      verifyOnly: true,
      command: { file: "claude", args: ["--version"] },
    })
    if (plan.mcps.some((m) => m.targets.includes("claude"))) {
      steps.push({
        kind: "command",
        id: "verify-claude-mcp",
        label: v.claudeMcp,
        verifyOnly: true,
        command: { file: "claude", args: ["mcp", "list"] },
      })
    }
  }
  if (plan.clis.includes("codex")) {
    steps.push({
      kind: "command",
      id: "verify-codex-version",
      label: v.codexVersion,
      verifyOnly: true,
      command: { file: "codex", args: ["--version"] },
    })
  }
  return steps
}

// ── Menu-action builders (single-step descriptors for direct management) ──────

export function cliInstallStep(
  id: Plan["clis"][number],
  command: { file: string; args: string[] },
  upgrade: boolean,
  messages: Messages = en,
  requiresElevation = false
): StepDescriptor {
  const title = messages.catalog.cli[id]?.title ?? id
  return {
    kind: "command",
    id: `cli-${upgrade ? "upgrade" : "install"}-${id}`,
    label: upgrade ? messages.steps.upgradeCli(title) : messages.steps.installCli(title),
    command,
    requiresElevation: requiresElevation || undefined,
  }
}

export function runtimeInstallStep(
  id: Runtime["id"],
  command: { file: string; args: string[] },
  messages: Messages = en,
  requiresElevation = false
): StepDescriptor {
  const title = messages.catalog.runtime[id]?.title ?? id
  return {
    kind: "command",
    id: `runtime-install-${id}`,
    label: messages.steps.installRuntime(title),
    command,
    requiresElevation: requiresElevation || undefined,
  }
}

/**
 * Update an already-installed runtime in place (`winget upgrade`, `brew upgrade`,
 * `bun upgrade`, `uv self update`). A `winget upgrade` is auto-elevated by the
 * runner, so no explicit elevation flag is needed here.
 */
export function runtimeUpgradeStep(
  id: Runtime["id"],
  command: { file: string; args: string[] },
  messages: Messages = en
): StepDescriptor {
  const title = messages.catalog.runtime[id]?.title ?? id
  return {
    kind: "command",
    id: `runtime-update-${id}`,
    label: messages.steps.updateRuntime(title),
    command,
  }
}

export function skillInstallStep(
  skillId: string,
  title: string,
  targets: AgentTarget[],
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "skillInstall",
    id: `skill-install-${skillId}`,
    label: messages.steps.installSkill(title, targets.join(", ")),
    skillId,
    targets,
  }
}

export function skillRemoveStep(
  skillId: string,
  title: string,
  targets: string[],
  dests: string[],
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "skillRemove",
    id: `skill-remove-${skillId}`,
    label: messages.steps.uninstallSkill(title, targets.join(", ")),
    skillId,
    targets,
    dests,
  }
}

/**
 * Copy a local skill folder (an installed skill from another agent's root, or a
 * user-picked import folder) into each target's skills root.
 */
export function skillCopyStep(
  dirName: string,
  title: string,
  srcPath: string,
  targets: string[],
  dests: string[],
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "skillCopy",
    id: `skill-copy-${dirName}-${targets.join("-")}`,
    label: messages.steps.copySkill(title, targets.join(", ")),
    srcPath,
    dirName,
    targets,
    dests,
  }
}

/** Install the selected skills from a fetched GitHub repo scan into each target. */
export function skillRepoInstallStep(
  scanId: string,
  skills: { relPath: string; dirName: string }[],
  targets: string[],
  dests: string[],
  repo: string,
  ref: string,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "skillRepoInstall",
    id: `skill-repo-install-${scanId}`,
    label: messages.steps.installRepoSkills(skills.length, targets.join(", ")),
    scanId,
    skills,
    targets,
    dests,
    repo,
    ref,
  }
}

/** Re-sync a managed skill from its origin repo into each of its sources. */
export function skillUpdateStep(
  dirName: string,
  path: string,
  targets: string[],
  dests: string[],
  mirrorPrefix: string | null,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "skillUpdate",
    id: `skill-update-${dirName}`,
    label: messages.steps.updateSkill(dirName, targets.join(", ")),
    path,
    dirName,
    targets,
    dests,
    mirrorPrefix,
  }
}

/** Back up a skill's directory before it is deleted. */
export function skillBackupStep(
  dirName: string,
  path: string,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "skillBackup",
    id: `skill-backup-${dirName}`,
    label: messages.steps.backupSkill(dirName),
    path,
    dirName,
  }
}

/** Create a new hand-authored skill (`<root>/<name>/SKILL.md`) in each target. */
export function skillCreateStep(
  name: string,
  targets: string[],
  content: string,
  dests: string[],
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "skillCreate",
    id: `skill-create-${name}`,
    label: messages.steps.createSkill(name, targets.join(", ")),
    name,
    targets,
    content,
    dests,
  }
}

/**
 * Overwrite a skill's SKILL.md with edited content. Rides the mergeFile
 * machinery (backup-on-first-touch, atomic write, dry-run preview).
 */
export function skillEditStep(
  dirName: string,
  skillMdPath: string,
  content: string,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "mergeFile",
    id: `skill-edit-${dirName}`,
    label: messages.steps.editSkill(dirName),
    path: skillMdPath,
    merge: () => content,
    writtenNote: messages.steps.skillMdWritten,
  }
}

/**
 * Set a skill's Claude Code visibility (`skillOverrides` in settings.json, keyed
 * by skill NAME). Rides the mergeFile machinery: backup-on-first-touch, atomic
 * write, dry-run preview.
 */
export function skillVisibilityStep(
  name: string,
  visibility: ClaudeSkillVisibility,
  paths: Paths,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "mergeFile",
    id: `skill-visibility-${name}`,
    label: messages.steps.skillVisibility(name, visibility),
    path: paths.claudeSettings,
    merge: (existing) => mergeClaudeSkillOverride(existing, name, visibility),
    writtenNote: messages.steps.claudeSkillOverridesWritten,
  }
}

/** Set a skill's OpenCode permission (`permission.skill.<name>` in opencode.json). */
export function skillPermissionStep(
  name: string,
  permission: OpencodeSkillPermission,
  paths: Paths,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "mergeFile",
    id: `skill-permission-${name}`,
    label: messages.steps.skillPermission(name, permission),
    path: paths.opencodeConfig,
    merge: (existing) => mergeOpencodeSkillPermission(existing, name, permission),
    writtenNote: messages.steps.opencodeConfigWritten,
  }
}

export function visibleAppsStep(
  path: string,
  visible: VisibleApps,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "ccVisibleApps",
    id: "cc-visible-apps",
    label: messages.steps.ccVisibleApps,
    path,
    merge: (existing) => mergeVisibleApps(existing, visible),
  }
}

/** Suffix for the rolling backup written before any mergeFile/ccVisibleApps write. */
export const BACKUP_SUFFIX = ".agentpack.bak"

/** MCP title for a step label: catalog title when known, else the raw id. */
function mcpTitle(id: string, messages: Messages): string {
  return messages.catalog.mcp[id]?.title ?? id
}

/**
 * Add steps for a resolved `McpSpec` across the chosen targets. Claude runs
 * `claude mcp add`; Codex / OpenCode merge an entry into their config file
 * (`config.toml` / `opencode.json`). Shared by catalog adds (`mcpAddStep`) and
 * custom-server adds (`mcpAddSpecStep`).
 */
function mcpAddSpecSteps(
  id: string,
  spec: McpSpec,
  targets: McpTarget[],
  paths: Paths,
  messages: Messages
): StepDescriptor[] {
  const title = mcpTitle(id, messages)
  const steps: StepDescriptor[] = []
  if (targets.includes("claude")) {
    steps.push({
      kind: "command",
      id: `mcp-add-claude-${id}`,
      label: messages.steps.addMcpClaude(title),
      command: buildClaudeMcpCommandFromSpec(id, spec),
    })
  }
  if (targets.includes("codex")) {
    const entry = buildCodexMcpEntryFromSpec(spec)
    steps.push({
      kind: "mergeFile",
      id: `mcp-add-codex-${id}`,
      label: messages.steps.addMcpCodex(title),
      path: paths.codexConfig,
      merge: (existing) => mergeCodexMcp(existing, id, entry),
      writtenNote: messages.steps.codexMcpWritten(id),
    })
  }
  if (targets.includes("opencode")) {
    const entry = buildOpencodeMcpEntryFromSpec(spec)
    steps.push({
      kind: "mergeFile",
      id: `mcp-add-opencode-${id}`,
      label: messages.steps.addMcpOpencode(title),
      path: paths.opencodeConfig,
      merge: (existing) => mergeOpencodeMcp(existing, id, entry),
      writtenNote: messages.steps.opencodeMcpWritten(id),
    })
  }
  return steps
}

/**
 * Add a catalog MCP server to the chosen agents directly (one card action,
 * outside a batch run). Mirrors the add steps `buildSteps` emits — minus the
 * batch-only `dependsOn` on a same-run `claude` install, since direct management
 * runs against an already-present CLI.
 */
export function mcpAddStep(
  server: McpServer,
  targets: McpTarget[],
  key: string | undefined,
  paths: Paths,
  messages: Messages = en
): StepDescriptor[] {
  return mcpAddSpecSteps(server.id, resolveCatalogSpec(server, key), targets, paths, messages)
}

/**
 * Add a user-defined custom MCP server (any command / url) to the chosen agents.
 * Same wiring as `mcpAddStep` but from a directly-constructed `McpSpec` rather
 * than a catalog entry, so custom servers reach all three targets identically.
 */
export function mcpAddSpecStep(
  id: string,
  spec: McpSpec,
  targets: McpTarget[],
  paths: Paths,
  messages: Messages = en
): StepDescriptor[] {
  return mcpAddSpecSteps(id, spec, targets, paths, messages)
}

/**
 * Edit an existing MCP server's config on the chosen targets. Codex / OpenCode
 * are idempotent overwrite merges (a single add re-writes the entry). Claude has
 * NO in-place edit — `claude mcp add` rejects a duplicate id — so it removes
 * then re-adds; the remove is `verifyOnly` so that adding Claude as a *new*
 * target mid-edit (nothing to remove) is tolerated rather than failing.
 */
export function mcpEditStep(
  id: string,
  spec: McpSpec,
  targets: McpTarget[],
  paths: Paths,
  messages: Messages = en
): StepDescriptor[] {
  const title = mcpTitle(id, messages)
  const steps: StepDescriptor[] = []
  if (targets.includes("claude")) {
    steps.push({
      kind: "command",
      id: `mcp-edit-remove-claude-${id}`,
      label: messages.steps.removeMcpClaude(title),
      command: buildClaudeMcpRemoveCommand(id),
      verifyOnly: true,
    })
    steps.push({
      kind: "command",
      id: `mcp-edit-add-claude-${id}`,
      label: messages.steps.addMcpClaude(title),
      command: buildClaudeMcpCommandFromSpec(id, spec),
    })
  }
  // Codex / OpenCode: reuse the add merges (overwrite the existing entry).
  steps.push(
    ...mcpAddSpecSteps(
      id,
      spec,
      targets.filter((tg) => tg !== "claude"),
      paths,
      messages
    )
  )
  return steps
}

/**
 * Remove an MCP server from the chosen agents. Claude uses `claude mcp remove`;
 * Codex / OpenCode delete the entry from their config file. Returns one step per
 * targeted agent (mirrors how buildSteps splits add steps).
 */
export function mcpRemoveStep(
  id: string,
  targets: McpTarget[],
  paths: Paths,
  messages: Messages = en
): StepDescriptor[] {
  const title = mcpTitle(id, messages)
  const steps: StepDescriptor[] = []
  if (targets.includes("claude")) {
    steps.push({
      kind: "command",
      id: `mcp-remove-claude-${id}`,
      label: messages.steps.removeMcpClaude(title),
      command: buildClaudeMcpRemoveCommand(id),
    })
  }
  if (targets.includes("codex")) {
    steps.push({
      kind: "mergeFile",
      id: `mcp-remove-codex-${id}`,
      label: messages.steps.removeMcpCodex(title),
      path: paths.codexConfig,
      merge: (existing) => deleteCodexMcpEntry(existing, id),
      writtenNote: messages.steps.codexMcpWritten(id),
    })
  }
  if (targets.includes("opencode")) {
    steps.push({
      kind: "mergeFile",
      id: `mcp-remove-opencode-${id}`,
      label: messages.steps.removeMcpOpencode(title),
      path: paths.opencodeConfig,
      merge: (existing) => deleteOpencodeMcpEntry(existing, id),
      writtenNote: messages.steps.opencodeMcpWritten(id),
    })
  }
  return steps
}

/**
 * Remove the agentpack relay config: Claude env vars from settings.json and the
 * agentpack provider from Codex config.toml. Returns one step per chosen CLI.
 */
export function relayRemoveStep(
  clis: Plan["clis"],
  paths: Paths,
  messages: Messages = en
): StepDescriptor[] {
  const steps: StepDescriptor[] = []
  if (clis.includes("claude-code")) {
    steps.push({
      kind: "mergeFile",
      id: "relay-remove-claude",
      label: messages.steps.removeRelayClaude,
      path: paths.claudeSettings,
      merge: (existing) => deleteClaudeRelay(existing),
      writtenNote: messages.steps.claudeSettingsUpdated,
    })
  }
  if (clis.includes("codex")) {
    steps.push({
      kind: "mergeFile",
      id: "relay-remove-codex",
      label: messages.steps.removeRelayCodex,
      path: paths.codexConfig,
      merge: (existing) => deleteCodexProvider(existing),
      writtenNote: messages.steps.codexProviderUpdated,
    })
  }
  return steps
}

/** Uninstall a CLI. No automated uninstaller on this OS => an info note. */
export function cliUninstallStep(
  id: Plan["clis"][number],
  command: { file: string; args: string[] } | undefined,
  messages: Messages = en
): StepDescriptor {
  const title = messages.catalog.cli[id]?.title ?? id
  if (command) {
    return {
      kind: "command",
      id: `cli-uninstall-${id}`,
      label: messages.steps.uninstallCli(title),
      command,
    }
  }
  return {
    kind: "info",
    id: `cli-uninstall-${id}`,
    label: messages.steps.uninstallCli(title),
    lines: [messages.steps.noUninstaller(title), messages.steps.manualInstall],
    manual: true,
  }
}

/** Restore a config file from its `.agentpack.bak` snapshot (lightweight rollback). */
export function fileRestoreStep(path: string, messages: Messages = en): StepDescriptor {
  return {
    kind: "fileRestore",
    id: `restore-${path}`,
    label: messages.steps.restoreFile(path),
    path,
    backupPath: `${path}${BACKUP_SUFFIX}`,
  }
}

export function providerStep(
  op: "add" | "update" | "delete" | "setCurrent",
  app: ProviderApp,
  name: string,
  form: ProviderForm | undefined,
  id: string | undefined,
  messages: Messages = en
): StepDescriptor {
  const s = messages.steps
  const label =
    op === "add"
      ? s.ccProviderAdd(name)
      : op === "update"
        ? s.ccProviderUpdate(name)
        : op === "delete"
          ? s.ccProviderDelete(name)
          : s.ccProviderSetCurrent(name)
  return {
    kind: "ccProvider",
    id: `cc-provider-${op}`,
    label,
    op,
    payload: {
      app,
      id,
      settingsConfig: form ? buildSettingsConfig(form) : undefined,
      form: form ? { name: form.name, websiteUrl: form.websiteUrl, notes: form.notes } : undefined,
    },
  }
}

/** Snapshot the cc-switch DB + live configs into the listable backup history. */
export function snapshotStep(reason: string, messages: Messages = en): StepDescriptor {
  return {
    kind: "snapshot",
    id: "backup-snapshot",
    label: messages.steps.snapshot,
    reason,
  }
}

/**
 * Write a provider's `settings_config` into the live agent config so switching it
 * actually takes effect. claude → settings.json; codex → config.toml + auth.json.
 * Reuses the `mergeFile` machinery (read → `.agentpack.bak` → write).
 *
 * `dependsOn` should name the DB-write step these syncs follow, so a failed DB
 * write never leaves the live config pointing at a provider that isn't current.
 */
export function syncLiveConfigSteps(
  provider: Provider,
  paths: Paths,
  messages: Messages = en,
  dependsOn?: string[]
): StepDescriptor[] {
  const s = messages.steps
  const cfg = provider.settings_config
  if (provider.app_type === "claude") {
    return [
      {
        kind: "mergeFile",
        id: "cc-sync-claude",
        label: s.syncClaude,
        path: paths.claudeSettings,
        merge: (existing) => claudeSettingsFromProvider(existing, cfg),
        writtenNote: s.claudeSettingsUpdated,
        dependsOn,
      },
    ]
  }
  return [
    {
      kind: "mergeFile",
      id: "cc-sync-codex-config",
      label: s.syncCodex,
      path: paths.codexConfig,
      merge: (existing) => codexConfigFromProvider(existing, cfg),
      writtenNote: s.codexProviderUpdated,
      dependsOn,
    },
    {
      kind: "mergeFile",
      id: "cc-sync-codex-auth",
      label: s.syncCodexAuth,
      path: paths.codexAuth,
      merge: (existing) => codexAuthFromProvider(existing, cfg),
      writtenNote: s.codexProviderUpdated,
      dependsOn,
    },
  ]
}
