import {
  buildTimeline,
  configBackupCandidates,
  countBySafety,
  emptyTimeline,
  OWN_WRITE_GRACE_MS,
  pathsToCheck,
  RECOVERY_KINDS,
  RECOVERY_VERSION,
  recoveryId,
  restoreSafety,
  sortPoints,
  type LiveFileStat,
  type RecoveryInput,
  type RecoveryPoint,
} from "./recovery"

const HOUR = 3_600_000
const NOON = 1_700_000_000_000

const snapshot = (id: string, ts: number, paths: string[] = ["/h/.cc-switch/cc-switch.db"]) => ({
  id,
  ts,
  reason: "before provider switch",
  files: paths.map((originalPath) => ({ originalPath })),
})

const fold = (over: Partial<RecoveryInput> = {}) => buildTimeline({ measured: true, ...over })

const live = (path: string, modifiedMs: number, exists = true): LiveFileStat => ({
  path,
  exists,
  modifiedMs,
})

const point = (over: Partial<RecoveryPoint> = {}): RecoveryPoint => ({
  id: "configSnapshot:a",
  kind: "configSnapshot",
  restoreId: "a",
  takenAt: NOON,
  paths: ["/h/config.json"],
  targets: [],
  ...over,
})

describe("folding the four sources", () => {
  it("carries a provider snapshot with the paths it would write over", () => {
    const p = fold({ configSnapshots: [snapshot("snapshot-1", NOON)] }).points[0]
    expect(p.id).toBe("configSnapshot:snapshot-1")
    // The record's id is not what the restore command takes.
    expect(p.restoreId).toBe("snapshot-1")
    expect(p.paths).toEqual(["/h/.cc-switch/cc-switch.db"])
    expect(p.reason).toBe("before provider switch")
    expect(p.items).toBe(1)
  })

  it("carries a config .bak as undated, because it has no date of its own", () => {
    const p = fold({
      configBackups: [{ path: "/h/.claude/settings.json", target: "claude" }],
    }).points[0]
    expect(p.kind).toBe("configBackupFile")
    expect(p.takenAt).toBe(0)
    // `fileRestoreStep` takes the live path and appends the suffix itself.
    expect(p.restoreId).toBe("/h/.claude/settings.json")
    expect(p.targets).toEqual(["claude"])
  })

  it("carries a skill backup, with a path only when the caller resolved one", () => {
    const backup = {
      id: "b1",
      name: "code-review",
      dirName: "code-review",
      source: "claude",
      bytes: 2048,
      createdAt: NOON,
    }
    expect(fold({ skillBackups: [backup] }).points[0].paths).toEqual([])
    expect(fold({ skillBackups: [{ ...backup, path: "/h/.claude/skills/code-review" }] }).points[0].paths).toEqual(["/h/.claude/skills/code-review"]) // prettier-ignore
    expect(fold({ skillBackups: [backup] }).points[0].name).toBe("code-review")
  })

  it("marks a quarantine batch as guarded by its own restore command", () => {
    // `cleanup_quarantine_restore` skips a path the CLI has reoccupied rather
    // than clobbering it, so warning about it would train people to ignore the
    // warning that matters.
    const p = fold({
      quarantine: [{ id: "batch-1", ts: NOON, bytes: 900, items: 12, targetIds: ["codex-logs"] }],
    }).points[0]
    expect(p.selfGuarded).toBe(true)
    expect(p.paths).toEqual([])
    expect(p.targets).toEqual(["codex-logs"])
    expect(p.bytes).toBe(900)
  })

  it("gives every point a unique id across the four kinds", () => {
    const timeline = fold({
      configSnapshots: [snapshot("x", NOON)],
      configBackups: [{ path: "x", target: "claude" }],
      skillBackups: [{ id: "x", name: "n", dirName: "n", source: "claude", bytes: 1, createdAt: NOON }], // prettier-ignore
      quarantine: [{ id: "x", ts: NOON, bytes: 1, items: 1, targetIds: [] }],
    })
    expect(new Set(timeline.points.map((p) => p.id)).size).toBe(4)
    expect(recoveryId("skillBackup", "x")).toBe("skillBackup:x")
  })
})

