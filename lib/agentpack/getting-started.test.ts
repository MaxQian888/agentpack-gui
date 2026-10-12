import {
  checklistRows,
  gettingStarted,
  type ChecklistId,
  type ChecklistInput,
  type ChecklistScan,
} from "./getting-started"
import { buildInventory } from "./inventory"
import { WHOLE_SCAN, type ListResult, type SessionSummary } from "@/lib/history/types"

const healthy = { status: "ok", hasBackup: false } as const
const none = { known: [], custom: [] }

const scan = (over: Partial<ChecklistScan> = {}): ChecklistScan => ({
  relay: { hasToken: false },
  hasCodexRelay: false,
  claudeMcps: none,
  codexMcps: none,
  claudeSkills: none,
  codexSkills: none,
  ...over,
})

const inventory = (detections: Record<string, { installed: boolean }>, scanned = true) =>
  buildInventory({
    scan: scanned
      ? { at: 1, degraded: false, claudeSettings: healthy, codexConfig: healthy }
      : null,
    detections,
    latestVersions: {},
    cliManagers: {},
    networkProbe: null,
    paths: null,
  })

const session = (source: SessionSummary["source"], parentId: string | null = null) =>
  ({ id: `${source}-${parentId ?? "top"}`, source, parentId }) as SessionSummary
const history = (...sessions: SessionSummary[]): ListResult => ({ sessions, errors: [] })

const CLAUDE = { "claude-code": { installed: true } }

/** A machine with Claude installed, signed out, no sessions — every reading back. */
const input = (over: Partial<ChecklistInput> = {}): ChecklistInput => ({
  inventory: inventory(CLAUDE),
  scan: scan(),
  login: { claude: false, codex: false },
  history: history(),
  tourSeen: false,
  ...over,
})

const tick = (over: Partial<ChecklistInput>, id: ChecklistId) =>
  gettingStarted(input(over)).items.find((i) => i.id === id)!.tick

describe("gettingStarted", () => {
  it("claims nothing before the machine has been read", () => {
    const list = gettingStarted(input({ inventory: inventory(CLAUDE, false) }))
    expect(list.measured).toBe(false)
    expect(list.items.every((i) => i.tick === "unknown")).toBe(true)
  })

  it("counts a desktop app as an installed agent", () => {
    const list = gettingStarted(
      input({ inventory: inventory({ "codex-app": { installed: true } }) })
    )
    expect(list.apps).toEqual(["codex"])
    expect(list.items[0].tick).toBe("done")
    expect(tick({ inventory: inventory({}) }, "install")).toBe("todo")
  })

  describe("connect", () => {
    it("is ticked by the agent's own sign-in", () => {
      expect(tick({ login: { claude: true } }, "connect")).toBe("done")
    })

    it("is ticked by an Anthropic key or a relay in the live config", () => {
      expect(tick({ scan: scan({ relay: { hasToken: false, hasApiKey: true } }) }, "connect")).toBe(
        "done"
      )
      expect(tick({ scan: scan({ relay: { hasToken: true } }) }, "connect")).toBe("done")
      const codex = inventory({ codex: { installed: true } })
      expect(tick({ inventory: codex, scan: scan({ hasCodexRelay: true }) }, "connect")).toBe(
        "done"
      )
    })

    it("is ticked by a past session, which no key in a shell profile can hide", () => {
      expect(tick({ history: history(session("claude")) }, "connect")).toBe("done")
    })

    it("names exactly the agents still missing one", () => {
      const both = inventory({ "claude-code": { installed: true }, codex: { installed: true } })
      const list = gettingStarted(input({ inventory: both, login: { claude: true, codex: false } }))
      const connect = list.items.find((i) => i.id === "connect")!
      expect(connect.tick).toBe("todo")
      expect(connect.pending).toEqual(["codex"])
    })

    it("is unknown, not undone, while a reading is still out", () => {
      expect(tick({ login: null }, "connect")).toBe("unknown")
      expect(tick({ history: null }, "connect")).toBe("unknown")
    })
  })

  describe("first message", () => {
    it("is ticked by one top-level session for any installed agent", () => {
      expect(tick({ history: history(session("claude")) }, "firstMessage")).toBe("done")
      // A sub-agent transcript is not a conversation the user started.
      expect(tick({ history: history(session("claude", "parent")) }, "firstMessage")).toBe("todo")
      // Nor is another agent's.
      expect(tick({ history: history(session("opencode")) }, "firstMessage")).toBe("todo")
    })

    it("treats a failed history scan as unmeasured, never as no history", () => {
      const failed = { sessions: [], errors: [{ source: WHOLE_SCAN, message: "boom" }] }
      expect(tick({ history: failed }, "firstMessage")).toBe("unknown")
      expect(tick({ history: null }, "firstMessage")).toBe("unknown")
    })
  })

  it("reads the extras from the scan, the inventory and the tour flag", () => {
    expect(tick({}, "keyedServer")).toBe("todo")
    expect(tick({ scan: scan({ claudeMcps: { known: ["context7"], custom: [] } }) }, "keyedServer")).toBe("done") // prettier-ignore
    // A keyless server is not the row's point.
    expect(tick({ scan: scan({ claudeMcps: { known: ["memory"], custom: [] } }) }, "keyedServer")).toBe("todo") // prettier-ignore
    expect(tick({ scan: scan({ codexSkills: { known: [], custom: ["mine"] } }) }, "skills")).toBe("done") // prettier-ignore
    expect(tick({ scan: null }, "skills")).toBe("unknown")
    expect(tick({}, "desktopApp")).toBe("todo")
    expect(tick({ inventory: inventory({ ...CLAUDE, "claude-desktop": { installed: true } }) }, "desktopApp")).toBe("done") // prettier-ignore
    expect(tick({ tourSeen: true }, "tour")).toBe("done")
  })
})

