import {
  batchActions,
  batchFor,
  batchKeyOf,
  groupInbox,
  inboxSummary,
  MIN_BATCH,
  selectableIds,
} from "./inbox"
import {
  CATEGORY_ORDER,
  type DiagnosticAction,
  type DiagnosticCategory,
  type DiagnosticItem,
  type DiagnosticSeverity,
} from "./diagnostics"

const item = (
  id: string,
  over: Partial<DiagnosticItem> & { run?: DiagnosticAction } = {}
): DiagnosticItem => ({
  id,
  severity: over.severity ?? "info",
  category: over.category ?? "dependency",
  title: over.title ?? id,
  detail: over.detail,
  destination: over.destination ?? "clis",
  action: over.action ?? { label: "Upgrade", run: over.run ?? { kind: "upgradeCli", id } },
})

const upgrade = (id: string, over: Partial<DiagnosticItem> = {}) => item(id, over)
const restore = (id: string, path = `/h/${id}`) =>
  item(id, {
    category: "config",
    severity: "critical",
    action: { label: "Restore", run: { kind: "restoreFile", path } },
  })
const navigate = (id: string, category: DiagnosticCategory = "network") =>
  item(id, { category, action: { label: "Open", run: { kind: "navigate" } } })

describe("what can be batched", () => {
  it("reads the action, never the item's topic", () => {
    // The two findings below both say "an update is out". One of them is really
    // a navigate — npm would refuse the upgrade on this machine's Node — and
    // sweeping it into an upgrade batch would stage a command already known to
    // fail. Keying off the action is what keeps them apart.
    expect(batchKeyOf(upgrade("upgrade-claude-code"))).toBe("upgrade-cli")
    expect(
      batchKeyOf(
        item("upgrade-claude-code", {
          action: { label: "Open Runtimes", run: { kind: "navigate" } },
        })
      )
    ).toBeUndefined()
  })

  it("batches restores, and nothing that is merely navigation", () => {
    expect(batchKeyOf(restore("config-claudeSettings"))).toBe("restore-config")
    expect(batchKeyOf(navigate("network-unreachable"))).toBeUndefined()
    expect(batchKeyOf(item("x", { run: { kind: "rescan" } }))).toBeUndefined()
    expect(batchKeyOf(item("x", { run: { kind: "openOnboarding" } }))).toBeUndefined()
  })

  it("offers a tick box only where a batch could happen", () => {
    const items = [upgrade("a"), restore("b"), navigate("c")]
    expect(selectableIds(items)).toEqual(new Set(["a", "b"]))
  })
})

describe("grouping", () => {
  it("keeps each group in the order it was given, which is severity order", () => {
    const items = [
      item("crit", { category: "config", severity: "critical" }),
      item("warn", { category: "config", severity: "warning" }),
      item("info", { category: "config", severity: "info" }),
    ]
    expect(groupInbox(items)[0].items.map((i) => i.id)).toEqual(["crit", "warn", "info"])
  })

  it("leads a group with its worst severity", () => {
    const items = [item("a", { category: "config", severity: "info" }), restore("b")]
    expect(groupInbox(items)[0].severity).toBe("critical")
  })

  it("emits categories in the fixed order, whatever order the items arrived in", () => {
    const items = [navigate("n", "network"), item("d"), item("s", { category: "scan" })]
    expect(groupInbox(items).map((g) => g.category)).toEqual(["scan", "dependency", "network"])
  })

  it("never emits a category with nothing in it", () => {
    // Eight empty headers read as eight problems. `usage` and `disk` have no
    // producer at all yet, and must not show up as filters over nothing.
    const groups = groupInbox([item("d")])
    expect(groups).toHaveLength(1)
    expect(groups.map((g) => g.category)).not.toContain("usage")
    expect(groupInbox([])).toEqual([])
  })

  it("suggests a batch only once there are two of a kind", () => {
    // A batch of one is the row's own button under a second name.
    expect(groupInbox([upgrade("a")])[0].batches).toEqual([])
    const two = groupInbox([upgrade("a"), upgrade("b")])[0].batches
    expect(two).toHaveLength(1)
    expect(two[0].key).toBe("upgrade-cli")
    expect(two[0].items.map((i) => i.id)).toEqual(["a", "b"])
  })

  it("keeps two different kinds in the same category as separate batches", () => {
    const items = [
      item("u1", { category: "config" }),
      item("u2", { category: "config" }),
      restore("r1"),
      restore("r2"),
    ]
    const batches = groupInbox(items)[0].batches
    expect(batches.map((b) => b.key)).toEqual(["upgrade-cli", "restore-config"])
  })
})

