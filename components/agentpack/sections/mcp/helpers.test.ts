import {
  anyPresent,
  describeSpec,
  existingIds,
  installedRows,
  presenceOf,
  rawConfigText,
  specFields,
} from "./helpers"
import type { McpSpec } from "@/lib/agentpack/merge/mcp"
import type { DashboardScan } from "../dashboard"

const LABELS = {
  command: "Command",
  url: "URL",
  env: "Env",
  headers: "Headers",
  bearerEnv: "Bearer env",
}

const scan = (over: Partial<DashboardScan>): DashboardScan =>
  ({
    claudeMcps: { known: [], custom: [] },
    codexMcps: { known: [], custom: [] },
    opencodeMcps: { known: [], custom: [] },
    claudeSkills: { known: [], custom: [] },
    codexSkills: { known: [], custom: [] },
    relay: { hasToken: false },
    hasCodexRelay: false,
    providers: [],
    claudeSettings: { status: "missing", hasBackup: false },
    codexConfig: { status: "missing", hasBackup: false },
    ...over,
  }) as DashboardScan

it("presenceOf reads per-target presence, and null scan is all-false", () => {
  const s = scan({
    claudeMcps: { known: ["context7"], custom: [] },
    opencodeMcps: { known: [], custom: ["context7"] },
  })
  expect(presenceOf(s, "context7")).toEqual({ claude: true, codex: false, opencode: true })
  expect(presenceOf(null, "context7")).toEqual({ claude: false, codex: false, opencode: false })
  expect(anyPresent(presenceOf(s, "context7"))).toBe(true)
  expect(anyPresent(presenceOf(s, "missing"))).toBe(false)
})

it("installedRows aggregates ids across targets and flags catalog membership", () => {
  const rows = installedRows(
    scan({
      claudeMcps: { known: ["context7"], custom: ["mine"] },
      codexMcps: { known: ["context7"], custom: [] },
    })
  )
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  expect(byId["context7"].known).toBe(true)
  expect(byId["context7"].presence).toEqual({ claude: true, codex: true, opencode: false })
  expect(byId["mine"].known).toBe(false)
  expect(existingIds(scan({ claudeMcps: { known: ["context7"], custom: ["mine"] } }))).toEqual(
    new Set(["context7", "mine"])
  )
})

it("describeSpec masks secret values", () => {
  const stdio: McpSpec = {
    transport: "stdio",
    command: "npx",
    args: ["-y", "pkg"],
    env: { K: "v" },
  }
  expect(describeSpec(stdio)).toEqual(["command: npx -y pkg", "env: K=••••••"])
  const http: McpSpec = {
    transport: "http",
    url: "https://x",
    headers: { Authorization: "Bearer t" },
    bearerTokenEnvVar: "T",
  }
  expect(describeSpec(http)).toEqual([
    "url: https://x",
    "header: Authorization: ••••••",
    "bearer env: T",
  ])
})

it("specFields builds labelled rows and flags secret-bearing values", () => {
  const stdio: McpSpec = {
    transport: "stdio",
    command: "npx",
    args: ["-y", "pkg"],
    env: { K: "s" },
  }
  const f = specFields(stdio, LABELS)
  expect(f[0]).toEqual({ label: "Command", value: "npx -y pkg", mono: true })
  expect(f[1]).toEqual({ label: "Env: K", value: "s", mono: true, secret: true })

  const http: McpSpec = {
    transport: "http",
    url: "https://x",
    headers: { Authorization: "Bearer t" },
    bearerTokenEnvVar: "T",
  }
  const h = specFields(http, LABELS)
  expect(h[0]).toEqual({ label: "URL", value: "https://x", mono: true })
  expect(h[1]).toEqual({
    label: "Headers: Authorization",
    value: "Bearer t",
    mono: true,
    secret: true,
  })
  expect(h[2]).toEqual({ label: "Bearer env", value: "T", mono: true })
})

it("rawConfigText renders each target's file shape with masked secrets", () => {
  const stdio: McpSpec = {
    transport: "stdio",
    command: "npx",
    args: ["-y", "pkg"],
    env: { K: "secret" },
  }
  const claude = rawConfigText("x", stdio, "claude")
  expect(claude).toContain('"mcpServers"')
  expect(claude).toContain('"command": "npx"')
  expect(claude).toContain("••••••")
  expect(claude).not.toContain("secret")

  expect(rawConfigText("x", stdio, "codex")).toContain("[mcp_servers.x]")

  const opencode = rawConfigText("x", stdio, "opencode")
  expect(opencode).toContain('"type": "local"')
  expect(opencode).toContain("••••••")
})