describe("checklistRows", () => {
  const rows = (over: Partial<ChecklistInput>, opts = { full: true, dismissed: false }) =>
    checklistRows(gettingStarted(input(over)), opts)
  const statuses = (r: ReturnType<typeof rows>) => r?.map((x) => `${x.id}:${x.status}`)

  it("accents one row and makes each later one wait on its own precondition", () => {
    expect(statuses(rows({ inventory: inventory({}) }))).toEqual([
      "install:current",
      "connect:waiting",
      "firstMessage:waiting",
      "keyedServer:waiting",
      "skills:waiting",
      "desktopApp:waiting",
      "tour:waiting",
    ])
  })

  it("offers the extras once the agent has answered, accenting only the first", () => {
    const r = rows({ login: { claude: true }, history: history(session("claude")) })
    expect(statuses(r)).toEqual([
      "install:done",
      "connect:done",
      "firstMessage:done",
      "keyedServer:current",
      "skills:todo",
      "desktopApp:todo",
      "tour:todo",
    ])
  })

  it("does not make a row wait on a step that is merely unmeasured", () => {
    const r = rows({ login: null, history: null })
    expect(statuses(r)?.slice(0, 3)).toEqual([
      "install:done",
      "connect:current",
      "firstMessage:todo",
    ])
  })

  it("disappears once everything is done, or when dismissed", () => {
    const all = {
      login: { claude: true },
      history: history(session("claude")),
      scan: scan({
        claudeMcps: { known: ["github"], custom: [] },
        claudeSkills: { known: ["tdd"], custom: [] },
      }),
      inventory: inventory({ ...CLAUDE, "claude-desktop": { installed: true } }),
      tourSeen: true,
    }
    expect(rows(all)).toBeNull()
    expect(rows({}, { full: true, dismissed: true })).toBeNull()
  })

  it("stays off screen until the machine has been read", () => {
    expect(rows({ inventory: inventory(CLAUDE, false) })).toBeNull()
  })

  it("shows web mode the unticked path, as the way into the wizard", () => {
    const r = checklistRows(gettingStarted(input({ inventory: inventory(CLAUDE, false) })), {
      full: false,
      dismissed: false,
      unmeasurable: true,
    })
    expect(r?.[0]).toMatchObject({ id: "install", status: "current" })
    expect(r?.some((x) => x.status === "done")).toBe(false)
  })

  describe("for an existing user", () => {
    const existing = { full: false, dismissed: false }

    it("never appears on a machine whose core already works", () => {
      expect(rows({ history: history(session("claude")) }, existing)).toBeNull()
    })

    it("does not nag about a reading that hasn't come back", () => {
      expect(rows({ login: null, history: null }, existing)).toBeNull()
    })

    it("lists only the core rows still measured undone", () => {
      const r = rows({ login: { claude: true } }, existing)
      expect(statuses(r)).toEqual(["firstMessage:current"])
    })
  })
})
