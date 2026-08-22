import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import {
  buildDiagnostics,
  sortDiagnostics,
  worstSeverity,
  type DiagnosticItem,
} from "./diagnostics"
import { buildInventory, type InventoryInput } from "./inventory"
import type { OS } from "./types"
import { SECTION_KEYS } from "./workspaces"

const healthy = { status: "ok", hasBackup: false } as const

const input = (over: Partial<InventoryInput> = {}): InventoryInput => ({
  scan: { at: 1, degraded: false, claudeSettings: healthy, codexConfig: healthy },
  // A machine with an agent installed and current: the quiet baseline every
  // test below perturbs one thing away from.
  detections: { "claude-code": { installed: true, version: "2.0.0" } },
  latestVersions: {},
  cliManagers: {},
  networkProbe: { directOk: true, bestProxy: null },
  paths: { claudeSettings: "/h/.claude/settings.json", codexConfig: "/h/.codex/config.toml" },
  ...over,
})

/**
 * Findings are read off a folded inventory, never off the raw readings — the
 * same path the overview takes, so a test can't pass through a shape the app
 * never builds.
 */
const build = (over: Partial<InventoryInput> = {}, os: OS = "mac") =>
  buildDiagnostics(en, buildInventory(input(over)), os)
const ids = (items: DiagnosticItem[]) => items.map((i) => i.id)

describe("what counts as a finding", () => {
  it("finds nothing on a healthy machine", () => {
    expect(build()).toEqual([])
  })

  it("says nothing at all before anything has been scanned", () => {
    // "We haven't looked yet" is not a finding, and rendering it as one would
    // make web mode and the first second of startup look broken.
    expect(build({ scan: null })).toEqual([])
  })

  it("leads with a degraded scan, because everything below it may be wrong", () => {
    const items = build({
      scan: { at: 1, degraded: true, claudeSettings: healthy, codexConfig: healthy },
    })
    expect(items[0].id).toBe("scan-degraded")
    expect(items[0].severity).toBe("critical")
    expect(items[0].action.run).toEqual({ kind: "rescan" })
  })

  it("flags having no coding agent at all", () => {
    const items = build({ detections: {} })
    expect(ids(items)).toContain("no-agent")
    expect(items.find((i) => i.id === "no-agent")?.action.run).toEqual({ kind: "openOnboarding" })
  })

  it("counts either agent as enough", () => {
    expect(ids(build({ detections: { codex: { installed: true } } }))).not.toContain("no-agent")
    // Installed-but-not-really doesn't count.
    expect(ids(build({ detections: { codex: { installed: false } } }))).toContain("no-agent")
  })

  it("flags a config that doesn't parse, and offers the backup", () => {
    const items = build({
      scan: {
        at: 1,
        degraded: false,
        claudeSettings: { status: "invalid", hasBackup: true },
        codexConfig: healthy,
      },
    })
    const item = items.find((i) => i.id === "config-claudeSettings")!
    expect(item.severity).toBe("critical")
    expect(item.action.run).toEqual({ kind: "restoreFile", path: "/h/.claude/settings.json" })
  })

  it("offers to open, not to restore, when there is no backup to restore from", () => {
    // A repair button that cannot repair is worse than no button.
    const items = build({
      scan: {
        at: 1,
        degraded: false,
        claudeSettings: { status: "invalid", hasBackup: false },
        codexConfig: healthy,
      },
    })
    expect(items.find((i) => i.id === "config-claudeSettings")?.action.run).toEqual({
      kind: "navigate",
    })
  })

  it("ignores a config that was simply never created", () => {
    // The normal state of a machine that never set that agent up. Flagging it
    // would make the list shout at every new install, forever.
    const items = build({
      scan: {
        at: 1,
        degraded: false,
        claudeSettings: healthy,
        codexConfig: { status: "missing", hasBackup: false },
      },
    })
    expect(ids(items)).not.toContain("config-codexConfig")
  })

  it("flags a config that vanished but left a backup behind", () => {
    const items = build({
      scan: {
        at: 1,
        degraded: false,
        claudeSettings: healthy,
        codexConfig: { status: "missing", hasBackup: true },
      },
    })
    expect(ids(items)).toContain("config-codexConfig")
  })

  it("flags a network that reached nothing at all", () => {
    const items = build({ networkProbe: { directOk: false, bestProxy: null } })
    const item = items.find((i) => i.id === "network-unreachable")!
    expect(item.severity).toBe("warning")
    expect(item.destination).toBe("network")
  })

  it("stays quiet when a proxy works, or when nothing was measured", () => {
    expect(
      ids(build({ networkProbe: { directOk: false, bestProxy: { url: "p" } } }))
    ).not.toContain("network-unreachable")
    // Never measured ≠ measured and dead.
    expect(ids(build({ networkProbe: null }))).not.toContain("network-unreachable")
  })

  it("flags an out-of-date CLI as optional, not as a problem", () => {
    const items = build({
      detections: { "claude-code": { installed: true, version: "1.0.0" } },
      latestVersions: { "claude-code": "2.0.0" },
    })
    const item = items.find((i) => i.id === "upgrade-claude-code")!
    expect(item.severity).toBe("info")
    expect(item.action.run).toEqual({ kind: "upgradeCli", id: "claude-code" })
    expect(item.detail).toBe(en.diagnostics.upgradeFrom("1.0.0"))
  })

  it("refuses to offer a one-click upgrade npm would reject on this Node", () => {
    // claude-code declares an engines.node floor of 22; this machine has 18, so
    // the Upgrade button would stage a command that dies with EBADENGINE. The
    // finding stays — the update is real — but it points at the fix that
    // actually unblocks it.
    const items = build({
      detections: {
        "claude-code": { installed: true, version: "1.0.0" },
        node: { installed: true, version: "v18.19.0" },
      },
      latestVersions: { "claude-code": "2.0.0" },
    })
    const item = items.find((i) => i.id === "upgrade-claude-code")!
    expect(item.severity).toBe("warning")
    expect(item.destination).toBe("environment")
    expect(item.action.run).toEqual({ kind: "navigate" })
    expect(item.detail).toBe(en.diagnostics.nodeFloorDetail(22, "v18.19.0"))
  })

  it("keeps the one-click upgrade when Node clears the floor", () => {
    const items = build({
      detections: {
        "claude-code": { installed: true, version: "1.0.0" },
        node: { installed: true, version: "v22.14.0" },
      },
      latestVersions: { "claude-code": "2.0.0" },
    })
    expect(items.find((i) => i.id === "upgrade-claude-code")?.action.run).toEqual({
      kind: "upgradeCli",
      id: "claude-code",
    })
  })

  it("leaves a native install alone, because its upgrade never touches npm", () => {
    const items = build({
      detections: {
        "claude-code": { installed: true, version: "1.0.0" },
        node: { installed: true, version: "v18.19.0" },
      },
      latestVersions: { "claude-code": "2.0.0" },
      cliManagers: { "claude-code": "native" },
    })
    expect(items.find((i) => i.id === "upgrade-claude-code")?.severity).toBe("info")
  })

  it("says nothing about Node when Node itself was never detected", () => {
    // Absent ≠ too old: the plan installs a current LTS when Node is missing.
    const items = build({
      detections: { "claude-code": { installed: true, version: "1.0.0" } },
      latestVersions: { "claude-code": "2.0.0" },
    })
    expect(items.find((i) => i.id === "upgrade-claude-code")?.severity).toBe("info")
  })

  it("ignores a version that isn't actually behind", () => {
    expect(
      ids(
        build({
          detections: { "claude-code": { installed: true, version: "2.0.0" } },
          latestVersions: { "claude-code": "2.0.0" },
        })
      )
    ).toEqual([])
  })
})

