import { countsBySource, filterRows, groupSkills, matchRow, sortRows } from "./browse"
import type { InstalledSkill, SkillSource } from "./types"

function skill(
  over: Partial<InstalledSkill> & { source: SkillSource; dirName: string }
): InstalledSkill {
  return {
    path: `/h/${over.source}/${over.dirName}`,
    isSymlink: false,
    linkTarget: null,
    skillMd: `---\nname: ${over.dirName}\ndescription: about ${over.dirName}\n---\nbody`,
    modifiedAt: 0,
    origin: null,
    ...over,
  }
}

describe("groupSkills", () => {
  it("groups the same dir name across sources into one row", () => {
    const rows = groupSkills([
      skill({
        source: "claude",
        dirName: "caveman",
        isSymlink: true,
        linkTarget: "/h/.agents/skills/caveman",
      }),
      skill({ source: "agents", dirName: "caveman" }),
      skill({ source: "codex", dirName: "tauri-v2" }),
    ])
    expect(rows.map((r) => r.dirName)).toEqual(["caveman", "tauri-v2"])
    const caveman = rows[0]
    expect(caveman.entries.claude?.isSymlink).toBe(true)
    expect(caveman.entries.agents).toBeDefined()
    expect(caveman.entries.codex).toBeUndefined()
  })

  it("resolves name/description from the canonical source first", () => {
    const rows = groupSkills([
      skill({ source: "claude", dirName: "x", skillMd: "---\nname: from-claude\n---\n" }),
      skill({
        source: "agents",
        dirName: "x",
        skillMd: "---\nname: from-agents\ndescription: d\n---\n",
      }),
    ])
    expect(rows[0].name).toBe("from-agents")
    expect(rows[0].description).toBe("d")
  })

  it("flags a frontmatter name that differs from the dir name", () => {
    const rows = groupSkills([
      skill({ source: "claude", dirName: "my-dir", skillMd: "---\nname: other-name\n---\n" }),
      skill({ source: "codex", dirName: "match", skillMd: "---\nname: match\n---\n" }),
      skill({ source: "codex", dirName: "bare", skillMd: "no frontmatter" }),
    ])
    expect(rows.find((r) => r.dirName === "my-dir")?.nameMismatch).toBe(true)
    expect(rows.find((r) => r.dirName === "match")?.nameMismatch).toBe(false)
    // No frontmatter falls back to the dir name — not a mismatch.
    expect(rows.find((r) => r.dirName === "bare")?.nameMismatch).toBe(false)
  })

  it("keeps the newest mtime across entries", () => {
    const rows = groupSkills([
      skill({ source: "claude", dirName: "x", modifiedAt: 100 }),
      skill({ source: "codex", dirName: "x", modifiedAt: 300 }),
    ])
    expect(rows[0].modifiedAt).toBe(300)
  })
})

describe("filterRows", () => {
  const rows = groupSkills([
    skill({
      source: "claude",
      dirName: "rust-pro",
      skillMd: "---\nname: rust-pro\ndescription: cargo tooling\n---\n",
    }),
    skill({ source: "codex", dirName: "sql-pro" }),
  ])

  it("filters by agent presence", () => {
    expect(filterRows(rows, "", "codex").map((r) => r.dirName)).toEqual(["sql-pro"])
    expect(filterRows(rows, "", "all")).toHaveLength(2)
  })

  it("matches query against name and description, case-insensitively", () => {
    expect(filterRows(rows, "CARGO", "all").map((r) => r.dirName)).toEqual(["rust-pro"])
    expect(filterRows(rows, "sql", "all").map((r) => r.dirName)).toEqual(["sql-pro"])
    expect(filterRows(rows, "nothing", "all")).toEqual([])
  })

  it("includes rows that match only in the SKILL.md body", () => {
    const bodyRows = groupSkills([
      skill({
        source: "claude",
        dirName: "alpha",
        skillMd: "---\nname: alpha\n---\nmentions webpack",
      }),
      skill({ source: "codex", dirName: "beta", skillMd: "---\nname: beta\n---\nplain" }),
    ])
    expect(filterRows(bodyRows, "webpack", "all").map((r) => r.dirName)).toEqual(["alpha"])
  })
})

describe("matchRow (full-text)", () => {
  const row = groupSkills([
    skill({
      source: "claude",
      dirName: "rust-pro",
      skillMd:
        "---\nname: rust-pro\ndescription: cargo tooling\nwhen_to_use: building firmware\n---\nUse clippy for linting.",
    }),
  ])[0]

  it("treats an empty query as a metadata match", () => {
    expect(matchRow(row, "")).toEqual({ matched: true, contentOnly: false })
  })

  it("does not flag name / description hits as content-only", () => {
    expect(matchRow(row, "cargo")).toEqual({ matched: true, contentOnly: false })
    expect(matchRow(row, "RUST-PRO")).toEqual({ matched: true, contentOnly: false })
  })

  it("flags body / frontmatter-only hits as content-only", () => {
    expect(matchRow(row, "clippy")).toEqual({ matched: true, contentOnly: true })
    expect(matchRow(row, "firmware")).toEqual({ matched: true, contentOnly: true })
  })

  it("reports no match when the query is absent everywhere", () => {
    expect(matchRow(row, "kubernetes")).toEqual({ matched: false, contentOnly: false })
  })
})

describe("sortRows", () => {
  const rows = groupSkills([
    skill({ source: "claude", dirName: "beta", modifiedAt: 100 }),
    skill({ source: "claude", dirName: "alpha", modifiedAt: 200 }),
  ])

  it("sorts by name or by newest-first mtime", () => {
    expect(sortRows(rows, "name").map((r) => r.dirName)).toEqual(["alpha", "beta"])
    expect(sortRows(rows, "modified").map((r) => r.dirName)).toEqual(["alpha", "beta"])
    expect(sortRows(rows, "modified")[0].modifiedAt).toBe(200)
  })

  it("does not mutate the input", () => {
    const input = [...rows]
    sortRows(rows, "modified")
    expect(rows).toEqual(input)
  })
})

describe("countsBySource", () => {
  it("counts installs per source", () => {
    const counts = countsBySource([
      skill({ source: "claude", dirName: "a" }),
      skill({ source: "claude", dirName: "b" }),
      skill({ source: "agents", dirName: "a" }),
    ])
    expect(counts).toEqual({ claude: 2, codex: 0, opencode: 0, agents: 1 })
  })
})
