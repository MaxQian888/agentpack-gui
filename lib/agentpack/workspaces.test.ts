import {
  definitionOf,
  hasTabs,
  landingSection,
  SECTION_KEYS,
  sectionsOf,
  workspaceOf,
  WORKSPACES,
  type SectionKey,
} from "./workspaces"

/**
 * The union, spelled out by hand. Deriving this from `SECTION_KEYS` would make
 * the coverage test tautological — the point is to catch a section added to the
 * type but never given a home in the rail, which is exactly how a destination
 * becomes unreachable.
 */
const ALL: readonly SectionKey[] = [
  "dashboard",
  "history",
  "management-overview",
  "accounts",
  "quota",
  "analytics",
  "audit",
  "my-account",
  "my-balance",
  "my-usage",
  "my-models",
  "my-security",
  "presets",
  "environment",
  "clis",
  "skills",
  "mcp",
  "network",
  "cleanup",
  "ccswitch",
  "ccconnect",
  "config",
  "about",
]

describe("workspaces", () => {
  it("gives every section exactly one home", () => {
    const seen = new Map<SectionKey, number>()
    for (const w of WORKSPACES) {
      for (const s of w.sections) seen.set(s, (seen.get(s) ?? 0) + 1)
    }
    for (const key of ALL) {
      expect(seen.get(key)).toBe(1)
    }
    expect(seen.size).toBe(ALL.length)
  })

  it("keeps SECTION_KEYS in rail order and complete", () => {
    expect([...SECTION_KEYS].sort()).toEqual([...ALL].sort())
    expect(SECTION_KEYS[0]).toBe("dashboard")
    expect(SECTION_KEYS.length).toBe(ALL.length)
  })

  it("resolves each section back to its workspace", () => {
    expect(workspaceOf("dashboard")).toBe("overview")
    expect(workspaceOf("network")).toBe("install")
    expect(workspaceOf("ccconnect")).toBe("capabilities")
    expect(workspaceOf("quota")).toBe("management")
    expect(workspaceOf("my-balance")).toBe("account")
    expect(workspaceOf("history")).toBe("usage")
    expect(workspaceOf("about")).toBe("settings")
  })

  it("round-trips: every section's workspace lists it", () => {
    for (const key of ALL) {
      expect(sectionsOf(workspaceOf(key))).toContain(key)
    }
  })

  it("lands on the first section of a workspace", () => {
    for (const w of WORKSPACES) {
      expect(landingSection(w.key)).toBe(w.sections[0])
      expect(w.sections.length).toBeGreaterThan(0)
    }
  })

  it("draws a tab strip only where there is something to switch between", () => {
    expect(hasTabs("overview")).toBe(false)
    expect(hasTabs("usage")).toBe(false)
    expect(hasTabs("install")).toBe(true)
    expect(hasTabs("capabilities")).toBe(true)
    expect(hasTabs("management")).toBe(true)
    expect(hasTabs("account")).toBe(true)
    expect(hasTabs("settings")).toBe(true)
  })

  it("falls back to a real workspace for an unknown key", () => {
    expect(definitionOf("nope" as never).key).toBe("overview")
    expect(workspaceOf("nope" as never)).toBe("overview")
  })

  it("keeps the personal and management packages in separate domains", () => {
    // The whole point of the restructure. If this grows back past six, the
    // rail has drifted into being a section list again.
    expect(WORKSPACES.map((w) => w.key)).toEqual([
      "overview",
      "install",
      "capabilities",
      "account",
      "management",
      "usage",
      "settings",
    ])
  })
})
