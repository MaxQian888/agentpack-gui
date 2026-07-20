import { existingSet, findConflicts, pruneSkipped } from "./conflicts"
import type { InstalledSkill, SkillSource } from "./types"

function skill(source: SkillSource, dirName: string): InstalledSkill {
  return {
    source,
    dirName,
    path: `/h/${source}/${dirName}`,
    isSymlink: false,
    linkTarget: null,
    skillMd: `---\nname: ${dirName}\n---\n`,
    modifiedAt: 0,
    origin: null,
  }
}

const installed = [skill("claude", "rust"), skill("agents", "rust"), skill("codex", "python")]

describe("existingSet", () => {
  it("keys every (source, dirName) pair", () => {
    const set = existingSet(installed)
    expect(set.has("claude rust")).toBe(true)
    expect(set.has("agents rust")).toBe(true)
    expect(set.has("codex python")).toBe(true)
    expect(set.has("codex rust")).toBe(false)
  })
})

describe("findConflicts", () => {
  it("returns only the requested targets that already exist", () => {
    const conflicts = findConflicts(
      [{ dirName: "rust", targets: ["claude", "codex", "agents"] }],
      installed
    )
    expect(conflicts).toEqual([
      { dirName: "rust", source: "claude" },
      { dirName: "rust", source: "agents" },
    ])
  })

  it("is empty when nothing overlaps", () => {
    expect(findConflicts([{ dirName: "rust", targets: ["opencode"] }], installed)).toEqual([])
    expect(findConflicts([{ dirName: "brand-new", targets: ["claude"] }], installed)).toEqual([])
  })
})

describe("pruneSkipped", () => {
  it("drops skipped targets and any request left empty", () => {
    const requests = [
      { dirName: "rust", targets: ["claude", "codex", "agents"] as SkillSource[] },
      { dirName: "python", targets: ["codex"] as SkillSource[] },
    ]
    const pruned = pruneSkipped(requests, [
      { dirName: "rust", source: "claude" },
      { dirName: "python", source: "codex" },
    ])
    // rust keeps codex+agents; python had only codex (skipped) so it drops out.
    expect(pruned).toEqual([{ dirName: "rust", targets: ["codex", "agents"] }])
  })

  it("only skips the exact (source, dirName) pair, not the same source elsewhere", () => {
    const requests = [
      { dirName: "rust", targets: ["claude"] as SkillSource[] },
      { dirName: "python", targets: ["claude"] as SkillSource[] },
    ]
    const pruned = pruneSkipped(requests, [{ dirName: "rust", source: "claude" }])
    expect(pruned).toEqual([{ dirName: "python", targets: ["claude"] }])
  })
})
