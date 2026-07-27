import { matchPreset, mcpTargetsFor, skillTargetsFor } from "./presets"
import type { Plan } from "./types"

const plan = (over: Partial<Plan>): Plan => ({
  os: "mac",
  clis: [],
  skills: [],
  mcps: [],
  mcpKeys: {},
  network: {},
  ...over,
})

describe("mcpTargetsFor", () => {
  it("maps each agent CLI to its config surface", () => {
    expect(mcpTargetsFor(["claude-code"])).toEqual(["claude"])
    expect(mcpTargetsFor(["codex"])).toEqual(["codex"])
    expect(mcpTargetsFor(["opencode"])).toEqual(["opencode"])
  })

  it("configures every agent the selection installs, in catalog order", () => {
    expect(mcpTargetsFor(["opencode", "codex", "claude-code"])).toEqual([
      "claude",
      "codex",
      "opencode",
    ])
  })

  it("ignores companion tools that host nothing", () => {
    expect(mcpTargetsFor(["cc-switch", "cc-connect", "codex"])).toEqual(["codex"])
  })

  it("falls back to claude when no agent CLI is selected", () => {
    expect(mcpTargetsFor([])).toEqual(["claude"])
    expect(mcpTargetsFor(["cc-switch"])).toEqual(["claude"])
  })
})

describe("skillTargetsFor", () => {
  it("drops opencode, which the plan's skill targets cannot express", () => {
    expect(skillTargetsFor(["claude-code", "codex", "opencode"])).toEqual(["claude", "codex"])
  })

  it("falls back to claude for an opencode-only selection", () => {
    expect(skillTargetsFor(["opencode"])).toEqual(["claude"])
  })
})

describe("matchPreset", () => {
  it("recognizes the minimal bundle by its id sets", () => {
    expect(
      matchPreset(plan({ clis: ["claude-code"], mcps: [{ id: "memory", targets: ["claude"] }] }))
    ).toBe("minimal")
  })

  it("ignores targets, keys and network config when matching", () => {
    expect(
      matchPreset(
        plan({
          clis: ["claude-code"],
          mcps: [{ id: "memory", targets: ["claude", "codex"] }],
          mcpKeys: { memory: "k" },
          network: { npmRegistry: "https://m" },
        })
      )
    ).toBe("minimal")
  })

  it("falls back to custom when nothing matches", () => {
    expect(matchPreset(plan({ clis: ["codex"] }))).toBe("custom")
  })
})
