import {
  buildSteps,
  buildVerifySteps,
  cliInstallStep,
  skillInstallStep,
  skillRemoveStep,
  visibleAppsStep,
  providerStep,
} from "./plan"
import { DEFAULT_VISIBLE_APPS } from "./ccswitch/settings"
import type { Paths, Plan } from "./types"
import type { ProviderForm } from "./ccswitch/types"

const paths: Paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeSkillsDir: "/h/.claude/skills",
  codexConfig: "/h/.codex/config.toml",
  codexSkillsDir: "/h/.codex/skills",
  ccSwitchSettings: "/h/.cc-switch/settings.json",
  ccSwitchDb: "/h/.cc-switch/cc-switch.db",
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

it("codex mcp step targets the resolved config path", () => {
  const step = buildSteps(plan, paths).find((s) => s.id === "mcp-codex-context7")!
  expect(step.kind === "mergeFile" && step.path).toBe("/h/.codex/config.toml")
})

it("verify steps are all verifyOnly", () => {
  expect(buildVerifySteps(plan).every((s) => s.verifyOnly)).toBe(true)
})

it("installed CLIs use the upgrade command + label", () => {
  const step = buildSteps(plan, paths, undefined, new Set(["claude-code"])).find(
    (s) => s.id === "cli-claude-code"
  )!
  expect(step.kind).toBe("command")
  expect(step.kind === "command" && step.command.args.join(" ")).toContain("@latest")
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
})
