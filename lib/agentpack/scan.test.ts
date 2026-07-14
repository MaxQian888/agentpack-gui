import {
  classifyAgainstRegistry,
  parseClaudeMcpConfig,
  parseClaudeRelay,
  parseCodexConfig,
  parseOpencodeMcpConfig,
} from "./scan"
import { mergeClaudeSettings, mergeCodexProvider } from "./merge/network"
import { mergeCodexMcp, mergeOpencodeMcp } from "./merge/mcp"

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

it("parseOpencodeMcpConfig lists mcp ids from opencode.json", () => {
  let json = mergeOpencodeMcp("", "context7", { type: "local", command: ["npx"] })
  json = mergeOpencodeMcp(json, "memory", { type: "local", command: ["npx"] })
  expect(parseOpencodeMcpConfig(json).sort()).toEqual(["context7", "memory"])
})

it("parseOpencodeMcpConfig tolerates empty / malformed / mcp-less input", () => {
  expect(parseOpencodeMcpConfig("")).toEqual([])
  expect(parseOpencodeMcpConfig("{not json")).toEqual([])
  expect(parseOpencodeMcpConfig("{}")).toEqual([])
  expect(parseOpencodeMcpConfig(JSON.stringify({ mcp: null }))).toEqual([])
})

it("classifyAgainstRegistry separates known from custom", () => {
  const out = classifyAgainstRegistry(["memory", "my-custom"], ["memory", "context7"])
  expect(out.known).toEqual(["memory"])
  expect(out.custom).toEqual(["my-custom"])
})
