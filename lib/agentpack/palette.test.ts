import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import { buildPalette, filterPalette, navigateTo, type PaletteItem } from "./palette"
import { SECTION_KEYS, WORKSPACES } from "./workspaces"

const build = (pendingChanges = 0) => buildPalette(en, { pendingChanges })

const ids = (items: PaletteItem[]) => items.map((i) => i.id)

describe("buildPalette", () => {
  it("lists every workspace as a destination", () => {
    const items = build()
    for (const w of WORKSPACES) {
      expect(ids(items)).toContain(`go:${w.key}`)
    }
  })

  it("also lists the individual sections, so old muscle memory still works", () => {
    // Someone who has used the app for months types "MCP", not "Capabilities".
    // Both have to land, or the restructure costs the experienced user their
    // fastest route.
    const items = build()
    expect(ids(items)).toContain("go:section:mcp")
    expect(filterPalette(items, en.menu.mcp).length).toBeGreaterThan(0)
  })

  it("does not list a single-section workspace twice under two names", () => {
    // Usage IS the history section; two rows for one destination is noise.
    const items = build()
    expect(ids(items)).toContain("go:usage")
    expect(ids(items)).not.toContain("go:section:history")
    expect(ids(items)).not.toContain("go:section:dashboard")
  })

  it("resolves each destination to a real section", () => {
    for (const item of build()) {
      if (item.action.kind !== "navigate") continue
      expect(SECTION_KEYS).toContain(item.action.section)
    }
  })

  it("offers review only when something is actually staged", () => {
    expect(ids(build(0))).not.toContain("action:review")
    const staged = build(3)
    expect(ids(staged)).toContain("action:review")
    expect(staged.find((i) => i.id === "action:review")?.label).toBe(en.palette.reviewCount(3))
  })

  it("offers the running run instead of a review that would be refused", () => {
    const items = buildPalette(en, { pendingChanges: 3, running: true })
    expect(ids(items)).toContain("action:show-run")
    expect(ids(items)).not.toContain("action:review")
  })

  it("is fully translated — no key falls back to English", () => {
    const zh = buildPalette(zhCN, { pendingChanges: 1 })
    expect(ids(zh)).toEqual(ids(build(1)))
    for (const item of zh) expect(item.label.trim()).not.toBe("")
  })

  it("indexes destinations and actions only — never content", () => {
    // The privacy line. Chat transcripts, config bodies and MCP keys all live a
    // couple of modules away; a palette that reached them would turn "find the
    // network page" into a way to read someone's keys off their own screen.
    for (const item of build(1)) {
      expect(item.id).toMatch(/^(go|action):/)
    }
  })
})

describe("filterPalette", () => {
  const items = build(2)

  it("returns everything for an empty or whitespace query", () => {
    expect(filterPalette(items, "")).toEqual(items)
    expect(filterPalette(items, "   ")).toEqual(items)
  })

  it("matches case-insensitively on the label", () => {
    expect(ids(filterPalette(items, "OVERVIEW"))).toContain("go:overview")
  })

  it("matches the hint too, so a symptom finds the place", () => {
    // "cost" is in Usage's description, not its name.
    expect(ids(filterPalette(items, "cost"))).toContain("go:usage")
  })

  it("requires every term, so a second word narrows rather than widens", () => {
    const one = filterPalette(items, "install")
    const two = filterPalette(items, "install repair")
    expect(two.length).toBeLessThanOrEqual(one.length)
    expect(ids(two)).toContain("go:install")
  })

  it("keeps the original order, so rows don't reshuffle under the cursor", () => {
    const filtered = filterPalette(items, "a")
    const order = items.filter((i) => filtered.includes(i))
    expect(ids(filtered)).toEqual(ids(order))
  })

  it("returns nothing rather than a confident wrong guess", () => {
    // Not fuzzy on purpose: Enter on a wrong row navigates somewhere the user
    // didn't ask for.
    expect(filterPalette(items, "zzzzz")).toEqual([])
  })
})

describe("navigateTo", () => {
  it("pairs a section with the workspace that owns it", () => {
    expect(navigateTo("mcp")).toEqual({
      kind: "navigate",
      workspace: "capabilities",
      section: "mcp",
    })
  })
})
