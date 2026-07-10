import { parse } from "smol-toml"

/**
 * cc-connect (github.com/chenhg5/cc-connect) bridges local coding agents to
 * chat platforms. While its bridge process runs it serves a web management UI
 * on this port, overridable via `[management] port` in ~/.cc-connect/config.toml.
 */
export const CC_CONNECT_DEFAULT_PORT = 9820

/**
 * Web-UI port from cc-connect's config.toml. Falls back to the default on any
 * missing/unparseable config or out-of-range value — the config is auto-created
 * by cc-connect itself, so garbage in should never break the section.
 */
export function parseManagementPort(toml: string): number {
  try {
    const doc = parse(toml) as { management?: { port?: unknown } }
    const port = doc.management?.port
    if (typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port
    }
  } catch {
    // fall through to the default
  }
  return CC_CONNECT_DEFAULT_PORT
}

/** The management UI is only ever bound locally; remote hosts are out of scope. */
export function webUiUrl(port: number): string {
  return `http://localhost:${port}`
}