describe("shape", () => {
  it("gives every item exactly one action and a real destination", () => {
    const items = build({
      scan: {
        at: 1,
        degraded: true,
        claudeSettings: { status: "invalid", hasBackup: true },
        codexConfig: healthy,
      },
      detections: {},
      latestVersions: { "claude-code": "2.0.0" },
      networkProbe: { directOk: false, bestProxy: null },
    })
    expect(items.length).toBeGreaterThan(2)
    for (const item of items) {
      expect(item.action.label.trim()).not.toBe("")
      expect(SECTION_KEYS).toContain(item.destination)
    }
    // No aggregate "fix everything": across a mixed list there is no honest
    // label for what one button would do.
    expect(ids(items).some((id) => /all|everything/i.test(id))).toBe(false)
  })

  it("ranks blocking findings above optional ones", () => {
    const items = build({
      detections: { "claude-code": { installed: true, version: "1.0.0" } },
      latestVersions: { "claude-code": "2.0.0" },
      networkProbe: { directOk: false, bestProxy: null },
      scan: { at: 1, degraded: true, claudeSettings: healthy, codexConfig: healthy },
    })
    expect(items.map((i) => i.severity)).toEqual(
      [...items.map((i) => i.severity)].sort(
        (a, b) =>
          ["critical", "warning", "info"].indexOf(a) - ["critical", "warning", "info"].indexOf(b)
      )
    )
  })

  it("has unique ids, so React keys and dedup both hold", () => {
    const items = build({
      detections: {},
      scan: { at: 1, degraded: true, claudeSettings: healthy, codexConfig: healthy },
    })
    expect(new Set(ids(items)).size).toBe(items.length)
  })

  it("is fully translated", () => {
    const args = buildInventory(
      input({ detections: {}, networkProbe: { directOk: false, bestProxy: null } })
    )
    const zh = buildDiagnostics(zhCN, args, "mac")
    const eng = buildDiagnostics(en, args, "mac")
    expect(ids(zh)).toEqual(ids(eng))
    for (let i = 0; i < zh.length; i++) {
      expect(zh[i].title).not.toBe(eng[i].title)
      expect(zh[i].title.trim()).not.toBe("")
    }
  })
})

describe("helpers", () => {
  const item = (severity: DiagnosticItem["severity"], id: string): DiagnosticItem => ({
    id,
    severity,
    category: "scan",
    title: id,
    destination: "dashboard",
    action: { label: "x", run: { kind: "rescan" } },
  })

  it("sorts worst-first and keeps insertion order within a severity", () => {
    const sorted = sortDiagnostics([
      item("info", "i1"),
      item("critical", "c1"),
      item("info", "i2"),
      item("warning", "w1"),
      item("critical", "c2"),
    ])
    expect(sorted.map((i) => i.id)).toEqual(["c1", "c2", "w1", "i1", "i2"])
  })

  it("does not mutate its input", () => {
    const items = [item("info", "i"), item("critical", "c")]
    sortDiagnostics(items)
    expect(items.map((i) => i.id)).toEqual(["i", "c"])
  })

  it("reports the worst severity present, and null for a clean list", () => {
    expect(worstSeverity([])).toBeNull()
    expect(worstSeverity([item("info", "i"), item("warning", "w")])).toBe("warning")
    expect(worstSeverity([item("info", "i"), item("critical", "c")])).toBe("critical")
  })
})
