import {
  classifyAgainstRegistry,
  parseClaudeMcpConfig,
  parseClaudeRelay,
  parseCodexConfig,
} from "./scan"
import { mergeClaudeSettings, mergeCodexProvider } from "./merge/network"
import { mergeCodexMcp } from "./merge/mcp"

it("parseClaudeRelay inverts mergeClaudeSettings", () => {
  const json = mergeClaudeSettings("", { apiBaseUrl: "https://r", apiToken: "t" })
  const out = parseClaudeRelay(json)
  expect(out.baseUrl).toBe("https://r")
  expect(out.hasToken).toBe(true)
})

it("parseClaudeRelay tolerates empty / malformed input", () => {
  expect(parseClaudeRelay("")).toEqual({ hasToken: false })
  expect(parseClaudeRelay("{not json")).toEqual({ hasToken: false })
  expect(parseClaudeRelay("{}")).toEqual({ hasToken: false })
})

it("parseCodexConfig lists mcp servers and detects relay provider", () => {
  let toml = mergeCodexMcp("", "context7", { command: "npx", args: [] })
  toml = mergeCodexMcp(toml, "memory", { command: "npx", args: [] })
  toml = mergeCodexProvider(toml, { apiBaseUrl: "https://r" })
  const out = parseCodexConfig(toml)
  expect(out.mcpServers.sort()).toEqual(["context7", "memory"])
  expect(out.hasRelayProvider).toBe(true)
})

it("parseCodexConfig tolerates empty / malformed input", () => {
  expect(parseCodexConfig("")).toEqual({ mcpServers: [], hasRelayProvider: false })
  expect(parseCodexConfig("= = =")).toEqual({ mcpServers: [], hasRelayProvider: false })
})

it("parseClaudeMcpConfig lists user-scope mcpServers ids from ~/.claude.json", () => {
  const json = JSON.stringify({
    mcpServers: { context7: { command: "npx" }, memory: { command: "npx" } },
    projects: { "/some/proj": { mcpServers: { other: {} } } },
  })
  expect(parseClaudeMcpConfig(json).sort()).toEqual(["context7", "memory"])
})

it("parseClaudeMcpConfig tolerates empty / malformed / server-less input", () => {
  expect(parseClaudeMcpConfig("")).toEqual([])
  expect(parseClaudeMcpConfig("{not json")).toEqual([])
  expect(parseClaudeMcpConfig("{}")).toEqual([])
  expect(parseClaudeMcpConfig(JSON.stringify({ mcpServers: null }))).toEqual([])
})

it("classifyAgainstRegistry separates known from custom", () => {
  const out = classifyAgainstRegistry(["memory", "my-custom"], ["memory", "context7"])
  expect(out.known).toEqual(["memory"])
  expect(out.custom).toEqual(["my-custom"])
})
