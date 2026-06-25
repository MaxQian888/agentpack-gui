import { buildSteps, buildVerifySteps } from "./plan"
import type { Paths, Plan } from "./types"

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
