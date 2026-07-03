import { CLI_TOOLS, MCP_SERVERS, RUNTIMES, findCli, findMcp, findRuntime } from "./registry"
import { PRESETS, findPreset } from "./presets"

it("each CLI has an install entry for every OS key", () => {
  for (const c of CLI_TOOLS)
    for (const os of ["win", "mac", "linux"] as const) expect(c.install).toHaveProperty(os)
})

it("each runtime has an install entry for every OS key", () => {
  for (const r of RUNTIMES)
    for (const os of ["win", "mac", "linux"] as const) expect(r.install).toHaveProperty(os)
})

it("runtime finder resolves node and bun by id", () => {
  expect(findRuntime("node")?.bin).toBe("node")
  expect(findRuntime("bun")?.bin).toBe("bun")
  expect(findRuntime("nope")).toBeUndefined()
})

it("python probes python3 as a fallback; uv installs on every OS", () => {
  expect(findRuntime("python")?.altBin).toBe("python3")
  for (const os of ["win", "mac", "linux"] as const) {
    expect(findRuntime("uv")?.install[os]).not.toBeNull()
  }
})

it("everything preset covers the whole MCP registry", () => {
  const e = findPreset("everything")!
  expect(e.mcps.length).toBe(MCP_SERVERS.length)
})

it("finders work", () => {
  expect(findCli("claude-code")?.bin).toBe("claude")
  expect(findMcp("context7")?.keyEnv).toBe("CONTEXT7_API_KEY")
  expect(PRESETS.map((p) => p.id)).toContain("recommended")
})
