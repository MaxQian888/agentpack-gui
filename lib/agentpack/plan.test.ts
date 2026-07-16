import {
  buildSteps,
  buildVerifySteps,
  cliInstallStep,
  cliUninstallStep,
  fileRestoreStep,
  mcpAddStep,
  mcpAddSpecStep,
  mcpEditStep,
  mcpRemoveStep,
  relayRemoveStep,
  runtimeUpgradeStep,
  skillInstallStep,
  skillRemoveStep,
  skillCopyStep,
  skillRepoInstallStep,
  skillUpdateStep,
  skillBackupStep,
  skillCreateStep,
  skillEditStep,
  skillVisibilityStep,
  skillPermissionStep,
  snapshotStep,
  visibleAppsStep,
  providerStep,
  syncLiveConfigSteps,
} from "./plan"
import { findMcp } from "./registry"
import { mergeCodexMcp } from "./merge/mcp"
import { mergeClaudeSettings, mergeCodexProvider } from "./merge/network"
import { DEFAULT_VISIBLE_APPS } from "./ccswitch/settings"
import type { Paths, Plan, StepDescriptor } from "./types"
import type { Provider, ProviderForm } from "./ccswitch/types"

const paths: Paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeConfig: "/h/.claude.json",
  claudeSkillsDir: "/h/.claude/skills",
  codexConfig: "/h/.codex/config.toml",
  codexAuth: "/h/.codex/auth.json",
  codexSkillsDir: "/h/.codex/skills",
  opencodeConfig: "/h/.config/opencode/opencode.json",
  opencodeSkillsDir: "/h/.config/opencode/skills",
  agentsSkillsDir: "/h/.agents/skills",
  ccSwitchSettings: "/h/.cc-switch/settings.json",
  ccSwitchDb: "/h/.cc-switch/cc-switch.db",
  ccConnectDir: "/h/.cc-connect",
  ccConnectConfig: "/h/.cc-connect/config.toml",
  os: "mac",
}

const plan: Plan = {
  os: "mac",
  clis: ["claude-code"],
  skills: [{ id: "rust", targets: ["claude"] }],
  mcps: [{ id: "context7", targets: ["claude", "codex"] }],
  mcpKeys: { context7: "k" },
  network: { npmRegistry: "https://m", apiBaseUrl: "https://r" },
}

it("orders steps registry→install→skills→mcp→relay", () => {
  const ids = buildSteps(plan, paths).map((s) => s.id)
  expect(ids[0]).toBe("npm-registry")
  expect(ids).toEqual(
    expect.arrayContaining([
      "cli-claude-code",
      "skill-rust",
      "mcp-claude-context7",
      "mcp-codex-context7",
      "relay-claude",
    ])
  )
})

it("prepends a Node.js install before npm CLIs when node is not detected", () => {
  const steps = buildSteps(plan, paths)
  const ids = steps.map((s) => s.id)
  expect(ids.indexOf("runtime-node")).toBeLessThan(ids.indexOf("cli-claude-code"))
  const cli = steps.find((s) => s.id === "cli-claude-code")!
  expect(cli.dependsOn).toEqual(["runtime-node"])
})

it("skips the Node prerequisite when node is already installed", () => {
  const ids = buildSteps(plan, paths, undefined, new Set(["node"])).map((s) => s.id)
  expect(ids).not.toContain("runtime-node")
})

it("uses an info note for the Node prerequisite when the OS has no installer", () => {
  const linuxPlan = { ...plan, os: "linux" as const }
  const steps = buildSteps(linuxPlan, { ...paths, os: "linux" })
  const node = steps.find((s) => s.id === "runtime-node")!
  expect(node.kind).toBe("info")
  // No dependency on a manual note — the CLI install still gets attempted.
  expect(steps.find((s) => s.id === "cli-claude-code")!.dependsOn).toBeUndefined()
})

it("a chosen non-npm method uses that command and skips the Node prerequisite", () => {
  const winPlan: Plan = {
    ...plan,
    os: "win",
    skills: [],
    mcps: [],
    network: {},
    cliMethods: { "claude-code": "native" },
  }
  const steps = buildSteps(winPlan, { ...paths, os: "win" })
  const ids = steps.map((s) => s.id)
  // Native install brings its own runtime — no Node step, no Node dependency.
  expect(ids).not.toContain("runtime-node")
  const cli = steps.find((s) => s.id === "cli-claude-code")!
  expect(cli.dependsOn).toBeUndefined()
  expect(cli.kind === "command" && cli.command.file).toBe("powershell")
})