describe("what a selection amounts to", () => {
  const items = [upgrade("a"), upgrade("b"), restore("c"), navigate("d")]

  it("is a batch when the picks share one action kind", () => {
    const batch = batchFor(items, new Set(["a", "b"]))!
    expect(batch.key).toBe("upgrade-cli")
    expect(batch.items.map((i) => i.id)).toEqual(["a", "b"])
  })

  it("keeps list order, not the order they were ticked in", () => {
    // The preview reads top to bottom; a batch ordered by click would not match
    // the list the user assembled it from.
    expect(batchFor(items, new Set(["b", "a"]))!.items.map((i) => i.id)).toEqual(["a", "b"])
  })

  it("is nothing at all when two kinds are mixed", () => {
    // There is no single sentence for "upgrade this and restore that", so there
    // is no button — rather than a button that describes half of what it does.
    expect(batchFor(items, new Set(["a", "c"]))).toBeNull()
  })

  it("is nothing when an unbatchable item is in the selection", () => {
    expect(batchFor(items, new Set(["a", "b", "d"]))).toBeNull()
  })

  it("needs two, because one is what the row's own button already does", () => {
    expect(batchFor(items, new Set(["a"]))).toBeNull()
    expect(batchFor(items, new Set())).toBeNull()
    expect(MIN_BATCH).toBe(2)
  })

  it("is nothing when a tick refers to a finding that is no longer listed", () => {
    // A rescan drops findings. Running the two that survived under a label that
    // counted three would be the button lying about what it did.
    expect(batchFor(items, new Set(["a", "b", "gone"]))).toBeNull()
  })

  it("hands back the actions as data, in list order", () => {
    const batch = batchFor(items, new Set(["a", "b"]))!
    expect(batchActions(batch)).toEqual([
      { kind: "upgradeCli", id: "a" },
      { kind: "upgradeCli", id: "b" },
    ])
  })
})

describe("summary", () => {
  it("counts every severity, including the zeroes", () => {
    const summary = inboxSummary([restore("a"), navigate("b"), item("c")])
    expect(summary.total).toBe(3)
    expect(summary.bySeverity).toEqual({ critical: 1, warning: 0, info: 2 })
    expect(summary.worst).toBe("critical")
  })

  it("reports no worst severity for a clean list", () => {
    expect(inboxSummary([])).toEqual({
      total: 0,
      bySeverity: { critical: 0, warning: 0, info: 0 },
      worst: null,
    })
  })

  it("falls back to the next severity down when the worst is absent", () => {
    expect(inboxSummary([navigate("b")]).worst).toBe("info")
    expect(inboxSummary([item("w", { severity: "warning" })]).worst).toBe("warning")
  })
})

describe("vocabulary", () => {
  it("orders every category exactly once", () => {
    // A category added to the union without a place in the order would never be
    // grouped, and its findings would silently vanish from the inbox.
    const seen = new Set<DiagnosticCategory>(CATEGORY_ORDER)
    expect(seen.size).toBe(CATEGORY_ORDER.length)
    expect([...CATEGORY_ORDER].sort()).toEqual([
      "capability",
      "config",
      "dependency",
      "disk",
      "network",
      "provider",
      "scan",
      "usage",
    ])
  })

  it("groups a finding of every severity without dropping any", () => {
    const severities: DiagnosticSeverity[] = ["critical", "warning", "info"]
    const items = severities.map((severity, i) => item(`s${i}`, { severity }))
    expect(groupInbox(items)[0].items).toHaveLength(3)
  })
})
