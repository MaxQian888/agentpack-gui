/**
 * The Overview's "Getting started" checklist — what is left between this
 * machine and an agent that answers, and the extras worth adding after.
 *
 * Pure and browser-safe, like `diagnostics`. It folds readings the app already
 * took (the inventory, the dashboard scan, `login_status`, the history scan)
 * and decides nothing by itself being clicked: **every tick is measured**. A
 * checkbox the user ticks by hand is a claim about the machine that nothing
 * checked, and the first-run wizard exists because claims like that ("set up!")
 * were how a newcomer ended at an agent that couldn't answer.
 *
 * Three rules:
 *
 * 1. **Unmeasured is not undone.** A reading that hasn't come back is
 *    `unknown`, never `todo` — the history scan takes seconds, and a row that
 *    flips from "send your first message" to ticked on a machine with a year of
 *    sessions is a list that can't be trusted.
 * 2. **A session proves a connection.** Nothing can be measured about a key
 *    exported in a shell profile, but an agent that has held a conversation
 *    reached a model somehow. Without this, an existing user with
 *    `ANTHROPIC_API_KEY` in `.zshrc` would be told to connect forever.
 * 3. **An existing user sees only what they're missing.** The checklist is a
 *    newcomer's (`startedWithWizard`), and shows ticked rows and the optional
 *    extras to them. Everyone else sees it only when a core item is measured
 *    undone, and then only the undone core rows — a machine that already works
 *    never sees it at all.
 */

import type { ClaudeRelayState, ClassifiedIds } from "./scan"
import type { MachineInventory } from "./inventory"
import { findCatalogAsset } from "./inventory"
import { MCP_SERVERS } from "./registry"
import type { ConnectApp } from "./onboarding"
import { WHOLE_SCAN, type ListResult } from "@/lib/history/types"

export type ChecklistId =
  "install" | "connect" | "firstMessage" | "keyedServer" | "skills" | "desktopApp" | "tour"

/** The endpoint: installed, connected, answering. In order; each waits on the one before. */
export const CORE_ITEMS: readonly ChecklistId[] = ["install", "connect", "firstMessage"]
/** Enhancements — offered once the core is done, never in front of it. */
export const OPTIONAL_ITEMS: readonly ChecklistId[] = [
  "keyedServer",
  "skills",
  "desktopApp",
  "tour",
]

export type Tick = "done" | "todo" | "unknown"

export interface ChecklistItem {
  id: ChecklistId
  tick: Tick
  /**
   * The agents this row is still waiting on, in install order. For `connect`,
   * the installed agents with no measured way to a model; for `firstMessage`,
   * every installed agent (any one of them answering ticks it). Empty
   * otherwise.
   */
  pending: ConnectApp[]
}

export interface Checklist {
  /** False until the inventory has been read — nothing below means anything before that. */
  measured: boolean
  /** The agents agentpack sets up that are on this machine. */
  apps: ConnectApp[]
  items: ChecklistItem[]
}

/** The part of the dashboard scan the checklist reads. `DashboardScan` satisfies it. */
export interface ChecklistScan {
  relay: ClaudeRelayState
  hasCodexRelay: boolean
  claudeMcps: ClassifiedIds
  codexMcps: ClassifiedIds
  claudeSkills: ClassifiedIds
  codexSkills: ClassifiedIds
}

export interface ChecklistInput {
  inventory: MachineInventory
  scan: ChecklistScan | null
  /** Each agent's own sign-in, as `login_status` read it; null until it has. */
  login: Partial<Record<ConnectApp, boolean>> | null
  /** The history scan; null while it runs. */
  history: ListResult | null
  tourSeen: boolean
}

/** Which catalog entries count as each agent — the CLI or its desktop app. */
const AGENT_ASSETS: Record<ConnectApp, readonly string[]> = {
  claude: ["claude-code", "claude-desktop"],
  codex: ["codex", "codex-app"],
}
const DESKTOP_APPS = ["claude-desktop", "codex-app"] as const
const KEYED_SERVERS = new Set(MCP_SERVERS.filter((m) => m.keyEnv).map((m) => m.id))

type Measured = boolean | null

/** Fold several readings into a tick: any `false` is todo, all `true` done, otherwise unknown. */
function tickOf(readings: Measured[]): Tick {
  if (readings.some((r) => r === false)) return "todo"
  return readings.every((r) => r === true) ? "done" : "unknown"
}

