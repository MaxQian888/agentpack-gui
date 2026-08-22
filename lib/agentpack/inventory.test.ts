import {
  ASSET_KINDS,
  assetId,
  assetsOfKind,
  buildInventory,
  CONFIG_ASSET_IDS,
  countByStatus,
  driftFrom,
  emptyInventory,
  findAsset,
  findCatalogAsset,
  INVENTORY_VERSION,
  NETWORK_ASSET_ID,
  STATUS_ORDER,
  upgradeAvailable,
  worstStatus,
  type Asset,
  type AssetStatus,
  type InventoryInput,
  type InventoryScan,
} from "./inventory"
import { CLI_TOOLS, RUNTIMES } from "./registry"

const healthy = { status: "ok", hasBackup: false } as const

const scanOf = (over: Partial<InventoryScan> = {}): InventoryScan => ({
  at: 1_700_000_000_000,
  degraded: false,
  claudeSettings: healthy,
  codexConfig: healthy,
  ...over,
})

/**
 * A machine with one agent installed, both configs parsing and the network up:
 * the quiet baseline every test below perturbs one thing away from.
 */
const input = (over: Partial<InventoryInput> = {}): InventoryInput => ({
  scan: scanOf(),
  detections: { "claude-code": { installed: true, version: "2.0.0" } },
  latestVersions: {},
  cliManagers: {},
  networkProbe: { directOk: true, bestProxy: null },
  paths: { claudeSettings: "/h/.claude/settings.json", codexConfig: "/h/.codex/config.toml" },
  ...over,
})

const fold = (over: Partial<InventoryInput> = {}) => buildInventory(input(over))
const ids = (assets: readonly Asset[]) => assets.map((a) => a.id)

describe("what becomes an asset", () => {
  it("folds an installed CLI and leaves out one that isn't there", () => {
    const inv = fold({
      detections: {
        "claude-code": { installed: true, version: "2.0.0" },
        codex: { installed: false },
      },
    })
    expect(findAsset(inv, "agent:claude-code")?.version).toBe("2.0.0")
    // Not installed is not an asset. The registry says what *could* be here;
    // an inventory says what a reading found.
    expect(findAsset(inv, "agent:codex")).toBeUndefined()
  })

  it("records how a CLI got here, when that was determined", () => {
    const inv = fold({ cliManagers: { "claude-code": "native" } })
    expect(findAsset(inv, "agent:claude-code")?.installedVia).toBe("native")
    // Unknown stays unknown rather than defaulting to a plausible-looking npm.
    expect(fold().assets.find((a) => a.id === "agent:claude-code")?.installedVia).toBeUndefined()
  })

  it("marks a CLI with a newer version available as needing attention", () => {
    const inv = fold({ latestVersions: { "claude-code": "3.0.0" } })
    const asset = findAsset(inv, "agent:claude-code")!
    expect(asset.health.status).toBe("attention")
    expect(asset.latestVersion).toBe("3.0.0")
  })

  it("leaves a current CLI healthy, even with a latest version on file", () => {
    expect(fold({ latestVersions: { "claude-code": "2.0.0" } }).assets[0].health.status).toBe(
      "healthy"
    )
  })

  it("folds runtimes under their own kind", () => {
    const inv = fold({
      detections: { node: { installed: true, version: "v22.14.0" } },
    })
    const node = findAsset(inv, "runtime:node")!
    expect(node.kind).toBe("runtime")
    expect(node.catalogId).toBe("node")
    expect(node.version).toBe("v22.14.0")
  })

  it("treats a detection as a verification, because it ran the binary", () => {
    const inv = fold()
    expect(findAsset(inv, "agent:claude-code")?.health.verifiedAt).toBe(scanOf().at)
  })
})

