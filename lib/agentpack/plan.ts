import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { restoreBlankedSecrets, type BundleFileKey } from "./bundle/secrets"
import { formatBytes, type CleanupConfigTarget } from "./cleanup"
import {
  fallbackMethodsFor,
  findCli,
  findMcp,
  findRuntime,
  findSkill,
  installMethodsFor,
  upgradeCommandFor,
} from "./registry"
import { hasReleaseFor } from "./release"
import { isUpgradeAvailable, majorVersion } from "./version"
import {
  buildClaudeMcpCommandFromSpec,
  buildClaudeMcpEntryFromSpec,
  buildClaudeMcpRemoveCommand,
  buildCodexMcpEntryFromSpec,
  buildOpencodeMcpEntryFromSpec,
  deleteCodexMcpEntry,
  deleteOpencodeMcpEntry,
  mergeClaudeMcp,
  mergeCodexMcp,
  mergeOpencodeMcp,
  removeClaudeMcp,
  resolveCatalogSpec,
  setCodexMcpEnabled,
  setOpencodeMcpEnabled,
  wrapStdioForOs,
  type McpSpec,
} from "./merge/mcp"
import {
  addDisabled,
  parseDisabledStore,
  removeDisabled,
  serializeDisabledStore,
} from "./mcp-disabled"
import {
  deleteClaudeProxy,
  deleteShellProxyBlock,
  gitProxyClearCommands,
  gitProxyCommands,
  mergeClaudeProxy,
  mergeShellProxyBlock,
  npmProxyClearCommands,
  npmProxyCommands,
  npmRegistryCommand,
  winProxyClearCommands,
  winProxyCommands,
} from "./merge/network"
import {
  effectiveProxy,
  hasTarget,
  isProxyActive,
  shellExportLines,
  shellFlavor,
} from "./network/proxy"
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
  codexConfigFromProvider,
  opencodeConfigFromProvider,
} from "./ccswitch/sync"
import type {
  Arch,
  CleanupSpecDescriptor,
  CliInstallManager,
  CliTool,
  Command,
  CommandStep,
  McpServer,
  McpTarget,
  OS,
  Paths,
  Plan,
  ProxyConfig,
  ProxyTarget,
  ReleaseInstallStep,
  Runtime,
  StepDescriptor,
} from "./types"
import type {
  Provider,
  ProviderApp,
  ProviderBackend,
  ProviderForm,
  VisibleApps,
} from "./ccswitch/types"

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
 * Machine/app facts a plan needs that aren't part of the plan itself. Both are
 * optional so existing callers (and every existing test) keep their behaviour:
 * without them, release-based installs simply aren't offered.
 */
