import { previewLines, commandToString } from "./preview"
import { zhCN } from "@/lib/i18n/zh-CN"
import type { Paths, StepDescriptor } from "./types"

const paths = {
  home: "/h",
  claudeSkillsDir: "/h/.claude/skills",
  codexSkillsDir: "/h/.codex/skills",
} as Paths

it("command preview shows would run", () => {
  const s: StepDescriptor = {
    kind: "command",
    id: "x",
    label: "x",
    command: { file: "npm", args: ["i", "-g", "x"] },
  }
  expect(previewLines(s, paths)).toContain("would run: npm i -g x")
})

it("mergeFile preview shows would write path", () => {
  const s: StepDescriptor = {
    kind: "mergeFile",
    id: "x",
    label: "x",
    path: "/h/.codex/config.toml",
    merge: (e) => e,
    writtenNote: "",
  }
  expect(previewLines(s, paths)).toEqual(["would write /h/.codex/config.toml"])
})

it("quoting wraps args with spaces", () => {
  expect(
    commandToString({ file: "claude", args: ["--header", "Authorization: Bearer k"] })
  ).toContain('"Authorization: Bearer k"')
})

it("info preview returns the lines verbatim", () => {
  const s: StepDescriptor = { kind: "info", id: "i", label: "i", lines: ["a", "b"] }
  expect(previewLines(s, paths)).toEqual(["a", "b"])
})

it("ccVisibleApps preview shows would write", () => {
  const s: StepDescriptor = {
    kind: "ccVisibleApps",
    id: "v",
    label: "v",
    path: "/cfg.json",
    merge: (e) => e,
  }
  expect(previewLines(s, paths)).toEqual(["would write /cfg.json"])
})

it("skillInstall preview maps each target to its skills dir", () => {
  const s: StepDescriptor = {
    kind: "skillInstall",
    id: "s",
    label: "s",
    skillId: "rust",
    targets: ["claude", "codex"],
  }
  const lines = previewLines(s, paths)
  expect(lines).toHaveLength(2)
  expect(lines[0]).toContain("/h/.claude/skills/rust")
  expect(lines[1]).toContain("/h/.codex/skills/rust")
})

it("skillRemove preview lists each dest", () => {
  const s: StepDescriptor = {
    kind: "skillRemove",
    id: "s",
    label: "s",
    skillId: "rust",
    targets: ["claude"],
    dests: ["/h/.claude/skills/rust"],
  }
  expect(previewLines(s, paths)).toEqual(["would delete /h/.claude/skills/rust"])
})

it("ccProvider preview names the op and app", () => {
  const s: StepDescriptor = {
    kind: "ccProvider",
    id: "p",
    label: "p",
    op: "add",
    payload: { app: "claude" },
  }
  expect(previewLines(s, paths)).toEqual(["would add a provider to claude"])
})

it("ccProvider preview tolerates a missing app", () => {
  const s: StepDescriptor = {
    kind: "ccProvider",
    id: "p",
    label: "p",
    op: "delete",
    payload: {},
  }
  expect(previewLines(s, paths)).toEqual(["would remove a provider from "])
})

/**
 * This was the one branch that built its line by hand instead of reading the
 * catalog, so a zh-CN dry run printed English — and printed the internal op
 * verb, `setCurrent`, at that.
 */
it("ccProvider preview is translated like every other kind", () => {
  const s: StepDescriptor = {
    kind: "ccProvider",
    id: "p",
    label: "p",
    op: "setCurrent",
    payload: { app: "claude" },
  }
  expect(previewLines(s, paths, zhCN)).toEqual(["将把 claude 切换到另一个供应商"])
  expect(previewLines(s, paths)[0]).not.toContain("setCurrent")
})

it("fileRestore preview shows would restore from backup", () => {
  const s: StepDescriptor = {
    kind: "fileRestore",
    id: "r",
    label: "r",
    path: "/h/.codex/config.toml",
    backupPath: "/h/.codex/config.toml.agentpack.bak",
  }
  expect(previewLines(s, paths)).toEqual([
    "would restore /h/.codex/config.toml.agentpack.bak -> /h/.codex/config.toml",
  ])
})

it("skillCopy preview shows would copy per dest", () => {
  const s: StepDescriptor = {
    kind: "skillCopy",
    id: "s",
    label: "s",
    srcPath: "/h/.claude/skills/caveman",
    dirName: "caveman",
    targets: ["codex", "opencode"],
    dests: ["/h/.codex/skills/caveman", "/h/.config/opencode/skills/caveman"],
  }
  expect(previewLines(s, paths)).toEqual([
    "would copy /h/.claude/skills/caveman -> /h/.codex/skills/caveman",
    "would copy /h/.claude/skills/caveman -> /h/.config/opencode/skills/caveman",
  ])
})

