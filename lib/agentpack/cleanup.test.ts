import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import {
  AGE_PRESETS,
  CLEANUP_CONFIG_TARGETS,
  CLEANUP_TARGETS,
  appsPresent,
  formatBytes,
  joinPath,
  rowsForApp,
  rowsFrom,
  safeSelection,
  specsFor,
  specsForAll,
  targetImpact,
  targetLabel,
  totalBytes,
  totalFiles,
  visibleRows,
  type CleanupRoots,
  type CleanupStat,
  type CleanupTarget,
} from "./cleanup"

const ROOTS: CleanupRoots = {
  home: "/h",
  claudeHome: "/h/.claude",
  claudeCacheDir: "/h/Library/Caches/claude-cli-nodejs",
  codexHome: "/h/.codex",
  opencodeDataDir: "/h/.local/share/opencode",
  opencodeConfigDir: "/h/.config/opencode",
  ccSwitchDir: "/h/.cc-switch",
  ccConnectDir: "/h/.cc-connect",
  copilotDir: "/h/.copilot",
  cursorDir: "/h/.cursor",
  agentpackDir: "/h/.agentpack",
}

const find = (id: string): CleanupTarget => {
  const t = CLEANUP_TARGETS.find((x) => x.id === id)
  if (!t) throw new Error(`no such target: ${id}`)
  return t
}

const stat = (over: Partial<CleanupStat> & Pick<CleanupStat, "id" | "path">): CleanupStat => ({
  exists: true,
  bytes: 0,
  files: 0,
  newestMs: 0,
  oldestMs: 0,
  degraded: false,
  ...over,
})

