import {
  applySurface,
  matchPreset,
  mcpTargetsFor,
  presetSelection,
  skillTargetsFor,
} from "./presets"
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

  it("maps the desktop apps to the same surfaces their CLIs use", () => {
    // They share `~/.claude` / `~/.codex` with the CLI, so a desktop-only
    // selection must still configure both agents — not silently fall back to
    // Claude and leave the Codex app with no servers at all.
    expect(mcpTargetsFor(["claude-desktop"])).toEqual(["claude"])
    expect(mcpTargetsFor(["codex-app"])).toEqual(["codex"])
    expect(mcpTargetsFor(["claude-desktop", "codex-app"])).toEqual(["claude", "codex"])
  })

  it("does not double up when both forms of an agent are selected", () => {
    expect(mcpTargetsFor(["claude-code", "claude-desktop"])).toEqual(["claude"])
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

describe("applySurface", () => {
  const recommended = ["claude-code", "codex", "cc-switch"]

  it("swaps the agent CLIs for their apps on the GUI path", () => {
    expect(applySurface(recommended, "gui")).toEqual(["claude-desktop", "codex-app", "cc-switch"])
  })

  it("leaves the CLI path alone", () => {
    expect(applySurface(recommended, "cli")).toEqual(recommended)
  })

  it("installs both forms, grouped per agent", () => {
    expect(applySurface(recommended, "both")).toEqual([
      "claude-code",
      "claude-desktop",
      "codex",
      "codex-app",
      "cc-switch",
    ])
  })

  it("passes through tools that have no desktop form", () => {
    // OpenCode is a TUI; cc-switch and cc-connect are companions.
    expect(applySurface(["opencode", "cc-connect"], "gui")).toEqual(["opencode", "cc-connect"])
  })

  it("is idempotent — re-applying a surface never accumulates", () => {
    const once = applySurface(recommended, "gui")
    expect(applySurface(once, "gui")).toEqual(once)
    // And switching back is a real switch, not an addition.
    expect(applySurface(once, "cli")).toEqual(recommended)
  })

  it("does not duplicate when a bundle already names both forms", () => {
    expect(applySurface(["claude-code", "claude-desktop"], "both")).toEqual([
      "claude-code",
      "claude-desktop",
    ])
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

describe("presetSelection", () => {
  it("returns null for an unknown bundle", () => {
    expect(presetSelection("nope")).toBeNull()
  })

  it("resolves the surface before deriving targets", () => {
    // "gui" swaps the CLIs for the desktop apps, and the targets must follow the
    // resolved list — a desktop-only pick still configures claude and codex.
    const picked = presetSelection("recommended", "gui")!
    expect(picked.clis).toEqual(["claude-desktop", "codex-app", "cc-switch"])
    expect(picked.mcps.map((m) => m.id)).toContain("context7")
    expect(picked.mcps[0]!.targets).toEqual(["claude", "codex"])
  })

  it("passes the bundle through untouched when no surface is given", () => {
    expect(presetSelection("recommended")!.clis).toEqual(["claude-code", "codex", "cc-switch"])
  })

  // The wizard's summary and the store's applyPreset both read this, so a drift
  // here would show the user one thing and install another.
  it("agrees with what applyPreset writes to the plan", () => {
    const picked = presetSelection("everything", "cli")!
    expect(picked.skills.every((s) => s.targets.length > 0)).toBe(true)
    expect(picked.mcps.every((m) => m.targets.length > 0)).toBe(true)
  })
})
