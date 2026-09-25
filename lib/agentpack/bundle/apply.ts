import { redactPlan } from "../config"
import type { Profile } from "../profile"
import { findCli, installMethodsFor } from "../registry"
import { MCP_TARGETS, type AgentTarget, type OS, type Plan } from "../types"
import type { AppSettings } from "@/lib/tauri/settings"
import { parseDoc, type BundleFileKey } from "./secrets"

/**
 * Turning a parsed bundle into "what would change" and then into the change
 * itself. Kept apart from the dialog so the preview the user approves and the
 * result they get are computed by the same functions.
 */

export type PlanMode = "replace" | "merge"
export type ProfilesMode = "merge" | "replace" | "skip"

const AGENT_TARGETS: readonly AgentTarget[] = ["claude", "codex"]

export interface IdDiff {
  added: string[]
  removed: string[]
}

export interface PlanDiff {
  clis: IdDiff
  skills: IdDiff
  mcps: IdDiff
  networkChanged: boolean
}

function diffIds(local: string[], incoming: string[], mode: PlanMode): IdDiff {
  return {
    added: incoming.filter((id) => !local.includes(id)),
    // Merge only ever adds, so showing removals there would be a lie about what
    // the button is going to do.
    removed: mode === "merge" ? [] : local.filter((id) => !incoming.includes(id)),
  }
}

/** What importing `incoming` under `mode` would change about the local plan. */
export function diffPlan(local: Plan, incoming: Plan, mode: PlanMode): PlanDiff {
  return {
    clis: diffIds([...local.clis], [...incoming.clis], mode),
    skills: diffIds(
      local.skills.map((s) => s.id),
      incoming.skills.map((s) => s.id),
      mode
    ),
    mcps: diffIds(
      local.mcps.map((m) => m.id),
      incoming.mcps.map((m) => m.id),
      mode
    ),
    // Compared after redaction, so a bundle that merely withheld the proxy
    // password doesn't read as a network change.
    networkChanged:
      JSON.stringify(redactPlan(local).network) !== JSON.stringify(redactPlan(incoming).network),
  }
}

/** Union two target lists in the canonical order, never in click order. */
function unionTargets<T extends string>(canonical: readonly T[], a: readonly T[], b: readonly T[]) {
  const seen = new Set<T>([...a, ...b])
  return canonical.filter((t) => seen.has(t))
}

function mergeEntries<T extends string>(
  canonical: readonly T[],
  local: { id: string; targets: T[] }[],
  incoming: { id: string; targets: T[] }[]
) {
  const out = local.map((e) => ({ ...e, targets: [...e.targets] }))
  for (const entry of incoming) {
    const match = out.find((e) => e.id === entry.id)
    if (match) match.targets = unionTargets(canonical, match.targets, entry.targets)
    else out.push({ ...entry, targets: unionTargets(canonical, [], entry.targets) })
  }
  return out
}

/**
 * Add the incoming plan to the local one without taking anything away. Selections
 * union; per-item targets union; network settings fill in only where the local
 * plan had nothing.
 */
export function mergePlan(local: Plan, incoming: Plan): Plan {
  return {
    ...local,
    clis: [...local.clis, ...incoming.clis.filter((id) => !local.clis.includes(id))],
    cliMethods:
      local.cliMethods || incoming.cliMethods
        ? { ...local.cliMethods, ...incoming.cliMethods }
        : undefined,
    skills: mergeEntries(AGENT_TARGETS, local.skills, incoming.skills),
    mcps: mergeEntries(MCP_TARGETS, local.mcps, incoming.mcps),
    mcpKeys: { ...local.mcpKeys, ...incoming.mcpKeys },
    network: {
      npmRegistry: incoming.network.npmRegistry ?? local.network.npmRegistry,
      proxy: incoming.network.proxy ?? local.network.proxy,
    },
  }
}

/**
 * Put back any secret the exporting side redacted, in both modes.
 *
 * A shared plan is expected to arrive with empty `mcpKeys` and no proxy
 * password; without this, applying one would silently deauthenticate every MCP
 * server the user had working.
 */
export function keepLocalSecrets(next: Plan, local: Plan): Plan {
  const mcpKeys = { ...next.mcpKeys }
  for (const [id, key] of Object.entries(local.mcpKeys)) {
    if (!mcpKeys[id] && key) mcpKeys[id] = key
  }
  const proxy = next.network.proxy
  return {
    ...next,
    mcpKeys,
    network: {
      ...next.network,
      proxy: proxy
        ? {
            ...proxy,
            password: proxy.password || local.network.proxy?.password,
            clientKeyPassphrase:
              proxy.clientKeyPassphrase || local.network.proxy?.clientKeyPassphrase,
          }
        : proxy,
    },
  }
}

/**
 * Re-stamp a plan onto the importing machine's OS, dropping install methods that
 * OS doesn't offer. A bundle written on Windows otherwise carries `winget` picks
 * into a macOS plan, where the step builder would emit a command that can't run.
 */