describe("config files", () => {
  it("keeps a config that parses, and dates it", () => {
    const asset = findAsset(fold(), assetId("config", "claudeSettings"))!
    expect(asset.health.status).toBe("healthy")
    expect(asset.path).toBe("/h/.claude/settings.json")
    expect(asset.health.verifiedAt).toBe(scanOf().at)
  })

  it("calls a config that doesn't parse broken", () => {
    const inv = fold({ scan: scanOf({ claudeSettings: { status: "invalid", hasBackup: true } }) })
    expect(findAsset(inv, "config:claudeSettings")?.health.status).toBe("broken")
  })

  it("ignores a config that was simply never created", () => {
    // The normal state of a machine that never set that agent up. An asset row
    // for it would make every new machine look half-broken.
    const inv = fold({ scan: scanOf({ codexConfig: { status: "missing", hasBackup: false } }) })
    expect(findAsset(inv, "config:codexConfig")).toBeUndefined()
  })

  it("keeps a config that vanished but left a backup behind", () => {
    const inv = fold({ scan: scanOf({ codexConfig: { status: "missing", hasBackup: true } }) })
    const asset = findAsset(inv, "config:codexConfig")!
    expect(asset.health.status).toBe("attention")
    // Nothing was exercised — there was no file left to open.
    expect(asset.health.verifiedAt).toBeUndefined()
  })

  it("claims a rollback only when there is both a backup and somewhere to put it", () => {
    const withBackup = fold({
      scan: scanOf({ claudeSettings: { status: "invalid", hasBackup: true } }),
    })
    expect(findAsset(withBackup, "config:claudeSettings")?.restorePoint).toBe(
      "/h/.claude/settings.json"
    )

    const noBackup = fold({
      scan: scanOf({ claudeSettings: { status: "invalid", hasBackup: false } }),
    })
    expect(findAsset(noBackup, "config:claudeSettings")?.restorePoint).toBeUndefined()

    // A backup with no known path is not a restore either: there is nowhere to
    // write it back to.
    const noPath = fold({
      scan: scanOf({ claudeSettings: { status: "invalid", hasBackup: true } }),
      paths: null,
    })
    expect(findAsset(noPath, "config:claudeSettings")?.restorePoint).toBeUndefined()
  })

  it("folds the two config files in a fixed order", () => {
    const configs = assetsOfKind(fold(), "config")
    expect(configs.map((a) => a.id)).toEqual(CONFIG_ASSET_IDS.map((k) => assetId("config", k)))
  })
})

describe("declared capabilities", () => {
  const scan = scanOf({
    claudeMcps: { known: ["context7"], custom: ["my-server"] },
    codexMcps: { known: ["context7"], custom: [] },
    opencodeMcps: { known: [], custom: [] },
    claudeSkills: { known: ["skill-a"], custom: [] },
    codexSkills: { known: ["skill-a"], custom: [] },
  })

  it("declares a server healthy but never claims it was verified", () => {
    // The config names it and parses. Nothing tried to start it — and a green
    // tick that means "a JSON file mentions this" is a lie the user acts on.
    const asset = findAsset(fold({ scan }), "mcp:context7")!
    expect(asset.health.status).toBe("healthy")
    expect(asset.health.verifiedAt).toBeUndefined()
    expect(asset.health.evidence.source).toBe("scan")
  })

  it("gives one asset per id carrying every agent it is declared in", () => {
    // One row per (agent, id) pair would triple-count anything installed
    // everywhere, and make any total drawn from this list wrong.
    const inv = fold({ scan })
    expect(findAsset(inv, "mcp:context7")?.targets).toEqual(["claude", "codex"])
    expect(findAsset(inv, "skill:skill-a")?.targets).toEqual(["claude", "codex"])
    expect(assetsOfKind(inv, "mcp")).toHaveLength(2)
  })

  it("separates what the catalog knows from what the user added", () => {
    const inv = fold({ scan })
    const known = findAsset(inv, "mcp:context7")!
    expect(known.catalogId).toBe("context7")
    expect(known.name).toBeUndefined()

    const custom = findAsset(inv, "mcp:my-server")!
    expect(custom.catalogId).toBeUndefined()
    // A hand-added id is the user's own text, so it travels as data.
    expect(custom.name).toBe("my-server")
  })

  it("lists catalog entries before user-added ones, alphabetically within each", () => {
    const inv = fold({
      scan: scanOf({
        claudeMcps: { known: ["zeta", "alpha"], custom: ["beta"] },
      }),
    })
    expect(ids(assetsOfKind(inv, "mcp"))).toEqual(["mcp:alpha", "mcp:zeta", "mcp:beta"])
  })

  it("folds nothing when a scan didn't report that surface at all", () => {
    expect(assetsOfKind(fold(), "mcp")).toEqual([])
    expect(assetsOfKind(fold(), "skill")).toEqual([])
  })
})