describe("looked at, or not", () => {
  it("says it hasn't looked rather than that there is no way back", () => {
    expect(buildTimeline({ measured: false }).measured).toBe(false)
    expect(emptyTimeline()).toEqual({
      version: RECOVERY_VERSION,
      points: [],
      measured: false,
      degraded: false,
    })
  })

  it("stamps a schema version, so a stored timeline can be migrated", () => {
    expect(fold().version).toBe(RECOVERY_VERSION)
  })

  it("distinguishes a source it could not read from one that is empty", () => {
    // Otherwise "you have no skill backups" and "we could not open the
    // skill-backup store" are the same screen, and only one means what it says.
    expect(fold().degraded).toBe(false)
    expect(fold({ degraded: true }).degraded).toBe(true)
  })

  it("dates a config .bak from the sibling's own mtime when the caller stat'ed it", () => {
    // The scan only says a backup exists. An undated point can never be judged
    // safe, so one extra stat is what makes the warning possible at all.
    const dated = fold({
      configBackups: [{ path: "/h/x.json", target: "claude", takenAt: NOON }],
    }).points[0]
    expect(dated.takenAt).toBe(NOON)
    expect(restoreSafety(dated, [live("/h/x.json", NOON + HOUR)])).toBe("stale")
  })

  it("keeps its kind vocabulary complete", () => {
    expect([...RECOVERY_KINDS].sort()).toEqual([
      "configBackupFile",
      "configSnapshot",
      "quarantineBatch",
      "skillBackup",
    ])
  })
})

describe("order", () => {
  it("puts the newest first", () => {
    const timeline = fold({
      configSnapshots: [snapshot("old", NOON - HOUR), snapshot("new", NOON)],
    })
    expect(timeline.points.map((p) => p.restoreId)).toEqual(["new", "old"])
  })

  it("puts an undated point last, not first", () => {
    // A `.agentpack.bak` with no date is not "from 1970", and at the top of a
    // timeline it would claim to be the most recent thing that happened.
    const timeline = fold({
      configSnapshots: [snapshot("dated", NOON)],
      configBackups: [{ path: "/h/x.json", target: "claude" }],
    })
    expect(timeline.points.map((p) => p.kind)).toEqual(["configSnapshot", "configBackupFile"])
  })

  it("does not mutate its input, and is stable within a timestamp", () => {
    const points = [point({ id: "a" }), point({ id: "b" }), point({ id: "c" })]
    expect(sortPoints(points).map((p) => p.id)).toEqual(["a", "b", "c"])
    expect(points.map((p) => p.id)).toEqual(["a", "b", "c"])
  })
})

describe("would restoring throw away newer work", () => {
  it("is safe when the file is older than the backup", () => {
    expect(restoreSafety(point(), [live("/h/config.json", NOON - HOUR)])).toBe("safe")
  })

  it("is stale when the file is newer than the backup", () => {
    // Someone edited it in a text editor after the backup was taken; restoring
    // silently throws that away, at the exact moment they were undoing
    // something else.
    expect(restoreSafety(point(), [live("/h/config.json", NOON + HOUR)])).toBe("stale")
  })

  it("is safe when the file isn't there at all — nothing to lose", () => {
    expect(restoreSafety(point(), [live("/h/config.json", NOON + HOUR, false)])).toBe("safe")
  })

  it("is unknown when nothing measured the path", () => {
    expect(restoreSafety(point(), [])).toBe("unknown")
    expect(restoreSafety(point(), [live("/h/other.json", NOON)])).toBe("unknown")
  })

  it("is unknown when the platform wouldn't report an mtime", () => {
    // 0 is "cannot tell", never "1970, therefore older, therefore safe".
    expect(restoreSafety(point(), [live("/h/config.json", 0)])).toBe("unknown")
  })

  it("is unknown for an undated backup, whatever the file says", () => {
    expect(restoreSafety(point({ takenAt: 0 }), [live("/h/config.json", NOON - HOUR)])).toBe(
      "unknown"
    )
  })

  it("is unknown when the point names no path to compare", () => {
    expect(restoreSafety(point({ paths: [] }), [])).toBe("unknown")
  })

  it("lets the worst path decide, so one newer file is enough", () => {
    const multi = point({ paths: ["/h/a.json", "/h/b.json", "/h/c.json"] })
    expect(
      restoreSafety(multi, [
        live("/h/a.json", NOON - HOUR),
        live("/h/b.json", NOON + HOUR),
        live("/h/c.json", NOON - HOUR),
      ])
    ).toBe("stale")
    // Stale outranks unknown too: a measured danger beats an unmeasured one.
    expect(restoreSafety(multi, [live("/h/b.json", NOON + HOUR)])).toBe("stale")
  })

  it("trusts a restore command that refuses to overwrite", () => {
    const guarded = point({ selfGuarded: true, paths: [], takenAt: 0 })
    expect(restoreSafety(guarded, [])).toBe("safe")
  })

  it("does not count the write the backup was taken for as newer work", () => {
    // mergeFile writes the `.agentpack.bak` and then the live file, and a
    // provider write snapshots and then writes — so the live file is always a
    // little newer. Reading that as "stale" put the warning on every point the
    // moment it existed, which is how a warning gets clicked through.
    expect(restoreSafety(point(), [live("/h/config.json", NOON + 40)])).toBe("safe")
    expect(restoreSafety(point(), [live("/h/config.json", NOON + OWN_WRITE_GRACE_MS)])).toBe("safe")
  })

  it("still warns about a write that came after that grace", () => {
    expect(restoreSafety(point(), [live("/h/config.json", NOON + OWN_WRITE_GRACE_MS + 1)])).toBe(
      "stale"
    )
  })
})