export interface BuildOptions {
  /** CPU architecture, for picking the right release asset. Defaults to x64. */
  arch?: Arch
  /** GitHub download mirror prefix from app settings, or null for direct. */
  ghMirrorPrefix?: string | null
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
  state: InstalledState = {},
  opts: BuildOptions = {}
): StepDescriptor[] {
  const t = messages.steps
  const cat = messages.catalog
  const steps: StepDescriptor[] = []
  const arch = opts.arch ?? "x64"
  const ghMirrorPrefix = opts.ghMirrorPrefix ?? null

  /**
   * The GitHub-Release install step for a tool, when it publishes something
   * installable on this OS. Used two ways: as the *only* path where a platform
   * has no package manager (cc-switch on Linux), and as the last fallback when
   * one does but the network won't cooperate.
   */
  const releaseStep = (tool: CliTool, title: string): ReleaseInstallStep | undefined =>
    hasReleaseFor(tool.release, plan.os)
      ? {
          kind: "releaseInstall",
          id: `cli-${tool.id}-release`,
          label: t.installFromRelease(title),
          title,
          source: tool.release!,
          os: plan.os,
          arch,
          mirrorPrefix: ghMirrorPrefix,
        }
      : undefined

  /**
   * Other routes to the same tool, ordered cheapest-first: another package
   * manager, then a direct release download. Only consulted when the primary
   * command fails *on the network* (see `lib/agentpack/network/recovery.ts`).
   */
  const fallbacksFor = (tool: CliTool, title: string, chosenId: string | undefined) => {
    const out: StepDescriptor[] = fallbackMethodsFor(tool, plan.os, chosenId).map((mth) => ({
      kind: "command" as const,
      id: `cli-${tool.id}-${mth.id}`,
      label: t.installCliVia(title, mth.id),
      command: mth.command,
      requiresElevation: mth.requiresElevation || undefined,
    }))
    const release = releaseStep(tool, title)
    if (release) out.push(release)
    return out.length > 0 ? out : undefined
  }

  // Already-configured MCP servers / skills, per agent — an entry here means the
  // corresponding add / copy step is redundant and gets dropped below.
  const claudeMcps = new Set(state.claudeMcps ?? [])
  const codexMcps = new Set(state.codexMcps ?? [])
  const opencodeMcps = new Set(state.opencodeMcps ?? [])
  const claudeSkills = new Set(state.claudeSkills ?? [])
  const codexSkills = new Set(state.codexSkills ?? [])

  // 0. Proxy before anything that touches the network, so the mirror lookup and
  // every install below already go through it.
  steps.push(...proxyApplySteps(plan.network.proxy, paths, plan.os, messages))

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
  const needsNodeForCli = plan.clis.some((id) => {
    const tool = findCli(id)
    if (!tool?.npmPackage) return false
    const r = resolveCli(tool)
    // A skipped (already-current) CLI does no npm work, so it needs no Node.
    return !r.skip && isNpmBased(r.methodId)
  })
  // An npx-launched server needs Node to *start*, which is a different question
  // from whether anything here is installed through npm. The desktop-app path
  // installs no npm CLI at all, so without this its servers would be written to
  // config and then silently never launch — `claude mcp add` only writes config
  // and reports success either way. Same shape as `needsUv` below.
  const needsNodeForMcp = plan.mcps.some((m) => {
    if (m.targets.length === 0) return false
    const server = findMcp(m.id)
    return server?.transport === "stdio" && (server.runtime ?? "npx") === "npx"
  })
  const needsNode = needsNodeForCli || needsNodeForMcp
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
        // On Windows, scoop is a user-scope route that avoids both UAC and
        // whatever blocked winget's download.
        fallbacks: node
          ? fallbackMethodsFor(node, plan.os, method.id).map((mth) => ({
              kind: "command" as const,
              id: `${nodeStepId}-${mth.id}`,
              label: t.installRuntimeVia(title, mth.id),
              command: mth.command,
              requiresElevation: mth.requiresElevation || undefined,
            }))
          : undefined,
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

  // 2b. uv prerequisite — a uvx-launched MCP server (published to PyPI, not npm)
  // needs uv on PATH. Unlike Node this is NOT a `dependsOn` for the MCP steps:
  // `claude mcp add` only writes config and succeeds without uv, so gating on a
  // failed uv install would drop config that is otherwise correct and would start
  // working the moment uv appears.
  const needsUv = plan.mcps.some((m) => {
    if (m.targets.length === 0) return false
    return findMcp(m.id)?.runtime === "uvx"
  })
  if (needsUv && !installed.has("uv")) {
    const uv = findRuntime("uv")
    const title = cat.runtime["uv"]?.title ?? "uv"
    const method = uv ? installMethodsFor(uv, plan.os)[0] : undefined
    steps.push(
      method
        ? {
            kind: "command",
            id: "runtime-uv",
            label: t.installRuntime(title),
            command: method.command,
            requiresElevation: method.requiresElevation || undefined,
          }
        : {
            kind: "info",
            id: "runtime-uv",
            label: t.installRuntime(title),
            lines: [uv?.manualNote ?? t.noInstaller(title), t.manualInstall],
            manual: true,
          }
    )
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

    // An npm install against a Node older than the package's `engines.node`
    // floor fails with EBADENGINE buried in npm's output. Catch it up front and
    // say what to do instead. Only when Node is already on the machine and too
    // old — when it's absent we install a current LTS above every floor.
    const nodeFound = installed.has("node") ? state.versions?.["node"] : undefined
    const nodeMajor = majorVersion(nodeFound)
    if (npmBased && tool.minNodeMajor && nodeMajor !== undefined && nodeMajor < tool.minNodeMajor) {
      steps.push({
        kind: "info",
        id: `cli-${id}`,
        label: upgrade ? t.upgradeCli(title) : t.installCli(title),
        lines: [
          t.nodeTooOld(title, tool.minNodeMajor, nodeFound ?? String(nodeMajor)),
          t.nodeTooOldFix(tool.minNodeMajor),
        ],
        manual: true,
      })
      continue
    }

    if (cmd) {
      steps.push({
        kind: "command",
        id: `cli-${id}`,
        label: upgrade ? t.upgradeCli(title) : t.installCli(title),
        command: cmd,
        // Skip an npm install cleanly when the Node install itself failed.
        dependsOn: npmBased && nodeStepIsCommand ? [nodeStepId] : undefined,
        requiresElevation: requiresElevation || undefined,
        // An upgrade re-runs the path the tool was installed by; routing it
        // somewhere else would leave a second, shadowing copy behind, so only a
        // fresh install gets alternatives.
        fallbacks: upgrade ? undefined : fallbacksFor(tool, title, methodId),
      })
      continue
    }

    // No package-manager path on this OS. A published release is still a real,
    // automated install (this is what finally gives cc-switch one on Linux);
    // only fall back to the manual note when there isn't even that.
    const release = releaseStep(tool, title)
    steps.push(
      release ?? {
        kind: "info",
        id: `cli-${id}`,
        label: t.installCli(title),
        lines: [tool.manualNote ?? t.noInstaller(title), t.manualInstall],
        manual: true,
      }
    )
  }

  // Later steps that shell out to a CLI installed earlier in this same run
  // depend on that install step (freshly-installed => not in `installed`).
  const claudeDep =
    plan.clis.includes("claude-code") && !installed.has("claude-code")
      ? ["cli-claude-code"]
      : undefined

  // Whether a `claude` binary will exist to shell out to. On the desktop-only
  // path it won't: the app bundles the agent and installs no CLI, so a
  // `claude mcp add` step would fail with "command not found" for every server.
  // The config is written directly instead — the app reads the same file.
  const claudeCliPresent = plan.clis.includes("claude-code") || installed.has("claude-code")

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
    const spec = resolveCatalogSpec(server, plan.mcpKeys[m.id])
    // Codex and OpenCode spawn the command they stored, so an npm shim (`npx`) has
    // to be wrapped in `cmd /c` on Windows or it can't be spawned at all — the same
    // treatment the MCP section's direct adds apply. Claude's own launcher resolves
    // shims, so its command stays bare.
    const stored = wrapStdioForOs(spec, plan.os)

    if (m.targets.includes("claude") && !claudeMcps.has(m.id)) {
      steps.push(
        claudeCliPresent
          ? {
              kind: "command",
              id: `mcp-claude-${m.id}`,
              label: t.addMcpClaude(title),
              command: buildClaudeMcpCommandFromSpec(server.id, spec),
              // `claude mcp add` needs the claude binary that step installs.
              dependsOn: claudeDep,
            }
          : {
              kind: "mergeFile",
              id: `mcp-claude-${m.id}`,
              label: t.addMcpClaude(title),
              path: paths.claudeConfig,
              merge: (existing) =>
                mergeClaudeMcp(existing, server.id, buildClaudeMcpEntryFromSpec(spec)),
              writtenNote: t.claudeMcpWritten(server.id),
            }
      )
    }
    if (m.targets.includes("codex") && !codexMcps.has(m.id)) {
      const entry = buildCodexMcpEntryFromSpec(stored)
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
      const entry = buildOpencodeMcpEntryFromSpec(stored)
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

  return steps
}

/**
 * Whether a plan carries anything worth running — a CLI, a skill, an MCP server,
 * or network config. Network counts: an npm mirror or a proxy on its own is a
 * complete, runnable plan, so neither the runner's "your plan is empty" toast
 * nor the quick-install dialog's disabled button may treat it as nothing.
 */
/**
 * How many things the user has picked, for the change tray's count.
 *
 * Counts *selections*, not the steps they will become — one skill selected for
 * three agents is one decision the user made, and a tray reading "3" for it
 * would be lying about what they chose. The network config counts as one
 * regardless of how many surfaces it writes to, for the same reason.
 */
export function countSelections(plan: Plan | undefined): number {
  if (!plan) return 0
  const net = plan.network
  const network = (net.npmRegistry ? 1 : 0) + (isProxyActive(net.proxy) ? 1 : 0)
  return plan.clis.length + plan.skills.length + plan.mcps.length + network
}

export function planHasSelections(plan: Plan | undefined): boolean {
  if (!plan) return false
  const net = plan.network
  return (
    plan.clis.length > 0 ||
    plan.skills.length > 0 ||
    plan.mcps.length > 0 ||
    !!net.npmRegistry ||
    isProxyActive(net.proxy)
  )
}

/**
 * Read-only post-install verify steps (`claude --version`, `codex --version`).
 * Both marked verifyOnly so failures surface as info.
 *
 * Deliberately does NOT run `claude mcp list`: that command health-checks every
 * configured server, which takes tens of seconds and can hang — it would park the
 * run panel on a "running" step long after the install finished. The post-run
 * dashboard re-scan reads the same servers straight from `~/.claude.json`, so the
 * user still gets confirmation, immediately.
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

// ── Proxy steps ──────────────────────────────────────────────────────────────

/**
 * Write the proxy into every surface the user selected. Ordered so the config
 * files land before any command that might use them, and returned as ordinary
 * descriptors so preview mode renders "would …" lines and changes nothing.
 *
 * Only `claude` has a documented config field for a proxy; Codex and OpenCode
 * read the process environment, which is why the `shell` target (an rc-file
 * block on macOS/Linux, `setx` on Windows) is what reaches them — and why a
 * closing note spells that out when the user left that target off.
 */
export function proxyApplySteps(
  cfg: ProxyConfig | undefined,
  paths: Paths,
  os: OS,
  messages: Messages = en
): StepDescriptor[] {
  if (!cfg || !isProxyActive(cfg)) return []
  const t = messages.steps
  const eff = effectiveProxy(cfg)
  const shown = eff.https ?? eff.http ?? eff.all ?? ""
  const steps: StepDescriptor[] = []

  if (hasTarget(cfg, "claude")) {
    steps.push({
      kind: "mergeFile",
      id: "proxy-claude",
      label: t.proxyClaude(shown),
      path: paths.claudeSettings,
      merge: (existing) => mergeClaudeProxy(existing, cfg),
      writtenNote: t.claudeSettingsUpdated,
    })
  }
  if (hasTarget(cfg, "npm")) {
    for (const command of npmProxyCommands(cfg)) {
      steps.push({
        kind: "command",
        id: `proxy-npm-${command.args[2]}`,
        label: t.proxyNpmSet(command.args[2], command.args[3]),
        command,
      })
    }
  }
  if (hasTarget(cfg, "git")) {
    for (const command of gitProxyCommands(cfg)) {
      steps.push({
        kind: "command",
        id: `proxy-git-${command.args[2]}`,
        label: t.proxyGitSet(command.args[2], command.args[3]),
        command,
      })
    }
  }
  if (hasTarget(cfg, "shell")) {
    if (os === "win") {
      for (const command of winProxyCommands(cfg)) {
        steps.push({
          kind: "command",
          id: `proxy-win-${command.args[0]}`,
          label: t.proxyWinSet(command.args[0], command.args[1]),
          command,
        })
      }
    } else if (paths.shellProfile) {
      const flavor = shellFlavor(paths.shellProfile)
      steps.push({
        kind: "mergeFile",
        id: "proxy-shell",
        label: t.proxyShell(paths.shellProfile),
        path: paths.shellProfile,
        merge: (existing) => mergeShellProxyBlock(existing, cfg, flavor),
        writtenNote: t.proxyShellWritten(paths.shellProfile),
      })
    }
  }

  // What the user still has to do themselves: restart terminals, or (when the
  // shell target is off) export the variables for Codex / OpenCode by hand.
  steps.push({
    kind: "info",
    id: "proxy-note",
    label: t.proxyNote,
    lines: hasTarget(cfg, "shell")
      ? [t.proxyRestartNote]
      : [
          t.proxyShellNote,
          ...shellExportLines(cfg, os === "win" ? "posix" : shellFlavor(paths.shellProfile)),
        ],
  })
  return steps
}

/**
 * Remove everything `proxyApplySteps` writes, for the targets given. Clearing is
 * unconditional per target (not derived from the current values) so a key left
 * behind by an earlier, different proxy is cleaned up too. The command steps are
 * `verifyOnly`: `git config --unset` and `setx` on an absent key are nothing to
 * report as a failure.
 */
export function proxyClearSteps(
  targets: readonly ProxyTarget[],
  paths: Paths,
  os: OS,
  messages: Messages = en
): StepDescriptor[] {
  const t = messages.steps
  const steps: StepDescriptor[] = []
  if (targets.includes("claude")) {
    steps.push({
      kind: "mergeFile",
      id: "proxy-clear-claude",
      label: t.proxyClearClaude,
      path: paths.claudeSettings,
      merge: deleteClaudeProxy,
      writtenNote: t.claudeSettingsUpdated,
    })
  }
  if (targets.includes("npm")) {
    for (const command of npmProxyClearCommands()) {
      steps.push({
        kind: "command",
        id: `proxy-clear-npm-${command.args[2]}`,
        label: t.proxyClearNpm(command.args[2]),
        command,
        verifyOnly: true,
      })
    }
  }
  if (targets.includes("git")) {
    for (const command of gitProxyClearCommands()) {
      steps.push({
        kind: "command",
        id: `proxy-clear-git-${command.args[3]}`,
        label: t.proxyClearGit(command.args[3]),
        command,
        verifyOnly: true,
      })
    }
  }
  if (targets.includes("shell")) {
    if (os === "win") {
      for (const command of winProxyClearCommands()) {
        steps.push({
          kind: "command",
          id: `proxy-clear-win-${command.args[0]}`,
          label: t.proxyClearWin(command.args[0]),
          command,
          verifyOnly: true,
        })
      }
    } else if (paths.shellProfile) {
      steps.push({
        kind: "mergeFile",
        id: "proxy-clear-shell",
        label: t.proxyClearShell(paths.shellProfile),
        path: paths.shellProfile,
        merge: deleteShellProxyBlock,
        writtenNote: t.proxyShellWritten(paths.shellProfile),
      })
    }
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
  targets: string[],
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
  messages: Messages = en,
  overwrite = false
): StepDescriptor {
  return {
    kind: "skillCreate",
    id: `skill-create-${name}`,
    label: messages.steps.createSkill(name, targets.join(", ")),
    name,
    targets,
    content,
    dests,
    overwrite,
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

/**
 * How Claude's user-scope MCP config can be reached on this machine.
 *
 * - `cli` — shell out to `claude mcp add/remove`, the supported interface.
 * - `file` — write `~/.claude.json` directly. The desktop app reads the same
 *   file but ships no binary, so this is the only route it has.
 * - `none` — neither is installed; there is nothing to configure yet.
 *
 * One function so the UI's "is this checkbox available" and the step builder's
 * "which kind of step" can't drift: they used to answer from `claude-code`
 * alone, which greyed the whole Claude column out on a desktop-only machine
 * that was perfectly capable of running the servers.
 */
export type ClaudeMcpRoute = "cli" | "file" | "none"

export function claudeMcpRoute(cliInstalled: boolean, desktopInstalled: boolean): ClaudeMcpRoute {
  if (cliInstalled) return "cli"
  return desktopInstalled ? "file" : "none"
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
  messages: Messages,
  route: ClaudeMcpRoute = "cli"
): StepDescriptor[] {
  const title = mcpTitle(id, messages)
  const steps: StepDescriptor[] = []
  if (targets.includes("claude") && route !== "none") {
    steps.push(
      route === "cli"
        ? {
            kind: "command",
            id: `mcp-add-claude-${id}`,
            label: messages.steps.addMcpClaude(title),
            command: buildClaudeMcpCommandFromSpec(id, spec),
          }
        : {
            kind: "mergeFile",
            id: `mcp-add-claude-${id}`,
            label: messages.steps.addMcpClaude(title),
            path: paths.claudeConfig,
            merge: (existing) => mergeClaudeMcp(existing, id, buildClaudeMcpEntryFromSpec(spec)),
            writtenNote: messages.steps.claudeMcpWritten(id),
          }
    )
  }
  // Codex has no standalone SSE transport — it only speaks streamable-HTTP — so
  // an sse spec is skipped for Codex (the UI gates the checkbox too).
  if (targets.includes("codex") && spec.transport !== "sse") {
    const entry = buildCodexMcpEntryFromSpec(wrapStdioForOs(spec, paths.os))
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
    const entry = buildOpencodeMcpEntryFromSpec(wrapStdioForOs(spec, paths.os))
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
  messages: Messages = en,
  route: ClaudeMcpRoute = "cli"
): StepDescriptor[] {
  return mcpAddSpecSteps(
    server.id,
    resolveCatalogSpec(server, key),
    targets,
    paths,
    messages,
    route
  )
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
  messages: Messages = en,
  route: ClaudeMcpRoute = "cli"
): StepDescriptor[] {
  return mcpAddSpecSteps(id, spec, targets, paths, messages, route)
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
  messages: Messages = en,
  route: ClaudeMcpRoute = "cli"
): StepDescriptor[] {
  const title = mcpTitle(id, messages)
  const steps: StepDescriptor[] = []
  if (targets.includes("claude") && route !== "none") {
    steps.push(
      route === "cli"
        ? {
            kind: "command",
            id: `mcp-remove-claude-${id}`,
            label: messages.steps.removeMcpClaude(title),
            command: buildClaudeMcpRemoveCommand(id),
          }
        : {
            kind: "mergeFile",
            id: `mcp-remove-claude-${id}`,
            label: messages.steps.removeMcpClaude(title),
            path: paths.claudeConfig,
            merge: (existing) => removeClaudeMcp(existing, id),
            writtenNote: messages.steps.claudeMcpWritten(id),
          }
    )
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
 * Disable an MCP server on the chosen targets without deleting it. Codex /
 * OpenCode flip their native `enabled = false` flag in place. Claude has no
 * per-server toggle, so it stashes the current `spec` in agentpack's disabled
 * store (mergeFile) and then removes the entry from ~/.claude.json — `mcpEnableStep`
 * restores it. `spec` is the server's current on-disk spec (needed for the stash).
 */
export function mcpDisableStep(
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
      kind: "mergeFile",
      id: `mcp-disable-stash-${id}`,
      label: messages.steps.disableMcp(title),
      path: paths.mcpDisabledStore,
      merge: (existing) =>
        serializeDisabledStore(
          addDisabled(parseDisabledStore(existing), id, { spec, targets: ["claude"] })
        ),
      writtenNote: messages.steps.mcpStashed(id),
    })
    steps.push({
      kind: "command",
      id: `mcp-disable-remove-claude-${id}`,
      label: messages.steps.removeMcpClaude(title),
      command: buildClaudeMcpRemoveCommand(id),
    })
  }
  if (targets.includes("codex")) {
    steps.push({
      kind: "mergeFile",
      id: `mcp-disable-codex-${id}`,
      label: messages.steps.disableMcp(title),
      path: paths.codexConfig,
      merge: (existing) => setCodexMcpEnabled(existing, id, false),
      writtenNote: messages.steps.codexMcpWritten(id),
    })
  }
  if (targets.includes("opencode")) {
    steps.push({
      kind: "mergeFile",
      id: `mcp-disable-opencode-${id}`,
      label: messages.steps.disableMcp(title),
      path: paths.opencodeConfig,
      merge: (existing) => setOpencodeMcpEnabled(existing, id, false),
      writtenNote: messages.steps.opencodeMcpWritten(id),
    })
  }
  return steps
}

/**
 * Re-enable a disabled MCP server. Codex / OpenCode flip `enabled = true`. Claude
 * re-adds the server from `spec` (read from the disabled store by the caller) and
 * then clears its stash entry (mergeFile).
 */
export function mcpEnableStep(
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
      id: `mcp-enable-add-claude-${id}`,
      label: messages.steps.enableMcp(title),
      command: buildClaudeMcpCommandFromSpec(id, spec),
    })
    steps.push({
      kind: "mergeFile",
      id: `mcp-enable-unstash-${id}`,
      label: messages.steps.enableMcp(title),
      path: paths.mcpDisabledStore,
      merge: (existing) => serializeDisabledStore(removeDisabled(parseDisabledStore(existing), id)),
      writtenNote: messages.steps.mcpUnstashed(id),
    })
  }
  if (targets.includes("codex")) {
    steps.push({
      kind: "mergeFile",
      id: `mcp-enable-codex-${id}`,
      label: messages.steps.enableMcp(title),
      path: paths.codexConfig,
      merge: (existing) => setCodexMcpEnabled(existing, id, true),
      writtenNote: messages.steps.codexMcpWritten(id),
    })
  }
  if (targets.includes("opencode")) {
    steps.push({
      kind: "mergeFile",
      id: `mcp-enable-opencode-${id}`,
      label: messages.steps.enableMcp(title),
      path: paths.opencodeConfig,
      merge: (existing) => setOpencodeMcpEnabled(existing, id, true),
      writtenNote: messages.steps.opencodeMcpWritten(id),
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

/** Step id of a provider write, so callers can depend on exactly that one. */
export function providerStepId(
  op: string,
  app: ProviderApp,
  backend: ProviderBackend = "ccswitch"
): string {
  return backend === "ccswitch" ? `cc-provider-${op}-${app}` : `provider-native-${op}-${app}`
}

/**
 * Identity fields a provider row carries besides its `settings_config`. Rides
 * in the payload under `form`, which is the field name `cc_write_provider`
 * expects on the wire.
 */
interface ProviderMeta {
  name: string
  websiteUrl?: string
  notes?: string
}

/**
 * Shared core: everything about a provider write except *where* the
 * `settings_config` came from — built from form fields, or carried verbatim
 * from an imported bundle.
 */
function ccProviderStep(
  op: "add" | "update" | "delete" | "setCurrent",
  app: ProviderApp,
  name: string,
  id: string | undefined,
  settingsConfig: string | undefined,
  meta: ProviderMeta | undefined,
  messages: Messages,
  backend: ProviderBackend
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
    // Scoped by app so a run that switches several apps at once (applying an
    // account profile) has one id per step: the runner tracks failed
    // dependencies by id, and a shared one would let a single app's failed
    // write skip the live-config sync of every other app in the same run.
    id: providerStepId(op, app, backend),
    label,
    op,
    payload: { backend, app, id, settingsConfig, form: meta },
  }
}

export function providerStep(
  op: "add" | "update" | "delete" | "setCurrent",
  app: ProviderApp,
  name: string,
  form: ProviderForm | undefined,
  id: string | undefined,
  messages: Messages = en,
  backend: ProviderBackend = "ccswitch"
): StepDescriptor {
  return ccProviderStep(
    op,
    app,
    name,
    id,
    form ? buildSettingsConfig(form) : undefined,
    form ? { name: form.name, websiteUrl: form.websiteUrl, notes: form.notes } : undefined,
    messages,
    backend
  )
}

/** A provider entry from an exported bundle, as `providerImportStep` needs it. */
export interface ImportedProvider {
  app: ProviderApp
  name: string
  /** The stored `settings_config`, carried through untouched. */
  settingsConfig: string
  websiteUrl?: string
  notes?: string
}

/**
 * Write step for a provider whose `settings_config` is already decided.
 *
 * Separate from {@link providerStep} because an imported config may hold
 * hand-written keys (custom headers, query params) that no form field models —
 * rebuilding it from fields would silently drop exactly the parts someone went
 * out of their way to configure. This takes the stored config verbatim instead
 * of fabricating empty `baseUrl` / `token` fields to smuggle it through a form.
 */
export function providerImportStep(
  entry: ImportedProvider,
  existingId: string | undefined,
  messages: Messages = en,
  backend: ProviderBackend = "ccswitch"
): StepDescriptor {
  return ccProviderStep(
    existingId ? "update" : "add",
    entry.app,
    entry.name,
    existingId,
    entry.settingsConfig,
    { name: entry.name, websiteUrl: entry.websiteUrl, notes: entry.notes },
    messages,
    backend
  )
}

/** Snapshot the cc-switch DB + live configs into the listable backup history. */
export function snapshotStep(
  reason: string,
  messages: Messages = en,
  backend?: ProviderBackend
): StepDescriptor {
  return {
    kind: "snapshot",
    id: "backup-snapshot",
    label: messages.steps.snapshot,
    reason,
    backend,
  }
}

/**
 * Write one config file carried by an imported backup bundle.
 *
 * Riding `mergeFile` rather than writing the file directly is what buys the
 * `.agentpack.bak` snapshot of the original, the dry-run preview line, and the
 * dashboard's existing restore path — all of which an import needs more than
 * most steps, since it overwrites a file the user didn't author.
 *
 * The merge closure is where the bundle's blanked credentials are refilled from
 * whatever is already on this machine, so importing a shared config can't
 * deauthenticate the importer.
 */
export function bundleFileStep(
  key: BundleFileKey,
  path: string,
  incoming: string,
  messages: Messages = en
): StepDescriptor {
  return {
    kind: "mergeFile",
    id: `bundle-file-${key}`,
    label: messages.steps.bundleFile(path),
    path,
    merge: (existing) => restoreBlankedSecrets(key, incoming, existing),
    writtenNote: messages.steps.bundleFileWritten(path),
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
  if (provider.app_type === "opencode") {
    return [
      {
        kind: "mergeFile",
        id: "cc-sync-opencode",
        label: s.syncOpencode,
        path: paths.opencodeConfig,
        merge: (existing) => opencodeConfigFromProvider(existing, cfg),
        writtenNote: s.opencodeProviderUpdated,
        dependsOn,
      },
    ]
  }
  // Only config.toml: `~/.codex/auth.json` holds the official ChatGPT login and
  // is never written — the relay token rides in config.toml instead. See the
  // module comment in `ccswitch/sync.ts`.
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
  ]
}

/**
 * Clear a set of cleanup targets in one step.
 *
 * One step for the whole selection rather than one per target: to the user this
 * is a single decision ("clear these seven things"), the backend does it in one
 * pass, and it produces exactly one restore point — a per-target step list would
 * scatter a single quarantine batch across seven reports that each claim it.
 *
 * `entries` is measured by the section's scan, which only ever `stat`s. That is
 * what lets the preview name every path and its real size while keeping the
 * dry-run promise that nothing is touched.
 */
export function cleanupStep(
  specs: CleanupSpecDescriptor[],
  entries: { path: string; bytes: number; files: number }[],
  mode: "quarantine" | "delete",
  messages: Messages = en
): StepDescriptor {
  const bytes = entries.reduce((sum, e) => sum + e.bytes, 0)
  return {
    kind: "cleanup",
    id: `cleanup-${mode}`,
    label:
      mode === "quarantine"
        ? messages.steps.cleanupQuarantine(formatBytes(bytes))
        : messages.steps.cleanupDelete(formatBytes(bytes)),
    mode,
    specs,
    entries,
  }
}

/**
 * Clear a config-key cleanup target (hooks, the per-project prompt history in
 * `~/.claude.json`).
 *
 * Rides `mergeFile` deliberately: these edit a file that also holds settings the
 * user cares about, and `mergeFile` is the path that snapshots the original to
 * `.agentpack.bak` first. A cleanup step would have moved the whole file to
 * quarantine — correct for a cache directory, wrong for `settings.json`.
 */
export function cleanupConfigStep(
  target: CleanupConfigTarget,
  path: string,
  messages: Messages = en
): StepDescriptor {
  const title = messages.cleanup.targets[target.id]?.title ?? target.id
  return {
    kind: "mergeFile",
    id: `cleanup-config-${target.id}`,
    label: messages.steps.cleanupConfig(title),
    path,
    merge: target.edit,
    writtenNote: messages.steps.cleanupConfigWritten(title, path),
  }
}
