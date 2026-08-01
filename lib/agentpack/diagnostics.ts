/**
 * The overview's to-do list.
 *
 * Everything here is *derived* from measurements the app already took — the
 * dashboard scan, the CLI detections, the startup network probe. Nothing in
 * this file probes, reads a file, or runs a command; it turns state the user
 * can't interpret into a short list of things they might want to do about it.
 *
 * Two rules the shape enforces:
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
 */

import type { Messages } from "@/lib/i18n/types"
import type { CliInstallManager, OS } from "./types"
import { CLI_TOOLS, upgradeCommandFor } from "./registry"
import { isUpgradeAvailable } from "./version"
import type { SectionKey } from "./workspaces"

export type DiagnosticSeverity = "critical" | "warning" | "info"

/** Rendering order, worst first. */
export const SEVERITY_ORDER: readonly DiagnosticSeverity[] = ["critical", "warning", "info"]

export type DiagnosticAction =
  | { kind: "upgradeCli"; id: string }
  | { kind: "restoreFile"; path: string }
  | { kind: "rescan" }
  | { kind: "openOnboarding" }
  | { kind: "navigate" }

export interface DiagnosticItem {
  id: string
  severity: DiagnosticSeverity
  title: string
  /** One line of context: what was actually observed. Never a guess. */
  detail?: string
  /** Where following this item takes the user. */
  destination: SectionKey
  action: { label: string; run: DiagnosticAction }
}

/** A config file's health, as the dashboard scan reports it. */
export interface FileHealthLike {
  status: "ok" | "invalid" | "missing"
  hasBackup: boolean
}

export interface DiagnosticsInput {
  /**
   * The last dashboard scan, or null when none has landed (web mode, or the
   * first read still in flight). Null produces no items at all — "we haven't
   * looked yet" is not a finding.
   */
  scan: {
    degraded: boolean
    claudeSettings: FileHealthLike
    codexConfig: FileHealthLike
  } | null
  detections: Record<string, { installed: boolean; version?: string }>
  latestVersions: Record<string, string>
  cliManagers: Record<string, CliInstallManager>
  /** null until the startup probe lands, or when it failed outright. */
  networkProbe: { directOk: boolean; bestProxy: unknown | null } | null
  paths: { claudeSettings: string; codexConfig: string } | null
  os: OS
}

/**
 * The agents this app exists to set up. If neither is present, nothing else on
 * the list matters yet — which is why that item outranks everything.
 */
const AGENT_CLI_IDS = ["claude-code", "codex"] as const

export function buildDiagnostics(t: Messages, input: DiagnosticsInput): DiagnosticItem[] {
  const { scan, detections, latestVersions, cliManagers, networkProbe, paths, os } = input
  const g = t.diagnostics
  const items: DiagnosticItem[] = []
  if (!scan) return items

  // A scan that couldn't read its sources is the most important thing on the
  // page, because every other item below it was derived from a partial read and
  // may be wrong. Saying so is the whole point — the alternative is a confident
  // "all clear" drawn from a file we failed to open.
  if (scan.degraded) {
    items.push({
      id: "scan-degraded",
      severity: "critical",
      title: g.degradedTitle,
      detail: g.degradedDetail,
      destination: "dashboard",
      action: { label: g.rescan, run: { kind: "rescan" } },
    })
  }

  if (!AGENT_CLI_IDS.some((id) => detections[id]?.installed)) {
    items.push({
      id: "no-agent",
      severity: "critical",
      title: g.noAgentTitle,
      detail: g.noAgentDetail,
      destination: "presets",
      action: { label: g.setUp, run: { kind: "openOnboarding" } },
    })
  }

  for (const file of [
    { key: "claudeSettings", label: g.fileClaudeSettings, health: scan.claudeSettings },
    { key: "codexConfig", label: g.fileCodexConfig, health: scan.codexConfig },
  ] as const) {
    const path = paths?.[file.key]
    const broken = file.health.status === "invalid"
    // "missing" alone is the normal state on a machine that never set that agent
    // up. It only becomes a finding once a backup proves the file used to exist
    // — otherwise this list would shout at every new machine, forever.
    const vanished = file.health.status === "missing" && file.health.hasBackup
    if (!broken && !vanished) continue
    // Without a backup there is nothing to restore *from*, so the honest action
    // is to open the file, not to offer a repair that can't happen.
    const restorable = file.health.hasBackup && !!path
    items.push({
      id: `config-${file.key}`,
      severity: "critical",
      title: broken ? g.configInvalidTitle(file.label) : g.configMissingTitle(file.label),
      detail: path ?? undefined,
      destination: "config",
      action: restorable
        ? { label: g.restore, run: { kind: "restoreFile", path: path! } }
        : { label: g.open, run: { kind: "navigate" } },
    })
  }

  // A measured probe that reached nothing, directly or through any proxy. Only
  // raised when something was actually measured — a null probe means we never
  // got to look, which is not the same as "the network is down".
  if (networkProbe && !networkProbe.directOk && !networkProbe.bestProxy) {
    items.push({
      id: "network-unreachable",
      severity: "warning",
      title: g.networkTitle,
      detail: g.networkDetail,
      destination: "network",
      action: { label: g.openNetwork, run: { kind: "navigate" } },
    })
  }

  for (const tool of CLI_TOOLS) {
    const det = detections[tool.id]
    const latest = latestVersions[tool.id]
    if (!det?.installed || !latest || !isUpgradeAvailable(det.version, latest)) continue
    const title = t.catalog.cli[tool.id]?.title ?? tool.id
    const cmd = upgradeCommandFor(tool, os, cliManagers[tool.id])
    items.push({
      id: `upgrade-${tool.id}`,
      severity: "info",
      title: g.upgradeTitle(title, latest),
      detail: det.version ? g.upgradeFrom(det.version) : undefined,
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
