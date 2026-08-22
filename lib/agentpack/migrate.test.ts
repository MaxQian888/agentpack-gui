import {
  compareToMachine,
  completeness,
  expectedFrom,
  pendingCredentials,
  type MigrationInput,
} from "./migrate"
import { buildInventory, emptyInventory, type InventoryInput } from "./inventory"
import type { Plan } from "./types"

const plan = (over: Partial<Plan> = {}): Plan => ({
  os: "mac",
  clis: [],
  skills: [],
  mcps: [],
  mcpKeys: {},
  network: { proxy: { mode: "off", targets: [] } },
  ...over,
})

const scan = (over: Partial<NonNullable<InventoryInput["scan"]>> = {}) => ({
  at: 1,
  degraded: false,
  claudeSettings: { status: "ok", hasBackup: false } as const,
  codexConfig: { status: "ok", hasBackup: false } as const,
  ...over,
})

const inventoryOf = (over: Partial<InventoryInput> = {}) =>
  buildInventory({
    scan: scan(),
    detections: {},
    latestVersions: {},
    cliManagers: {},
    networkProbe: null,
    paths: null,
    ...over,
  })

const compare = (over: Partial<MigrationInput> = {}) =>
  compareToMachine({ inventory: inventoryOf(), plan: plan(), ...over })

describe("what a profile expects", () => {
  it("resolves a CLI's kind from the registry, so the id can match an asset", () => {
    // "claude-code" is an agent and "cc-switch" a companion; an id built from a
    // guess at the kind would never match anything in the inventory.
    expect(expectedFrom(plan({ clis: ["claude-code", "cc-switch"] })).map((e) => e.id)).toEqual([
      "agent:claude-code",
      "companion:cc-switch",
    ])
  })

  it("skips a CLI the registry no longer knows rather than guessing its kind", () => {
    expect(expectedFrom(plan({ clis: ["gone-tool" as never] }))).toEqual([])
  })

  it("expects only the capabilities that were actually asked for", () => {
    // Zero targets is not a selection, and expecting it would report a machine
    // as incomplete for something the user unticked.
    const p = plan({
      mcps: [
        { id: "context7", targets: ["claude"] },
        { id: "memory", targets: [] },
      ],
      skills: [{ id: "code-review", targets: [] }],
    })
    expect(expectedFrom(p).map((e) => e.id)).toEqual(["mcp:context7"])
  })
})

describe("comparing a profile against the machine", () => {
  const wanted = plan({
    clis: ["claude-code"],
    mcps: [{ id: "context7", targets: ["claude"] }],
  })

  it("names what the machine is missing", () => {
    const report = compare({ plan: wanted })
    expect(report.missing.map((d) => d.assetId)).toEqual(["agent:claude-code", "mcp:context7"])
    expect(report.satisfied).toBe(0)
    expect(report.expected).toBe(2)
  })

  it("counts what it already has", () => {
    const report = compare({
      plan: wanted,
      inventory: inventoryOf({
        detections: { "claude-code": { installed: true, version: "2.0.0" } },
        scan: scan({ claudeMcps: { known: ["context7"], custom: [] } }),
      }),
    })
    expect(report.missing).toEqual([])
    expect(report.satisfied).toBe(2)
    expect(completeness(report)).toBe(1)
  })

  it("separates a version that doesn't match a pin from an absence", () => {
    const inventory = inventoryOf({
      detections: { "claude-code": { installed: true, version: "1.0.0" } },
    })
    const report = compareToMachine({
      inventory,
      plan: plan({ clis: ["claude-code"] }),
    })
    // No pin in a plan yet, so nothing drifts on version through this path…
    expect(report.versionDrift).toEqual([])
    expect(report.missing).toEqual([])
  })

  it("claims nothing at all about a machine it could not read", () => {
    // Every asset would read as missing, and the fix offered would be to
    // reinstall a machine that is already complete.
    const report = compareToMachine({ inventory: emptyInventory(), plan: wanted })
    expect(report.measured).toBe(false)
    expect(report.missing).toEqual([])
    expect(report.satisfied).toBe(0)
    expect(completeness(report)).toBeNull()
  })

  it("has no ratio for a profile that expects nothing", () => {
    // 100% would say this machine matches a profile nobody has compared it to.
    expect(completeness(compare())).toBeNull()
  })
})

describe("what only a human can supply", () => {
  it("lists a key-gated server the file couldn't carry a key for", () => {
    const report = compare({
      plan: plan({ mcps: [{ id: "context7", targets: ["claude"] }] }),
    })
    expect(report.credentials).toEqual([
      { kind: "mcpKey", owner: "context7", field: "CONTEXT7_API_KEY" },
    ])
  })

  it("stays quiet once the key is there, or when the server wasn't selected", () => {
    expect(
      pendingCredentials({
        plan: plan({
          mcps: [{ id: "context7", targets: ["claude"] }],
          mcpKeys: { context7: "sk-x" },
        }),
      })
    ).toEqual([])
    expect(
      pendingCredentials({
        plan: plan({ mcps: [{ id: "context7", targets: [] }] }),
      })
    ).toEqual([])
  })

  it("asks for a proxy password only when the proxy is actually switched on", () => {
    const withAuth = (mode: "off" | "manual") =>
      pendingCredentials({
        plan: plan({
          network: {
            proxy: { mode, targets: [], httpUrl: "http://p:8080", username: "me" },
          },
        }),
      })
    expect(withAuth("manual")).toEqual([
      { kind: "proxyPassword", owner: "proxy", field: "password" },
    ])
    // An inactive proxy needs no password, so it isn't a chore.
    expect(withAuth("off")).toEqual([])
  })

  it("asks for a client-key passphrase when a certificate came across without one", () => {
    const out = pendingCredentials({
      plan: plan({
        network: {
          proxy: {
            mode: "manual",
            targets: [],
            httpUrl: "http://p:8080",
            clientCertPath: "/h/cert.pem",
          },
        },
      }),
    })
    expect(out).toEqual([{ kind: "proxyPassword", owner: "proxy", field: "clientKeyPassphrase" }])
  })

  it("reads the blanked fields out of the config text the bundle really carries", () => {
    // Derived from the artefact, not from a second copy of the redaction rule:
    // a checklist with its own idea of what is secret drifts in the direction
    // of "we forgot to tell you about this key".
    const out = pendingCredentials({
      plan: plan(),
      files: {
        claudeSettings: JSON.stringify({
          env: { ANTHROPIC_AUTH_TOKEN: "", NOT_A_SECRET: "keep" },
        }),
      },
    })
    expect(out).toEqual([
      { kind: "configField", owner: "claudeSettings", field: "env.ANTHROPIC_AUTH_TOKEN" },
    ])
  })

  it("says nothing for a file that carried no secrets, or none at all", () => {
    expect(
      pendingCredentials({
        plan: plan(),
        files: { claudeSettings: JSON.stringify({ model: "opus" }), codexConfig: "" },
      })
    ).toEqual([])
    expect(pendingCredentials({ plan: plan() })).toEqual([])
  })

  it("gathers every source into one list", () => {
    const report = compare({
      plan: plan({
        mcps: [{ id: "context7", targets: ["claude"] }],
        network: {
          proxy: { mode: "manual", targets: [], httpUrl: "http://p", username: "me" },
        },
      }),
      files: { claudeSettings: JSON.stringify({ env: { API_KEY: "" } }) },
    })
    expect(report.credentials.map((c) => c.kind)).toEqual([
      "mcpKey",
      "proxyPassword",
      "configField",
    ])
  })
})
