import { findCli, findMcp, findSkill, installMethodsFor } from "./registry"
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { PROXY_TARGETS, type Plan, type ProxyMode, type ProxyTarget } from "./types"

/** Bumped when the on-disk config schema changes incompatibly. */
export const CONFIG_VERSION = 1

export interface SerializeOptions {
  /** Include API keys / relay token in the output (default: redact). */
  includeSecrets?: boolean
}

/**
 * Serialize a Plan to a shareable JSON config. Secrets (MCP keys, proxy
 * credentials) are redacted by default so the file is safe to commit; on load
 * they are refilled from a provided secrets map via `fillSecrets`.
 */
/**
 * A copy of `plan` with every secret it carries stripped: MCP API keys, the
 * proxy password and the client-key passphrase. Split out of `serializePlan` so
 * the backup bundle — which also embeds plans inside saved profiles — redacts by
 * calling this rather than by keeping a second list of secret fields in sync.
 */
export function redactPlan(plan: Plan): Plan {
  return {
    ...plan,
    mcpKeys: {},
    network: {
      ...plan.network,
      // The proxy password ends up inside the proxy URL wherever it is applied,
      // but a shared config file must not carry it.
      proxy: plan.network.proxy
        ? { ...plan.network.proxy, password: undefined, clientKeyPassphrase: undefined }
        : undefined,
    },
  }
}

export function serializePlan(plan: Plan, opts: SerializeOptions = {}): string {
  const src = opts.includeSecrets ? plan : redactPlan(plan)
  const out = {
    version: CONFIG_VERSION,
    os: src.os,
    clis: src.clis,
    // Chosen install channel per CLI (undefined omitted by JSON.stringify).
    cliMethods: src.cliMethods,
    skills: src.skills,
    mcps: src.mcps,
    mcpKeys: src.mcpKeys,
    network: src.network,
  }
  return JSON.stringify(out, null, 2) + "\n"
}

/**
 * Narrow a loaded `network` block to values we're willing to act on. A config
 * file can be hand-edited or shared, and its proxy settings end up in commands
 * and config files — so an unknown mode or target is dropped rather than carried
 * into the plan.
 */
/**
 * Narrow a loaded proxy block to a mode and targets we recognize. Exported so
 * the backup bundle can apply the same rule to an imported `settings.proxy`,
 * which reaches the app by exactly the same untrusted route.
 */
export function sanitizeProxy(raw: Plan["network"]["proxy"]): Plan["network"]["proxy"] {
  if (!raw || typeof raw !== "object") return undefined
  const mode: ProxyMode =
    raw.mode === "manual" || raw.mode === "system" || raw.mode === "off" ? raw.mode : "off"
  const targets = Array.isArray(raw.targets)
    ? raw.targets.filter((t): t is ProxyTarget => PROXY_TARGETS.includes(t))
    : []
  return { ...raw, mode, targets }
}

function sanitizeNetwork(network: Plan["network"]): Plan["network"] {
  // Rebuilt from known fields rather than spread: a config written by an older
  // agentpack still carries `apiBaseUrl` / `apiToken` from the removed relay
  // card, and carrying those forward would resurrect a second writer for the
  // agent CLIs' endpoint. Relay config lives in the provider list now.
  const kept: Plan["network"] = { npmRegistry: network.npmRegistry }
  const proxy = sanitizeProxy(network.proxy)
  return proxy ? { ...kept, proxy } : kept
}

/**
 * Parse + validate a config JSON into a Plan. Rejects unknown OS / ids with
 * localized errors. Never trusts the file shape blindly.
 */
export function parseConfig(json: string, messages: Messages = en): Plan {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    throw new Error(messages.errors.invalidJson)
  }

  const os = data["os"]
  if (os !== "win" && os !== "mac" && os !== "linux") {
    throw new Error(messages.errors.unknownOs(String(os)))
  }

  const clis = Array.isArray(data["clis"]) ? (data["clis"] as string[]) : []
  for (const id of clis) {
    if (!findCli(id)) throw new Error(messages.errors.unknownCli(String(id)))
  }

  // Validate the chosen install method per CLI: the CLI must be known and the
  // method id must be one this tool actually offers on the config's OS.
  const rawCliMethods =
    data["cliMethods"] && typeof data["cliMethods"] === "object"
      ? (data["cliMethods"] as Record<string, string>)
      : undefined
  if (rawCliMethods) {
    for (const [cliId, methodId] of Object.entries(rawCliMethods)) {
      const tool = findCli(cliId)
      if (!tool) throw new Error(messages.errors.unknownCli(String(cliId)))
      if (!installMethodsFor(tool, os).some((mth) => mth.id === methodId)) {
        throw new Error(messages.errors.unknownMethod(String(methodId)))
      }
    }
  }

  const rawSkills = Array.isArray(data["skills"]) ? (data["skills"] as Plan["skills"]) : []
  for (const s of rawSkills) {
    if (!findSkill(s?.id)) throw new Error(messages.errors.unknownSkill(String(s?.id)))
  }

  const rawMcps = Array.isArray(data["mcps"]) ? (data["mcps"] as Plan["mcps"]) : []
  for (const m of rawMcps) {
    if (!findMcp(m?.id)) throw new Error(messages.errors.unknownMcp(String(m?.id)))
  }

  const mcpKeys =
    data["mcpKeys"] && typeof data["mcpKeys"] === "object"
      ? (data["mcpKeys"] as Plan["mcpKeys"])
      : {}
  const network =
    data["network"] && typeof data["network"] === "object"
      ? sanitizeNetwork(data["network"] as Plan["network"])
      : {}

  return {
    os,
    clis: clis as Plan["clis"],
    cliMethods: rawCliMethods,
    skills: rawSkills,
    mcps: rawMcps,
    mcpKeys,
    network,
  }
}

/**
 * Fill missing MCP keys from a provided secrets map. Used after loading a
 * redacted config so a replay can still authenticate. Keys are looked up by each
 * server's `keyEnv`.
 */
export function fillSecrets(plan: Plan, secrets: Record<string, string | undefined> = {}): Plan {
  const mcpKeys = { ...plan.mcpKeys }
  for (const m of plan.mcps) {
    const server = findMcp(m.id)
    if (server?.keyEnv && !mcpKeys[m.id] && secrets[server.keyEnv]) {
      mcpKeys[m.id] = secrets[server.keyEnv]!
    }
  }
  return { ...plan, mcpKeys }
}