it("skillRepoInstall preview renders precomputed dests without touching the scan", () => {
  const s: StepDescriptor = {
    kind: "skillRepoInstall",
    id: "r",
    label: "r",
    scanId: "scan-1",
    skills: [{ relPath: "skills/web", dirName: "web" }],
    targets: ["claude"],
    dests: ["/h/.claude/skills/web"],
    repo: "owner/repo",
    ref: "HEAD",
  }
  expect(previewLines(s, paths)).toEqual(["would copy scan-1 -> /h/.claude/skills/web"])
})

it("skillUpdate preview renders precomputed dests from the origin path", () => {
  const s: StepDescriptor = {
    kind: "skillUpdate",
    id: "u",
    label: "u",
    path: "/h/.claude/skills/web",
    dirName: "web",
    targets: ["claude"],
    dests: ["/h/.claude/skills/web"],
    mirrorPrefix: null,
  }
  expect(previewLines(s, paths)).toEqual([
    "would copy /h/.claude/skills/web -> /h/.claude/skills/web",
  ])
})

it("skillBackup preview announces the backup without touching disk", () => {
  const s: StepDescriptor = {
    kind: "skillBackup",
    id: "b",
    label: "b",
    path: "/h/.claude/skills/web",
    dirName: "web",
  }
  expect(previewLines(s, paths)).toEqual(["would back up /h/.claude/skills/web"])
})

it("skillCreate preview lists the SKILL.md dests it would write", () => {
  const s: StepDescriptor = {
    kind: "skillCreate",
    id: "c",
    label: "c",
    name: "web",
    targets: ["claude"],
    content: "---\nname: web\n---\n",
    dests: ["/h/.claude/skills/web"],
  }
  expect(previewLines(s, paths)).toEqual(["would write /h/.claude/skills/web"])
})

/**
 * The two highest-side-effect kinds, and until now the only two with no preview
 * test at all. `releaseInstall` downloads and runs an installer; `snapshot` is
 * the rollback safety net. Dry-run's whole promise is that neither happens.
 */
describe("releaseInstall preview", () => {
  const base = { kind: "releaseInstall", id: "r", label: "r", title: "Claude", os: "mac" } as const

  it("names the GitHub repo it would install from, without resolving it", () => {
    const s: StepDescriptor = {
      ...base,
      source: { kind: "github", repo: "owner/tool", asset: { mac: { pattern: ".*\\.dmg" } } },
      arch: "arm64",
      mirrorPrefix: null,
    }
    expect(previewLines(s, paths)).toEqual([
      "would download the latest Claude release from owner/tool and install it",
    ])
  })

  it("names the mirror when a GitHub download would go through one", () => {
    const s: StepDescriptor = {
      ...base,
      source: { kind: "github", repo: "owner/tool", asset: { mac: { pattern: ".*\\.dmg" } } },
      arch: "arm64",
      mirrorPrefix: "https://gh-proxy.com/",
    }
    expect(previewLines(s, paths)[0]).toContain("https://gh-proxy.com/")
  })

  // A mirror prefix only rewrites github.com, so naming one for a vendor's own
  // manifest host would describe a download that is not going to happen.
  it("ignores the mirror for a vendor manifest, and names the host instead", () => {
    const s: StepDescriptor = {
      ...base,
      source: { kind: "manifest", manifest: { mac: "https://vendor.example/RELEASES.json" } },
      arch: "arm64",
      mirrorPrefix: "https://gh-proxy.com/",
    }
    const [line] = previewLines(s, paths)
    expect(line).toContain("vendor.example")
    expect(line).not.toContain("gh-proxy")
  })

  it("is translated", () => {
    const s: StepDescriptor = {
      ...base,
      source: { kind: "github", repo: "owner/tool", asset: {} },
      arch: "arm64",
      mirrorPrefix: null,
    }
    expect(previewLines(s, paths, zhCN)[0]).not.toEqual(previewLines(s, paths)[0])
  })
})

it("snapshot preview announces the backup without taking one", () => {
  const s: StepDescriptor = { kind: "snapshot", id: "s", label: "s", reason: "before import" }
  expect(previewLines(s, paths)).toEqual(["would back up cc-switch DB and live configs"])
})
