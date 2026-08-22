/**
 * The machine's asset inventory: one normalized list of everything agentpack
 * found on this computer, folded from the readings the app already took.
 *
 * Before this file, every section inferred the machine's state for itself — the
 * overview from a scan plus detections, the diagnostics list from seven loose
 * parameters, the MCP and Skills pages from their own reads. Three surfaces
 * describing the same machine in three shapes is how two of them end up
 * disagreeing, and how "what is actually on this machine?" became a question
 * with no single answer to point at.
 *
 * Four rules the shape enforces:
 *
 * 1. **Nothing here measures anything.** Pure and browser-safe, like
 *    `diagnostics` and `scan`: it folds inputs that were already read, so it is
 *    structurally incapable of touching the disk or the network. A missing
 *    reading produces a missing asset, never a probe.
 * 2. **Candidates are not assets.** The registry says what *could* be on a
 *    machine; an asset is something a reading actually found. A machine that
 *    never installed OpenCode has no OpenCode asset — it does not get a row
 *    saying "not installed". What is expected but absent is `drift`, which is a
 *    comparison against a profile, not a property of the machine.
 * 3. **Observed is not verified.** `status` says what the reading showed;
 *    `verifiedAt` says whether anything actually exercised the asset. A
 *    declared MCP server is `healthy` with no `verifiedAt` — the config parses
 *    and names it, and nothing has tried to start it. Collapsing those two into
 *    one green tick is how a page claims a server works because a JSON file
 *    mentions it.
 * 4. **No secrets, by construction.** Every field here is copied explicitly, and
 *    the ones that could carry credential material — a provider's
 *    `settings_config`, a relay token, an MCP server's `env` — are not copied at
 *    all. This model is the input to the export and profile formats in the
 *    roadmap, so a field added carelessly here becomes a credential in a file
 *    the user mails to their other machine.
 */

import type { CliInstallManager, McpTarget } from "./types"
import { CLI_TOOLS, RUNTIMES } from "./registry"
import { isUpgradeAvailable } from "./version"

/**
 * Schema version of `MachineInventory`. Bump it when a field's *meaning*
 * changes, not when one is added — a reader that meets an unknown field must
 * keep it, never drop it.
 */
export const INVENTORY_VERSION = 1

/**
 * What sort of thing an asset is. This is the axis a user groups by — "my
 * agents", "my runtimes", "my MCP servers" — not the axis the code reads it
 * from, which is `id`.
 */
export type AssetKind =
  "agent" | "companion" | "runtime" | "config" | "skill" | "mcp" | "provider" | "network"

/** Every kind, in the order an inventory folds and renders them. */
export const ASSET_KINDS: readonly AssetKind[] = [
  "agent",
  "companion",
  "runtime",
  "config",
  "skill",
  "mcp",
  "provider",
  "network",
]

/**
 * How an asset is doing, as the reading showed it.
 *
 * - `healthy` — found, and nothing wrong was measured.
 * - `attention` — found and usable, but something is pending: an upgrade, a
 *   file that vanished but has a backup, a setting that no longer matches.
 * - `broken` — found and measurably not working: a config that doesn't parse,
 *   a probe that reached nothing.
 * - `unknown` — we could not look. Never used to mean "probably fine".
 */
export type AssetStatus = "healthy" | "attention" | "broken" | "unknown"

/** Worst first. `worstStatus` and every sort in the UI walk this. */
export const STATUS_ORDER: readonly AssetStatus[] = ["broken", "attention", "unknown", "healthy"]

/** Whether an asset applies machine-wide or only inside one project. */
export type AssetScope = "global" | "project"

/**
 * Which reading produced an observation. It is what lets a surface say *why* it
 * believes something, and what makes a stale row explainable rather than wrong.
 */
export type EvidenceSource = "detect" | "scan" | "probe"

