import { indexUpdates, isManaged, rowUpdateTargets, updateQueries } from "./updates"
import type { InstalledSkill, SkillOrigin, SkillRow } from "./types"

const origin: SkillOrigin = {
  repo: "o/r",
  ref: "HEAD",
  relPath: "",
  contentHash: "h1",
  installedAt: 0,
}

function entry(
  over: Partial<InstalledSkill> & { source: InstalledSkill["source"] }
): InstalledSkill {
  return {
    dirName: "x",
    path: `/h/${over.source}/x`,
    isSymlink: false,
    linkTarget: null,
    skillMd: "",
    modifiedAt: 0,
    origin: null,
    ...over,
  }
}

function row(entries: SkillRow["entries"]): SkillRow {
  return {
    dirName: "x",
    name: "x",
    description: undefined,
    entries,
    nameMismatch: false,
    modifiedAt: 0,
  }
}

describe("updateQueries", () => {
  it("collects only origin-bearing entries", () => {
    const r = row({
      claude: entry({ source: "claude", origin }),
      codex: entry({ source: "codex" }),
    })
    expect(updateQueries([r])).toEqual([{ path: "/h/claude/x", origin }])
  })
})

describe("isManaged", () => {
  it("is true when any entry carries an origin", () => {
    expect(isManaged(row({ claude: entry({ source: "claude", origin }) }))).toBe(true)
    expect(isManaged(row({ codex: entry({ source: "codex" }) }))).toBe(false)
  })
})

describe("rowUpdateTargets", () => {
  it("returns the sources whose path has a pending update", () => {
    const r = row({ claude: entry({ source: "claude", origin }) })
    const withUpdate = indexUpdates([
      { path: "/h/claude/x", hasUpdate: true, latestHash: "h2", error: null },
    ])
    expect(rowUpdateTargets(r, withUpdate)).toEqual(["claude"])

    const upToDate = indexUpdates([
      { path: "/h/claude/x", hasUpdate: false, latestHash: "h1", error: null },
    ])
    expect(rowUpdateTargets(r, upToDate)).toEqual([])
  })
})
