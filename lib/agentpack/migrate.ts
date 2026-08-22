/**
 * Reproducing an environment on another machine.
 *
 * The bundle format already carries what one install has (`bundle/format`), and
 * `bundle/apply` already diffs an incoming bundle against the local *intent* —
 * plan against plan, profiles against profiles, settings against settings. What
 * nothing did was compare a profile against the **machine**: after an import the
 * user has a plan, and no one has told them that three of its seven tools aren't
 * installed here, or that the two credentials the file deliberately refused to
 * carry are the reason nothing works yet.
 *
 * That is what this is for, and it is the last mile of "reproduce this
 * environment somewhere else": the file can carry everything except the things
 * it must not, so the honest completion of an import is a short list of exactly
 * those things.
 *
 * Three rules the shape enforces:
 *
 * 1. **The comparison is against the inventory, not against another plan.**
 *    `driftFrom` does the work, which means a profile is judged against what a
 *    reading actually found rather than against what some other file intended.
 * 2. **An unmeasured machine is compared to nothing.** Inherited from
 *    `driftFrom`: every asset would read as missing, and the fix offered would
 *    be to reinstall a machine that is already complete.
 * 3. **The credentials list is derived from the file, never from a second copy
 *    of the redaction rule.** `blankedSecrets` reads what the bundle actually
 *    carries; a checklist written from its own idea of what is secret would
 *    drift from the redaction the moment either changed, and the direction it
 *    drifts in is "we forgot to tell you about this key".
 */

import { assetId, driftFrom, type DriftItem, type MachineInventory } from "./inventory"
import { blankedSecrets, type BundleFileKey } from "./bundle/secrets"
import { findCli, findMcp } from "./registry"
import { isProxyActive } from "./network/proxy"
import type { ExpectedAsset } from "./inventory"
import type { Plan } from "./types"

/**
 * What a profile's plan expects this machine to have.
 *
 * Only what was actually asked for: a capability with no targets is not a
 * selection, and expecting it would report a machine as incomplete for
 * something the user unticked. A CLI the registry no longer knows is skipped
 * rather than guessed at — its kind is what makes its asset id, and an id built
 * from a guess would never match anything.
 */
export function expectedFrom(plan: Plan): ExpectedAsset[] {
  const expected: ExpectedAsset[] = []
  for (const id of plan.clis) {
    const tool = findCli(id)
    if (tool) expected.push({ id: assetId(tool.kind, id) })
  }
  for (const skill of plan.skills) {
    if (skill.targets.length > 0) expected.push({ id: assetId("skill", skill.id) })
  }
  for (const mcp of plan.mcps) {
    if (mcp.targets.length > 0) expected.push({ id: assetId("mcp", mcp.id) })
  }
  return expected
}

/** What only a human can supply after an import. */
export type CredentialKind = "mcpKey" | "proxyPassword" | "configField"

export interface PendingCredential {
  kind: CredentialKind
  /** What it belongs to — an MCP id, the proxy, a config file. */
  owner: string
  /** The env var or dotted field path, when there is one to name. */
  field?: string
}

export interface MigrationReport {
  /**
   * Whether the machine was read at all. False means every count below is about
   * nothing, and a caller must say so rather than render zeroes.
   */
  measured: boolean
  /** Expected here, not found. */
  missing: readonly DriftItem[]
  /** Present, but not at the version the profile pinned. */
  versionDrift: readonly DriftItem[]
  /** How many of the profile's expectations this machine already meets. */
  satisfied: number
  /** How many it expects in total. */
  expected: number
  /** What the file could not carry. Empty when nothing was withheld. */
  credentials: readonly PendingCredential[]
}

/**
 * The half of a migration that is about the *file*, not the machine. Narrower
 * than `MigrationInput` on purpose: the import dialog answers "what did this
 * file refuse to carry" long before anything has read the machine, and making
 * it hand over an inventory it has no use for would be asking for a stub.
 */
export interface CredentialSource {
  /** The profile being reproduced. */
  plan: Plan
  /**
   * The config-file texts the bundle carries, as they are in the file — already
   * redacted. Omit when reproducing a local profile, which withheld nothing.
   */
  files?: Partial<Record<BundleFileKey, string>>
}

export interface MigrationInput extends CredentialSource {
  inventory: MachineInventory
}

/**
 * Compare a profile against this machine, and say what only a human can finish.
 */
export function compareToMachine(input: MigrationInput): MigrationReport {
  const { inventory, plan } = input
  const expected = expectedFrom(plan)
  const drift = driftFrom(inventory, expected)
  const missing = drift.filter((d) => d.kind === "missing")
  const versionDrift = drift.filter((d) => d.kind === "version")
  return {
    measured: inventory.measured,
    missing,
    versionDrift,
    // Only meaningful once something has looked; `driftFrom` returns nothing for
    // an unmeasured machine, which would otherwise read as "all satisfied".
    satisfied: inventory.measured ? expected.length - drift.length : 0,
    expected: expected.length,
    credentials: pendingCredentials(input),
  }
}

/**
 * Everything the transfer deliberately refused to carry, in one list.
 *
 * Three sources, and each is read from the artefact rather than assumed:
 * the plan's own key-gated servers, the proxy that has a URL but no password
 * left in it, and the blanked fields still sitting in the config texts.
 */
export function pendingCredentials(input: CredentialSource): PendingCredential[] {
  const { plan, files } = input
  const out: PendingCredential[] = []

  // A server that needs a key and has none installs cleanly and then never
  // answers — the same fact the pre-flight brief warns about before a run.
  for (const entry of plan.mcps) {
    if (entry.targets.length === 0) continue
    const server = findMcp(entry.id)
    if (server?.keyEnv && !plan.mcpKeys[entry.id]) {
      out.push({ kind: "mcpKey", owner: entry.id, field: server.keyEnv })
    }
  }

  // `redactPlan` strips the proxy password and the client-key passphrase. A
  // proxy that isn't switched on needs neither, so an inactive one is not a
  // chore.
  const proxy = plan.network.proxy
  if (proxy && isProxyActive(proxy)) {
    if (proxy.username && !proxy.password) {
      out.push({ kind: "proxyPassword", owner: "proxy", field: "password" })
    }
    if (proxy.clientCertPath && !proxy.clientKeyPassphrase) {
      out.push({ kind: "proxyPassword", owner: "proxy", field: "clientKeyPassphrase" })
    }
  }

  for (const [key, text] of Object.entries(files ?? {})) {
    if (!text) continue
    for (const field of blankedSecrets(key as BundleFileKey, text)) {
      out.push({ kind: "configField", owner: key, field })
    }
  }

  return out
}

/**
 * How much of a profile a machine already satisfies, 0–1.
 *
 * Null rather than 1 for a profile that expects nothing, and null for an
 * unmeasured machine: both are "there is no ratio here", and rendering either
 * as 100% would say this machine matches a profile nobody has compared it to.
 */
export function completeness(report: MigrationReport): number | null {
  if (!report.measured || report.expected === 0) return null
  return report.satisfied / report.expected
}
