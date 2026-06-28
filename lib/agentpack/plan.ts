import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { findCli, findMcp, findSkill } from "./registry"
import {
  buildClaudeMcpCommand,
  buildClaudeMcpRemoveCommand,
  buildCodexMcpEntry,
  deleteCodexMcpEntry,
  mergeCodexMcp,
} from "./merge/mcp"
import {
  deleteClaudeRelay,
  deleteCodexProvider,
  mergeClaudeSettings,
  mergeCodexProvider,
  npmRegistryCommand,
} from "./merge/network"
import { mergeVisibleApps } from "./ccswitch/settings"
import { buildSettingsConfig } from "./ccswitch/provider"
import type { AgentTarget, CommandStep, Paths, Plan, Runtime, StepDescriptor } from "./types"
import type { ProviderApp, ProviderForm, VisibleApps } from "./ccswitch/types"

/**
 * Materialize a Plan into ordered, declarative StepDescriptors.
 * Order: npm mirror → CLI installs → skills → MCP servers → relay config.
 * Closures (merge transforms) stay in TS; only their read/write primitives
 * cross IPC at run time. `messages` localizes labels (defaults to English).
 */
export function buildSteps(
  plan: Plan,
  paths: Paths,
  messages: Messages = en,
  installed: ReadonlySet<string> = new Set()
): StepDescriptor[] {
  const t = messages.steps
  const cat = messages.catalog
  const steps: StepDescriptor[] = []

  // 1. npm registry mirror first, so subsequent npm installs use it.
  if (plan.network.npmRegistry) {
    steps.push({
      kind: "command",
      id: "npm-registry",
      label: t.npmRegistry(plan.network.npmRegistry),
      command: npmRegistryCommand(plan.network.npmRegistry),
    })
  }

  // 2. CLI installs — already-installed tools upgrade; missing ones install.
  for (const id of plan.clis) {
    const tool = findCli(id)
    if (!tool) continue
    const title = cat.cli[id]?.title ?? id
    const upgrade = installed.has(id)
    const cmd = upgrade ? (tool.upgrade?.[plan.os] ?? tool.install[plan.os]) : tool.install[plan.os]
    if (cmd) {
      steps.push({
        kind: "command",
        id: `cli-${id}`,
        label: upgrade ? t.upgradeCli(title) : t.installCli(title),
        command: cmd,
      })
    } else {
      // No automated installer on this OS — surface the manual note instead of silently skipping.
      steps.push({
        kind: "info",
        id: `cli-${id}`,
        label: t.installCli(title),
        lines: [tool.manualNote ?? t.noInstaller(title), t.manualInstall],
      })
    }
  }

  // 3. Skills.
  for (const sk of plan.skills) {
    const def = findSkill(sk.id)
    if (!def || sk.targets.length === 0) continue
    const title = cat.skills[sk.id]?.title ?? sk.id
    steps.push({
      kind: "skillInstall",
      id: `skill-${sk.id}`,
      label: t.installSkill(title, sk.targets.join(", ")),
      skillId: sk.id,
      targets: sk.targets,
    })
  }

  // 4. MCP servers.
  for (const m of plan.mcps) {
    const server = findMcp(m.id)
    if (!server || m.targets.length === 0) continue
    const title = cat.mcp[m.id]?.title ?? m.id
    const key = plan.mcpKeys[m.id]

    if (m.targets.includes("claude")) {
      steps.push({
        kind: "command",
        id: `mcp-claude-${m.id}`,
        label: t.addMcpClaude(title),
        command: buildClaudeMcpCommand(server, key),
      })
    }
    if (m.targets.includes("codex")) {
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
  }

  // 5. Relay / API endpoint config.
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
  messages: Messages = en
): StepDescriptor {
  const title = messages.catalog.cli[id]?.title ?? id
  return {
    kind: "command",
    id: `cli-${upgrade ? "upgrade" : "install"}-${id}`,
    label: upgrade ? messages.steps.upgradeCli(title) : messages.steps.installCli(title),
    command,
  }
}

export function runtimeInstallStep(
  id: Runtime["id"],
  command: { file: string; args: string[] },
  messages: Messages = en
): StepDescriptor {
  const title = messages.catalog.runtime[id]?.title ?? id
  return {
    kind: "command",
    id: `runtime-install-${id}`,
    label: messages.steps.installRuntime(title),
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
  targets: AgentTarget[],
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

/**
 * Remove an MCP server from the chosen agents. Claude uses `claude mcp remove`;
 * Codex deletes the `mcp_servers.<id>` table from config.toml. Returns one step
 * per targeted agent (mirrors how buildSteps splits add steps).
 */
export function mcpRemoveStep(
  id: string,
  targets: AgentTarget[],
  paths: Paths,
  messages: Messages = en
): StepDescriptor[] {
  const title = messages.catalog.mcp[id]?.title ?? id
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
