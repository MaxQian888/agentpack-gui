import {
  classifyAgainstRegistry,
  parseClaudeMcpList,
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

it("parseClaudeMcpList extracts ids before the colon and skips noise", () => {
  const stdout = [
    "context7: npx -y @upstash/context7-mcp",
    "memory: npx -y server",
    "",
    "garbage",
  ].join("\n")
  expect(parseClaudeMcpList(stdout)).toEqual(["context7", "memory"])
})

it("parseClaudeMcpList strips status glyphs / ANSI prefixes", () => {
  const stdout = "[32m✓[0m context7: connected"
  expect(parseClaudeMcpList(stdout)).toEqual(["context7"])
})

it("classifyAgainstRegistry separates known from custom", () => {
  const out = classifyAgainstRegistry(["memory", "my-custom"], ["memory", "context7"])
  expect(out.known).toEqual(["memory"])
  expect(out.custom).toEqual(["my-custom"])
})
