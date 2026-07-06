import {
  CLI_TOOLS,
  MCP_CATEGORY_ORDER,
  MCP_SERVERS,
  RUNTIMES,
  findCli,
  findMcp,
  findRuntime,
  installMethodsFor,
  runtimePkgManager,
  runtimeUpgradeCommandFor,
  upgradeCommandFor,
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

it("every MCP server has a category the section knows how to render", () => {
  for (const m of MCP_SERVERS) {
    expect(m.category).toBeDefined()
    // A category missing from MCP_CATEGORY_ORDER would never render in the UI.
    expect(MCP_CATEGORY_ORDER).toContain(m.category)
  }
})

it("MCP_CATEGORY_ORDER has no category without at least one server", () => {
  const used = new Set(MCP_SERVERS.map((m) => m.category))
  for (const c of MCP_CATEGORY_ORDER) expect(used.has(c)).toBe(true)
})

it("every MCP server links to its docs", () => {
  for (const m of MCP_SERVERS) expect(m.docsUrl).toMatch(/^https?:\/\//)
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

describe("upgradeCommandFor", () => {
  const claude = findCli("claude-code")!

  it("uses the npm @latest upgrade for an npm-managed install", () => {
    const cmd = upgradeCommandFor(claude, "mac", "npm")
    expect(cmd?.args.join(" ")).toContain("@latest")
  })

  it("defaults to the npm upgrade when the manager is unknown", () => {
    const cmd = upgradeCommandFor(claude, "mac", undefined)
    expect(cmd?.args.join(" ")).toContain("@latest")
  })

  it("re-runs the native installer for a native install (no npm duplicate)", () => {
    const native = upgradeCommandFor(claude, "win", "native")
    const nativeMethod = claude.methods?.win?.find((m) => m.id === "native")
    expect(nativeMethod).toBeDefined()
    expect(native).toEqual(nativeMethod?.command)
    // The native install is not an npm command, so no `@latest` npm invocation.
    expect(native?.file).not.toBe("npm")
  })

  it("falls back to the npm upgrade for a native manager on a tool without a native method", () => {
    // cc-switch has no native method — a native manager must not crash; it uses
    // the tool's install command as the last-resort upgrade.
    const cc = findCli("cc-switch")!
    expect(upgradeCommandFor(cc, "mac", "native")).toEqual(cc.install.mac)
  })
})

describe("runtimeUpgradeCommandFor", () => {
  it("upgrades Node in place via winget/brew per OS", () => {
    const node = findRuntime("node")!
    expect(runtimeUpgradeCommandFor(node, "win")).toEqual({
      file: "winget",
      args: expect.arrayContaining(["upgrade", "OpenJS.NodeJS.LTS"]),
    })
    expect(runtimeUpgradeCommandFor(node, "mac")?.file).toBe("brew")
  })

  it("self-updates Bun and uv without a package manager", () => {
    expect(runtimeUpgradeCommandFor(findRuntime("bun")!, "linux")).toEqual({
      file: "bun",
      args: ["upgrade"],
    })
    expect(runtimeUpgradeCommandFor(findRuntime("uv")!, "win")).toEqual({
      file: "uv",
      args: ["self", "update"],
    })
  })

  it("has no automated update path for Node on Linux", () => {
    expect(runtimeUpgradeCommandFor(findRuntime("node")!, "linux")).toBeUndefined()
  })
})

describe("runtimePkgManager", () => {
  it("extracts the winget id from Node's Windows upgrade command", () => {
    expect(runtimePkgManager(findRuntime("node")!, "win")).toEqual({
      manager: "winget",
      id: "OpenJS.NodeJS.LTS",
    })
  })

  it("uses Python's winget FAMILY id (not the pinned minor) so any 3.x install matches", () => {
    // winget ships each Python minor as its own package; the ownership check +
    // update must match the family (Python.Python.3), not the pinned install
    // version (…3.13), or a winget-installed 3.14 reads as unmanaged.
    const pm = runtimePkgManager(findRuntime("python")!, "win")
    expect(pm).toEqual({ manager: "winget", id: "Python.Python.3" })
    expect(pm!.id).not.toContain("3.13")
  })

  it("extracts the brew formula from Python's macOS upgrade command", () => {
    expect(runtimePkgManager(findRuntime("python")!, "mac")).toEqual({
      manager: "brew",
      id: "python",
    })
  })

  it("is undefined for self-updating runtimes (bun/uv) — no package manager owns them", () => {
    expect(runtimePkgManager(findRuntime("bun")!, "win")).toBeUndefined()
    expect(runtimePkgManager(findRuntime("uv")!, "mac")).toBeUndefined()
  })

  it("is undefined where a runtime has no update path on this OS (Node on Linux)", () => {
    expect(runtimePkgManager(findRuntime("node")!, "linux")).toBeUndefined()
  })

  it("only winget/brew-managed runtimes carry a downloadUrl fallback", () => {
    // node/python (winget/brew) need the download-link fallback; bun/uv self-update.
    expect(findRuntime("node")!.downloadUrl).toMatch(/^https?:\/\//)
    expect(findRuntime("python")!.downloadUrl).toMatch(/^https?:\/\//)
  })
})