export function retargetPlanOs(plan: Plan, os: OS): Plan {
  if (plan.os === os) return plan
  const cliMethods = plan.cliMethods
    ? Object.fromEntries(
        Object.entries(plan.cliMethods).filter(([cliId, methodId]) => {
          const tool = findCli(cliId)
          return tool && installMethodsFor(tool, os).some((m) => m.id === methodId)
        })
      )
    : undefined
  return { ...plan, os, cliMethods }
}

export interface ProfilesDiff {
  fresh: number
  updated: number
  /**
   * Local profiles the bundle doesn't carry — what "Replace" deletes. Merge
   * keeps them, so a caller only states this for replace.
   */
  dropped: number
}

export function diffProfiles(local: Profile[], incoming: Profile[]): ProfilesDiff {
  const ids = new Set(local.map((p) => p.id))
  const incomingIds = new Set(incoming.map((p) => p.id))
  return {
    fresh: incoming.filter((p) => !ids.has(p.id)).length,
    updated: incoming.filter((p) => ids.has(p.id)).length,
    dropped: local.filter((p) => !incomingIds.has(p.id)).length,
  }
}

/**
 * Profile ids are `${time}-${random}`, so a cross-machine collision can't happen
 * by chance — a match means this exact profile has travelled before, which makes
 * "incoming wins" an update rather than a clash.
 */
export function mergeProfiles(
  local: Profile[],
  incoming: Profile[],
  mode: ProfilesMode
): Profile[] {
  if (mode === "skip") return local
  if (mode === "replace") return incoming
  const byId = new Map(incoming.map((p) => [p.id, p]))
  const kept = local.map((p) => byId.get(p.id) ?? p)
  const localIds = new Set(local.map((p) => p.id))
  return [...kept, ...incoming.filter((p) => !localIds.has(p.id))]
}

export interface FileDiff {
  key: BundleFileKey
  status: "new" | "same" | "differs"
  /** Top-level keys whose value differs — a readable summary, not a byte compare. */
  changedKeys: string[]
  /** Local file exists but doesn't parse, so its secrets can't be preserved. */
  localUnreadable: boolean
}

export function diffFiles(
  incoming: Partial<Record<BundleFileKey, string>>,
  local: Partial<Record<BundleFileKey, string>>
): FileDiff[] {
  const out: FileDiff[] = []
  for (const [k, text] of Object.entries(incoming) as [BundleFileKey, string][]) {
    const here = local[k] ?? ""
    if (!here.trim()) {
      out.push({ key: k, status: "new", changedKeys: [], localUnreadable: false })
      continue
    }
    const localDoc = parseDoc(k, here)
    if (!localDoc) {
      out.push({ key: k, status: "differs", changedKeys: [], localUnreadable: true })
      continue
    }
    if (here === text) {
      out.push({ key: k, status: "same", changedKeys: [], localUnreadable: false })
      continue
    }
    const incomingDoc = parseDoc(k, text) ?? {}
    const keys = new Set([...Object.keys(localDoc), ...Object.keys(incomingDoc)])
    const changedKeys = [...keys].filter(
      (key) => JSON.stringify(localDoc[key]) !== JSON.stringify(incomingDoc[key])
    )
    out.push({ key: k, status: "differs", changedKeys, localUnreadable: false })
  }
  return out
}

export interface SettingsChange {
  key: keyof AppSettings
  from: unknown
  to: unknown
}

export function diffSettings(local: AppSettings, incoming: Partial<AppSettings>): SettingsChange[] {
  const out: SettingsChange[] = []
  for (const [key, to] of Object.entries(incoming) as [keyof AppSettings, unknown][]) {
    const from = local[key]
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ key, from, to })
  }
  return out
}

/**
 * The settings half of `keepLocalSecrets`: a redacted bundle arrives with the
 * proxy password and client-key passphrase blanked, and applying it as-is would
 * wipe the ones this machine already had — exactly what the export dialog's
 * "importing puts your own back" promises won't happen.
 */
export function keepLocalSettingsSecrets(
  incoming: Partial<AppSettings>,
  local: AppSettings
): Partial<AppSettings> {
  const proxy = incoming.proxy
  if (!proxy) return incoming
  return {
    ...incoming,
    proxy: {
      ...proxy,
      password: proxy.password || local.proxy?.password,
      clientKeyPassphrase: proxy.clientKeyPassphrase || local.proxy?.clientKeyPassphrase,
    },
  }
}

/** A value as the review shows it: a proxy's secrets masked, everything else as JSON. */
function settingValue(key: keyof AppSettings, value: unknown): string {
  if (key !== "proxy" || !value || typeof value !== "object") return JSON.stringify(value) ?? "null"
  const proxy = value as NonNullable<AppSettings["proxy"]>
  return JSON.stringify({
    ...proxy,
    ...(proxy.password ? { password: "•••" } : {}),
    ...(proxy.clientKeyPassphrase ? { clientKeyPassphrase: "•••" } : {}),
  })
}

/**
 * One changed setting as a single review line — `key: from → to`. This text
 * lands in the import dialog and in the run log, so the proxy's credentials are
 * masked rather than printed: `from` is this machine's own, and after
 * `keepLocalSettingsSecrets` so is `to`.
 */
export function describeSettingsChange(change: SettingsChange): string {
  return `${String(change.key)}: ${settingValue(change.key, change.from)} → ${settingValue(change.key, change.to)}`
}