export interface AssetEvidence {
  source: EvidenceSource
  /** When the reading was taken (epoch ms). 0 when nothing has been measured. */
  at: number
  /**
   * The observation, as one short line — a version string, a parse failure, a
   * probe result. Facts only, and never a value that could be a credential.
   */
  detail?: string
}

export interface AssetHealth {
  status: AssetStatus
  evidence: AssetEvidence
  /**
   * When something last *exercised* this asset (ran it, parsed it, connected to
   * it) — as opposed to merely listing it. Absent means nothing has, which is a
   * different claim from "it failed" and is rendered differently.
   */
  verifiedAt?: number
}

export interface Asset {
  /**
   * `${kind}:${localId}`, unique within an inventory. The local half is stable
   * across scans: a registry id for a catalog asset, the user's own id for one
   * they added by hand.
   */
  id: string
  kind: AssetKind
  /**
   * The registry id this asset corresponds to, when agentpack's catalog knows
   * it. Absent means the user added it themselves — which is exactly the line
   * `classifyAgainstRegistry` already draws, carried forward instead of being
   * re-derived per section.
   */
  catalogId?: string
  /**
   * The name the *user* chose, when the asset has one — a provider's label, a
   * hand-added MCP id. Absent for catalog assets, whose display text comes from
   * the i18n catalog rather than from the machine.
   */
  name?: string
  health: AssetHealth
  /** As measured on this machine. Absent when nothing reported a version. */
  version?: string
  /** The newest version something knows about, when anything checked. */
  latestVersion?: string
  /** How it got here, when that was determined. */
  installedVia?: CliInstallManager
  /** Absolute path, for an asset that is a file or a directory. */
  path?: string
  scope?: AssetScope
  /**
   * The agents this asset applies to. Empty means machine-wide — a runtime and
   * a network reading belong to no single agent.
   */
  targets: readonly string[]
  /**
   * What a rollback of this asset would restore from — a backup path, or a
   * snapshot / quarantine batch id. Its *presence* is the claim that undoing is
   * possible; absence means there is nothing to restore from, and a surface
   * that offers "restore" anyway is offering a repair that cannot happen.
   */
  restorePoint?: string
}

export interface MachineInventory {
  version: number
  /** When the pass that produced these readings was taken. 0 when unmeasured. */
  at: number
  /**
   * At least one source could not be read — as opposed to not being there.
   * Inherited from the scan, and it taints every count derived from this
   * inventory: a total drawn from a partial read is a wrong total, not a small
   * one.
   */
  degraded: boolean
  /**
   * Whether this machine was looked at at all. False in web mode and during the
   * first read, where an empty inventory means "we haven't looked", not "the
   * machine is empty" — and callers must render those two differently.
   */
  measured: boolean
  assets: readonly Asset[]
}

/** A config file's health, in the shape the dashboard scan reports it. */
export interface FileHealthLike {
  status: "ok" | "invalid" | "missing"
  hasBackup: boolean
}

/** Ids split into ones the registry knows vs. ones the user added. */
export interface ClassifiedLike {
  known: readonly string[]
  custom: readonly string[]
}

/**
 * The scan's subset this fold reads. Deliberately narrower than `DashboardScan`
 * — naming only what is folded keeps a field the scan grows from silently
 * appearing in an exported profile.
 */
export interface InventoryScan {
  at: number
  degraded: boolean
  claudeSettings: FileHealthLike
  codexConfig: FileHealthLike
  claudeMcps?: ClassifiedLike
  codexMcps?: ClassifiedLike
  opencodeMcps?: ClassifiedLike
  claudeSkills?: ClassifiedLike
  codexSkills?: ClassifiedLike
  /**
   * cc-switch / native provider records. Only `id`, `name`, `app_type` and
   * `is_current` are read: `settings_config` holds the endpoint token, and
   * nothing in this model is allowed to carry it.
   */
  providers?: readonly {
    id: string
    name: string
    app_type: string
    is_current: boolean
  }[]
}