it("the npm method still installs + depends on Node", () => {
  const winPlan: Plan = {
    ...plan,
    os: "win",
    skills: [],
    mcps: [],
    network: {},
    cliMethods: { "claude-code": "npm" },
  }
  const steps = buildSteps(winPlan, { ...paths, os: "win" })
  expect(steps.map((s) => s.id)).toContain("runtime-node")
  expect(steps.find((s) => s.id === "cli-claude-code")!.dependsOn).toEqual(["runtime-node"])
})

it("carries requiresElevation from the Node winget default on Windows", () => {
  const winPlan: Plan = { ...plan, os: "win", skills: [], mcps: [], network: {} }
  const node = buildSteps(winPlan, { ...paths, os: "win" }).find((s) => s.id === "runtime-node")!
  expect(node.kind === "command" && node.requiresElevation).toBe(true)
})

it("claude mcp steps depend on the claude install from the same run", () => {
  const step = buildSteps(plan, paths).find((s) => s.id === "mcp-claude-context7")!
  expect(step.dependsOn).toEqual(["cli-claude-code"])
})

it("claude mcp steps carry no dependency when claude is already installed", () => {
  const step = buildSteps(plan, paths, undefined, new Set(["claude-code", "node"])).find(
    (s) => s.id === "mcp-claude-context7"
  )!
  expect(step.dependsOn).toBeUndefined()
})

it("codex mcp step targets the resolved config path", () => {
  const step = buildSteps(plan, paths).find((s) => s.id === "mcp-codex-context7")!
  expect(step.kind === "mergeFile" && step.path).toBe("/h/.codex/config.toml")
})

it("verify steps are all verifyOnly", () => {
  expect(buildVerifySteps(plan).every((s) => s.verifyOnly)).toBe(true)
})

it("installed CLIs upgrade only when a newer version is published", () => {
  // Behind → an @latest upgrade step.
  const behind = buildSteps(plan, paths, undefined, new Set(["claude-code"]), {
    versions: { "claude-code": "1.0.0" },
    latest: { "claude-code": "2.0.0" },
  }).find((s) => s.id === "cli-claude-code")!
  expect(behind.kind).toBe("command")
  expect(behind.kind === "command" && behind.command.args.join(" ")).toContain("@latest")
})

it("upgrades a native-installed CLI by re-running its native installer, not npm", () => {
  const step = buildSteps(plan, paths, undefined, new Set(["claude-code"]), {
    versions: { "claude-code": "1.0.0" },
    latest: { "claude-code": "2.0.0" },
    managers: { "claude-code": "native" },
  }).find((s) => s.id === "cli-claude-code")!
  expect(step.kind).toBe("command")
  // Not an npm install (which would drop a second, shadowing copy)…
  expect(step.kind === "command" && step.command.file).not.toBe("npm")
  expect(step.kind === "command" && step.command.args.join(" ")).toContain("claude.ai/install")
  // …and a native re-install brings its own runtime, so no Node dependency.
  expect(step.dependsOn).toBeUndefined()
})

it("skips an already-installed CLI that is up to date (no re-install)", () => {
  const upToDate = buildSteps(plan, paths, undefined, new Set(["claude-code"]), {
    versions: { "claude-code": "2.0.0" },
    latest: { "claude-code": "2.0.0" },
  }).map((s) => s.id)
  expect(upToDate).not.toContain("cli-claude-code")
  // With no CLI to install, the npm Node prerequisite is unnecessary too.
  expect(upToDate).not.toContain("runtime-node")
})

it("skips an installed CLI when the latest version is still unknown", () => {
  // A version lookup that hasn't resolved must not trigger a re-install.
  const ids = buildSteps(plan, paths, undefined, new Set(["claude-code"]), {
    versions: { "claude-code": "1.0.0" },
  }).map((s) => s.id)
  expect(ids).not.toContain("cli-claude-code")
})