describe("providers carry no credential material", () => {
  const providers = [
    {
      id: "p1",
      name: "My relay",
      app_type: "claude",
      is_current: true,
      // The real row also carries this. Nothing here is allowed to copy it.
      settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-secret-value" } }),
    },
  ]

  it("keeps the four fields it needs and drops the rest", () => {
    const asset = findAsset(fold({ scan: scanOf({ providers }) }), "provider:p1")!
    expect(asset.name).toBe("My relay")
    expect(asset.targets).toEqual(["claude"])
    expect(asset.scope).toBe("global")
  })

  it("never lets a token reach the model, at any depth", () => {
    // This model is the input to the profile and export formats, so a field
    // copied carelessly here becomes a credential in a file the user mails to
    // another machine. Serializing the whole inventory is the only check that
    // stays true when a field is added later.
    const inv = fold({ scan: scanOf({ providers }) })
    expect(JSON.stringify(inv)).not.toContain("sk-secret-value")
    expect(JSON.stringify(inv)).not.toContain("settings_config")
  })
})

describe("the network reading", () => {
  it("is healthy when the machine got out directly", () => {
    expect(findAsset(fold(), NETWORK_ASSET_ID)?.health.status).toBe("healthy")
  })

  it("is healthy when only a proxy got out", () => {
    const inv = fold({ networkProbe: { directOk: false, bestProxy: { url: "p" } } })
    expect(findAsset(inv, NETWORK_ASSET_ID)?.health.status).toBe("healthy")
  })

  it("is broken when a probe reached nothing at all", () => {
    const inv = fold({ networkProbe: { directOk: false, bestProxy: null } })
    expect(findAsset(inv, NETWORK_ASSET_ID)?.health.status).toBe("broken")
  })

  it("is absent when nothing probed, because that is not a failure", () => {
    // Never measured ≠ measured and dead. An `unknown` row here would put a
    // finding on the overview of every machine during startup.
    expect(findAsset(fold({ networkProbe: null }), NETWORK_ASSET_ID)).toBeUndefined()
  })
})

describe("measured, degraded and dated", () => {
  it("says it hasn't looked when no scan has landed", () => {
    const inv = fold({ scan: null })
    expect(inv.measured).toBe(false)
    expect(inv.at).toBe(0)
  })

  it("still folds the readings it does have without a scan", () => {
    // The detections are real. What `measured: false` forbids is reading the
    // *absence* of a scanned asset as its absence from the machine.
    const inv = fold({ scan: null })
    expect(findAsset(inv, "agent:claude-code")).toBeDefined()
    expect(assetsOfKind(inv, "config")).toEqual([])
  })

  it("carries a degraded scan forward, because every count below it may be short", () => {
    expect(fold({ scan: scanOf({ degraded: true }) }).degraded).toBe(true)
    expect(fold().degraded).toBe(false)
  })

  it("dates every observation from the pass that took it", () => {
    const inv = fold()
    expect(inv.at).toBe(scanOf().at)
    for (const asset of inv.assets) expect(asset.health.evidence.at).toBe(inv.at)
  })

  it("lets a caller date the fold explicitly", () => {
    expect(fold({ at: 42 }).at).toBe(42)
    expect(buildInventory(input({ scan: null, at: 42 })).at).toBe(42)
  })

  it("stamps its schema version, so a stored inventory can be migrated", () => {
    expect(fold().version).toBe(INVENTORY_VERSION)
    expect(emptyInventory()).toEqual({
      version: INVENTORY_VERSION,
      at: 0,
      degraded: false,
      measured: false,
      assets: [],
    })
  })

  it("folds the same machine into the same list twice", () => {
    // A rescan that reshuffles rows under the cursor is worse than no rescan.
    const args = input({
      scan: scanOf({ claudeMcps: { known: ["b", "a"], custom: ["z"] } }),
      detections: {
        codex: { installed: true, version: "1.0.0" },
        "claude-code": { installed: true, version: "2.0.0" },
        node: { installed: true, version: "v22.0.0" },
      },
    })
    expect(buildInventory(args)).toEqual(buildInventory(args))
    // Registry order, not the order the detections happened to be keyed in.
    const cliIds = CLI_TOOLS.map((t) => t.id)
    const folded = buildInventory(args)
      .assets.filter((a) => a.kind === "agent" || a.kind === "companion")
      .map((a) => a.catalogId!)
    expect(folded).toEqual(cliIds.filter((id) => folded.includes(id)))
  })
})

