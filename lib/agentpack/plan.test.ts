import {
  buildSteps,
  buildVerifySteps,
  cliInstallStep,
  cliUninstallStep,
  fileRestoreStep,
  mcpAddStep,
  mcpAddSpecStep,
  mcpDisableStep,
  mcpEditStep,
  mcpEnableStep,
  mcpRemoveStep,
  planHasSelections,
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
  proxyApplySteps,
  proxyClearSteps,
  syncLiveConfigSteps,
} from "./plan"
import { en } from "@/lib/i18n/en"
import { findMcp } from "./registry"
import { mergeCodexMcp, type McpSpec } from "./merge/mcp"
import { DEFAULT_VISIBLE_APPS } from "./ccswitch/settings"
import type { Paths, Plan, ProxyConfig, StepDescriptor } from "./types"
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
  mcpDisabledStore: "/h/.agentpack/mcp-disabled.json",
  shellProfile: "/h/.zshrc",
  os: "mac",
}

const plan: Plan = {
  os: "mac",
  clis: ["claude-code"],
  skills: [{ id: "rust", targets: ["claude"] }],
  mcps: [{ id: "context7", targets: ["claude", "codex"] }],
  mcpKeys: { context7: "k" },
  network: { npmRegistry: "https://m" },
}

it("orders steps registry→install→skills→mcp", () => {
  const ids = buildSteps(plan, paths).map((s) => s.id)
  expect(ids[0]).toBe("npm-registry")
  expect(ids).toEqual(
    expect.arrayContaining([
      "cli-claude-code",
      "skill-rust",
      "mcp-claude-context7",
      "mcp-codex-context7",
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

it("wraps an npx server in cmd /c for codex on Windows, but not for claude", () => {
  // Codex spawns the command it stored, so a bare `npx` shim would fail there;
  // Claude's own launcher resolves shims, so its command must stay bare.
  const winPlan: Plan = {
    ...plan,
    os: "win",
    skills: [],
    mcps: [{ id: "context7", targets: ["claude", "codex"] }],
    network: {},
  }
  const steps = buildSteps(winPlan, { ...paths, os: "win" })
  const codex = steps.find((s) => s.id === "mcp-codex-context7")!
  expect(codex.kind === "mergeFile" && codex.merge("")).toContain('command = "cmd"')
  const claude = steps.find((s) => s.id === "mcp-claude-context7")!
  expect(claude.kind === "command" && claude.command.args).toContain("npx")
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
  // No npx server in this plan either, so nothing at all wants Node — see
  // "Node prerequisite for npx-launched MCP servers" for the case where one does.
  const bare: Plan = { ...plan, skills: [], mcps: [] }
  const upToDate = buildSteps(bare, paths, undefined, new Set(["claude-code"]), {
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

describe("Node engines floor", () => {
  // @anthropic-ai/claude-code declares engines.node ">=22.0.0"; npm refuses the
  // install below that with EBADENGINE buried in its output.
  const withNode = (version: string) =>
    buildSteps(plan, paths, undefined, new Set(["node"]), { versions: { node: version } })

  it("replaces the npm install with an actionable note when Node is too old", () => {
    const step = withNode("v20.11.0").find((s) => s.id === "cli-claude-code")!
    expect(step.kind).toBe("info")
    expect(step.kind === "info" && step.manual).toBe(true)
    expect(step.kind === "info" && step.lines.join(" ")).toContain("Node.js 22")
    expect(step.kind === "info" && step.lines.join(" ")).toContain("20.11.0")
  })

  it("installs normally once Node satisfies the floor", () => {
    const step = withNode("v24.4.0").find((s) => s.id === "cli-claude-code")!
    expect(step.kind).toBe("command")
  })

  it("does not fire when Node is absent — the run installs a current LTS first", () => {
    const steps = buildSteps(plan, paths)
    expect(steps.find((s) => s.id === "runtime-node")?.kind).toBe("command")
    expect(steps.find((s) => s.id === "cli-claude-code")?.kind).toBe("command")
  })

  it("does not fire for a native install, which needs no Node at all", () => {
    const nativePlan: Plan = { ...plan, cliMethods: { "claude-code": "native" } }
    const step = buildSteps(nativePlan, paths, undefined, new Set(["node"]), {
      versions: { node: "v20.11.0" },
    }).find((s) => s.id === "cli-claude-code")!
    expect(step.kind).toBe("command")
  })
})

describe("Claude MCP config on a desktop-only install", () => {
  // No claude-code CLI anywhere: the desktop app bundles the agent and installs
  // no binary, so `claude mcp add` would fail "command not found" every time.
  const guiPlan: Plan = { ...plan, clis: ["claude-desktop"], skills: [], network: {} }

  it("writes the config directly when there is no claude binary to run", () => {
    const step = buildSteps(guiPlan, paths).find((s) => s.id === "mcp-claude-context7")!
    expect(step.kind).toBe("mergeFile")
    expect(step.kind === "mergeFile" && step.path).toBe(paths.claudeConfig)
  })

  it("produces the same entry `claude mcp add` would have written", () => {
    const step = buildSteps(guiPlan, paths).find((s) => s.id === "mcp-claude-context7")!
    if (step.kind !== "mergeFile") throw new Error("expected a mergeFile step")
    const written = JSON.parse(step.merge("")) as {
      mcpServers: Record<string, { type: string; command: string; args: string[] }>
    }
    const entry = written.mcpServers["context7"]!
    expect(entry.type).toBe("stdio")
    expect(entry.command).toBe("npx")
    expect(entry.args.join(" ")).toContain("@upstash/context7-mcp")
  })

  it("preserves the rest of .claude.json — it holds unrelated Claude state", () => {
    const step = buildSteps(guiPlan, paths).find((s) => s.id === "mcp-claude-context7")!
    if (step.kind !== "mergeFile") throw new Error("expected a mergeFile step")
    const before = JSON.stringify({ numStartups: 7, mcpServers: { other: { type: "stdio" } } })
    const after = JSON.parse(step.merge(before)) as Record<string, unknown>
    expect(after["numStartups"]).toBe(7)
    expect(Object.keys(after["mcpServers"] as object).sort()).toEqual(["context7", "other"])
  })

  it("still shells out when the CLI is being installed alongside the app", () => {
    const both: Plan = { ...guiPlan, clis: ["claude-desktop", "claude-code"] }
    const step = buildSteps(both, paths).find((s) => s.id === "mcp-claude-context7")!
    expect(step.kind).toBe("command")
  })

  it("still shells out when the CLI is already on the machine", () => {
    const step = buildSteps(guiPlan, paths, undefined, new Set(["claude-code"])).find(
      (s) => s.id === "mcp-claude-context7"
    )!
    expect(step.kind).toBe("command")
  })
})

describe("Node prerequisite for npx-launched MCP servers", () => {
  // The desktop-app path installs no npm CLI at all, but an npx-launched server
  // still needs Node to *start* — and nothing says so at install time, because
  // `claude mcp add` only writes config and reports success either way.
  const guiPlan: Plan = { ...plan, clis: [], skills: [], network: {} }

  it("installs Node for an npx server even with no npm-installed CLI", () => {
    const ids = buildSteps(guiPlan, paths).map((s) => s.id)
    expect(ids).toContain("runtime-node")
  })

  it("adds no Node step when the only servers are remote", () => {
    const httpPlan: Plan = { ...guiPlan, mcps: [{ id: "github", targets: ["claude"] }] }
    expect(buildSteps(httpPlan, paths).map((s) => s.id)).not.toContain("runtime-node")
  })

  it("adds no Node step when the only server runs through uvx", () => {
    const uvPlan: Plan = { ...guiPlan, mcps: [{ id: "fetch", targets: ["claude"] }] }
    expect(buildSteps(uvPlan, paths).map((s) => s.id)).not.toContain("runtime-node")
  })

  it("adds no Node step for a server nothing is targeting", () => {
    const untargeted: Plan = { ...guiPlan, mcps: [{ id: "context7", targets: [] }] }
    expect(buildSteps(untargeted, paths).map((s) => s.id)).not.toContain("runtime-node")
  })

  it("does not gate the MCP config on Node — writing config succeeds without it", () => {
    // Same reasoning as uv: the config is correct and starts working the moment
    // Node appears, so a failed Node install must not drop it.
    const step = buildSteps(guiPlan, paths).find((s) => s.id === "mcp-claude-context7")!
    expect(step.dependsOn ?? []).not.toContain("runtime-node")
  })
})

describe("uv prerequisite for uvx-launched MCP servers", () => {
  const fetchPlan: Plan = { ...plan, mcps: [{ id: "fetch", targets: ["claude"] }] }

  it("installs uv when a selected server runs through uvx", () => {
    const steps = buildSteps(fetchPlan, paths)
    expect(steps.find((s) => s.id === "runtime-uv")?.kind).toBe("command")
  })

  it("skips the uv step when uv is already present", () => {
    const ids = buildSteps(fetchPlan, paths, undefined, new Set(["uv"])).map((s) => s.id)
    expect(ids).not.toContain("runtime-uv")
  })

  it("adds no uv step for an all-npx plan", () => {
    expect(buildSteps(plan, paths).map((s) => s.id)).not.toContain("runtime-uv")
  })

  it("does not gate the MCP config on uv — writing config succeeds without it", () => {
    // `claude mcp add` only writes config. Gating it on a failed uv install would
    // drop config that is correct and starts working as soon as uv appears.
    const step = buildSteps(fetchPlan, paths).find((s) => s.id === "mcp-claude-fetch")!
    expect(step.kind === "command" && step.dependsOn).not.toContain("runtime-uv")
  })
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

describe("no package-manager path on this OS", () => {
  const linuxPlan = {
    ...plan,
    os: "linux" as const,
    clis: ["cc-switch" as const],
    skills: [],
    mcps: [],
  }
  const linuxPaths = { ...paths, os: "linux" as const }

  it("installs cc-switch from its GitHub release instead of giving up", () => {
    // Linux has no winget/brew for cc-switch, so a published release is the only
    // automated path there is — and until now there was none at all.
    const step = buildSteps(linuxPlan, linuxPaths).find((s) => s.id === "cli-cc-switch-release")!
    expect(step.kind).toBe("releaseInstall")
    expect(
      step.kind === "releaseInstall" && step.source.kind === "github" && step.source.repo
    ).toBe("farion1231/cc-switch")
    expect(step.kind === "releaseInstall" && step.os).toBe("linux")
  })

  it("routes the release download through the configured GitHub mirror", () => {
    const step = buildSteps(linuxPlan, linuxPaths, undefined, undefined, undefined, {
      arch: "arm64",
      ghMirrorPrefix: "https://ghfast.top/",
    }).find((s) => s.id === "cli-cc-switch-release")!
    expect(step.kind === "releaseInstall" && step.mirrorPrefix).toBe("https://ghfast.top/")
    expect(step.kind === "releaseInstall" && step.arch).toBe("arm64")
  })

  it("still falls back to the manual note for a tool with no release either", () => {
    const noRelease = { ...plan, os: "linux" as const, clis: [], skills: [], mcps: [] }
    // node has no linux installer and no release source of its own.
    const steps = buildSteps(
      { ...noRelease, mcps: [] },
      linuxPaths,
      undefined,
      new Set(["node"]) // pretend node exists so the prerequisite doesn't fire
    )
    expect(steps.find((s) => s.id === "cli-cc-switch")).toBeUndefined()
  })
})

describe("network fallbacks on install steps", () => {
  it("gives a winget cc-switch install the release download as a last resort", () => {
    const winPlan = {
      ...plan,
      os: "win" as const,
      clis: ["cc-switch" as const],
      skills: [],
      mcps: [],
    }
    const step = buildSteps(winPlan, { ...paths, os: "win" }).find((s) => s.id === "cli-cc-switch")!
    expect(step.kind).toBe("command")
    const fallbacks = step.kind === "command" ? (step.fallbacks ?? []) : []
    // winget's downloader ignores HTTPS_PROXY, so fetching the installer
    // ourselves is the only recovery that can work on a proxied network.
    expect(fallbacks.map((f) => f.kind)).toContain("releaseInstall")
  })

  it("offers the vendor script as a different route from npm, but not pnpm/bun", () => {
    const macPlan = {
      ...plan,
      os: "mac" as const,
      clis: ["claude-code" as const],
      skills: [],
      mcps: [],
    }
    const step = buildSteps(macPlan, { ...paths, os: "mac" }, undefined, new Set(["node"])).find(
      (s) => s.id === "cli-claude-code"
    )!
    const ids = step.kind === "command" ? (step.fallbacks ?? []).map((f) => f.id) : []
    // pnpm/bun pull the same package from the same registry that just failed.
    expect(ids).toEqual(["cli-claude-code-native"])
  })

  it("does not reroute an UPGRADE, which must match how the tool was installed", () => {
    const macPlan = {
      ...plan,
      os: "mac" as const,
      clis: ["claude-code" as const],
      skills: [],
      mcps: [],
    }
    const step = buildSteps(
      macPlan,
      { ...paths, os: "mac" },
      undefined,
      new Set(["node", "claude-code"]),
      { versions: { "claude-code": "1.0.0" }, latest: { "claude-code": "2.0.0" } }
    ).find((s) => s.id === "cli-claude-code")!
    expect(step.kind === "command" && step.fallbacks).toBeUndefined()
  })

  it("gives a winget Node install the user-scope scoop route", () => {
    const winPlan = {
      ...plan,
      os: "win" as const,
      clis: ["claude-code" as const],
      skills: [],
      mcps: [],
    }
    const step = buildSteps(winPlan, { ...paths, os: "win" }).find((s) => s.id === "runtime-node")!
    const ids = step.kind === "command" ? (step.fallbacks ?? []).map((f) => f.id) : []
    expect(ids).toEqual(["runtime-node-scoop"])
  })
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

it("a plan run never writes the agent CLIs' API endpoint", () => {
  // Endpoints are provider rows now; a run that also wrote them would give the
  // live config two writers and a provider switch could be silently undone.
  const p: Plan = { ...plan, clis: ["claude-code", "codex"], skills: [], mcps: [] }
  const ids = buildSteps(p, paths, en, new Set(["claude-code", "codex"])).map((s) => s.id)
  expect(ids.filter((id) => id.startsWith("relay-"))).toEqual([])
})

it("buildVerifySteps never runs the slow health-checking mcp list", () => {
  const ids = buildVerifySteps(plan).map((s) => s.id)
  expect(ids).toEqual(["verify-claude-version"])
})

describe("planHasSelections", () => {
  const bare: Plan = { os: "mac", clis: [], skills: [], mcps: [], mcpKeys: {}, network: {} }

  it("is false for an untouched plan", () => {
    expect(planHasSelections(bare)).toBe(false)
    expect(planHasSelections(undefined)).toBe(false)
  })

  it("counts network-only config as runnable", () => {
    expect(planHasSelections({ ...bare, network: { npmRegistry: "https://m" } })).toBe(true)
  })

  it("counts a picked item", () => {
    expect(planHasSelections({ ...bare, clis: ["codex"] })).toBe(true)
  })
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

  it("mcpAddSpecStep gates Codex out of an sse spec but keeps Claude/OpenCode", () => {
    const ids = mcpAddSpecStep(
      "sser",
      { transport: "sse", url: "https://x/sse", headers: {} },
      ["claude", "codex", "opencode"],
      paths
    ).map((s) => s.id)
    expect(ids).toEqual(["mcp-add-claude-sser", "mcp-add-opencode-sser"])
  })

  it("mcpAddSpecStep wraps npx through cmd /c for Codex/OpenCode on Windows", () => {
    const winPaths: Paths = { ...paths, os: "win" }
    const steps = mcpAddSpecStep(
      "srv",
      { transport: "stdio", command: "npx", args: ["-y", "pkg"], env: {} },
      ["codex", "opencode"],
      winPaths
    )
    const codex = steps.find((s) => s.id === "mcp-add-codex-srv")!
    expect(codex.kind === "mergeFile" && codex.merge("")).toContain('command = "cmd"')
    const oc = steps.find((s) => s.id === "mcp-add-opencode-srv")!
    expect(oc.kind === "mergeFile" && oc.merge("")).toContain('"cmd"')
  })

  it("mcpDisableStep: Codex/OpenCode flip enabled=false, Claude stashes then removes", () => {
    const spec: McpSpec = { transport: "stdio", command: "npx", args: [], env: {} }
    const steps = mcpDisableStep("srv", spec, ["claude", "codex", "opencode"], paths)
    expect(steps.map((s) => s.id)).toEqual([
      "mcp-disable-stash-srv",
      "mcp-disable-remove-claude-srv",
      "mcp-disable-codex-srv",
      "mcp-disable-opencode-srv",
    ])
    // Claude stash writes the spec into the disabled store, then removes the server.
    const stash = steps[0]
    expect(stash.kind === "mergeFile" && stash.path).toBe(paths.mcpDisabledStore)
    expect(stash.kind === "mergeFile" && stash.merge("")).toContain('"srv"')
    // Codex flips enabled=false in place.
    const codex = steps.find((s) => s.id === "mcp-disable-codex-srv")!
    const existing = mergeCodexMcp("", "srv", { command: "npx", args: [] })
    expect(codex.kind === "mergeFile" && codex.merge(existing)).toMatch(/enabled\s*=\s*false/)
  })

  it("mcpEnableStep: Claude re-adds then clears the stash; Codex flips enabled=true", () => {
    const spec: McpSpec = { transport: "stdio", command: "npx", args: [], env: {} }
    const steps = mcpEnableStep("srv", spec, ["claude", "codex"], paths)
    expect(steps.map((s) => s.id)).toEqual([
      "mcp-enable-add-claude-srv",
      "mcp-enable-unstash-srv",
      "mcp-enable-codex-srv",
    ])
    const unstash = steps.find((s) => s.id === "mcp-enable-unstash-srv")!
    // Unstashing an existing entry empties the store.
    const store = JSON.stringify({ srv: { spec, targets: ["claude"] } })
    expect(unstash.kind === "mergeFile" && JSON.parse(unstash.merge(store))).toEqual({})
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
    const steps = syncLiveConfigSteps(provider, paths, undefined, ["cc-provider-setCurrent-codex"])
    expect(steps.map((s) => s.id)).toEqual(["cc-sync-codex-config"])
    for (const s of steps) expect(s.dependsOn).toEqual(["cc-provider-setCurrent-codex"])
  })

  it("syncs an opencode provider into opencode.json", () => {
    const provider: Provider = {
      id: "1",
      app_type: "opencode",
      name: "prov",
      settings_config: JSON.stringify({
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://oc/v1" },
      }),
      is_current: true,
    }
    const steps = syncLiveConfigSteps(provider, paths)
    expect(steps.map((s) => s.id)).toEqual(["cc-sync-opencode"])
    expect(steps[0].kind === "mergeFile" && steps[0].path).toBe(paths.opencodeConfig)
  })

  it("never writes ~/.codex/auth.json — that file holds the official login", () => {
    // Codex resolves its explicit `auth_mode` ahead of everything else, so an
    // OPENAI_API_KEY written beside a ChatGPT login is silently ignored and the
    // switch only *looks* like it worked. Nothing agentpack emits may touch it.
    for (const app of ["claude", "codex"] as const) {
      const provider: Provider = {
        id: "1",
        app_type: app,
        name: "prov",
        settings_config: JSON.stringify({
          env: { ANTHROPIC_AUTH_TOKEN: "t" },
          auth: { OPENAI_API_KEY: "sk-1" },
          config: 'model_provider = "custom"\n',
        }),
        is_current: true,
      }
      const written = syncLiveConfigSteps(provider, paths).map((s) =>
        s.kind === "mergeFile" ? s.path : ""
      )
      expect(written).not.toContain(paths.codexAuth)
    }
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
  }

  it("codex mcp step writes the server entry into config.toml", () => {
    const step = buildSteps(codexPlan, paths).find((s) => s.id === "mcp-codex-context7")
    expect(mergeOf(step)("")).toContain("context7")
  })

  it("codex mcp-remove step deletes the named server table", () => {
    const existing = mergeCodexMcp("", "context7", { command: "npx", args: [] })
    const step = mcpRemoveStep("context7", ["codex"], paths).find(
      (s) => s.id === "mcp-remove-codex-context7"
    )
    expect(mergeOf(step)(existing)).not.toContain("context7")
  })

  it("codex sync step writes config.toml from the provider", () => {
    const provider: Provider = {
      id: "1",
      app_type: "codex",
      name: "prov",
      settings_config: JSON.stringify({
        config: 'model_provider = "custom"\n[model_providers.custom]\nname = "Relay"\n',
        auth: { OPENAI_API_KEY: "sk-1" },
      }),
      is_current: true,
    }
    const steps = syncLiveConfigSteps(provider, paths)
    const cfg = steps.find((s) => s.id === "cc-sync-codex-config")
    expect(mergeOf(cfg)("")).toContain("model_provider")
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

// --- Proxy ---------------------------------------------------------------

const proxyCfg = (patch: Partial<ProxyConfig> = {}): ProxyConfig => ({
  mode: "manual",
  targets: ["claude", "npm", "git", "shell"],
  httpUrl: "http://127.0.0.1:7890",
  ...patch,
})

it("applies the proxy before the npm mirror and every install", () => {
  const withProxy: Plan = { ...plan, network: { ...plan.network, proxy: proxyCfg() } }
  const ids = buildSteps(withProxy, paths).map((s) => s.id)
  expect(ids.indexOf("proxy-claude")).toBe(0)
  expect(ids.indexOf("proxy-npm-proxy")).toBeLessThan(ids.indexOf("npm-registry"))
  expect(ids.indexOf("npm-registry")).toBeLessThan(ids.indexOf("cli-claude-code"))
})

it("adds no proxy steps when the proxy is off or empty", () => {
  const off: Plan = { ...plan, network: { ...plan.network, proxy: proxyCfg({ mode: "off" }) } }
  expect(buildSteps(off, paths).some((s) => s.id.startsWith("proxy-"))).toBe(false)
  const empty: Plan = {
    ...plan,
    network: { ...plan.network, proxy: proxyCfg({ httpUrl: undefined }) },
  }
  expect(buildSteps(empty, paths).some((s) => s.id.startsWith("proxy-"))).toBe(false)
  expect(buildSteps(plan, paths).some((s) => s.id.startsWith("proxy-"))).toBe(false)
})

it("writes only the targets the user selected", () => {
  const ids = (targets: ProxyConfig["targets"]) =>
    proxyApplySteps(proxyCfg({ targets }), paths, "mac").map((s) => s.id)
  expect(ids(["claude"])).toEqual(["proxy-claude", "proxy-note"])
  expect(ids(["npm"])).toEqual(["proxy-npm-proxy", "proxy-npm-https-proxy", "proxy-note"])
  expect(ids(["git"])).toEqual(["proxy-git-http.proxy", "proxy-git-https.proxy", "proxy-note"])
  expect(ids(["shell"])).toEqual(["proxy-shell", "proxy-note"])
})

it("targets the right files, and the merge round-trips through the runner's transform", () => {
  const steps = proxyApplySteps(proxyCfg({ targets: ["claude", "shell"] }), paths, "mac")
  const claude = steps.find((s) => s.id === "proxy-claude")!
  expect(claude.kind === "mergeFile" && claude.path).toBe(paths.claudeSettings)
  expect(claude.kind === "mergeFile" && JSON.parse(claude.merge("")).env.HTTPS_PROXY).toBe(
    "http://127.0.0.1:7890"
  )
  const shell = steps.find((s) => s.id === "proxy-shell")!
  expect(shell.kind === "mergeFile" && shell.path).toBe(paths.shellProfile)
  expect(shell.kind === "mergeFile" && shell.merge("export PATH=/x\n")).toContain(
    'export HTTPS_PROXY="http://127.0.0.1:7890"'
  )
})

it("uses setx instead of a shell profile on Windows", () => {
  const ids = proxyApplySteps(proxyCfg({ targets: ["shell"] }), paths, "win").map((s) => s.id)
  expect(ids).toEqual(["proxy-win-HTTP_PROXY", "proxy-win-HTTPS_PROXY", "proxy-note"])
})

it("closes with the note Codex/OpenCode users need, and drops it once shell is covered", () => {
  const noShell = proxyApplySteps(proxyCfg({ targets: ["claude"] }), paths, "mac").at(-1)!
  expect(noShell.kind === "info" && noShell.lines.join("\n")).toContain(
    'export HTTPS_PROXY="http://127.0.0.1:7890"'
  )
  const withShell = proxyApplySteps(proxyCfg({ targets: ["shell"] }), paths, "mac").at(-1)!
  expect(withShell.kind === "info" && withShell.lines).toEqual([en.steps.proxyRestartNote])
})

it("clear steps are the inverse of apply, per target", () => {
  const steps = proxyClearSteps(["claude", "npm", "git", "shell"], paths, "mac")
  expect(steps.map((s) => s.id)).toEqual([
    "proxy-clear-claude",
    "proxy-clear-npm-proxy",
    "proxy-clear-npm-https-proxy",
    "proxy-clear-npm-noproxy",
    "proxy-clear-git-http.proxy",
    "proxy-clear-git-https.proxy",
    "proxy-clear-shell",
  ])
  // Applying then clearing leaves the file exactly as it started.
  const applied = proxyApplySteps(proxyCfg(), paths, "mac").find((s) => s.id === "proxy-claude")!
  const cleared = steps.find((s) => s.id === "proxy-clear-claude")!
  const original = JSON.stringify({ env: { KEEP: "1" } })
  const roundTrip =
    applied.kind === "mergeFile" && cleared.kind === "mergeFile"
      ? JSON.parse(cleared.merge(applied.merge(original)))
      : null
  expect(roundTrip.env).toEqual({ KEEP: "1" })
  // Unsetting a key that was never set must not fail the run.
  expect(steps.filter((s) => s.kind === "command").every((s) => s.verifyOnly)).toBe(true)
})

it("clears Windows user-scope variables with setx", () => {
  const ids = proxyClearSteps(["shell"], paths, "win").map((s) => s.id)
  expect(ids).toContain("proxy-clear-win-HTTPS_PROXY")
  expect(ids).toContain("proxy-clear-win-NODE_EXTRA_CA_CERTS")
})