it("skips MCP add steps for agents that already have the server", () => {
  const ids = buildSteps(plan, paths, undefined, new Set(), {
    claudeMcps: ["context7"],
  }).map((s) => s.id)
  // Already on Claude → dropped; still missing on Codex → kept.
  expect(ids).not.toContain("mcp-claude-context7")
  expect(ids).toContain("mcp-codex-context7")
})

it("drops a fully-installed MCP server from both agents", () => {
  const ids = buildSteps(plan, paths, undefined, new Set(), {
    claudeMcps: ["context7"],
    codexMcps: ["context7"],
  }).map((s) => s.id)
  expect(ids).not.toContain("mcp-claude-context7")
  expect(ids).not.toContain("mcp-codex-context7")
})

it("emits an opencode batch step for an opencode-targeted MCP, skipping when present", () => {
  const ocPlan: Plan = { ...plan, mcps: [{ id: "context7", targets: ["opencode"] }] }
  const added = buildSteps(ocPlan, paths).find((s) => s.id === "mcp-opencode-context7")
  expect(added?.kind === "mergeFile" && added.path).toBe(paths.opencodeConfig)
  const skipped = buildSteps(ocPlan, paths, undefined, new Set(), {
    opencodeMcps: ["context7"],
  }).map((s) => s.id)
  expect(skipped).not.toContain("mcp-opencode-context7")
})

it("copies a skill only into targets where it isn't installed yet", () => {
  const both: Plan = { ...plan, skills: [{ id: "rust", targets: ["claude", "codex"] }] }
  const step = buildSteps(both, paths, undefined, new Set(), { claudeSkills: ["rust"] }).find(
    (s) => s.id === "skill-rust"
  )!
  expect(step.kind === "skillInstall" && step.targets).toEqual(["codex"])
})

it("drops a skill step entirely when installed on every target", () => {
  const both: Plan = { ...plan, skills: [{ id: "rust", targets: ["claude", "codex"] }] }
  const ids = buildSteps(both, paths, undefined, new Set(), {
    claudeSkills: ["rust"],
    codexSkills: ["rust"],
  }).map((s) => s.id)
  expect(ids).not.toContain("skill-rust")
})

it("emits an info step (manual note) when an OS has no installer", () => {
  const linuxPlan = {
    ...plan,
    os: "linux" as const,
    clis: ["cc-switch" as const],
    skills: [],
    mcps: [],
  }
  const step = buildSteps(linuxPlan, { ...paths, os: "linux" }).find(
    (s) => s.id === "cli-cc-switch"
  )!
  expect(step.kind).toBe("info")
  expect(step.kind === "info" && step.lines.join(" ")).toMatch(/github\.com\/farion1231/)
})

it("skips unknown clis / skills / mcps and empty-target entries", () => {
  const messy: Plan = {
    ...plan,
    clis: ["nope" as Plan["clis"][number]],
    skills: [
      { id: "rust", targets: [] },
      { id: "ghost", targets: ["claude"] },
    ],
    mcps: [
      { id: "context7", targets: [] },
      { id: "ghost", targets: ["claude"] },
    ],
    network: {},
  }
  const ids = buildSteps(messy, paths).map((s) => s.id)
  expect(ids).toEqual([])
})

it("emits only the claude mcp step when codex is not targeted", () => {
  const p: Plan = { ...plan, network: {}, mcps: [{ id: "context7", targets: ["claude"] }] }
  const ids = buildSteps(p, paths).map((s) => s.id)
  expect(ids).toContain("mcp-claude-context7")
  expect(ids).not.toContain("mcp-codex-context7")
})

it("emits a codex relay step when codex + apiBaseUrl are present", () => {
  const p: Plan = {
    ...plan,
    clis: ["claude-code", "codex"],
    skills: [],
    mcps: [],
    network: { apiBaseUrl: "https://relay", apiToken: "tok" },
  }
  const ids = buildSteps(p, paths).map((s) => s.id)
  expect(ids).toContain("relay-claude")
  expect(ids).toContain("relay-codex")
})

it("buildVerifySteps adds an mcp-list check only when an MCP targets claude", () => {
  const withMcp = buildVerifySteps(plan).map((s) => s.id)
  expect(withMcp).toContain("verify-claude-mcp")
  const noMcp = buildVerifySteps({ ...plan, mcps: [] }).map((s) => s.id)
  expect(noMcp).not.toContain("verify-claude-mcp")
})

