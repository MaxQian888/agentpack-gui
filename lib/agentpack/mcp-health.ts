import type { McpSpec } from "./merge/mcp"

/**
 * Lightweight MCP server health check — pure orchestration, no Tauri import, so
 * it unit-tests with injected probes. Mirrors what cc-switch/CCHub actually do
 * cheaply: for a stdio server verify the executable resolves on PATH; for an http
 * server verify the endpoint's host:port is TCP-reachable and time it. It does
 * NOT spawn the server or run an MCP `initialize` handshake — that is slow, flaky,
 * and would trigger `npx` downloads for uninstalled packages.
 */

/** Coarse outcome, drives the badge color. */
export type McpHealthStatus = "ok" | "fail" | "unknown"

/** Machine-readable reason; the UI maps it to a localized sentence. */
export type McpHealthReason = "cmd-ok" | "cmd-missing" | "http-ok" | "http-unreachable" | "bad-url"

export interface McpHealth {
  status: McpHealthStatus
  reason: McpHealthReason
  /** Connect latency for a reachable http endpoint, ms. */
  latencyMs?: number
}

/** The side-effecting probes the check needs, injected so the core stays pure. */
export interface HealthProbes {
  commandOnPath: (command: string) => Promise<boolean>
  probeHost: (
    host: string,
    port: number,
    timeoutMs?: number
  ) => Promise<{ reachable: boolean; latencyMs: number | null }>
}

/**
 * Resolve an http spec's URL to a `{ host, port }` to probe, defaulting the port
 * from the scheme (443 for https, 80 otherwise). Returns `null` for a non-http
 * spec or an unparseable / hostless URL.
 */
export function httpTarget(spec: McpSpec): { host: string; port: number } | null {
  if (spec.transport !== "http") return null
  let url: URL
  try {
    url = new URL(spec.url)
  } catch {
    return null
  }
  if (!url.hostname) return null
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80
  if (!Number.isFinite(port) || port <= 0) return null
  return { host: url.hostname, port }
}

/**
 * Check one resolved spec's health using the injected probes. stdio → the command
 * must resolve on PATH; http → the endpoint must be TCP-reachable (latency
 * recorded). Never throws — a probe rejection is treated as a failure.
 */
export async function checkSpecHealth(spec: McpSpec, probes: HealthProbes): Promise<McpHealth> {
  if (spec.transport === "stdio") {
    const ok = await probes.commandOnPath(spec.command).catch(() => false)
    return ok ? { status: "ok", reason: "cmd-ok" } : { status: "fail", reason: "cmd-missing" }
  }
  const target = httpTarget(spec)
  if (!target) return { status: "fail", reason: "bad-url" }
  const probe = await probes
    .probeHost(target.host, target.port)
    .catch(() => ({ reachable: false, latencyMs: null }))
  return probe.reachable
    ? { status: "ok", reason: "http-ok", latencyMs: probe.latencyMs ?? undefined }
    : { status: "fail", reason: "http-unreachable" }
}
