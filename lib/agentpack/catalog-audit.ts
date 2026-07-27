/**
 * Staleness checks for the hardcoded catalog.
 *
 * The catalog pins npm packages, installer script URLs and package-manager ids
 * that upstream is free to rename, deprecate or delete. When that happens the
 * failure is often silent: `claude mcp add` writes a config for a package that
 * does not exist, and the user only finds out later inside their agent. This
 * module turns "is the catalog still true?" into pure functions over fetched
 * responses, so the same logic backs the weekly CI audit and the in-app check.
 *
 * Browser-safe: no Node builtins, no fetching — callers supply the responses.
 */

import { CLI_TOOLS, MCP_SERVERS, RUNTIMES } from "./registry"

/** Verdict for one npm package. */
export interface PackageHealth {
  name: string
  /** False when the registry returned 404 — the package does not exist at all. */
  exists: boolean
  /** True when npm marks the latest version deprecated. */
  deprecated: boolean
  /** npm's deprecation text, when deprecated. */
  message?: string
  /** The latest published version, when resolvable. */
  latest?: string
}

/**
 * The subset of an npm version manifest (`registry.npmjs.org/<pkg>/latest`) we
 * read. npm sets `deprecated` to the deprecation message string; some packages
 * carry a stray empty string, which does NOT mean deprecated.
 */
export interface NpmVersionManifest {
  version?: string
  deprecated?: string
}

/**
 * Turn a fetched `/<pkg>/latest` response into a verdict. A 404 means the
 * package never existed or was unpublished; any other non-OK status is treated
 * as "reachable but unreadable" and reported as existing-but-unknown, so a
 * flaky registry never fails the audit with a false "package is gone".
 */
export function parsePackageHealth(
  name: string,
  status: number,
  body: NpmVersionManifest | null
): PackageHealth {
  if (status === 404) return { name, exists: false, deprecated: false }
  if (status < 200 || status >= 300 || !body) return { name, exists: true, deprecated: false }
  const message = typeof body.deprecated === "string" ? body.deprecated.trim() : ""
  return {
    name,
    exists: true,
    deprecated: message.length > 0,
    message: message.length > 0 ? message : undefined,
    latest: body.version,
  }
}

/** True when a verdict should fail the audit / be flagged in the UI. */
export function isUnhealthy(health: PackageHealth): boolean {
  return !health.exists || health.deprecated
}

/** A one-line, human-readable reason a package was flagged. */
export function describeHealth(health: PackageHealth): string {
  if (!health.exists) return `${health.name}: does not exist on npm (404)`
  if (health.deprecated) return `${health.name}: deprecated — ${health.message ?? "no message"}`
  return `${health.name}: ok${health.latest ? ` (${health.latest})` : ""}`
}

/**
 * Whether an HTTP status means a catalog URL is genuinely broken.
 *
 * Only "this resource is gone" counts. An authenticated endpoint answering 401 /
 * 403, or one that rejects the probe method with 405, is reachable and correct —
 * flagging those would make the weekly audit cry wolf until it gets ignored.
 * 5xx is upstream having a bad day, not the catalog being wrong.
 */
export function isUrlBroken(status: number): boolean {
  return status === 404 || status === 410
}

/** One thing the audit checks, tagged with where in the catalog it came from. */
export interface AuditTarget {
  kind: "npm" | "pypi" | "url"
  /** Package name, or the URL to probe. */
  value: string
  /** Catalog entry this came from, for the failure report. */
  source: string
}

const HTTP_URL = /^https?:\/\/\S+$/

/**
 * Every npm package and remote URL the catalog depends on, de-duplicated.
 *
 * Installer commands embed their URL inside a shell string (`curl -fsSL <url> |
 * bash`), so pull URLs out of the command args rather than maintaining a second
 * hand-written list that could drift from the commands actually run.
 */
export function collectAuditTargets(): AuditTarget[] {
  const seen = new Set<string>()
  const out: AuditTarget[] = []
  const add = (kind: AuditTarget["kind"], value: string, source: string) => {
    const key = `${kind}:${value}`
    if (!value || seen.has(key)) return
    seen.add(key)
    out.push({ kind, value, source })
  }

  const addUrlsFrom = (args: readonly string[] | undefined, source: string) => {
    for (const arg of args ?? []) {
      for (const token of arg.split(/[\s"'|]+/)) {
        // Strip trailing punctuation a shell string may leave attached.
        const url = token.replace(/[),.;]+$/, "")
        if (HTTP_URL.test(url)) add("url", url, source)
      }
    }
  }

  for (const cli of CLI_TOOLS) {
    if (cli.npmPackage) add("npm", cli.npmPackage, `cli:${cli.id}`)
    for (const os of ["win", "mac", "linux"] as const) {
      addUrlsFrom(cli.install[os]?.args, `cli:${cli.id}:install:${os}`)
      for (const m of cli.methods?.[os] ?? []) {
        addUrlsFrom(m.command.args, `cli:${cli.id}:${m.id}:${os}`)
      }
    }
  }

  for (const rt of RUNTIMES) {
    for (const os of ["win", "mac", "linux"] as const) {
      addUrlsFrom(rt.install[os]?.args, `runtime:${rt.id}:install:${os}`)
      for (const m of rt.methods?.[os] ?? []) {
        addUrlsFrom(m.command.args, `runtime:${rt.id}:${m.id}:${os}`)
      }
    }
  }

  for (const mcp of MCP_SERVERS) {
    // uvx servers resolve against PyPI, not npm — checking them on npm would
    // report a false 404 (exactly the bug this audit exists to catch), and
    // skipping them entirely would leave that same spot unwatched.
    if (mcp.npmPackage) {
      add(mcp.runtime === "uvx" ? "pypi" : "npm", mcp.npmPackage, `mcp:${mcp.id}`)
    }
    if (mcp.url) add("url", mcp.url, `mcp:${mcp.id}:endpoint`)
  }

  return out
}
