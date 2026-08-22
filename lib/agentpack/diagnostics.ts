/**
 * The overview's to-do list.
 *
 * Everything here is *derived* from the machine inventory — one normalized
 * asset list folded from the readings the app already took (see
 * `lib/agentpack/inventory`). Nothing in this file probes, reads a file, or
 * runs a command; it turns state the user can't interpret into a short list of
 * things they might want to do about it.
 *
 * Three rules the shape enforces:
 *
 * 1. **One action per item.** Not a menu, not a "fix all". A user who is told
 *    something is wrong with their machine needs to know exactly what the
 *    remedy will do — and a single button whose label names the change is the
 *    only honest way to say it. A one-click "repair everything" over a mixed
 *    list of upgrades, restores and installs cannot be described in a label,
 *    which is why there isn't one.
 * 2. **Actions are data.** The item says *what* to do, not *how*; the caller
 *    maps `DiagnosticAction` onto real steps, and every one of those still goes
 *    through the review panel. That keeps this file pure and testable, and
 *    keeps it structurally incapable of writing to the machine.
 * 3. **One source for the machine's state.** This list reads the inventory and
 *    nothing else, so a finding and the asset row it refers to can never
 *    disagree about what was found. It used to take seven loose parameters and
 *    re-derive the same facts the overview had already derived beside it.
 */

import type { Messages } from "@/lib/i18n/types"
import type { OS } from "./types"
import { CLI_TOOLS, upgradeCommandFor } from "./registry"
import { majorVersion } from "./version"
import {
  assetId,
  CONFIG_ASSET_IDS,
  findAsset,
  findCatalogAsset,
  NETWORK_ASSET_ID,
  upgradeAvailable,
  type MachineInventory,
} from "./inventory"
import type { SectionKey } from "./workspaces"

export type DiagnosticSeverity = "critical" | "warning" | "info"

/** Rendering order, worst first. */
export const SEVERITY_ORDER: readonly DiagnosticSeverity[] = ["critical", "warning", "info"]

/**
 * Which part of the machine a finding is about.
 *
 * This is the axis the maintenance inbox filters and groups on — deliberately
 * *not* the axis it ranks on, which stays severity. A list grouped by category
 * puts a blocking finding in the third group underneath an optional one in the
 * first, and a to-do list that buries the blocking item is not a to-do list.
 *
 * The vocabulary is complete before the findings are: `usage` and `disk` have
 * no producer yet, because nothing measures a budget or free space in a shape
 * this list could read. They are named here so the eventual producer has a home
 * rather than inventing a parallel one — and `groupInbox` only ever emits
 * groups that have items, so an unproduced category never renders as an empty
 * filter chip.
 */
export type DiagnosticCategory =
  "scan" | "dependency" | "config" | "capability" | "provider" | "network" | "usage" | "disk"

/**
 * Grouping order. `scan` leads because a partial read taints every finding
 * under it; the rest follow the order a machine is set up in.
 */
export const CATEGORY_ORDER: readonly DiagnosticCategory[] = [
  "scan",
  "dependency",
  "config",
  "capability",
  "provider",
  "network",
  "usage",
  "disk",
]

export type DiagnosticAction =
  | { kind: "upgradeCli"; id: string }
  | { kind: "restoreFile"; path: string }
  | { kind: "rescan" }
  | { kind: "openOnboarding" }
  | { kind: "navigate" }

export interface DiagnosticItem {
  id: string
  severity: DiagnosticSeverity
  /** Which part of the machine this is about. Filtering, never ranking. */
  category: DiagnosticCategory
  title: string
  /** One line of context: what was actually observed. Never a guess. */
  detail?: string
  /** Where following this item takes the user. */
  destination: SectionKey
  action: { label: string; run: DiagnosticAction }
}

/**
 * The agents this app exists to set up. If neither is present, nothing else on
 * the list matters yet — which is why that item outranks everything.
 *
 * Deliberately narrower than the inventory's `agent` kind, which also covers
 * the third-party terminal agents agentpack installs but writes no config into.
 * A machine with only one of those is still a machine agentpack has not set up.
 */
const AGENT_CLI_IDS = ["claude-code", "codex"] as const

