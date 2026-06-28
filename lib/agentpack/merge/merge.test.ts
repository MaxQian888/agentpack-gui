import {
  buildClaudeMcpCommand,
  buildClaudeMcpRemoveCommand,
  buildCodexMcpEntry,
  deleteCodexMcpEntry,
  mergeCodexMcp,
} from "./mcp"
import {
  deleteClaudeRelay,
  deleteCodexProvider,
  mergeClaudeSettings,
  mergeCodexProvider,
  npmRegistryCommand,
} from "./network"
import { findMcp } from "../registry"
import type { McpServer } from "../types"

it("http MCP adds bearer header for Claude", () => {
  const cmd = buildClaudeMcpCommand(findMcp("supermemory")!, "k")
  expect(cmd.args).toEqual(expect.arrayContaining(["--transport", "http"]))
  expect(cmd.args.join(" ")).toContain("Authorization: Bearer k")
})

it("codex stdio entry embeds env key", () => {
  const e = buildCodexMcpEntry(findMcp("context7")!, "abc") as Record<string, unknown>
  expect(e.command).toBe("npx")
  expect(e.env).toEqual({ CONTEXT7_API_KEY: "abc" })
})

it("mergeCodexMcp is idempotent per id", () => {
  let toml = mergeCodexMcp("", "context7", { command: "npx", args: [] })
  toml = mergeCodexMcp(toml, "context7", { command: "npx", args: ["x"] })
  expect((toml.match(/context7/g) ?? []).length).toBe(1)
})

it("mergeClaudeSettings sets env block", () => {
  const out = mergeClaudeSettings("", { apiBaseUrl: "https://r", apiToken: "t" })
  expect(JSON.parse(out).env.ANTHROPIC_BASE_URL).toBe("https://r")
  expect(JSON.parse(out).env.ANTHROPIC_AUTH_TOKEN).toBe("t")
})

it("mergeCodexProvider sets agentpack relay and references env key", () => {
  const out = mergeCodexProvider("", { apiBaseUrl: "https://r" })
  expect(out).toContain("agentpack")
  expect(out).toContain("AGENTPACK_API_KEY")
  expect(out).not.toContain("token")
})

it("npmRegistryCommand builds an npm config set call", () => {
  expect(npmRegistryCommand("https://m")).toEqual({
    file: "npm",
    args: ["config", "set", "registry", "https://m"],
  })
})

it("claude stdio command omits --env when no key, embeds it when present", () => {
  const noKey = buildClaudeMcpCommand(findMcp("context7")!, undefined)
  expect(noKey.args).not.toContain("--env")
  expect(noKey.args.join(" ")).toContain("--scope user")
  const withKey = buildClaudeMcpCommand(findMcp("context7")!, "abc")
  expect(withKey.args.join(" ")).toContain("CONTEXT7_API_KEY=abc")
})

it("claude http command omits the bearer header when key is blank", () => {
  const cmd = buildClaudeMcpCommand(findMcp("supermemory")!, "   ")
  expect(cmd.args.join(" ")).not.toContain("Authorization")
})

it("claude stdio command appends extraArgs", () => {
  const cmd = buildClaudeMcpCommand(findMcp("filesystem")!, undefined)
  expect(cmd.args[cmd.args.length - 1]).toBe(".")
})

it("codex http entry references the bearer env var name", () => {
  const e = buildCodexMcpEntry(findMcp("supermemory")!, "k") as Record<string, unknown>
  expect(e.url).toBe("https://mcp.supermemory.ai/mcp")
  expect(e.bearer_token_env_var).toBe("SUPERMEMORY_API_KEY")
})

it("codex stdio entry omits env when no key is supplied", () => {
  const e = buildCodexMcpEntry(findMcp("context7")!, undefined) as Record<string, unknown>
  expect(e.env).toBeUndefined()
})

it("mergeClaudeSettings preserves an existing env block and partial inputs", () => {
  const existing = JSON.stringify({ env: { KEEP: "1" }, other: true })
  const out = JSON.parse(mergeClaudeSettings(existing, { apiBaseUrl: "https://r" }))
  expect(out.env.KEEP).toBe("1")
  expect(out.env.ANTHROPIC_BASE_URL).toBe("https://r")
  expect(out.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  expect(out.other).toBe(true)
})

it("mergeCodexProvider returns the input unchanged with no apiBaseUrl", () => {
  expect(mergeCodexProvider("existing = true", { apiToken: "t" })).toBe("existing = true")
})

it("buildClaudeMcpRemoveCommand targets the id with user scope", () => {
  expect(buildClaudeMcpRemoveCommand("context7")).toEqual({
    file: "claude",
    args: ["mcp", "remove", "context7", "--scope", "user"],
  })
})

it("deleteCodexMcpEntry drops the named table and keeps the rest", () => {
  let toml = mergeCodexMcp("", "context7", { command: "npx", args: [] })
  toml = mergeCodexMcp(toml, "memory", { command: "npx", args: [] })
  const out = deleteCodexMcpEntry(toml, "context7")
  expect(out).not.toContain("context7")
  expect(out).toContain("memory")
})

it("deleteCodexMcpEntry is a no-op for an unknown id or empty input", () => {
  const toml = mergeCodexMcp("", "memory", { command: "npx", args: [] })
  expect(deleteCodexMcpEntry(toml, "nope")).toContain("memory")
  expect(deleteCodexMcpEntry("", "memory")).toBe("")
})

it("deleteClaudeRelay removes only the relay env vars", () => {
  const existing = mergeClaudeSettings(JSON.stringify({ env: { KEEP: "1" } }), {
    apiBaseUrl: "https://r",
    apiToken: "t",
  })
  const out = JSON.parse(deleteClaudeRelay(existing))
  expect(out.env.KEEP).toBe("1")
  expect(out.env.ANTHROPIC_BASE_URL).toBeUndefined()
  expect(out.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
})

it("deleteClaudeRelay returns empty input unchanged", () => {
  expect(deleteClaudeRelay("")).toBe("")
})

it("deleteCodexProvider removes the agentpack provider and clears the selector", () => {
  const existing = mergeCodexProvider("", { apiBaseUrl: "https://r" })
  const out = deleteCodexProvider(existing)
  expect(out).not.toContain("agentpack")
  expect(out).not.toMatch(/model_provider\s*=/)
})

it("deleteCodexProvider keeps other providers and a non-agentpack selector", () => {
  const toml = 'model_provider = "other"\n\n[model_providers.other]\nname = "Other"\n'
  const out = deleteCodexProvider(toml)
  expect(out).toContain("other")
  expect(out).toContain('model_provider = "other"')
})

it("tolerates servers missing url / package / keyEnv via defensive fallbacks", () => {
  const bareHttp = { id: "bare-http", transport: "http" } as McpServer
  const claudeHttp = buildClaudeMcpCommand(bareHttp, undefined)
  expect(claudeHttp.args).toContain("") // url ?? ""
  expect(buildCodexMcpEntry(bareHttp, "k")).toEqual({ url: "" })

  const bareStdio = { id: "bare-stdio", transport: "stdio" } as McpServer
  const claudeStdio = buildClaudeMcpCommand(bareStdio, "k")
  expect(claudeStdio.args).toContain("npx")
  const codexStdio = buildCodexMcpEntry(bareStdio, undefined) as Record<string, unknown>
  expect(codexStdio.command).toBe("npx")
})
