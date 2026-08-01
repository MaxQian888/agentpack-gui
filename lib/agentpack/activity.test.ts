import type { StepReport } from "./types"
import {
  ACTIVITY_LIMIT,
  activityPath,
  outcomeOf,
  parseActivity,
  pushRecord,
  recordRun,
  serializeActivity,
  type ActivityRecord,
} from "./activity"

const report = (over: Partial<StepReport> = {}): StepReport => ({
  id: "a",
  label: "Install Claude Code",
  status: "done",
  output: [],
  ...over,
})

const record = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id: "r1",
  title: "Install Claude Code",
  source: "quick-config",
  at: 1_700_000_000_000,
  outcome: "done",
  steps: [],
  ...over,
})

describe("outcomeOf", () => {
  it("reads all four statuses, not just done and error", () => {
    expect(outcomeOf([report()], false)).toBe("done")
    expect(outcomeOf([report(), report({ id: "b", status: "warning" })], false)).toBe("warning")
    // A step dropped because its prerequisite failed is not a success.
    expect(outcomeOf([report(), report({ id: "b", status: "skipped" })], false)).toBe("warning")
    expect(outcomeOf([report({ status: "error" })], false)).toBe("error")
  })

  it("lets error outrank warning", () => {
    expect(
      outcomeOf([report({ status: "warning" }), report({ id: "b", status: "error" })], false)
    ).toBe("error")
  })

  it("reports a stopped run as stopped, not as done", () => {
    // `skipped` alone can't tell a cancelled run from a dependency-skipped step,
    // which is exactly how a cancelled run used to report "All set".
    expect(outcomeOf([report()], true)).toBe("cancelled")
    expect(outcomeOf([report({ status: "skipped" })], true)).toBe("cancelled")
  })

  it("treats an empty run as done rather than throwing", () => {
    expect(outcomeOf([], false)).toBe("done")
  })
})

describe("recordRun", () => {
  const base = { id: "r", at: 1, cancelled: false }

  it("keeps only the fields the log is allowed to hold", () => {
    // The redaction line. `output` is the command's raw stdout and can contain a
    // token a CLI echoed back; `error` can carry a full command line.
    const r = recordRun({
      ...base,
      reports: [
        report({
          output: ["ANTHROPIC_API_KEY=sk-secret", "installed"],
          error: "failed running npm i --token sk-secret",
          durationMs: 120,
        }),
      ],
    })
    expect(r.steps[0]).toEqual({
      id: "a",
      label: "Install Claude Code",
      status: "done",
      durationMs: 120,
    })
    expect(JSON.stringify(r)).not.toContain("sk-secret")
    expect(JSON.stringify(r)).not.toContain("output")
  })

  it("carries a restore point when the step actually made one", () => {
    const r = recordRun({ ...base, reports: [report({ artifact: "snap-7" })] })
    expect(r.steps[0].artifact).toBe("snap-7")
    // And says nothing at all when there wasn't one, rather than an empty string
    // that would read as "a restore point exists".
    expect(recordRun({ ...base, reports: [report()] }).steps[0]).not.toHaveProperty("artifact")
  })

  it("falls back to the first step's own label for a title", () => {
    expect(recordRun({ ...base, reports: [report()] }).title).toBe("Install Claude Code")
    expect(recordRun({ ...base, reports: [report()], title: "  " }).title).toBe(
      "Install Claude Code"
    )
    expect(recordRun({ ...base, reports: [report()], title: "Quick config" }).title).toBe(
      "Quick config"
    )
  })

  it("defaults an unnamed source rather than guessing one", () => {
    expect(recordRun({ ...base, reports: [report()] }).source).toBe("unknown")
  })
})

describe("pushRecord", () => {
  it("puts the newest first", () => {
    const list = pushRecord([record({ id: "old" })], record({ id: "new" }))
    expect(list.map((r) => r.id)).toEqual(["new", "old"])
  })

  it("caps the log, dropping the oldest", () => {
    let list: ActivityRecord[] = []
    for (let i = 0; i < ACTIVITY_LIMIT + 10; i++) {
      list = pushRecord(list, record({ id: `r${i}`, at: i }))
    }
    expect(list).toHaveLength(ACTIVITY_LIMIT)
    expect(list[0].id).toBe(`r${ACTIVITY_LIMIT + 9}`)
    expect(list.map((r) => r.id)).not.toContain("r0")
  })

  it("does not mutate the list it was given", () => {
    const before: ActivityRecord[] = [record()]
    pushRecord(before, record({ id: "r2" }))
    expect(before).toHaveLength(1)
  })
})

describe("parseActivity", () => {
  const store = (records: unknown[]) => JSON.stringify({ version: 1, profiles: records })

  it("round-trips what it wrote", () => {
    const written = serializeActivity({
      version: 1,
      profiles: [record({ steps: [{ id: "a", label: "L", status: "done", durationMs: 5 }] })],
    })
    expect(parseActivity(written).profiles).toEqual([
      record({ steps: [{ id: "a", label: "L", status: "done", durationMs: 5 }] }),
    ])
  })

  it("yields nothing rather than throwing on junk", () => {
    // An activity log is a convenience; it must never be why the overview won't
    // render.
    for (const junk of ["", "   ", "{ not json", "[]", "null", '{"profiles":3}']) {
      expect(parseActivity(junk).profiles).toEqual([])
    }
  })

  it("drops records that don't validate, keeping the ones that do", () => {
    const parsed = parseActivity(
      store([
        record({ id: "good" }),
        { id: "no-title", at: 1, outcome: "done" },
        { id: "bad-outcome", title: "t", at: 1, outcome: "exploded" },
        { id: "bad-at", title: "t", at: "yesterday", outcome: "done" },
        null,
      ])
    )
    expect(parsed.profiles.map((r) => r.id)).toEqual(["good"])
  })

  it("drops malformed steps without dropping their record", () => {
    const parsed = parseActivity(
      store([
        record({
          steps: [
            { id: "ok", label: "L", status: "done" },
            { id: "no-status", label: "L" },
            { id: "bad-status", label: "L", status: "exploded" },
            "nope",
          ] as never,
        }),
      ])
    )
    expect(parsed.profiles[0].steps.map((s) => s.id)).toEqual(["ok"])
  })

  it("re-sorts newest-first, so a hand-edited file still reads right", () => {
    const parsed = parseActivity(
      store([record({ id: "older", at: 1 }), record({ id: "newer", at: 9 })])
    )
    expect(parsed.profiles.map((r) => r.id)).toEqual(["newer", "older"])
  })

  it("enforces the cap on read as well as on write", () => {
    const many = Array.from({ length: ACTIVITY_LIMIT + 5 }, (_, i) =>
      record({ id: `r${i}`, at: i })
    )
    expect(parseActivity(store(many)).profiles).toHaveLength(ACTIVITY_LIMIT)
  })

  it("defaults an unknown source instead of trusting the file", () => {
    const parsed = parseActivity(store([{ ...record(), source: 42 }]))
    expect(parsed.profiles[0].source).toBe("unknown")
  })
})

describe("activityPath", () => {
  it("sits with the other agentpack stores", () => {
    expect(activityPath("/home/dev")).toBe("/home/dev/.agentpack/activity.json")
  })
})