export interface InventoryInput {
  /**
   * The last scan, or null when none has landed. Null yields an inventory with
   * `measured: false` — the assets folded from other readings are still real,
   * but no caller may read the absence of a scanned asset as its absence from
   * the machine.
   */
  scan: InventoryScan | null
  detections: Record<string, { installed: boolean; version?: string }>
  latestVersions: Record<string, string>
  cliManagers: Record<string, CliInstallManager>
  /** null until the startup probe lands, or when it failed outright. */
  networkProbe: { directOk: boolean; bestProxy: unknown | null } | null
  paths: { claudeSettings: string; codexConfig: string } | null
  /**
   * When this fold's readings were taken. Defaults to the scan's own timestamp,
   * which is what the dashboard has: it reads detections and the scan in one
   * pass, and dating them apart would be a fiction.
   */
  at?: number
}

/** The two config files this app repairs, and the order they are folded in. */
export const CONFIG_ASSET_IDS = ["claudeSettings", "codexConfig"] as const
export type ConfigAssetId = (typeof CONFIG_ASSET_IDS)[number]

/** The single network reading, as an asset id. */
export const NETWORK_ASSET_ID = "network:reachability"

export function assetId(kind: AssetKind, localId: string): string {
  return `${kind}:${localId}`
}

/**
 * Whether a newer version is known for this asset.
 *
 * The fold sets `attention` from this, and `diagnostics` asks it again when it
 * needs the answer — one implementation, two readers. Re-deriving it from
 * `status` instead would tie every caller to the fact that an upgrade is the
 * *only* reason a CLI is currently marked `attention`, which is exactly the
 * kind of coupling that breaks the first time something else earns that status.
 */
export function upgradeAvailable(asset: Asset): boolean {
  return !!asset.latestVersion && isUpgradeAvailable(asset.version, asset.latestVersion)
}

/**
 * Fold every reading into one asset list.
 *
 * Order is fixed and derived from the registries rather than from a Map's
 * insertion order, so two folds of the same machine produce the same list and a
 * rescan doesn't reshuffle rows under the user's cursor.
 */
