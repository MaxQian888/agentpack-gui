import { pendingKeyEnvs, summarize } from "./report"
import type { Plan, StepReport } from "./types"

const basePlan: Plan = {
  os: "mac",
  clis: [],
  skills: [],
  mcps: [],
  mcpKeys: {},
  network: {},
}

const report = (over: Partial<StepReport>): StepReport => ({
  id: "x",
  label: "x",
  status: "done",
  output: [],
  ...over,
})

describe("pendingKeyEnvs", () => {
  it("lists keyEnvs for selected MCPs that have no key", () => {
    const plan: Plan = {
      ...basePlan,
      mcps: [{ id: "context7", targets: ["claude"] }],
      mcpKeys: {},
    }
    // The id rides along so callers can tell whether that server actually installed.
    expect(pendingKeyEnvs(plan)).toEqual([{ id: "context7", env: "CONTEXT7_API_KEY" }])
  })

  it("omits MCPs whose key was provided", () => {
    const plan: Plan = {
      ...basePlan,
      mcps: [{ id: "context7", targets: ["claude"] }],
      mcpKeys: { context7: "secret" },
    }
    expect(pendingKeyEnvs(plan)).toEqual([])
  })

  it("ignores MCPs that need no key and unknown ids", () => {
    const plan: Plan = {
      ...basePlan,
      mcps: [
        { id: "memory", targets: ["claude"] },
        { id: "nope", targets: ["claude"] },
      ],
    }
    expect(pendingKeyEnvs(plan)).toEqual([])
  })
})

describe("summarize", () => {
  it("counts successes and reports the setup-complete headline", () => {
    const lines = summarize([report({ status: "done" })], basePlan)
    expect(lines[0]).toMatch(/Setup complete/i)
    expect(lines[0]).toContain("1")
  })

  it("uses the dry-run headline when dryRun is true", () => {
    const lines = summarize([report({ status: "done" })], basePlan, undefined, true)
    expect(lines[0]).toMatch(/Dry-run complete/i)
  })

  it("lists failed steps with their error text", () => {
    const lines = summarize([report({ status: "error", label: "boom", error: "kaboom" })], basePlan)
    expect(lines.join("\n")).toContain("boom")
    expect(lines.join("\n")).toContain("kaboom")
  })

  it("falls back to empty error text when a failed step has none", () => {
    const lines = summarize([report({ status: "error", label: "boom" })], basePlan)
    expect(lines.join("\n")).toContain("✖ boom —")
  })

  it("lists verification warnings under their own header", () => {
    const lines = summarize([report({ status: "warning", label: "verify claude" })], basePlan)
    expect(lines.join("\n")).toContain("⚠ verify claude")
  })

  it("warns about MCP keys left pending", () => {
    const plan: Plan = { ...basePlan, mcps: [{ id: "context7", targets: ["claude"] }] }
    const lines = summarize([], plan)
    expect(lines.join("\n")).toContain("CONTEXT7_API_KEY")
  })

  it("adds next-step hints for each chosen CLI", () => {
    const plan: Plan = { ...basePlan, clis: ["claude-code", "codex"] }
    const text = summarize([], plan).join("\n")
    expect(text).toContain("claude")
    expect(text).toContain("codex")
  })

  it("emits no next-steps block when no CLI was selected", () => {
    const text = summarize([], basePlan).join("\n")
    expect(text).not.toMatch(/Next steps/i)
  })
})