export function buildDiagnostics(
  t: Messages,
  inventory: MachineInventory,
  os: OS
): DiagnosticItem[] {
  const g = t.diagnostics
  const items: DiagnosticItem[] = []
  // "We haven't looked yet" is not a finding, and rendering it as one would
  // make web mode and the first second of startup look broken.
  if (!inventory.measured) return items

  // A scan that couldn't read its sources is the most important thing on the
  // page, because every other item below it was derived from a partial read and
  // may be wrong. Saying so is the whole point — the alternative is a confident
  // "all clear" drawn from a file we failed to open.
  if (inventory.degraded) {
    items.push({
      id: "scan-degraded",
      severity: "critical",
      category: "scan",
      title: g.degradedTitle,
      detail: g.degradedDetail,
      destination: "dashboard",
      action: { label: g.rescan, run: { kind: "rescan" } },
    })
  }

  if (!AGENT_CLI_IDS.some((id) => findCatalogAsset(inventory, id))) {
    items.push({
      id: "no-agent",
      severity: "critical",
      category: "dependency",
      title: g.noAgentTitle,
      detail: g.noAgentDetail,
      destination: "presets",
      action: { label: g.setUp, run: { kind: "openOnboarding" } },
    })
  }

  for (const key of CONFIG_ASSET_IDS) {
    // An absent asset is the normal state of a machine that never set that
    // agent up: the fold only keeps a config file it found, or one a backup
    // proves used to be there. Neither case is a finding on its own.
    const asset = findAsset(inventory, assetId("config", key))
    const status = asset?.health.status
    if (!asset || (status !== "broken" && status !== "attention")) continue
    const label = key === "claudeSettings" ? g.fileClaudeSettings : g.fileCodexConfig
    const broken = status === "broken"
    // Without a backup there is nothing to restore *from*, so the honest action
    // is to open the file, not to offer a repair that can't happen. That is
    // precisely what a missing `restorePoint` means.
    const restore = asset.restorePoint
    items.push({
      id: `config-${key}`,
      severity: "critical",
      category: "config",
      title: broken ? g.configInvalidTitle(label) : g.configMissingTitle(label),
      detail: asset.path,
      destination: "config",
      action: restore
        ? { label: g.restore, run: { kind: "restoreFile", path: restore } }
        : { label: g.open, run: { kind: "navigate" } },
    })
  }

  // A measured probe that reached nothing, directly or through any proxy. The
  // asset only exists once something probed, so an absent one means we never
  // got to look — which is not the same as "the network is down".
  if (findAsset(inventory, NETWORK_ASSET_ID)?.health.status === "broken") {
    items.push({
      id: "network-unreachable",
      severity: "warning",
      category: "network",
      title: g.networkTitle,
      detail: g.networkDetail,
      destination: "network",
      action: { label: g.openNetwork, run: { kind: "navigate" } },
    })
  }

  // Node as this machine reports it, for the `engines.node` floors below.
  const nodeVersion = findCatalogAsset(inventory, "node")?.version
  const nodeMajor = majorVersion(nodeVersion)

  for (const tool of CLI_TOOLS) {
    const asset = findCatalogAsset(inventory, tool.id)
    if (!asset?.latestVersion || !upgradeAvailable(asset)) continue
    const latest = asset.latestVersion
    const title = t.catalog.cli[tool.id]?.title ?? tool.id
    const manager = asset.installedVia
    const cmd = upgradeCommandFor(tool, os, manager)

    // npm rejects a package whose `engines.node` floor is above the Node on
    // this machine, and it does it mid-install with EBADENGINE buried in its
    // output. The overview's Upgrade goes straight to `cliInstallStep`, so it
    // never passes the floor check `buildSteps` does — offering it here would
    // stage a command we already know npm will refuse. Point at the Node
    // upgrade that unblocks it instead, and say why.
    //
    // Only the npm path: a native install upgrades through its own installer,
    // where Node's version is irrelevant. An unknown manager counts as npm
    // because that is exactly what `upgradeCommandFor` would run.
    const npmPath = !!tool.npmPackage && manager !== "native"
    const floor = tool.minNodeMajor
    if (npmPath && floor !== undefined && nodeMajor !== undefined && nodeMajor < floor) {
      items.push({
        id: `upgrade-${tool.id}`,
        severity: "warning",
        category: "dependency",
        title: g.upgradeTitle(title, latest),
        detail: g.nodeFloorDetail(floor, nodeVersion ?? String(nodeMajor)),
        destination: "environment",
        action: { label: g.openRuntimes, run: { kind: "navigate" } },
      })
      continue
    }

    items.push({
      id: `upgrade-${tool.id}`,
      severity: "info",
      category: "dependency",
      title: g.upgradeTitle(title, latest),
      detail: asset.version ? g.upgradeFrom(asset.version) : undefined,
      destination: "clis",
      action: cmd
        ? { label: t.shell.upgrade, run: { kind: "upgradeCli", id: tool.id } }
        : { label: g.open, run: { kind: "navigate" } },
    })
  }

  return sortDiagnostics(items)
}

/**
 * Worst first, and stable within a severity so the list doesn't reshuffle
 * between renders — a to-do list whose rows move under the cursor is worse
 * than no to-do list.
 */
export function sortDiagnostics(items: DiagnosticItem[]): DiagnosticItem[] {
  return [...items].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  )
}

/** The worst severity present, for the summary line. Null when the list is clean. */
export function worstSeverity(items: DiagnosticItem[]): DiagnosticSeverity | null {
  for (const s of SEVERITY_ORDER) {
    if (items.some((i) => i.severity === s)) return s
  }
  return null
}
