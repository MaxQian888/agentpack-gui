import { findCli, findMcp, findSkill, installMethodsFor } from "./registry"
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import type { Plan } from "./types"

/** Bumped when the on-disk config schema changes incompatibly. */
export const CONFIG_VERSION = 1

export interface SerializeOptions {
  /** Include API keys / relay token in the output (default: redact). */
  includeSecrets?: boolean
}

/**
 * Serialize a Plan to a shareable JSON config. Secrets (MCP keys, relay token)
 * are redacted by default so the file is safe to commit; on load they are
 * refilled from a provided secrets map via `fillSecrets`.
 */
export function serializePlan(plan: Plan, opts: SerializeOptions = {}): string {
  const network = opts.includeSecrets ? plan.network : { ...plan.network, apiToken: undefined }
  const out = {
    version: CONFIG_VERSION,
    os: plan.os,
    clis: plan.clis,
    // Chosen install channel per CLI (undefined omitted by JSON.stringify).
    cliMethods: plan.cliMethods,
    skills: plan.skills,
    mcps: plan.mcps,
    mcpKeys: opts.includeSecrets ? plan.mcpKeys : {},
    network,
  }
  return JSON.stringify(out, null, 2) + "\n"
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
      ? (data["network"] as Plan["network"])
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
 * Fill missing MCP keys (and the relay token) from a provided secrets map.
 * Used after loading a redacted config so a replay can still authenticate.
 * Keys are looked up by each server's `keyEnv`; the relay token by
 * `AGENTPACK_API_KEY`.
 */
export function fillSecrets(plan: Plan, secrets: Record<string, string | undefined> = {}): Plan {
  const mcpKeys = { ...plan.mcpKeys }
  for (const m of plan.mcps) {
    const server = findMcp(m.id)
    if (server?.keyEnv && !mcpKeys[m.id] && secrets[server.keyEnv]) {
      mcpKeys[m.id] = secrets[server.keyEnv]!
    }
  }
  const network = { ...plan.network }
  if (!network.apiToken && secrets["AGENTPACK_API_KEY"]) {
    network.apiToken = secrets["AGENTPACK_API_KEY"]
  }
  return { ...plan, mcpKeys, network }
}
