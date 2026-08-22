import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import { preflight, sortNotes, TONE_ORDER, type PreflightNote } from "./preflight"
import { buildInventory, emptyInventory, type InventoryInput } from "./inventory"
import type { Plan, StepDescriptor } from "./types"

const p = en.preflight

const cmd = (id: string, over: Partial<Extract<StepDescriptor, { kind: "command" }>> = {}) =>
  ({
    kind: "command",
    id,
    label: id,
    command: { file: "npm", args: ["i", "-g", id] },
    ...over,
  }) as StepDescriptor

const info = (id: string, over: { manual?: boolean; lines?: string[]; label?: string } = {}) =>
  ({
    kind: "info",
    id,
    label: over.label ?? id,
    lines: over.lines ?? ["because reasons"],
    manual: over.manual,
  }) as StepDescriptor

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
    networkProbe: { directOk: true, bestProxy: null },
    paths: null,
    ...over,
  })

const brief = (steps: StepDescriptor[], over: Partial<InventoryInput> = {}, pl = plan()) =>
  preflight(en, steps, { plan: pl, inventory: inventoryOf(over) })

const ids = (notes: readonly PreflightNote[]) => notes.map((n) => n.id)

describe("nothing to say", () => {
  it("says nothing about a plain run", () => {
    const report = brief([cmd("cli-claude-code")])
    expect(report.notes).toEqual([])
    expect(report.verdict).toBe("ready")
    expect(report.changeCount).toBe(1)
  })

  it("counts the steps it was handed, not the ones it commented on", () => {
    expect(brief([cmd("a"), cmd("b"), cmd("c")]).changeCount).toBe(3)
    expect(brief([]).changeCount).toBe(0)
  })
})

describe("things that cannot be done here", () => {
  it("names the item and the reason the step itself recorded", () => {
    // The brief and the log must not tell two stories, so the detail is the
    // step's own line rather than a second explanation written here.
    const step = info("cli-claude-code", {
      label: "Install Claude Code",
      lines: ["Claude Code needs Node 22 or newer; this machine has Node 18.", "Update Node."],
      manual: true,
    })
    const note = brief([step]).notes[0]
    expect(note.tone).toBe("blocked")
    expect(note.title).toBe(p.blockedTitle("Install Claude Code"))
    expect(note.detail).toBe("Claude Code needs Node 22 or newer; this machine has Node 18.")
  })

  it("leaves an informational step that needs nobody alone", () => {
    expect(brief([info("note")]).notes).toEqual([])
  })

  it("does not veto the rest of the run", () => {
    // One impossible item must not read as "you cannot install anything" — the
    // other nine steps are still worth doing, so the verdict is a tone, not a
    // stop, and the count still covers everything staged.
    const report = brief([info("cli-x", { manual: true }), cmd("cli-y"), cmd("cli-z")])
    expect(report.verdict).toBe("blocked")
    expect(report.changeCount).toBe(3)
  })
})

describe("things the machine will do to you", () => {
  it("warns before the operating system asks for a password", () => {
    const report = brief([cmd("a", { requiresElevation: true }), cmd("b")])
    const note = report.notes.find((n) => n.id === "elevation")!
    expect(note.tone).toBe("warn")
    expect(note.detail).toBe(p.elevationDetail(1))
  })

  it("counts every elevated step, so the number matches the prompts", () => {
    const report = brief([
      cmd("a", { requiresElevation: true }),
      cmd("b", { requiresElevation: true }),
    ])
    expect(report.notes.find((n) => n.id === "elevation")?.detail).toBe(p.elevationDetail(2))
  })

  it("stays quiet when nothing needs an administrator", () => {
    expect(ids(brief([cmd("a")]).notes)).not.toContain("elevation")
  })
})

describe("the network", () => {
  it("warns when a probe measured that nothing was reachable", () => {
    const report = brief([cmd("a")], { networkProbe: { directOk: false, bestProxy: null } })
    expect(report.notes.find((n) => n.id === "offline")?.tone).toBe("warn")
  })

  it("stays quiet when a proxy works, and when nothing probed", () => {
    // Never measured is not the same as measured and dead, and telling someone
    // their network is down right before they install is a costly thing to
    // guess at.
    expect(
      ids(brief([cmd("a")], { networkProbe: { directOk: false, bestProxy: { url: "p" } } }).notes)
    ).not.toContain("offline")
    expect(ids(brief([cmd("a")], { networkProbe: null }).notes)).not.toContain("offline")
  })
})

describe("keys that are still missing", () => {
  const withKeyedServer = plan({ mcps: [{ id: "context7", targets: ["claude"] }] })

  it("says which server will install and then not answer", () => {
    const report = preflight(en, [cmd("a")], {
      plan: withKeyedServer,
      inventory: inventoryOf(),
    })
    const note = report.notes.find((n) => n.id === "keys")!
    expect(note.tone).toBe("warn")
    expect(note.title).toBe(p.keysTitle(1))
    expect(note.detail).toContain(en.catalog.mcp["context7"].title)
  })

  it("stays quiet once the key is filled in", () => {
    const filled = plan({
      mcps: [{ id: "context7", targets: ["claude"] }],
      mcpKeys: { context7: "sk-x" },
    })
    expect(
      ids(preflight(en, [cmd("a")], { plan: filled, inventory: inventoryOf() }).notes)
    ).not.toContain("keys")
  })

  it("asks for nothing when there is no plan to read", () => {
    expect(ids(preflight(en, [cmd("a")], { inventory: inventoryOf() }).notes)).not.toContain("keys")
  })
})