it("buildVerifySteps includes a codex version check when codex is chosen", () => {
  const ids = buildVerifySteps({ ...plan, clis: ["codex"] }).map((s) => s.id)
  expect(ids).toEqual(["verify-codex-version"])
})

describe("menu-action builders", () => {
  it("cliInstallStep toggles label/id on the upgrade flag", () => {
    const cmd = { file: "npm", args: ["i"] }
    const install = cliInstallStep("claude-code", cmd, false)
    const upgrade = cliInstallStep("claude-code", cmd, true)
    expect(install.id).toBe("cli-install-claude-code")
    expect(upgrade.id).toBe("cli-upgrade-claude-code")
    expect(install.label).not.toEqual(upgrade.label)
  })

  it("runtimeUpgradeStep builds an update command descriptor", () => {
    const step = runtimeUpgradeStep("node", { file: "brew", args: ["upgrade", "node"] })
    expect(step).toMatchObject({
      kind: "command",
      id: "runtime-update-node",
      command: { file: "brew", args: ["upgrade", "node"] },
    })
    // Localized "Update <title>" label — distinct from the install-step id above.
    expect(step.label).toMatch(/node/i)
  })

  it("skillInstallStep / skillRemoveStep carry targets and dests", () => {
    const install = skillInstallStep("rust", "Rust", ["claude"])
    expect(install).toMatchObject({ kind: "skillInstall", skillId: "rust", targets: ["claude"] })
    const remove = skillRemoveStep("rust", "Rust", ["claude"], ["/d/rust"])
    expect(remove).toMatchObject({ kind: "skillRemove", dests: ["/d/rust"] })
  })

  it("visibleAppsStep builds a ccVisibleApps merge descriptor", () => {
    const step = visibleAppsStep("/cfg.json", DEFAULT_VISIBLE_APPS)
    expect(step.kind).toBe("ccVisibleApps")
    expect(step.kind === "ccVisibleApps" && step.path).toBe("/cfg.json")
  })

  it("mcpAddStep emits a claude command and a codex mergeFile per target", () => {
    const steps = mcpAddStep(findMcp("context7")!, ["claude", "codex"], "k", paths)
    const claude = steps.find((s) => s.id === "mcp-add-claude-context7")!
    expect(claude.kind === "command" && claude.command.args.slice(0, 3)).toEqual([
      "mcp",
      "add",
      "context7",
    ])
    // The key flows into the --env flag for a keyed stdio server.
    expect(claude.kind === "command" && claude.command.args.join(" ")).toContain(
      "CONTEXT7_API_KEY=k"
    )
    const codex = steps.find((s) => s.id === "mcp-add-codex-context7")!
    expect(codex.kind === "mergeFile" && codex.path).toBe("/h/.codex/config.toml")
  })

  it("mcpAddStep only emits the targeted agent", () => {
    expect(mcpAddStep(findMcp("memory")!, ["codex"], undefined, paths).map((s) => s.id)).toEqual([
      "mcp-add-codex-memory",
    ])
  })

  it("mcpAddStep codex merge writes the server table into config.toml", () => {
    const step = mcpAddStep(findMcp("context7")!, ["codex"], "k", paths).find(
      (s) => s.id === "mcp-add-codex-context7"
    )
    expect(step?.kind === "mergeFile" && step.merge("")).toContain("context7")
  })

  it("mcpRemoveStep emits a claude command and a codex mergeFile per target", () => {
    const steps = mcpRemoveStep("context7", ["claude", "codex"], paths)
    const claude = steps.find((s) => s.id === "mcp-remove-claude-context7")!
    expect(claude.kind === "command" && claude.command.args).toEqual([
      "mcp",
      "remove",
      "context7",
      "--scope",
      "user",
    ])
    const codex = steps.find((s) => s.id === "mcp-remove-codex-context7")!
    expect(codex.kind === "mergeFile" && codex.path).toBe("/h/.codex/config.toml")
  })

  it("mcpRemoveStep only emits the targeted agent", () => {
    expect(mcpRemoveStep("memory", ["claude"], paths).map((s) => s.id)).toEqual([
      "mcp-remove-claude-memory",
    ])
  })

  it("mcpAddStep opencode merge writes mcp.<id> into opencode.json", () => {
    const step = mcpAddStep(findMcp("context7")!, ["opencode"], "k", paths).find(
      (s) => s.id === "mcp-add-opencode-context7"
    )
    expect(step?.kind === "mergeFile" && step.path).toBe(paths.opencodeConfig)
    expect(step?.kind === "mergeFile" && step.merge("")).toContain("context7")
  })

  it("mcpAddStep spans all three targets", () => {
    const ids = mcpAddStep(findMcp("context7")!, ["claude", "codex", "opencode"], "k", paths).map(
      (s) => s.id
    )
    expect(ids).toEqual([
      "mcp-add-claude-context7",
      "mcp-add-codex-context7",
      "mcp-add-opencode-context7",
    ])
  })

  it("mcpAddSpecStep adds a custom (non-npx) server across targets", () => {
    const steps = mcpAddSpecStep(
      "mine",
      { transport: "stdio", command: "uvx", args: ["mymcp"], env: { T: "1" } },
      ["claude", "opencode"],
      paths
    )
    const claude = steps.find((s) => s.id === "mcp-add-claude-mine")!
    expect(claude.kind === "command" && claude.command.args.join(" ")).toContain("-- uvx mymcp")
    const oc = steps.find((s) => s.id === "mcp-add-opencode-mine")!
    expect(oc.kind === "mergeFile" && oc.merge("")).toContain("uvx")
  })

  it("mcpEditStep removes-then-adds for Claude, overwrites Codex/OpenCode", () => {
    const steps = mcpEditStep(
      "mine",
      { transport: "stdio", command: "npx", args: ["-y", "pkg"], env: {} },
      ["claude", "codex"],
      paths
    )
    const ids = steps.map((s) => s.id)
    // Claude: remove (verifyOnly) precedes add; Codex: single overwrite merge.
    expect(ids).toEqual([
      "mcp-edit-remove-claude-mine",
      "mcp-edit-add-claude-mine",
      "mcp-add-codex-mine",
    ])
    const remove = steps[0]
    expect(remove.kind === "command" && remove.verifyOnly).toBe(true)
    expect(ids.indexOf("mcp-edit-remove-claude-mine")).toBeLessThan(
      ids.indexOf("mcp-edit-add-claude-mine")
    )
  })

  it("mcpRemoveStep emits an opencode delete-merge for the opencode target", () => {
    const step = mcpRemoveStep("context7", ["opencode"], paths).find(
      (s) => s.id === "mcp-remove-opencode-context7"
    )
    expect(step?.kind === "mergeFile" && step.path).toBe(paths.opencodeConfig)
  })

  it("relayRemoveStep removes claude + codex relay config for chosen clis", () => {
    const ids = relayRemoveStep(["claude-code", "codex"], paths).map((s) => s.id)
    expect(ids).toEqual(["relay-remove-claude", "relay-remove-codex"])
  })

  it("cliUninstallStep uses the command when present, an info note otherwise", () => {
    const withCmd = cliUninstallStep("claude-code", { file: "npm", args: ["uninstall"] })
    expect(withCmd.kind).toBe("command")
    const noCmd = cliUninstallStep("cc-switch", undefined)
    expect(noCmd.kind).toBe("info")
  })

  it("fileRestoreStep points at the .agentpack.bak snapshot", () => {
    const step = fileRestoreStep("/h/.codex/config.toml")
    expect(step.kind).toBe("fileRestore")
    expect(step.kind === "fileRestore" && step.backupPath).toBe(
      "/h/.codex/config.toml.agentpack.bak"
    )
  })

  it("providerStep labels each op and only builds settingsConfig when a form is given", () => {
    const form: ProviderForm = {
      name: "Mine",
      app: "claude",
      baseUrl: "https://b",
      token: "t",
      claudeAuthKind: "auth_token",
    }
    const add = providerStep("add", "claude", "Mine", form, undefined)
    expect(add.kind === "ccProvider" && add.op).toBe("add")
    expect((add as { payload: { settingsConfig?: string } }).payload.settingsConfig).toBeDefined()

    for (const op of ["update", "delete", "setCurrent"] as const) {
      const s = providerStep(op, "claude", "Mine", undefined, "id-1")
      expect(s.kind === "ccProvider" && s.op).toBe(op)
      expect((s as { payload: { settingsConfig?: string } }).payload.settingsConfig).toBeUndefined()
    }
  })

  it("syncLiveConfigSteps threads dependsOn onto every sync step", () => {
    const provider: Provider = {
      id: "1",
      app_type: "codex",
      name: "prov",
      settings_config: "{}",
      is_current: true,
    }
    const steps = syncLiveConfigSteps(provider, paths, undefined, ["cc-provider-setCurrent"])
    expect(steps.map((s) => s.id)).toEqual(["cc-sync-codex-config", "cc-sync-codex-auth"])
    for (const s of steps) expect(s.dependsOn).toEqual(["cc-provider-setCurrent"])
  })

  it("snapshotStep threads its reason into a snapshot descriptor", () => {
    const step = snapshotStep("pre-switch backup")
    expect(step.kind).toBe("snapshot")
    expect(step.kind === "snapshot" && step.reason).toBe("pre-switch backup")
  })
})