describe("helpers", () => {
  it("builds an id from a kind and a local id", () => {
    expect(assetId("mcp", "context7")).toBe("mcp:context7")
  })

  it("finds a catalog asset without the caller knowing its kind", () => {
    // "claude-code" is an `agent` and "cc-switch" a `companion`; a caller that
    // knows the registry id shouldn't have to know which.
    const inv = fold({
      detections: {
        "claude-code": { installed: true, version: "2.0.0" },
        "cc-switch": { installed: true, version: "1.0.0" },
      },
    })
    expect(findCatalogAsset(inv, "claude-code")?.kind).toBe("agent")
    expect(findCatalogAsset(inv, "cc-switch")?.kind).toBe("companion")
    expect(findCatalogAsset(inv, "nothing-here")).toBeUndefined()
  })

  it("counts every status, including the zeroes", () => {
    const inv = fold({
      latestVersions: { "claude-code": "3.0.0" },
      networkProbe: { directOk: false, bestProxy: null },
    })
    expect(countByStatus(inv)).toEqual({
      broken: 1, // the network
      attention: 1, // the upgradable CLI
      unknown: 0,
      healthy: 2, // both config files
    })
  })

  it("reports the worst status present, and null for nothing at all", () => {
    const at = { source: "scan" as const, at: 1 }
    const asset = (status: AssetStatus): Asset => ({
      id: `mcp:${status}`,
      kind: "mcp",
      targets: [],
      health: { status, evidence: at },
    })
    expect(worstStatus([])).toBeNull()
    expect(worstStatus([asset("healthy"), asset("attention")])).toBe("attention")
    expect(worstStatus([asset("attention"), asset("broken")])).toBe("broken")
    // Unknown outranks healthy: "we couldn't look" is not "it's fine".
    expect(worstStatus([asset("healthy"), asset("unknown")])).toBe("unknown")
  })

  it("answers the upgrade question in one place", () => {
    const base: Asset = {
      id: "agent:x",
      kind: "agent",
      targets: [],
      health: { status: "healthy", evidence: { source: "detect", at: 1 } },
    }
    expect(upgradeAvailable({ ...base, version: "1.0.0", latestVersion: "2.0.0" })).toBe(true)
    expect(upgradeAvailable({ ...base, version: "2.0.0", latestVersion: "2.0.0" })).toBe(false)
    // A failed lookup never shows an upgrade.
    expect(upgradeAvailable({ ...base, version: "1.0.0" })).toBe(false)
    expect(upgradeAvailable({ ...base, latestVersion: "2.0.0" })).toBe(false)
  })

  it("keeps its two ordered vocabularies complete", () => {
    // A kind or a status added to the union without a place in the order would
    // sort as -1 and silently lead every list.
    expect([...ASSET_KINDS].sort()).toEqual([
      "agent",
      "companion",
      "config",
      "mcp",
      "network",
      "provider",
      "runtime",
      "skill",
    ])
    expect([...STATUS_ORDER].sort()).toEqual(["attention", "broken", "healthy", "unknown"])
  })

  it("covers every runtime the registry can detect", () => {
    const inv = fold({
      detections: Object.fromEntries(
        RUNTIMES.map((r) => [r.id, { installed: true, version: "1.0.0" }])
      ),
    })
    expect(assetsOfKind(inv, "runtime")).toHaveLength(RUNTIMES.length)
  })
})

describe("drift against a profile", () => {
  it("reports what the profile asked for and the machine doesn't have", () => {
    expect(driftFrom(fold(), [{ id: "agent:codex" }])).toEqual([
      { assetId: "agent:codex", kind: "missing", expected: undefined },
    ])
  })

  it("reports a version that doesn't match the pin", () => {
    expect(driftFrom(fold(), [{ id: "agent:claude-code", version: "3.0.0" }])).toEqual([
      { assetId: "agent:claude-code", kind: "version", expected: "3.0.0", actual: "2.0.0" },
    ])
  })

  it("stays quiet when the pin matches, and when there is no pin", () => {
    expect(driftFrom(fold(), [{ id: "agent:claude-code", version: "2.0.0" }])).toEqual([])
    expect(driftFrom(fold(), [{ id: "agent:claude-code" }])).toEqual([])
  })

  it("counts an unreported version as not matching a pin", () => {
    const inv = fold({ detections: { "claude-code": { installed: true } } })
    expect(driftFrom(inv, [{ id: "agent:claude-code", version: "2.0.0" }])[0]).toMatchObject({
      kind: "version",
      actual: undefined,
    })
  })

  it("ignores assets the profile never mentioned", () => {
    // An inventory holds far more than any one profile describes; reporting the
    // rest as "extra" would bury the real differences.
    expect(driftFrom(fold(), [])).toEqual([])
  })

  it("says nothing at all about a machine it could not read", () => {
    // Every asset would read as missing, and the fix would be to reinstall a
    // machine that is already complete.
    expect(driftFrom(fold({ scan: null }), [{ id: "config:claudeSettings" }])).toEqual([])
  })
})