describe("prerequisites nobody picked", () => {
  it("explains why Node is in a list of things the user never chose", () => {
    const report = brief([cmd("runtime-node", { label: "Install Node.js" }), cmd("mcp-a")])
    const note = report.notes.find((n) => n.id === "prereq-runtime-node")!
    expect(note.tone).toBe("info")
    expect(note.title).toBe(p.prereqTitle("Install Node.js"))
    expect(note.detail).toBe(p.prereqNode)
  })

  it("explains uv the same way, with its own reason", () => {
    const report = brief([cmd("runtime-uv", { label: "Install uv" })])
    expect(report.notes.find((n) => n.id === "prereq-runtime-uv")?.detail).toBe(p.prereqUv)
  })

  it("says it once when the prerequisite is itself something you must do", () => {
    // Reported as a blocker above; a second line saying "we'll install it"
    // would contradict the first.
    const report = brief([info("runtime-node", { manual: true })])
    expect(ids(report.notes)).toEqual(["blocked-runtime-node"])
  })
})

describe("what is being left alone", () => {
  const picked = plan({
    clis: ["claude-code"],
    mcps: [{ id: "context7", targets: ["claude"] }],
    skills: [{ id: "code-review", targets: ["claude"] }],
  })
  const measured = {
    detections: { "claude-code": { installed: true, version: "2.0.0" } },
    scan: scan({
      claudeMcps: { known: ["context7"], custom: [] },
      claudeSkills: { known: ["code-review"], custom: [] },
    }),
  }

  it("counts every kind of selection the machine already has", () => {
    const report = preflight(en, [cmd("a")], {
      plan: picked,
      inventory: inventoryOf(measured),
    })
    expect(report.alreadyCount).toBe(3)
    expect(report.notes.find((n) => n.id === "already")?.title).toBe(p.alreadyTitle(3))
  })

  it("ignores a capability the user unticked", () => {
    // Zero targets is not a selection, and counting it would inflate "already
    // there" with rows nobody asked for.
    const untargeted = plan({ mcps: [{ id: "context7", targets: [] }] })
    const report = preflight(en, [cmd("a")], {
      plan: untargeted,
      inventory: inventoryOf(measured),
    })
    expect(report.alreadyCount).toBe(0)
    expect(ids(report.notes)).not.toContain("already")
  })

  it("claims nothing about a machine that was never measured", () => {
    // Zero would read as "nothing is installed yet", which is the wrong thing
    // to tell someone whose scan simply hasn't landed.
    const report = preflight(en, [cmd("a")], { plan: picked, inventory: emptyInventory() })
    expect(report.alreadyCount).toBeNull()
    expect(ids(report.notes)).not.toContain("already")
  })

  it("claims nothing when there is no plan to compare against", () => {
    expect(preflight(en, [cmd("a")], { inventory: inventoryOf(measured) }).alreadyCount).toBeNull()
  })
})

describe("shape", () => {
  it("ranks worst first and keeps insertion order within a tone", () => {
    const report = brief(
      [
        cmd("runtime-node", { label: "Install Node.js" }),
        cmd("a", { requiresElevation: true }),
        info("cli-x", { manual: true }),
      ],
      { networkProbe: { directOk: false, bestProxy: null } }
    )
    expect(report.notes.map((n) => n.tone)).toEqual(["blocked", "warn", "warn", "info"])
    expect(report.verdict).toBe("blocked")
  })

  it("reports the worst tone present as the verdict", () => {
    expect(brief([cmd("a", { requiresElevation: true })]).verdict).toBe("warn")
    expect(brief([cmd("runtime-node")]).verdict).toBe("info")
    expect(brief([cmd("a")]).verdict).toBe("ready")
  })

  it("gives every note a unique id and a non-empty title", () => {
    const report = brief(
      [
        info("cli-x", { manual: true }),
        info("cli-y", { manual: true }),
        cmd("a", { requiresElevation: true }),
      ],
      { networkProbe: { directOk: false, bestProxy: null } }
    )
    expect(new Set(ids(report.notes)).size).toBe(report.notes.length)
    for (const note of report.notes) expect(note.title.trim()).not.toBe("")
  })

  it("does not mutate the list it sorts", () => {
    const notes: PreflightNote[] = [
      { id: "i", tone: "info", title: "i" },
      { id: "b", tone: "blocked", title: "b" },
    ]
    sortNotes(notes)
    expect(ids(notes)).toEqual(["i", "b"])
    expect([...TONE_ORDER]).toEqual(["blocked", "warn", "info"])
  })

  it("is fully translated", () => {
    const steps = [cmd("a", { requiresElevation: true }), cmd("runtime-node")]
    const args = { plan: plan(), inventory: inventoryOf() }
    const zh = preflight(zhCN, steps, args)
    const eng = preflight(en, steps, args)
    expect(ids(zh.notes)).toEqual(ids(eng.notes))
    for (let i = 0; i < zh.notes.length; i++) {
      expect(zh.notes[i].title).not.toBe(eng.notes[i].title)
      expect(zh.notes[i].title.trim()).not.toBe("")
    }
  })
})