describe("which config backups exist to look for", () => {
  const paths = {
    home: "/h",
    claudeSettings: "/h/.claude/settings.json",
    claudeConfig: "/h/.claude.json",
    codexConfig: "/h/.codex/config.toml",
    opencodeConfig: "/h/.config/opencode/opencode.json",
    piSettings: "/h/.pi/agent/settings.json",
    ccConnectConfig: "/h/.cc-connect/config.toml",
    ccSwitchSettings: "/h/.cc-switch/settings.json",
    shellProfile: "",
    mcpDisabledStore: "/h/.agentpack/mcp-disabled.json",
  } as unknown as Parameters<typeof configBackupCandidates>[0]

  it("covers every file the app edits, not just the two the scan reports", () => {
    const listed = configBackupCandidates(paths).map((c) => c.path)
    expect(listed).toEqual(
      expect.arrayContaining([
        "/h/.claude/settings.json",
        "/h/.claude.json",
        "/h/.codex/config.toml",
        "/h/.config/opencode/opencode.json",
        "/h/.agentpack/profiles.json",
        "/h/.agentpack/accounts.json",
      ])
    )
  })

  it("skips a path this platform doesn't have, and lists each file once", () => {
    // The shell profile is empty on Windows: stat'ing "" + suffix would ask
    // about a file in the working directory.
    const listed = configBackupCandidates({ ...paths, codexConfig: paths.claudeSettings }).map(
      (c) => c.path
    )
    expect(listed).not.toContain("")
    expect(new Set(listed).size).toBe(listed.length)
  })

  it("names a config backup by its file, so two rows can be told apart", () => {
    const p = fold({ configBackups: [{ path: "/h/.claude.json", target: "claude" }] }).points[0]
    expect(p.name).toBe("/h/.claude.json")
  })
})

describe("what a caller has to measure", () => {
  it("lists each path once", () => {
    const points = [point({ paths: ["/h/a", "/h/b"] }), point({ paths: ["/h/b", "/h/c"] })]
    expect(pathsToCheck(points).sort()).toEqual(["/h/a", "/h/b", "/h/c"])
  })

  it("skips a self-guarded point, whose verdict no stat can change", () => {
    expect(pathsToCheck([point({ selfGuarded: true, paths: ["/h/a"] })])).toEqual([])
  })

  it("counts every verdict, including the zeroes", () => {
    const points = [
      point({ id: "a", paths: ["/h/safe.json"] }),
      point({ id: "b", paths: ["/h/stale.json"] }),
      point({ id: "c", paths: ["/h/unmeasured.json"] }),
    ]
    expect(
      countBySafety(points, [live("/h/safe.json", NOON - HOUR), live("/h/stale.json", NOON + HOUR)])
    ).toEqual({ stale: 1, unknown: 1, safe: 1 })
  })
})