export function buildInventory(input: InventoryInput): MachineInventory {
  const { scan, detections, latestVersions, cliManagers, networkProbe, paths } = input
  const at = input.at ?? scan?.at ?? 0
  const assets: Asset[] = []

  // ---- Installed CLIs and runtimes -----------------------------------------
  // A detection ran the binary (or looked for the app bundle), so it counts as
  // a verification, not just a listing.
  for (const tool of CLI_TOOLS) {
    const det = detections[tool.id]
    if (!det?.installed) continue
    const asset: Asset = {
      id: assetId(tool.kind, tool.id),
      kind: tool.kind,
      catalogId: tool.id,
      version: det.version,
      latestVersion: latestVersions[tool.id],
      installedVia: cliManagers[tool.id],
      targets: [],
      health: {
        status: "healthy",
        verifiedAt: at,
        evidence: { source: "detect", at, detail: det.version },
      },
    }
    if (upgradeAvailable(asset)) asset.health.status = "attention"
    assets.push(asset)
  }

  for (const runtime of RUNTIMES) {
    const det = detections[runtime.id]
    if (!det?.installed) continue
    assets.push({
      id: assetId("runtime", runtime.id),
      kind: "runtime",
      catalogId: runtime.id,
      version: det.version,
      latestVersion: latestVersions[runtime.id],
      targets: [],
      health: {
        status: "healthy",
        verifiedAt: at,
        evidence: { source: "detect", at, detail: det.version },
      },
    })
  }

  // ---- Config files --------------------------------------------------------
  // A file that is simply missing is the normal state of a machine that never
  // set that agent up, so it is not an asset. It becomes one the moment a
  // backup proves it used to exist — that is a thing that was here and left,
  // which is the only reading of "missing" worth a row.
  if (scan) {
    for (const key of CONFIG_ASSET_IDS) {
      const health = key === "claudeSettings" ? scan.claudeSettings : scan.codexConfig
      const path = paths?.[key]
      if (health.status === "missing" && !health.hasBackup) continue
      const status: AssetStatus =
        health.status === "ok" ? "healthy" : health.status === "invalid" ? "broken" : "attention"
      assets.push({
        id: assetId("config", key),
        kind: "config",
        path,
        scope: "global",
        targets: [key === "claudeSettings" ? "claude" : "codex"],
        // A restore needs something to restore *from*, and somewhere to put it.
        // Either half missing means there is no rollback, and the model must not
        // imply one.
        restorePoint: health.hasBackup && path ? path : undefined,
        health: {
          status,
          // Parsing the file is what produced this reading, so an `ok` or an
          // `invalid` was genuinely exercised. A vanished file was not — there
          // was nothing left to open.
          verifiedAt: health.status === "missing" ? undefined : at,
          evidence: { source: "scan", at, detail: path },
        },
      })
    }

    // ---- Declared capabilities ---------------------------------------------
    // Declared, not verified: the config names them and parses. Whether the
    // server starts or the skill's files are intact is a separate reading that
    // nothing here has taken.
    for (const asset of foldDeclared("skill", at, [
      { target: "claude", ids: scan.claudeSkills },
      { target: "codex", ids: scan.codexSkills },
    ])) {
      assets.push(asset)
    }
    for (const asset of foldDeclared("mcp", at, [
      { target: "claude", ids: scan.claudeMcps },
      { target: "codex", ids: scan.codexMcps },
      { target: "opencode", ids: scan.opencodeMcps },
    ])) {
      assets.push(asset)
    }

    // ---- Providers ---------------------------------------------------------
    // Four fields, copied one at a time. `settings_config` carries the endpoint
    // and its token, and it is the reason this loop does not spread.
    for (const provider of scan.providers ?? []) {
      assets.push({
        id: assetId("provider", provider.id),
        kind: "provider",
        name: provider.name,
        scope: "global",
        targets: [provider.app_type],
        health: {
          status: "healthy",
          evidence: { source: "scan", at },
        },
      })
    }
  }

  // ---- Network -------------------------------------------------------------
  // A probe that reached nothing, directly or through any proxy, is a measured
  // failure. A null probe is not a failure — it means we never got to look, and
  // the machine may well be online.
  if (networkProbe) {
    const reachable = networkProbe.directOk || !!networkProbe.bestProxy
    assets.push({
      id: NETWORK_ASSET_ID,
      kind: "network",
      targets: [],
      health: {
        status: reachable ? "healthy" : "broken",
        verifiedAt: at,
        evidence: { source: "probe", at },
      },
    })
  }

  return {
    version: INVENTORY_VERSION,
    at,
    degraded: scan?.degraded ?? false,
    measured: scan !== null,
    assets,
  }
}

/**
 * One asset per id, carrying every agent it is declared in — rather than one
 * per (agent, id) pair, which triple-counts anything installed everywhere.
 * Registry entries first, then user-added ones, alphabetical within each group.
 */
function foldDeclared(
  kind: Extract<AssetKind, "skill" | "mcp">,
  at: number,
  groups: readonly { target: McpTarget; ids?: ClassifiedLike }[]
): Asset[] {
  const byId = new Map<string, { targets: string[]; custom: boolean }>()
  for (const { target, ids } of groups) {
    if (!ids) continue
    for (const id of [...ids.known, ...ids.custom]) {
      const entry = byId.get(id) ?? { targets: [], custom: false }
      if (!entry.targets.includes(target)) entry.targets.push(target)
      if (ids.custom.includes(id)) entry.custom = true
      byId.set(id, entry)
    }
  }
  return [...byId.entries()]
    .sort(([aId, a], [bId, b]) => Number(a.custom) - Number(b.custom) || aId.localeCompare(bId))
    .map(([id, entry]) => ({
      id: assetId(kind, id),
      kind,
      catalogId: entry.custom ? undefined : id,
      name: entry.custom ? id : undefined,
      scope: "global" as const,
      targets: entry.targets,
      health: {
        status: "healthy" as const,
        evidence: { source: "scan" as const, at },
      },
    }))
}