export function gettingStarted(input: ChecklistInput): Checklist {
  const { inventory, scan, login, history, tourSeen } = input
  if (!inventory.measured) {
    return {
      measured: false,
      apps: [],
      items: [...CORE_ITEMS, ...OPTIONAL_ITEMS].map((id) => ({ id, tick: "unknown", pending: [] })),
    }
  }

  const apps = (Object.keys(AGENT_ASSETS) as ConnectApp[]).filter((app) =>
    AGENT_ASSETS[app].some((id) => findCatalogAsset(inventory, id))
  )

  // A rejected scan is recorded as a whole-scan error, never as no sessions.
  const historyRead = history && !history.errors.some((e) => e.source === WHOLE_SCAN)
  const hasSession = (app: ConnectApp): Measured =>
    historyRead ? history.sessions.some((s) => s.source === app && !s.parentId) : null

  const configured = (app: ConnectApp): Measured =>
    scan
      ? app === "claude"
        ? scan.relay.hasToken || !!scan.relay.hasApiKey
        : scan.hasCodexRelay
      : null

  const connected = (app: ConnectApp): Measured => {
    const readings = [login ? !!login[app] : null, configured(app), hasSession(app)]
    if (readings.includes(true)) return true
    return readings.includes(null) ? null : false
  }

  const installTick: Tick = apps.length > 0 ? "done" : "todo"
  const connectReadings = apps.map(connected)
  const sessions = apps.map(hasSession)
  const ids = (ids: ClassifiedIds) => [...ids.known, ...ids.custom]

  const items: ChecklistItem[] = [
    { id: "install", tick: installTick, pending: [] },
    {
      id: "connect",
      tick: apps.length ? tickOf(connectReadings) : "todo",
      pending: apps.filter((_, i) => connectReadings[i] === false),
    },
    {
      id: "firstMessage",
      // Any one agent answering is the endpoint; the rest is preference.
      tick: !apps.length
        ? "todo"
        : sessions.includes(true)
          ? "done"
          : sessions.includes(null)
            ? "unknown"
            : "todo",
      pending: sessions.includes(true) ? [] : apps,
    },
    {
      id: "keyedServer",
      tick: !scan
        ? "unknown"
        : [...ids(scan.claudeMcps), ...ids(scan.codexMcps)].some((id) => KEYED_SERVERS.has(id))
          ? "done"
          : "todo",
      pending: [],
    },
    {
      id: "skills",
      tick: !scan
        ? "unknown"
        : ids(scan.claudeSkills).length + ids(scan.codexSkills).length > 0
          ? "done"
          : "todo",
      pending: [],
    },
    {
      id: "desktopApp",
      tick: DESKTOP_APPS.some((id) => findCatalogAsset(inventory, id)) ? "done" : "todo",
      pending: [],
    },
    { id: "tour", tick: tourSeen ? "done" : "todo", pending: [] },
  ]
  return { measured: true, apps, items }
}

/**
 * Where a row stands, in `SetupSteps`' vocabulary plus `todo`: available, but
 * not the one suggested next. The accent (`current`) goes to exactly one row.
 */
export type RowStatus = "done" | "current" | "waiting" | "todo"

export interface ChecklistRow extends ChecklistItem {
  core: boolean
  status: RowStatus
}

export interface ChecklistOptions {
  /** This install went through the wizard's Install now — see rule 3. */
  full: boolean
  dismissed: boolean
  /**
   * There is nothing behind this window to measure with (web mode). The list
   * is then shown unticked, as the way into the wizard it replaced — the
   * quick-start card used to be the only one.
   */
  unmeasurable?: boolean
}

/**
 * The rows to render, or null when the checklist shouldn't be on screen at all.
 *
 * Each row's status is its own precondition, not its position: `connect` waits
 * on an agent being installed, the first message on a connection, and the
 * extras on the whole core. A precondition that is merely unmeasured counts as
 * met — "waiting on the step above" about a step nobody has looked at yet
 * would be a guess.
 */
export function checklistRows(list: Checklist, opts: ChecklistOptions): ChecklistRow[] | null {
  if (opts.dismissed) return null
  if (!list.measured && !opts.unmeasurable) return null

  const tick = (id: ChecklistId) => list.items.find((i) => i.id === id)!.tick
  const coreDone = CORE_ITEMS.every((id) => tick(id) === "done")
  const met = (id: ChecklistId) =>
    id === "install"
      ? true
      : id === "connect"
        ? tick("install") !== "todo"
        : id === "firstMessage"
          ? tick("install") !== "todo" && tick("connect") !== "todo"
          : coreDone

  const shown = list.items.filter((item) =>
    opts.full || opts.unmeasurable ? true : CORE_ITEMS.includes(item.id) && item.tick !== "done"
  )
  const visible =
    opts.full || opts.unmeasurable
      ? shown.some((r) => r.tick !== "done")
      : shown.some((r) => r.tick === "todo")
  if (!visible) return null

  let accented = false
  return shown.map((item) => {
    const status: RowStatus =
      item.tick === "done"
        ? "done"
        : !met(item.id)
          ? "waiting"
          : accented
            ? "todo"
            : ((accented = true), "current")
    return { ...item, core: CORE_ITEMS.includes(item.id), status }
  })
}