/**
 * The `mergeFile` descriptors carry inline `merge` closures that delegate to the
 * pure text transforms (tested exhaustively in merge/merge.test.ts). These tests
 * exercise the wiring: each descriptor invokes the right transform with the right
 * args, so a mis-wired closure is caught here.
 */
describe("mergeFile closures delegate to the expected transform", () => {
  const mergeOf = (step: StepDescriptor | undefined): ((existing: string) => string) => {
    if (!step || step.kind !== "mergeFile") throw new Error(`expected mergeFile, got ${step?.kind}`)
    return step.merge
  }

  const codexPlan: Plan = {
    ...plan,
    clis: ["claude-code", "codex"],
    skills: [],
    mcps: [{ id: "context7", targets: ["codex"] }],
    mcpKeys: { context7: "k" },
    network: { apiBaseUrl: "https://relay", apiToken: "tok" },
  }

  it("codex mcp step writes the server entry into config.toml", () => {
    const step = buildSteps(codexPlan, paths).find((s) => s.id === "mcp-codex-context7")
    expect(mergeOf(step)("")).toContain("context7")
  })

  it("claude relay step sets the ANTHROPIC base URL", () => {
    const step = buildSteps(codexPlan, paths).find((s) => s.id === "relay-claude")
    expect(JSON.parse(mergeOf(step)("")).env.ANTHROPIC_BASE_URL).toBe("https://relay")
  })

  it("codex relay step writes the agentpack provider", () => {
    const step = buildSteps(codexPlan, paths).find((s) => s.id === "relay-codex")
    expect(mergeOf(step)("")).toContain("agentpack")
  })

  it("codex mcp-remove step deletes the named server table", () => {
    const existing = mergeCodexMcp("", "context7", { command: "npx", args: [] })
    const step = mcpRemoveStep("context7", ["codex"], paths).find(
      (s) => s.id === "mcp-remove-codex-context7"
    )
    expect(mergeOf(step)(existing)).not.toContain("context7")
  })

  it("claude relay-remove step clears the relay env vars", () => {
    const existing = mergeClaudeSettings("", { apiBaseUrl: "https://r", apiToken: "t" })
    const step = relayRemoveStep(["claude-code"], paths).find((s) => s.id === "relay-remove-claude")
    expect(JSON.parse(mergeOf(step)(existing)).env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  it("codex relay-remove step drops the agentpack provider", () => {
    const existing = mergeCodexProvider("", { apiBaseUrl: "https://r" })
    const step = relayRemoveStep(["codex"], paths).find((s) => s.id === "relay-remove-codex")
    expect(mergeOf(step)(existing)).not.toContain("agentpack")
  })

  it("codex sync steps write config.toml and auth.json from the provider", () => {
    const provider: Provider = {
      id: "1",
      app_type: "codex",
      name: "prov",
      settings_config: JSON.stringify({
        config: 'model_provider = "openai"\n[model_providers.openai]\nname = "OpenAI"\n',
        auth: { OPENAI_API_KEY: "sk-1" },
      }),
      is_current: true,
    }
    const steps = syncLiveConfigSteps(provider, paths)
    const cfg = steps.find((s) => s.id === "cc-sync-codex-config")
    expect(mergeOf(cfg)("")).toContain("model_provider")
    const auth = steps.find((s) => s.id === "cc-sync-codex-auth")
    expect(JSON.parse(mergeOf(auth)("")).OPENAI_API_KEY).toBe("sk-1")
  })
})

describe("skills browser step builders", () => {
  it("skillCopyStep carries src, dirName, targets and precomputed dests", () => {
    const step = skillCopyStep(
      "caveman",
      "caveman",
      "/h/.claude/skills/caveman",
      ["codex"],
      ["/h/.codex/skills/caveman"]
    )
    expect(step).toMatchObject({
      kind: "skillCopy",
      srcPath: "/h/.claude/skills/caveman",
      dirName: "caveman",
      targets: ["codex"],
      dests: ["/h/.codex/skills/caveman"],
    })
    expect(step.label).toContain("caveman")
  })

  it("skillRepoInstallStep lists the picked skills and pluralizes the label", () => {
    const step = skillRepoInstallStep(
      "scan-1",
      [
        { relPath: "skills/a", dirName: "a" },
        { relPath: "skills/b", dirName: "b" },
      ],
      ["claude", "codex"],
      ["/h/.claude/skills/a", "/h/.codex/skills/a", "/h/.claude/skills/b", "/h/.codex/skills/b"],
      "owner/repo",
      "HEAD"
    )
    expect(step.kind).toBe("skillRepoInstall")
    expect(step.kind === "skillRepoInstall" && step.repo).toBe("owner/repo")
    expect(step.label).toContain("2")
    expect(step.kind === "skillRepoInstall" && step.skills).toHaveLength(2)
  })

  it("skillUpdateStep carries the path, targets, dests and mirror prefix", () => {
    const step = skillUpdateStep(
      "caveman",
      "/h/.claude/skills/caveman",
      ["claude", "codex"],
      ["/h/.claude/skills/caveman", "/h/.codex/skills/caveman"],
      "https://gh-proxy.com/"
    )
    expect(step.kind).toBe("skillUpdate")
    expect(step.label).toContain("caveman")
    expect(step.kind === "skillUpdate" && step.mirrorPrefix).toBe("https://gh-proxy.com/")
    expect(step.kind === "skillUpdate" && step.dests).toHaveLength(2)
  })

  it("skillBackupStep points at the skill path", () => {
    const step = skillBackupStep("caveman", "/h/.claude/skills/caveman")
    expect(step.kind).toBe("skillBackup")
    expect(step.kind === "skillBackup" && step.path).toBe("/h/.claude/skills/caveman")
    expect(step.label).toContain("caveman")
  })

  it("skillCreateStep carries name, content and dests", () => {
    const step = skillCreateStep("my-skill", ["claude"], "---\nname: my-skill\n---\n", [
      "/h/.claude/skills/my-skill",
    ])
    expect(step.kind).toBe("skillCreate")
    expect(step.kind === "skillCreate" && step.content).toContain("my-skill")
    expect(step.kind === "skillCreate" && step.dests).toEqual(["/h/.claude/skills/my-skill"])
  })

  it("skillEditStep rides mergeFile and overwrites SKILL.md", () => {
    const step = skillEditStep("caveman", "/h/.claude/skills/caveman/SKILL.md", "new body")
    expect(step.kind).toBe("mergeFile")
    expect(step.kind === "mergeFile" && step.path).toBe("/h/.claude/skills/caveman/SKILL.md")
    expect(step.kind === "mergeFile" && step.merge("old")).toBe("new body")
  })

  it("skillVisibilityStep merges skillOverrides into claude settings.json", () => {
    const step = skillVisibilityStep("find-docs", "name-only", paths)
    if (step.kind !== "mergeFile") throw new Error(`expected mergeFile, got ${step.kind}`)
    expect(step.path).toBe(paths.claudeSettings)
    const merged = JSON.parse(step.merge("{}"))
    expect(merged.skillOverrides).toEqual({ "find-docs": "name-only" })
  })

  it("skillPermissionStep merges permission.skill into opencode.json", () => {
    const step = skillPermissionStep("internal-docs", "deny", paths)
    if (step.kind !== "mergeFile") throw new Error(`expected mergeFile, got ${step.kind}`)
    expect(step.path).toBe(paths.opencodeConfig)
    const merged = JSON.parse(step.merge(""))
    expect(merged.permission.skill).toEqual({ "internal-docs": "deny" })
  })
})