describe("the catalog", () => {
  it("has a unique id for every target, across both kinds", () => {
    const ids = [...CLEANUP_TARGETS, ...CLEANUP_CONFIG_TARGETS].map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * The whole feature's safety story is that it cannot un-configure the machine.
   * The backend enforces it independently, but a catalog entry naming one of
   * these is a bug worth catching where it's written, not where it's refused.
   */
  it("never names a credential, a live config or a skills root", () => {
    const forbidden = [
      "auth.json",
      ".credentials.json",
      "settings.json",
      "config.toml",
      "opencode.json",
      "cc-switch.db",
      "/skills",
      "CLAUDE.md",
      "AGENTS.md",
    ]
    for (const target of CLEANUP_TARGETS) {
      for (const path of specsFor(target, ROOTS, "mac").map((s) => s.path)) {
        for (const bad of forbidden) {
          expect(`${path} [${target.id}]`).not.toContain(bad)
        }
      }
    }
  })

  /**
   * A path spec must never point at a bare root without a glob — the backend
   * refuses it, so such an entry would be a row that silently never works.
   */
  it("only points at a bare root when a glob narrows it", () => {
    const bare = CLEANUP_TARGETS.flatMap((t) =>
      t.paths.filter((p) => !p.rel && !p.glob).map((p) => `${t.id} → ${p.root}`)
    )
    expect(bare).toEqual([])
  })

  it("is fully translated in both catalogs", () => {
    for (const target of [...CLEANUP_TARGETS, ...CLEANUP_CONFIG_TARGETS]) {
      for (const messages of [en, zhCN]) {
        const copy = messages.cleanup.targets[target.id]
        expect(copy).toBeDefined()
        expect(copy.title.length).toBeGreaterThan(0)
        // `impact` is what the user reads before ticking a box. A row whose
        // impact is missing — or is just its own title again — says only how
        // many bytes it is, which is the failure mode this catches.
        expect(copy.impact.length).toBeGreaterThan(0)
        expect(copy.impact).not.toBe(copy.title)
      }
    }
  })

  /**
   * A row sits under a category heading, so a title equal to that heading
   * renders as "Caches / Caches" — which reads as a rendering bug, and which
   * makes every by-text query in the section ambiguous.
   */
  it("never gives a target the same title as the heading it sits under", () => {
    for (const target of [...CLEANUP_TARGETS, ...CLEANUP_CONFIG_TARGETS]) {
      for (const messages of [en, zhCN]) {
        expect(messages.cleanup.targets[target.id].title).not.toBe(
          messages.cleanup.categories[target.category]
        )
      }
    }
  })

  /** Two rows in one app card sharing a title is the same ambiguity, one level down. */
  it("gives every target within an app a distinct title", () => {
    for (const messages of [en, zhCN]) {
      const byApp = new Map<string, string[]>()
      for (const target of [...CLEANUP_TARGETS, ...CLEANUP_CONFIG_TARGETS]) {
        const titles = byApp.get(target.app) ?? []
        titles.push(messages.cleanup.targets[target.id].title)
        byApp.set(target.app, titles)
      }
      for (const [app, titles] of byApp) {
        expect(`${app}: ${titles.length}`).toBe(`${app}: ${new Set(titles).size}`)
      }
    }
  })

  it("labels every category and risk it uses, in both catalogs", () => {
    for (const target of [...CLEANUP_TARGETS, ...CLEANUP_CONFIG_TARGETS]) {
      for (const messages of [en, zhCN]) {
        expect(messages.cleanup.categories[target.category]).toBeTruthy()
        expect(messages.cleanup.risks[target.risk]).toBeTruthy()
        expect(messages.cleanup.riskHints[target.risk]).toBeTruthy()
        expect(messages.cleanup.apps[target.app]).toBeTruthy()
      }
    }
  })
})

describe("specsFor", () => {
  it("resolves each path against its root", () => {
    expect(specsFor(find("claude-chats"), ROOTS, "mac")).toEqual([
      { id: "claude-chats", path: "/h/.claude/projects" },
    ])
    expect(specsFor(find("codex-logs"), ROOTS, "mac")).toEqual([
      { id: "codex-logs", path: "/h/.codex", glob: "logs_*.sqlite*" },
    ])
  })

  it("joins with backslashes on Windows", () => {
    const [spec] = specsFor(find("claude-cache"), { ...ROOTS, claudeHome: "C:\\u\\.claude" }, "win")
    expect(spec.path).toBe("C:\\u\\.claude\\cache")
    // A nested rel path splits on every separator, not just the first.
    const nested = specsFor(
      find("claude-cache"),
      { ...ROOTS, claudeHome: "C:\\u\\.claude" },
      "win"
    ).map((s) => s.path)
    expect(nested).toContain("C:\\u\\.claude\\plugins\\cache")
  })

  /**
   * The age filter is the section's most load-bearing control, and applying it
   * where it can't work would be worse than not offering it: `codex-logs` is one
   * database, so "keep the last 30 days" over it silently means "clear it only
   * if you haven't used Codex lately".
   */
  it("applies the age filter only to dated records", () => {
    expect(specsFor(find("claude-chats"), ROOTS, "mac", 30)[0].olderThanDays).toBe(30)
    expect(specsFor(find("codex-logs"), ROOTS, "mac", 30)[0].olderThanDays).toBeUndefined()
    expect(specsFor(find("codex-cache"), ROOTS, "mac", 30)[0].olderThanDays).toBeUndefined()
    // 0 means "everything", not "files older than today".
    expect(specsFor(find("claude-chats"), ROOTS, "mac", 0)[0].olderThanDays).toBeUndefined()
  })

  it("emits one spec per path, in catalog order", () => {
    const specs = specsForAll(CLEANUP_TARGETS, ROOTS, "mac")
    expect(specs.length).toBe(CLEANUP_TARGETS.reduce((n, t) => n + t.paths.length, 0))
    expect(specs[0].id).toBe(CLEANUP_TARGETS[0].id)
  })
})

describe("rowsFrom", () => {
  const target = find("claude-cache")

  it("sums a multi-path target and keeps every path", () => {
    const rows = rowsFrom(
      [target],
      [
        stat({
          id: target.id,
          path: "/h/.claude/cache",
          bytes: 100,
          files: 2,
          oldestMs: 5,
          newestMs: 9,
        }),
        stat({ id: target.id, path: "/h/.claude/mcp-needs-auth-cache.json", exists: false }),
        stat({
          id: target.id,
          path: "/h/.claude/plugins/cache",
          bytes: 50,
          files: 1,
          oldestMs: 7,
          newestMs: 20,
        }),
      ]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].bytes).toBe(150)
    expect(rows[0].files).toBe(3)
    expect(rows[0].oldestMs).toBe(5)
    expect(rows[0].newestMs).toBe(20)
    expect(rows[0].exists).toBe(true)
    // Absent paths still appear, so the row can name where it looked.
    expect(rows[0].paths).toHaveLength(3)
  })

  /**
   * `claude-cache` covers three locations and two are routinely absent.
   * Requiring all of them would hide the one holding 24 MB.
   */
  it("counts a target as present when any one of its paths is", () => {
    const rows = rowsFrom(
      [target],
      [
        stat({ id: target.id, path: "/a", exists: false }),
        stat({ id: target.id, path: "/b", bytes: 10, files: 1 }),
      ]
    )
    expect(rows[0].exists).toBe(true)
    expect(rows[0].bytes).toBe(10)
  })

  it("drops a target the scan never reported on", () => {
    expect(rowsFrom([target], [])).toEqual([])
  })

  it("carries degraded through so a size is never quoted as a total", () => {
    const rows = rowsFrom(
      [target],
      [stat({ id: target.id, path: "/a", bytes: 10, files: 1, degraded: true })]
    )
    expect(rows[0].degraded).toBe(true)
  })
})

describe("selection", () => {
  const chats = find("claude-chats")
  const cache = find("claude-cache")
  const codexCache = find("codex-cache")

  const rows = rowsFrom(
    [chats, cache, codexCache],
    [
      stat({ id: chats.id, path: "/p", bytes: 2_000_000_000, files: 900 }),
      stat({ id: cache.id, path: "/c", bytes: 1_000, files: 4 }),
      stat({ id: codexCache.id, path: "/cc", bytes: 500, files: 2 }),
    ]
  )

  it("shows only rows that exist and hold something", () => {
    const empty = rowsFrom([cache], [stat({ id: cache.id, path: "/c", bytes: 0, files: 0 })])
    expect(visibleRows(empty)).toEqual([])
    expect(visibleRows(rows)).toHaveLength(3)
  })

  /**
   * The quick action has to be the one button a user can press without reading
   * anything. The moment it also clears chat history, every other affordance in
   * the section becomes a thing people click past.
   */
  it("never ticks anything but regenerated data in the quick clean", () => {
    const picked = safeSelection(rows)
    expect(picked).toContain(cache.id)
    expect(picked).toContain(codexCache.id)
    expect(picked).not.toContain(chats.id)
    for (const id of picked) {
      expect(CLEANUP_TARGETS.find((t) => t.id === id)?.risk).toBe("safe")
    }
  })

  it("totals only the selection", () => {
    const selected = new Set([cache.id, codexCache.id])
    expect(totalBytes(rows, selected)).toBe(1_500)
    expect(totalFiles(rows, selected)).toBe(6)
    expect(totalBytes(rows, new Set())).toBe(0)
  })

  it("groups by app in catalog order", () => {
    expect(appsPresent(rows)).toEqual(["claude", "codex"])
    expect(rowsForApp(rows, "claude").map((r) => r.target.id)).toEqual([chats.id, cache.id])
  })
})

describe("config targets", () => {
  const hooks = CLEANUP_CONFIG_TARGETS.find((t) => t.id === "claude-hooks")!
  const history = CLEANUP_CONFIG_TARGETS.find((t) => t.id === "claude-project-history")!

  it("removes only the hooks key, leaving the rest of settings.json", () => {
    const before = JSON.stringify({ model: "opus", hooks: { PreToolUse: [1] }, verbose: true })
    expect(hooks.present(before)).toBe(true)
    const after = JSON.parse(hooks.edit(before))
    expect(after).toEqual({ model: "opus", verbose: true })
  })

  it("reports nothing to do for a file with no hooks", () => {
    expect(hooks.present(JSON.stringify({ model: "opus" }))).toBe(false)
    expect(hooks.present(JSON.stringify({ model: "opus", hooks: {} }))).toBe(false)
    expect(hooks.present("")).toBe(false)
  })

  /**
   * The one thing an `edit` must never do is rewrite a file it could not read.
   * Given garbage it returns the text verbatim, so a bad merge is a no-op rather
   * than a truncated settings.json.
   */
  it("returns unparseable input verbatim rather than rewriting it", () => {
    const broken = "{ this is not json"
    expect(hooks.present(broken)).toBe(false)
    expect(hooks.edit(broken)).toBe(broken)
    expect(history.edit(broken)).toBe(broken)
    // An array is valid JSON but the wrong shape — also left alone.
    expect(hooks.edit("[1,2]")).toBe("[1,2]")
  })

  it("empties per-project prompt history without dropping the projects", () => {
    const before = JSON.stringify({
      projects: {
        "/a": { history: [{ display: "hi" }], allowedTools: ["Bash"] },
        "/b": { allowedTools: [] },
      },
      otherKey: 1,
    })
    expect(history.present(before)).toBe(true)
    const after = JSON.parse(history.edit(before))
    expect(after.projects["/a"]).toEqual({ history: [], allowedTools: ["Bash"] })
    // A project that never had a history key doesn't grow one.
    expect(after.projects["/b"]).toEqual({ allowedTools: [] })
    expect(after.otherKey).toBe(1)
    // Emptied, so there is now nothing left to offer.
    expect(history.present(JSON.stringify(after))).toBe(false)
  })
})

describe("formatBytes", () => {
  it("reads like a size, and never renders a blank", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(-1)).toBe("0 B")
    expect(formatBytes(NaN)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1_500_000)).toBe("1.4 MB")
    expect(formatBytes(1_932_735_283)).toBe("1.8 GB")
    // Three digits drop the decimal so a column of sizes stays the same width.
    expect(formatBytes(150 * 1024)).toBe("150 KB")
  })
})

describe("labels", () => {
  it("falls back to the id when the catalog outruns the copy", () => {
    expect(targetLabel(en, "claude-chats")).toBe(en.cleanup.targets["claude-chats"].title)
    expect(targetLabel(en, "not-a-target")).toBe("not-a-target")
    expect(targetImpact(en, "not-a-target")).toBe("")
  })
})

describe("joinPath", () => {
  it("returns the root untouched when there is no sub-path", () => {
    expect(joinPath("/h/.codex", undefined, "mac")).toBe("/h/.codex")
  })

  it("collapses repeated and trailing separators", () => {
    expect(joinPath("/h", "a//b/", "mac")).toBe("/h/a/b")
  })
})

describe("AGE_PRESETS", () => {
  it("starts at everything and increases", () => {
    expect(AGE_PRESETS[0]).toBe(0)
    for (let i = 1; i < AGE_PRESETS.length; i++) {
      expect(AGE_PRESETS[i]).toBeGreaterThan(AGE_PRESETS[i - 1])
    }
  })
})