/** An empty inventory: nothing looked at yet. Not "an empty machine". */
export function emptyInventory(): MachineInventory {
  return { version: INVENTORY_VERSION, at: 0, degraded: false, measured: false, assets: [] }
}

export function assetsOfKind(inventory: MachineInventory, kind: AssetKind): Asset[] {
  return inventory.assets.filter((a) => a.kind === kind)
}

export function findAsset(inventory: MachineInventory, id: string): Asset | undefined {
  return inventory.assets.find((a) => a.id === id)
}

/**
 * The asset for a registry id, whatever kind it turned out to be — a CLI's kind
 * depends on the catalog entry, so a caller that knows "claude-code" should not
 * have to know it is an `agent` rather than a `companion` to look it up.
 */
export function findCatalogAsset(
  inventory: MachineInventory,
  catalogId: string
): Asset | undefined {
  return inventory.assets.find((a) => a.catalogId === catalogId)
}

/** How many assets sit at each status. Every key present, including the zeroes. */
export function countByStatus(inventory: MachineInventory): Record<AssetStatus, number> {
  const counts: Record<AssetStatus, number> = {
    broken: 0,
    attention: 0,
    unknown: 0,
    healthy: 0,
  }
  for (const asset of inventory.assets) counts[asset.health.status] += 1
  return counts
}

/** The worst status present, for a summary line. Null when there is nothing. */
export function worstStatus(assets: readonly Asset[]): AssetStatus | null {
  for (const status of STATUS_ORDER) {
    if (assets.some((a) => a.health.status === status)) return status
  }
  return null
}

export type DriftKind = "missing" | "extra" | "version"

export interface DriftItem {
  /** The asset id this is about — present or not, it is the same identity. */
  assetId: string
  kind: DriftKind
  /** What the profile asked for. Absent for `extra`, which asked for nothing. */
  expected?: string
  /** What the machine has. Absent for `missing`, which has nothing. */
  actual?: string
}

export interface ExpectedAsset {
  /** Full asset id, as `assetId()` builds it. */
  id: string
  /** Exact version the profile pins, when it pins one. */
  version?: string
}

/**
 * Compare a machine against what a profile expects.
 *
 * Only assets the profile *names* can drift: an inventory holds far more than
 * any one profile describes, and reporting every unlisted asset as `extra`
 * would bury the three real differences under forty rows. `extra` therefore
 * means "the profile named this and asked for it to be gone", which is a thing
 * a profile has to say explicitly — expressed by listing the id with an
 * `absent` marker in a later revision of this model, and until then never
 * produced by this fold.
 *
 * An unmeasured inventory yields nothing at all. Comparing a machine we could
 * not read against a profile would report every asset as missing and offer to
 * reinstall a machine that is already complete.
 */
export function driftFrom(
  inventory: MachineInventory,
  expected: readonly ExpectedAsset[]
): DriftItem[] {
  if (!inventory.measured) return []
  const items: DriftItem[] = []
  for (const want of expected) {
    const asset = findAsset(inventory, want.id)
    if (!asset) {
      items.push({ assetId: want.id, kind: "missing", expected: want.version })
      continue
    }
    // A pin with nothing to compare against is not a match — we cannot claim a
    // version is right when the machine never reported one.
    if (want.version !== undefined && asset.version !== want.version) {
      items.push({
        assetId: want.id,
        kind: "version",
        expected: want.version,
        actual: asset.version,
      })
    }
  }
  return items
}
