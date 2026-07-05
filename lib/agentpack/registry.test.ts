import {
  CLI_TOOLS,
  MCP_SERVERS,
  RUNTIMES,
  findCli,
  findMcp,
  findRuntime,
  installMethodsFor,
} from "./registry"
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

describe("installMethodsFor", () => {
  it("returns the tool's explicit methods (npm default first) when present", () => {
    const methods = installMethodsFor(findCli("claude-code")!, "win")
    expect(methods.length).toBeGreaterThan(1)
    expect(methods[0].id).toBe("npm")
    // the npm default matches the single-command install entry
    expect(methods[0].command).toEqual(findCli("claude-code")!.install.win)
    expect(methods.map((m) => m.id)).toContain("native")
  })

  it("wraps a single install command as one default method when no methods are declared", () => {
    const methods = installMethodsFor(findCli("cc-switch")!, "mac")
    expect(methods).toHaveLength(1)
    expect(methods[0].id).toBe("default")
    expect(methods[0].command).toEqual(findCli("cc-switch")!.install.mac)
  })

  it("is empty when there is no installer and no methods (node on linux)", () => {
    expect(installMethodsFor(findRuntime("node")!, "linux")).toEqual([])
  })

  it("flags the elevation-requiring Node winget method and offers a user-scope scoop alternative", () => {
    const methods = installMethodsFor(findRuntime("node")!, "win")
    const winget = methods.find((m) => m.id === "winget")!
    const scoop = methods.find((m) => m.id === "scoop")!
    expect(winget.requiresElevation).toBe(true)
    expect(scoop.requiresElevation).toBeFalsy()
  })
})
